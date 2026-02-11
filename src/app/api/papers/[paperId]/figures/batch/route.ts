import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import {
  normalizeFigurePreferences,
  resolveThemeFromPreferences,
  resolveSketchStyleFromPreferences,
  type FigureSuggestionPreferences
} from '@/lib/figure-generation/preferences';

export const runtime = 'nodejs';

const preferencesSchema = z.object({
  stylePreset: z.enum(['auto', 'ieee_clean', 'nature_minimal', 'industrial_dashboard', 'technical_blueprint', 'conceptual_storyboard']).optional(),
  outputMix: z.enum(['auto', 'balanced', 'charts_first', 'diagrams_first', 'include_sketches']).optional(),
  chartPreference: z.enum(['auto', 'bar_line', 'distribution', 'correlation', 'comparative']).optional(),
  diagramPreference: z.enum(['auto', 'flow', 'architecture', 'sequence', 'conceptual']).optional(),
  visualTone: z.enum(['auto', 'formal', 'minimal', 'high_contrast', 'presentation_ready']).optional(),
  colorMode: z.enum(['auto', 'color', 'grayscale', 'colorblind_safe']).optional(),
  detailLevel: z.enum(['auto', 'simple', 'moderate', 'advanced']).optional(),
  annotationDensity: z.enum(['auto', 'light', 'balanced', 'detailed']).optional(),
  targetAudience: z.enum(['auto', 'academic', 'industry', 'mixed']).optional(),
  exportFormat: z.enum(['auto', 'png', 'svg', 'pdf']).optional(),
  strictness: z.enum(['soft', 'strict']).optional()
});

const suggestionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATION', 'SKETCH', 'CUSTOM']).optional(),
  suggestedType: z.string().optional(),
  rendererPreference: z.enum(['plantuml', 'mermaid', 'auto']).optional(),
  relevantSection: z.string().optional(),
  importance: z.enum(['required', 'recommended', 'optional']).optional(),
  dataNeeded: z.string().optional(),
  whyThisFigure: z.string().optional(),
  diagramSpec: z.object({
    layout: z.enum(['LR', 'TD']).optional(),
    nodes: z.array(z.object({
      idHint: z.string(),
      label: z.string(),
      group: z.string().optional()
    })).optional(),
    edges: z.array(z.object({
      fromHint: z.string(),
      toHint: z.string(),
      label: z.string().optional(),
      type: z.enum(['solid', 'dashed', 'async']).optional()
    })).optional(),
    groups: z.array(z.object({
      name: z.string(),
      nodeIds: z.array(z.string()).optional(),
      description: z.string().optional()
    })).optional(),
    splitSuggestion: z.string().optional()
  }).optional(),
  // Sketch/illustration-specific fields
  sketchStyle: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional(),
  sketchPrompt: z.string().optional(),
  sketchMode: z.enum(['SUGGEST', 'GUIDED']).optional()
});

const batchSchema = z.object({
  mode: z.enum(['generateExisting', 'createAndGenerateFromSuggestions']),
  figureIds: z.array(z.string().min(1)).optional(),
  suggestions: z.array(suggestionSchema).optional(),
  preferences: preferencesSchema.optional(),
  useLLM: z.boolean().optional().default(true),
  continueOnError: z.boolean().optional().default(true)
}).superRefine((value, ctx) => {
  if (value.mode === 'generateExisting' && (!value.figureIds || value.figureIds.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['figureIds'], message: 'At least one figure ID is required' });
  }

  if (value.mode === 'createAndGenerateFromSuggestions' && (!value.suggestions || value.suggestions.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['suggestions'], message: 'At least one suggestion is required' });
  }
});

type BatchTask =
  | {
      type: 'figure';
      figureId: string;
      title: string;
      description: string;
      caption: string;
      figureType: string;
      category: 'DATA_CHART' | 'DIAGRAM' | 'STATISTICAL_PLOT' | 'ILLUSTRATION' | 'SKETCH' | 'CUSTOM';
      suggestionMeta?: Record<string, unknown>;
    }
  | {
      type: 'sketch';
      figureId: string;
      title: string;
      description: string;
      mode: 'SUGGEST' | 'GUIDED' | 'REFINE';
      sketchStyle?: 'academic' | 'scientific' | 'conceptual' | 'technical';
      sketchPrompt?: string;
    };

function inferFigureType(
  category?: string,
  suggestedType?: string
): string {
  if (suggestedType && suggestedType.trim()) {
    return suggestedType.trim();
  }

  if (category === 'DATA_CHART') return 'bar';
  if (category === 'STATISTICAL_PLOT') return 'scatter';
  if (category === 'SKETCH') return 'sketch-auto';
  return 'flowchart';
}

function inferCategory(
  category?: string,
  suggestedType?: string
): 'DATA_CHART' | 'DIAGRAM' | 'STATISTICAL_PLOT' | 'ILLUSTRATION' | 'SKETCH' | 'CUSTOM' {
  if (category === 'DATA_CHART' || category === 'DIAGRAM' || category === 'STATISTICAL_PLOT' || category === 'ILLUSTRATION' || category === 'SKETCH' || category === 'CUSTOM') {
    return category;
  }

  const type = (suggestedType || '').toLowerCase();
  if (type.startsWith('sketch')) return 'SKETCH';
  if (['bar', 'line', 'pie', 'scatter', 'radar', 'doughnut'].includes(type)) return 'DATA_CHART';
  if (['histogram', 'boxplot', 'heatmap'].includes(type)) return 'STATISTICAL_PLOT';
  return 'DIAGRAM';
}

function isSketchFigure(category: string, figureType: string): boolean {
  return category === 'SKETCH' || figureType.toLowerCase().startsWith('sketch');
}

function getSketchMode(figureType: string): 'SUGGEST' | 'GUIDED' | 'REFINE' {
  const lower = figureType.toLowerCase();
  if (lower.includes('guided')) return 'GUIDED';
  if (lower.includes('refine')) return 'REFINE';
  return 'SUGGEST';
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({ where });
}

async function markFigureStatus(figureId: string, status: 'GENERATING' | 'FAILED', extra?: Record<string, unknown>) {
  const figure = await prisma.figurePlan.findUnique({ where: { id: figureId } });
  if (!figure) return;
  const meta = (figure.nodes as any) || {};

  await prisma.figurePlan.update({
    where: { id: figureId },
    data: {
      nodes: {
        ...meta,
        status,
        ...(extra || {})
      }
    }
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { paperId: sessionId } = await context.params;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const payload = batchSchema.parse(await request.json());
    const preferences: FigureSuggestionPreferences = normalizeFigurePreferences(payload.preferences || {});

    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    const origin = request.nextUrl.origin;
    const results: Array<Record<string, unknown>> = [];
    const tasks: BatchTask[] = [];

    if (payload.mode === 'generateExisting') {
      const orderedIds = payload.figureIds || [];
      const figures = await prisma.figurePlan.findMany({
        where: {
          sessionId,
          id: { in: orderedIds }
        }
      });

      const byId = new Map(figures.map((figure) => [figure.id, figure]));

      for (const figureId of orderedIds) {
        const figure = byId.get(figureId);
        if (!figure) {
          results.push({ figureId, success: false, error: 'Figure not found in this session' });
          if (!payload.continueOnError) break;
          continue;
        }

        const nodes = (figure.nodes as any) || {};
        const category = inferCategory(nodes.category, nodes.figureType);
        const figureType = inferFigureType(category, nodes.figureType);
        const caption = nodes.caption || figure.description || '';
        const description = nodes.notes || caption || figure.title;

        if (isSketchFigure(category, figureType)) {
          const sketchMeta = nodes.suggestionMeta || {};
          tasks.push({
            type: 'sketch',
            figureId: figure.id,
            title: figure.title,
            description,
            mode: getSketchMode(figureType),
            sketchStyle: sketchMeta.sketchStyle || nodes.sketchStyle || undefined,
            sketchPrompt: sketchMeta.sketchPrompt || undefined
          });
          continue;
        }

        tasks.push({
          type: 'figure',
          figureId: figure.id,
          title: figure.title,
          caption,
          description,
          figureType,
          category,
          suggestionMeta: nodes.suggestionMeta || undefined
        });
      }
    }

    if (payload.mode === 'createAndGenerateFromSuggestions') {
      const max = await prisma.figurePlan.aggregate({
        where: { sessionId },
        _max: { figureNo: true }
      });
      let nextFigureNo = (max._max.figureNo || 0) + 1;

      for (const suggestion of payload.suggestions || []) {
        const category = inferCategory(suggestion.category, suggestion.suggestedType);
        const figureType = inferFigureType(category, suggestion.suggestedType);
        const description = (suggestion.description || '').trim() || suggestion.title;

        if (isSketchFigure(category, figureType)) {
          // Persist a figurePlan record before generating so the sketch has an ID
          const sketchNodePayload: Record<string, unknown> = {
            status: 'PLANNED',
            category: 'SKETCH',
            figureType,
            caption: description,
            notes: description,
            relevantSection: suggestion.relevantSection || null,
            importance: suggestion.importance || null,
            appliedPreferences: preferences as unknown as Record<string, unknown>,
            suggestionMeta: {
              relevantSection: suggestion.relevantSection || null,
              importance: suggestion.importance || null,
              dataNeeded: suggestion.dataNeeded || null,
              whyThisFigure: suggestion.whyThisFigure || null,
              sketchStyle: (suggestion as any).sketchStyle || null,
              sketchPrompt: (suggestion as any).sketchPrompt || null,
              sketchMode: (suggestion as any).sketchMode || null
            }
          };

          const createdSketch = await prisma.figurePlan.create({
            data: {
              sessionId,
              figureNo: nextFigureNo,
              title: suggestion.title,
              description,
              nodes: sketchNodePayload as any,
              edges: []
            }
          });
          nextFigureNo += 1;

          tasks.push({
            type: 'sketch',
            figureId: createdSketch.id,
            title: suggestion.title,
            description,
            mode: getSketchMode(figureType),
            sketchStyle: (suggestion as any).sketchStyle || undefined,
            sketchPrompt: (suggestion as any).sketchPrompt || undefined
          });
          continue;
        }

        const nodePayload: Record<string, unknown> = {
          status: 'PLANNED',
          category,
          figureType,
          caption: description,
          notes: description,
          relevantSection: suggestion.relevantSection || null,
          importance: suggestion.importance || null,
          appliedPreferences: preferences as unknown as Record<string, unknown>,
          suggestionMeta: {
            relevantSection: suggestion.relevantSection || null,
            importance: suggestion.importance || null,
            dataNeeded: suggestion.dataNeeded || null,
            whyThisFigure: suggestion.whyThisFigure || null,
            rendererPreference: suggestion.rendererPreference || null,
            diagramSpec: suggestion.diagramSpec || null
          }
        };

        const created = await prisma.figurePlan.create({
          data: {
            sessionId,
            figureNo: nextFigureNo,
            title: suggestion.title,
            description,
            nodes: nodePayload as any,
            edges: []
          }
        });
        nextFigureNo += 1;

        tasks.push({
          type: 'figure',
          figureId: created.id,
          title: created.title,
          caption: description,
          description,
          figureType,
          category,
          suggestionMeta: {
            relevantSection: suggestion.relevantSection,
            importance: suggestion.importance,
            dataNeeded: suggestion.dataNeeded,
            whyThisFigure: suggestion.whyThisFigure,
            rendererPreference: suggestion.rendererPreference,
            diagramSpec: suggestion.diagramSpec
          }
        });
      }
    }

    const resolvedTheme = resolveThemeFromPreferences(preferences);
    const sketchStyle = resolveSketchStyleFromPreferences(preferences);

    // -----------------------------------------------------------------------
    // Concurrency-limited parallel execution with per-task retry
    // -----------------------------------------------------------------------
    const CONCURRENCY_LIMIT = 4;
    const MAX_TASK_RETRIES = 1;

    // Assert authHeader is string - we already checked for null and returned 401 above
    const authToken: string = authHeader;

    /**
     * Determine whether a generation error is worth retrying.
     * Retryable: LLM syntax errors, transient network issues, 5xx responses.
     * Not retryable: 401/403 auth, 404 not found, validation errors.
     */
    const isRetryableError = (status: number, errorMessage?: string): boolean => {
      if (status >= 500) return true;
      if (status === 429) return true; // rate limit
      const msg = (errorMessage || '').toLowerCase();
      if (msg.includes('invalid json') || msg.includes('invalid chart') || msg.includes('mermaid') || msg.includes('plantuml') || msg.includes('kroki') || msg.includes('syntax') || msg.includes('parse')) return true;
      if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('fetch failed')) return true;
      return false;
    };

    /**
     * Process a single figure or sketch task, with up to MAX_TASK_RETRIES retries.
     */
    const processTask = async (
      task: BatchTask,
      retryCount: number = 0
    ): Promise<Record<string, unknown>> => {
      try {
        if (task.type === 'figure') {
          await markFigureStatus(task.figureId, 'GENERATING');

          const response = await fetch(`${origin}/api/papers/${sessionId}/figures/${task.figureId}/generate`, {
            method: 'POST',
            headers: {
              Authorization: authToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              figureType: task.figureType,
              category: task.category,
              title: task.title,
              caption: task.caption,
              description: task.description,
              preferences,
              suggestionMeta: task.suggestionMeta,
              theme: resolvedTheme,
              useLLM: payload.useLLM
            })
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            // Retry on retryable errors
            if (retryCount < MAX_TASK_RETRIES && isRetryableError(response.status, data.error)) {
              console.warn(`[PaperFiguresBatch] Retrying figure "${task.title}" (attempt ${retryCount + 2})...`);
              await new Promise(resolve => setTimeout(resolve, 1500));
              return processTask(task, retryCount + 1);
            }
            await markFigureStatus(task.figureId, 'FAILED', { lastError: data.error || 'Generation failed', retries: retryCount });
            return { figureId: task.figureId, title: task.title, success: false, error: data.error || 'Generation failed', retries: retryCount };
          }

          return { figureId: task.figureId, title: task.title, success: true, imagePath: data.imagePath || null, retries: retryCount };
        }

        // Sketch task
        await markFigureStatus(task.figureId, 'GENERATING');

        // Use the rich sketchPrompt if available, otherwise fall back to description
        const sketchUserPrompt = task.sketchPrompt || task.description;
        const resolvedSketchStyle = task.sketchStyle || sketchStyle;

        const sketchResponse = await fetch(`${origin}/api/papers/${sessionId}/figures/${task.figureId}/sketch`, {
          method: 'POST',
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            mode: task.mode,
            title: task.title,
            userPrompt: sketchUserPrompt,
            style: resolvedSketchStyle
          })
        });

        const sketchData = await sketchResponse.json().catch(() => ({}));
        if (!sketchResponse.ok) {
          // Retry on retryable errors
          if (retryCount < MAX_TASK_RETRIES && isRetryableError(sketchResponse.status, sketchData.error)) {
            console.warn(`[PaperFiguresBatch] Retrying sketch "${task.title}" (attempt ${retryCount + 2})...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            return processTask(task, retryCount + 1);
          }
          await markFigureStatus(task.figureId, 'FAILED', { lastError: sketchData.error || 'Sketch generation failed', retries: retryCount });
          return { figureId: task.figureId, title: task.title, success: false, error: sketchData.error || 'Sketch generation failed', retries: retryCount };
        }

        return {
          figureId: sketchData.figureId || task.figureId,
          title: task.title,
          success: true,
          imagePath: sketchData.imagePath || null,
          generatedAs: 'sketch',
          retries: retryCount
        };
      } catch (taskError) {
        // Retry on transient errors
        if (retryCount < MAX_TASK_RETRIES) {
          console.warn(`[PaperFiguresBatch] Retrying task "${task.title}" after exception (attempt ${retryCount + 2})...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          return processTask(task, retryCount + 1);
        }

        const errorMsg = taskError instanceof Error ? taskError.message : 'Generation failed';
        await markFigureStatus(task.figureId, 'FAILED', { lastError: errorMsg, retries: retryCount });

        return {
          figureId: task.figureId,
          title: task.title,
          success: false,
          error: errorMsg,
          retries: retryCount
        };
      }
    };

    /**
     * Run an array of async task factories with a maximum concurrency limit.
     * Returns results in the original task order.
     */
    const runWithConcurrency = async <T,>(
      factories: (() => Promise<T>)[],
      concurrency: number
    ): Promise<T[]> => {
      const orderedResults: T[] = new Array(factories.length);
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < factories.length) {
          const idx = nextIndex++;
          orderedResults[idx] = await factories[idx]();
        }
      };

      const workers = Array.from(
        { length: Math.min(concurrency, factories.length) },
        () => worker()
      );
      await Promise.all(workers);
      return orderedResults;
    };

    // Choose parallel vs sequential based on continueOnError
    if (payload.continueOnError && tasks.length > 1) {
      // Parallel processing - all tasks run concurrently (up to CONCURRENCY_LIMIT)
      console.log(`[PaperFiguresBatch] Processing ${tasks.length} tasks in parallel (concurrency=${CONCURRENCY_LIMIT})`);
      const taskFactories = tasks.map((task) => () => processTask(task));
      const parallelResults = await runWithConcurrency(taskFactories, CONCURRENCY_LIMIT);
      results.push(...parallelResults);
    } else {
      // Sequential processing - stop on first error if continueOnError is false
      console.log(`[PaperFiguresBatch] Processing ${tasks.length} tasks sequentially`);
      for (const task of tasks) {
        const taskResult = await processTask(task);
        results.push(taskResult);
        if (!payload.continueOnError && taskResult.success === false) {
          break;
        }
      }
    }

    const successCount = results.filter((entry) => entry.success === true).length;
    const failureCount = results.filter((entry) => entry.success === false).length;
    const requestedCount = payload.mode === 'generateExisting'
      ? (payload.figureIds?.length || 0)
      : (payload.suggestions?.length || 0);

    return NextResponse.json({
      success: failureCount === 0 && requestedCount > 0,
      mode: payload.mode,
      totalRequested: requestedCount,
      generated: successCount,
      failed: failureCount,
      continueOnError: payload.continueOnError,
      preferences,
      results
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFiguresBatch] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process figure batch' },
      { status: 500 }
    );
  }
}
