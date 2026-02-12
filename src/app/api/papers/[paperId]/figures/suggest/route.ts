import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { generateFigureSuggestions } from '@/lib/figure-generation/llm-figure-service';
import { FigureSuggestion } from '@/lib/figure-generation/types';
import { chooseDiagramRenderer } from '@/lib/figure-generation/diagram-renderer-policy';
import {
  normalizeFigurePreferences,
  DEFAULT_FIGURE_SUGGESTION_PREFERENCES,
  type FigureSuggestionPreferences
} from '@/lib/figure-generation/preferences';

export const runtime = 'nodejs';

// ── Types for persisted suggestion cache ────────────────────────────
type CachedSuggestionStatus = 'pending' | 'used' | 'dismissed';

interface CachedSuggestionItem {
  id: string;
  status: CachedSuggestionStatus;
  usedByFigureId?: string | null;
  usedAt?: string | null;
  // All original FigureSuggestion fields
  title: string;
  description: string;
  category: string;
  suggestedType?: string;
  rendererPreference?: string;
  relevantSection?: string;
  importance?: string;
  dataNeeded?: string;
  whyThisFigure?: string;
  diagramSpec?: unknown;
  sketchStyle?: string;
  sketchPrompt?: string;
  sketchMode?: string;
}

interface SuggestionCache {
  generatedAt: string;
  usedLLM: boolean;
  preferences?: unknown;
  items: CachedSuggestionItem[];
}

type FocusHints = {
  entities?: string[];
  metrics?: string[];
  verbs?: string[];
};

const suggestSchema = z.object({
  paperTitle: z.string().optional(),
  paperAbstract: z.string().optional(),
  sections: z.record(z.string()).optional(),
  researchType: z.string().optional(),
  datasetDescription: z.string().optional(),
  blueprint: z.object({
    thesisStatement: z.string().optional(),
    centralObjective: z.string().optional(),
    keyContributions: z.array(z.string()).optional(),
    sectionPlan: z.array(z.object({
      sectionKey: z.string(),
      mustCover: z.array(z.string()).optional(),
      mustAvoid: z.array(z.string()).optional()
    })).optional()
  }).optional(),
  preferences: z.object({
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
  }).optional(),
  // Whether to use LLM for suggestions (default true)
  useLLM: z.boolean().optional().default(true),
  // Focus mode: when provided, suggestions are constrained to this specific text
  focusText: z.string().max(5000).optional(),
  focusSection: z.string().optional(),
  focusMode: z.enum(['selection', 'section']).optional(),
  focusHints: z.object({
    entities: z.array(z.string().max(120)).max(20).optional(),
    metrics: z.array(z.string().max(120)).max(20).optional(),
    verbs: z.array(z.string().max(80)).max(20).optional()
  }).optional()
});


/** Lightweight session lookup – only checks ownership, returns figureSuggestionCache */
async function getSessionLight(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    select: { id: true, figureSuggestionCache: true }
  });
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      researchTopic: true,
      paperType: true,
      paperBlueprint: true,
      paperSections: {
        orderBy: { updatedAt: 'desc' }
      },
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  });
}

function extractSectionMap(session: any, overrideSections?: Record<string, string>): Record<string, string> {
  if (overrideSections && Object.keys(overrideSections).length > 0) {
    return overrideSections;
  }

  const fromPaperSections = Array.isArray(session?.paperSections)
    ? session.paperSections.reduce((acc: Record<string, string>, section: any) => {
        if (section?.sectionKey && typeof section?.content === 'string' && section.content.trim()) {
          acc[section.sectionKey] = section.content;
        }
        return acc;
      }, {})
    : {};

  if (Object.keys(fromPaperSections).length > 0) {
    return fromPaperSections;
  }

  return (session?.annexureDrafts?.[0] as any)?.extraSections || {};
}

function extractBlueprintContext(session: any) {
  const blueprint = session?.paperBlueprint;
  if (!blueprint) {
    return undefined;
  }

  const sectionPlanRaw = Array.isArray(blueprint.sectionPlan) ? blueprint.sectionPlan : [];
  return {
    thesisStatement: blueprint.thesisStatement || undefined,
    centralObjective: blueprint.centralObjective || undefined,
    keyContributions: Array.isArray(blueprint.keyContributions) ? blueprint.keyContributions : undefined,
    sectionPlan: sectionPlanRaw
      .filter((section: any) => section?.sectionKey)
      .map((section: any) => ({
        sectionKey: section.sectionKey,
        mustCover: Array.isArray(section.mustCover) ? section.mustCover : [],
        mustAvoid: Array.isArray(section.mustAvoid) ? section.mustAvoid : []
      }))
  };
}

function dedupeList(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function extractMetricHints(text: string): string[] {
  const hits: string[] = [];
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:%|ms|s|sec|seconds|min|minutes|hours|hz|khz|mhz|ghz|fps|mb|gb|tb)\b/gi,
    /\b(?:accuracy|precision|recall|f1|f1-score|auc|roc-auc|latency|throughput|loss|rmse|mae|mape|iou|bleu|rouge|perplexity)\b(?:\s*[:=]\s*\d+(?:\.\d+)?(?:\s*%|\s*ms|\s*s)?)?/gi,
    /\bp\s*[<=>]\s*0?\.\d+\b/gi,
    /\bN\s*=\s*\d+\b/gi
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) hits.push(...matches.map(m => m.trim()));
  }
  return dedupeList(hits, 10);
}

function extractVerbHints(text: string): string[] {
  const verbPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: 'compare', pattern: /\bcompar(?:e|es|ed|ing|ison)\b/gi },
    { label: 'classify', pattern: /\bclassif(?:y|ies|ied|ying|ication)\b/gi },
    { label: 'predict', pattern: /\bpredict(?:s|ed|ing|ion)\b/gi },
    { label: 'detect', pattern: /\bdetect(?:s|ed|ing|ion)\b/gi },
    { label: 'optimize', pattern: /\boptimi[sz](?:e|es|ed|ing|ation)\b/gi },
    { label: 'evaluate', pattern: /\bevaluat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'benchmark', pattern: /\bbenchmark(?:s|ed|ing)?\b/gi },
    { label: 'aggregate', pattern: /\baggregat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'train', pattern: /\btrain(?:s|ed|ing)?\b/gi },
    { label: 'infer', pattern: /\binfer(?:s|red|ring|ence)\b/gi },
    { label: 'segment', pattern: /\bsegment(?:s|ed|ing|ation)\b/gi },
    { label: 'cluster', pattern: /\bcluster(?:s|ed|ing)?\b/gi },
    { label: 'rank', pattern: /\brank(?:s|ed|ing)?\b/gi },
    { label: 'retrieve', pattern: /\bretriev(?:e|es|ed|ing|al)\b/gi },
    { label: 'summarize', pattern: /\bsummariz(?:e|es|ed|ing|ation)\b/gi },
    { label: 'generate', pattern: /\bgenerat(?:e|es|ed|ing|ion)\b/gi },
    { label: 'analyze', pattern: /\banaly[sz](?:e|es|ed|ing|is)\b/gi }
  ];

  const scored: Array<{ label: string; count: number }> = [];
  for (const item of verbPatterns) {
    const matches = text.match(item.pattern);
    if (!matches || matches.length === 0) continue;
    scored.push({ label: item.label, count: matches.length });
  }
  scored.sort((a, b) => b.count - a.count);
  return scored.slice(0, 8).map(item => item.label);
}

function extractEntityHints(text: string, metricHints: string[], verbHints: string[]): string[] {
  const candidates = new Map<string, { value: string; score: number }>();
  const metricSet = new Set(metricHints.map(v => v.toLowerCase()));
  const verbSet = new Set(verbHints);
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'those', 'these', 'using', 'use', 'used', 'our', 'their',
    'into', 'onto', 'across', 'within', 'between', 'through', 'under', 'over', 'after', 'before', 'about', 'results',
    'result', 'paper', 'section', 'method', 'methods', 'approach', 'approaches', 'model', 'models', 'system', 'systems',
    'data', 'dataset', 'datasets', 'analysis', 'performance', 'value', 'values', 'table', 'figure'
  ]);

  const pushCandidate = (raw: string, bonus: number) => {
    const value = raw.replace(/[^\w\s\-\/]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const lower = value.toLowerCase();
    if (stopwords.has(lower) || metricSet.has(lower) || verbSet.has(lower)) return;
    if (lower.length < 3) return;
    if (/^\d/.test(lower)) return;
    const current = candidates.get(lower);
    candidates.set(lower, {
      value,
      score: (current?.score || 0) + 1 + bonus
    });
  };

  const acronymMatches = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) || [];
  acronymMatches.forEach((hit) => pushCandidate(hit, 3));

  const properNounMatches = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) || [];
  properNounMatches.forEach((hit) => pushCandidate(hit, 2));

  const taggedPhraseMatches = text.match(/\b(?:dataset|model|algorithm|framework|module|component|pipeline|architecture|network|baseline|variant|classifier|encoder|decoder|protocol)\s+[A-Za-z0-9][A-Za-z0-9\-_/]*(?:\s+[A-Za-z0-9][A-Za-z0-9\-_/]*)?/gi) || [];
  taggedPhraseMatches.forEach((hit) => pushCandidate(hit, 2));

  const tokens = text.match(/\b[a-zA-Z][a-zA-Z0-9\-_]{3,}\b/g) || [];
  tokens.forEach((token) => pushCandidate(token, /[A-Z]/.test(token) ? 1 : 0));

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(item => item.value);
}

function extractFocusHints(text: string): FocusHints {
  const metricHints = extractMetricHints(text);
  const verbHints = extractVerbHints(text);
  const entityHints = extractEntityHints(text, metricHints, verbHints);
  return {
    entities: entityHints,
    metrics: metricHints,
    verbs: verbHints
  };
}

function mergeFocusHints(provided?: FocusHints, extracted?: FocusHints): FocusHints | undefined {
  const entities = dedupeList([...(provided?.entities || []), ...(extracted?.entities || [])], 10);
  const metrics = dedupeList([...(provided?.metrics || []), ...(extracted?.metrics || [])], 10);
  const verbs = dedupeList([...(provided?.verbs || []), ...(extracted?.verbs || [])], 8);
  if (entities.length === 0 && metrics.length === 0 && verbs.length === 0) return undefined;
  return { entities, metrics, verbs };
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

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId } = await context.params;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = suggestSchema.parse(body);
    const preferences: FigureSuggestionPreferences = normalizeFigurePreferences(
      data.preferences || DEFAULT_FIGURE_SUGGESTION_PREFERENCES
    );

    // Get existing figures to avoid duplicates
    const existingFigures = await prisma.figurePlan.findMany({
      where: { sessionId },
      select: { title: true, nodes: true }
    });
    
    const existingFigureList = existingFigures.map(f => ({
      title: f.title,
      type: (f.nodes as any)?.figureType || 'unknown'
    }));

    let suggestions: import('@/lib/figure-generation/types').FigureSuggestion[];
    let llmMetadata: { tokensUsed?: number; model?: string } = {};

    // Check if we should use LLM for suggestions
    if (data.useLLM !== false) {
      console.log('[PaperFigures] Using LLM for figure suggestions...');
      
      // Get request headers for LLM call
      const requestHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });

      // Extract paper content from session if not provided
      const paperTitle = data.paperTitle || session.researchTopic?.title || '';
      const paperAbstract = data.paperAbstract || session.researchTopic?.abstractDraft || '';
      const sections = extractSectionMap(session, data.sections);
      const researchType = data.researchType || session.paperType?.name || 'research article';
      const datasetDescription = data.datasetDescription || session.researchTopic?.datasetDescription || '';
      const paperBlueprint = data.blueprint || extractBlueprintContext(session);

      const isFocused = !!data.focusText?.trim();
      const focusHints = isFocused
        ? mergeFocusHints(data.focusHints, extractFocusHints(data.focusText || ''))
        : undefined;
      const llmResult = await generateFigureSuggestions(
        {
          paperTitle,
          paperAbstract,
          sections,
          researchType,
          datasetDescription,
          paperBlueprint,
          preferences,
          existingFigures: existingFigureList,
          maxSuggestions: isFocused ? 4 : 8,
          // Focus fields – when present, the LLM constrains suggestions to this excerpt
          focusText: data.focusText,
          focusSection: data.focusSection,
          focusMode: data.focusMode,
          focusHints
        },
        requestHeaders
      );

      if (llmResult.success && llmResult.suggestions) {
        suggestions = llmResult.suggestions;
        llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
        console.log(`[PaperFigures] LLM generated ${suggestions.length} suggestions using ${llmResult.model}`);
      } else {
        // Fall back to rule-based suggestions
        console.log('[PaperFigures] LLM failed, using rule-based suggestions:', llmResult.error);
        suggestions = generateRuleBasedSuggestions(
          paperTitle,
          paperAbstract,
          sections,
          session
        );
      }
    } else {
      // Use rule-based suggestions
      const paperTitle = data.paperTitle || session.researchTopic?.title || '';
      const paperAbstract = data.paperAbstract || session.researchTopic?.abstractDraft || '';
      const sections = extractSectionMap(session, data.sections);
      suggestions = generateRuleBasedSuggestions(
        paperTitle,
        paperAbstract,
        sections,
        session
      );
    }

    // ── Persist suggestions to session cache ─────────────────────────
    // Each suggestion gets a stable UUID so the UI can track status.
    const cachedItems: CachedSuggestionItem[] = suggestions.map((s, idx) => ({
      id: `sug-${Date.now()}-${idx}`,
      status: 'pending' as CachedSuggestionStatus,
      usedByFigureId: null,
      usedAt: null,
      title: s.title,
      description: s.description,
      category: s.category,
      suggestedType: s.suggestedType,
      rendererPreference: s.rendererPreference,
      relevantSection: s.relevantSection,
      importance: s.importance,
      dataNeeded: s.dataNeeded,
      whyThisFigure: s.whyThisFigure,
      diagramSpec: s.diagramSpec,
      sketchStyle: s.sketchStyle,
      sketchPrompt: s.sketchPrompt,
      sketchMode: s.sketchMode
    }));

    const cache: SuggestionCache = {
      generatedAt: new Date().toISOString(),
      usedLLM: !!llmMetadata.model,
      preferences,
      items: cachedItems
    };

    // Fire-and-forget – don't block the response for a cache write
    prisma.draftingSession
      .update({
        where: { id: sessionId },
        data: { figureSuggestionCache: cache as any }
      })
      .catch(err => console.error('[PaperFigures] Failed to persist suggestion cache:', err));

    return NextResponse.json({ 
      suggestions: cachedItems,   // return items with stable IDs + status
      meta: {
        usedLLM: !!llmMetadata.model,
        preferences,
        ...llmMetadata
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Suggest error:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestions' },
      { status: 500 }
    );
  }
}

/**
 * Generates exactly 5-6 figure suggestions based on paper content.
 * This is a rule-based fallback implementation when LLM is unavailable or disabled.
 */
function generateRuleBasedSuggestions(
  title: string,
  abstract: string,
  sections: Record<string, string>,
  session: any
): FigureSuggestion[] {
  const content = `${title} ${abstract} ${Object.values(sections).join(' ')}`.toLowerCase();
  
  // All possible suggestions with relevance scores
  const allSuggestions: Array<FigureSuggestion & { score: number }> = [];

  // === CORE SUGGESTIONS (Always highly relevant) ===
  
  // 1. Methodology flowchart - essential for any research paper
  allSuggestions.push({
    title: 'Research Methodology Flowchart',
    description: 'A flowchart illustrating your research methodology, including data collection, processing, and analysis steps.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'methodology',
    importance: 'recommended',
    score: 100 // Always highly relevant
  });

  // 2. Results comparison - very common need
  allSuggestions.push({
    title: 'Results Comparison Chart',
    description: 'A bar chart comparing key findings, performance metrics, or outcomes across different conditions or groups.',
    category: 'DATA_CHART',
    suggestedType: 'bar',
    relevantSection: 'results',
    importance: 'recommended',
    score: hasKeywords(content, ['result', 'compar', 'performance', 'metric', 'evaluat', 'outcome', 'finding']) ? 95 : 70
  });

  // === CONTEXT-SPECIFIC SUGGESTIONS ===

  // 3. System/Architecture diagram
  allSuggestions.push({
    title: 'System Architecture Diagram',
    description: 'A diagram showing the system components, modules, their relationships, and data flow between them.',
    category: 'DIAGRAM',
    suggestedType: 'architecture',
    relevantSection: 'methodology',
    importance: hasKeywords(content, ['system', 'architecture', 'framework', 'platform', 'module']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['system', 'architecture', 'framework', 'platform', 'module', 'component']) ? 90 : 50
  });

  // 4. Trend/Time series chart
  allSuggestions.push({
    title: 'Trend Analysis Line Chart',
    description: 'A line chart showing trends, changes over time, or progression of key variables across different time points.',
    category: 'DATA_CHART',
    suggestedType: 'line',
    relevantSection: 'results',
    importance: hasKeywords(content, ['trend', 'time', 'temporal', 'growth', 'progress']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['trend', 'over time', 'temporal', 'growth', 'change', 'progress', 'evolution']) ? 85 : 55
  });

  // 5. Distribution/Proportion chart
  allSuggestions.push({
    title: 'Distribution Pie Chart',
    description: 'A pie or doughnut chart showing the distribution, proportions, or breakdown of categories in your data.',
    category: 'DATA_CHART',
    suggestedType: 'pie',
    relevantSection: 'results',
    importance: 'optional',
    score: hasKeywords(content, ['distribution', 'proportion', 'percentage', 'breakdown', 'categor']) ? 80 : 45
  });

  // 6. Correlation/Scatter plot
  allSuggestions.push({
    title: 'Correlation Scatter Plot',
    description: 'A scatter plot visualizing the relationship and correlation between two key variables in your study.',
    category: 'DATA_CHART',
    suggestedType: 'scatter',
    relevantSection: 'results',
    importance: hasKeywords(content, ['correlation', 'relationship', 'regression']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['correlation', 'relationship', 'association', 'regression', 'variable']) ? 82 : 40
  });

  // 7. Process flow diagram
  allSuggestions.push({
    title: 'Process Flow Diagram',
    description: 'A flowchart depicting the step-by-step process, algorithm, or workflow used in your research.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'methodology',
    importance: hasKeywords(content, ['process', 'workflow', 'algorithm', 'step']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['process', 'workflow', 'step', 'procedure', 'algorithm', 'pipeline']) ? 78 : 48
  });

  // 8. Sequence diagram
  allSuggestions.push({
    title: 'Interaction Sequence Diagram',
    description: 'A sequence diagram showing the interactions, message flows, or protocol exchanges between system components.',
    category: 'DIAGRAM',
    suggestedType: 'sequence',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['interaction', 'sequence', 'protocol', 'message', 'communication', 'api']) ? 75 : 35
  });

  // 9. Comparison radar chart
  allSuggestions.push({
    title: 'Multi-Criteria Radar Chart',
    description: 'A radar chart comparing multiple criteria, dimensions, or factors across different items or methods.',
    category: 'DATA_CHART',
    suggestedType: 'radar',
    relevantSection: 'results',
    importance: 'optional',
    score: hasKeywords(content, ['criteria', 'dimension', 'factor', 'multi', 'aspect', 'attribute']) ? 72 : 30
  });

  // 10. Timeline/Gantt chart
  allSuggestions.push({
    title: 'Project Timeline Chart',
    description: 'A Gantt chart or timeline showing project phases, milestones, tasks, and their scheduling.',
    category: 'DIAGRAM',
    suggestedType: 'gantt',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['timeline', 'schedule', 'phase', 'milestone', 'task', 'plan']) ? 70 : 25
  });

  // 11. Entity-Relationship diagram
  allSuggestions.push({
    title: 'Data Model ER Diagram',
    description: 'An entity-relationship diagram showing the data structure, entities, and their relationships.',
    category: 'DIAGRAM',
    suggestedType: 'er',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['database', 'entity', 'schema', 'data model', 'table', 'relation']) ? 68 : 20
  });

  // 12. Conceptual framework
  allSuggestions.push({
    title: 'Conceptual Framework Diagram',
    description: 'A diagram illustrating the theoretical framework, key concepts, and their relationships in your study.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'introduction',
    importance: 'optional',
    score: hasKeywords(content, ['concept', 'framework', 'theor', 'model', 'hypothesis']) ? 65 : 35
  });

  // === SKETCH / ILLUSTRATION SUGGESTIONS ===

  // 13. Conceptual overview illustration
  allSuggestions.push({
    title: 'Research Conceptual Overview Illustration',
    description: 'An AI-generated conceptual illustration summarizing the overall research contribution, showing the relationship between the problem, approach, and impact visually.',
    category: 'SKETCH',
    suggestedType: 'sketch-auto',
    relevantSection: 'introduction',
    importance: hasKeywords(content, ['overview', 'concept', 'framework', 'contribution', 'novel']) ? 'recommended' : 'optional',
    sketchStyle: 'conceptual',
    sketchMode: 'SUGGEST',
    sketchPrompt: `Create a professional conceptual illustration for an academic paper titled "${title}". The illustration should visually summarize the core research contribution, showing the relationship between the research problem, proposed approach, and expected impact. Use clean lines, a white background, professional academic style, and a balanced composition. Do not include figure numbers or title text on the image.`,
    score: hasKeywords(content, ['overview', 'concept', 'framework', 'novel', 'contribution', 'approach']) ? 62 : 30
  });

  // 14. Methodology illustration
  allSuggestions.push({
    title: 'Methodology Visual Summary',
    description: 'An AI-generated illustration depicting the research methodology as a visual narrative, suitable for readers who prefer visual over textual explanations of the process.',
    category: 'SKETCH',
    suggestedType: 'sketch-guided',
    relevantSection: 'methodology',
    importance: hasKeywords(content, ['method', 'approach', 'pipeline', 'process', 'workflow']) ? 'recommended' : 'optional',
    sketchStyle: 'scientific',
    sketchMode: 'GUIDED',
    sketchPrompt: `Create a scientific illustration showing the research methodology for a paper titled "${title}". Depict the key stages of the research process as a visual narrative with clear flow, labeled stages, and visual indicators of data transformation at each step. Use a clean scientific illustration style with precise lines, standard notation, and a white background. Do not include figure numbers or title text on the image.`,
    score: hasKeywords(content, ['method', 'approach', 'pipeline', 'process', 'workflow', 'experiment']) ? 58 : 28
  });

  // Sort by score (highest first) and take top 6
  const topSuggestions = allSuggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ score, ...suggestion }) => {
      if (suggestion.category === 'DIAGRAM') {
        const rendererDecision = chooseDiagramRenderer({
          diagramType: suggestion.suggestedType || 'flowchart',
          title: suggestion.title,
          description: suggestion.description
        });
        return {
          ...suggestion,
          rendererPreference: rendererDecision.renderer,
          diagramSpec: buildRuleDiagramSpec(suggestion.suggestedType || 'flowchart', suggestion.title)
        };
      }
      return suggestion;
    }); // Remove score from output

  // Ensure we always have at least 5 suggestions
  return topSuggestions;
}

function buildRuleDiagramSpec(type: string, title: string) {
  const normalizedType = (type || '').toLowerCase();
  if (normalizedType === 'sequence') {
    return {
      layout: 'LR' as const,
      nodes: [
        { idHint: 'actorA', label: 'Actor A', group: 'Participants' },
        { idHint: 'serviceB', label: 'Service B', group: 'Participants' },
        { idHint: 'storeC', label: 'Store C', group: 'Participants' }
      ],
      edges: [
        { fromHint: 'actorA', toHint: 'serviceB', label: 'request', type: 'solid' as const },
        { fromHint: 'serviceB', toHint: 'storeC', label: 'query', type: 'solid' as const },
        { fromHint: 'storeC', toHint: 'serviceB', label: 'response', type: 'dashed' as const }
      ],
      groups: [
        { name: 'Participants', nodeIds: ['actorA', 'serviceB', 'storeC'] }
      ],
      splitSuggestion: `If ${title} is too complex, split into interaction request path and response path.`
    };
  }

  return {
    layout: 'LR' as const,
    nodes: [
      { idHint: 'inputStage', label: 'Input Stage', group: 'Input' },
      { idHint: 'processStage', label: 'Processing Stage', group: 'Processing' },
      { idHint: 'validationStage', label: 'Validation Stage', group: 'Processing' },
      { idHint: 'outputStage', label: 'Output Stage', group: 'Output' }
    ],
    edges: [
      { fromHint: 'inputStage', toHint: 'processStage', label: 'feeds', type: 'solid' as const },
      { fromHint: 'processStage', toHint: 'validationStage', label: 'checks', type: 'solid' as const },
      { fromHint: 'validationStage', toHint: 'outputStage', label: 'outputs', type: 'solid' as const }
    ],
    groups: [
      { name: 'Input', nodeIds: ['inputStage'] },
      { name: 'Processing', nodeIds: ['processStage', 'validationStage'] },
      { name: 'Output', nodeIds: ['outputStage'] }
    ],
    splitSuggestion: `If ${title} exceeds complexity budget, split into process and validation subfigures.`
  };
}

/**
 * Helper to check if content contains any of the keywords
 */
function hasKeywords(content: string, keywords: string[]): boolean {
  return keywords.some(keyword => content.includes(keyword));
}

// ── GET: Retrieve persisted suggestion cache ──────────────────────
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { paperId: sessionId } = await context.params;
    const session = await getSessionLight(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const cache = session.figureSuggestionCache as SuggestionCache | null;
    if (!cache || !Array.isArray(cache.items)) {
      return NextResponse.json({ suggestions: [], meta: { cached: false } });
    }

    return NextResponse.json({
      suggestions: cache.items,
      meta: {
        cached: true,
        generatedAt: cache.generatedAt,
        usedLLM: cache.usedLLM,
        preferences: cache.preferences
      }
    });
  } catch (err) {
    console.error('[PaperFigures] GET suggestion cache error:', err);
    return NextResponse.json({ error: 'Failed to load suggestion cache' }, { status: 500 });
  }
}

// ── PATCH: Update suggestion statuses ─────────────────────────────
const patchSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    status: z.enum(['pending', 'used', 'dismissed']),
    usedByFigureId: z.string().optional().nullable()
  })).min(1)
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { paperId: sessionId } = await context.params;
    const session = await getSessionLight(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = patchSchema.parse(body);

    const cache = (session.figureSuggestionCache as SuggestionCache | null) || {
      generatedAt: new Date().toISOString(),
      usedLLM: false,
      items: []
    };

    // Build a lookup map for the updates
    const updateMap = new Map(data.updates.map(u => [u.id, u]));
    const now = new Date().toISOString();

    const updatedItems = cache.items.map(item => {
      const update = updateMap.get(item.id);
      if (!update) return item;
      return {
        ...item,
        status: update.status,
        usedByFigureId: update.usedByFigureId ?? item.usedByFigureId ?? null,
        usedAt: update.status === 'used' ? now : item.usedAt
      };
    });

    const updatedCache: SuggestionCache = { ...cache, items: updatedItems };
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { figureSuggestionCache: updatedCache as any }
    });

    return NextResponse.json({ success: true, suggestions: updatedItems });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }
    console.error('[PaperFigures] PATCH suggestion cache error:', err);
    return NextResponse.json({ error: 'Failed to update suggestion cache' }, { status: 500 });
  }
}

