import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { 
  generateChart, 
  generateFromMermaidCode,
  generateFromPlantUMLCode,
  FigureGenerationResult
} from '@/lib/figure-generation';
import {
  generateChartConfig,
  generateDiagramCode,
  repairDiagramCode
} from '@/lib/figure-generation/llm-figure-service';
import { chooseDiagramRenderer } from '@/lib/figure-generation/diagram-renderer-policy';
import type { DiagramStructuredSpec } from '@/lib/figure-generation/types';
import {
  normalizeFigurePreferences,
  resolveThemeFromPreferences,
  resolveSketchStyleFromPreferences
} from '@/lib/figure-generation/preferences';
import { generatePaperSketch } from '@/lib/figure-generation/paper-sketch-service';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';

const generateSchema = z.object({
  figureType: z.string(),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATED_FIGURE', 'ILLUSTRATION', 'SKETCH', 'CUSTOM']),
  title: z.string(),
  caption: z.string().optional().nullable(),
  // User's natural language description for LLM generation
  description: z.string().optional().nullable(),
  modificationRequest: z.string().optional().nullable(),
  data: z.object({
    labels: z.array(z.string()).optional(),
    datasets: z.array(z.object({
      label: z.string(),
      data: z.array(z.number()),
      errors: z.array(z.number()).optional()
    })).optional(),
    values: z.array(z.number()).optional(),
    xValues: z.array(z.number()).optional(),
    yValues: z.array(z.number()).optional(),
    groups: z.record(z.string(), z.array(z.number())).optional(),
    matrix: z.array(z.array(z.number())).optional(),
    matrixLabels: z.array(z.string()).optional()
  }).optional().nullable(), // Allow null for diagrams that don't need data
  code: z.string().optional().nullable(),
  theme: z.string().optional().nullable(),
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
  suggestionMeta: z.object({
    relevantSection: z.string().optional(),
    figureRole: z.enum(['ORIENT', 'POSITION', 'EXPLAIN_METHOD', 'SHOW_RESULTS', 'INTERPRET']).optional(),
    sectionFitJustification: z.string().optional(),
    expectedByReviewers: z.boolean().optional(),
    importance: z.enum(['required', 'recommended', 'optional']).optional(),
    dataNeeded: z.string().optional(),
    whyThisFigure: z.string().optional(),
    rendererPreference: z.enum(['plantuml', 'mermaid', 'auto']).optional(),
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
    chartSpec: z.object({
      chartType: z.string().optional(),
      xAxisLabel: z.string().optional(),
      yAxisLabel: z.string().optional(),
      xField: z.string().optional(),
      yField: z.string().optional(),
      series: z.array(z.object({
        label: z.string(),
        yField: z.string(),
        confidenceField: z.string().optional()
      })).optional(),
      aggregation: z.string().optional(),
      baselineLabel: z.string().optional(),
      placeholderPolicy: z.object({
        allowed: z.boolean().optional(),
        label: z.string().optional(),
        shape: z.string().optional(),
        rangeHint: z.string().optional()
      }).optional(),
      notes: z.string().optional()
    }).optional(),
    illustrationSpecV2: z.object({
      layout: z.enum(['PANELS', 'STRIP']).optional(),
      panelCount: z.number().int().min(1).max(8).optional(),
      stepCount: z.number().int().min(1).max(10).optional(),
      flowDirection: z.enum(['LR', 'TD']).optional(),
      panels: z.array(z.object({
        idHint: z.string(),
        title: z.string(),
        elements: z.array(z.string()).optional()
      })).optional(),
      elements: z.array(z.string()).optional(),
      steps: z.array(z.string()).optional(),
      captionDraft: z.string().optional(),
      splitSuggestion: z.string().optional(),
      figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
      renderDirectives: z.object({
        aspectRatio: z.string().optional(),
        fillCanvasPercentMin: z.number().optional(),
        whitespaceMaxPercent: z.number().optional(),
        textPolicy: z.any().optional(),
        stylePolicy: z.any().optional(),
        compositionPolicy: z.any().optional()
      }).optional(),
      actors: z.array(z.string()).optional(),
      props: z.array(z.string()).optional(),
      forbiddenElements: z.array(z.string()).optional()
    }).optional(),
    renderSpec: z.object({
      kind: z.enum(['chart', 'diagram', 'illustration']),
      chartSpec: z.any().optional(),
      diagramSpec: z.any().optional(),
      illustrationSpecV2: z.any().optional()
    }).optional(),
    figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
    renderDirectives: z.object({
      aspectRatio: z.string().optional(),
      fillCanvasPercentMin: z.number().optional(),
      whitespaceMaxPercent: z.number().optional(),
      textPolicy: z.any().optional(),
      stylePolicy: z.any().optional(),
      compositionPolicy: z.any().optional()
    }).optional(),
    paperProfile: z.object({
      paperGenre: z.string(),
      studyType: z.enum(['experimental', 'survey', 'qualitative', 'mixed-methods', 'simulation', 'theoretical', 'unknown']),
      dataAvailability: z.enum(['provided', 'partial', 'none'])
    }).optional(),
    // Sketch/illustration-specific fields
    sketchStyle: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional(),
    sketchPrompt: z.string().optional(),
    sketchMode: z.enum(['SUGGEST', 'GUIDED']).optional()
  }).optional(),
  // Whether to use LLM for code generation
  useLLM: z.boolean().optional().default(true)
});

// Use absolute path for reliable file operations
const FIGURE_UPLOAD_DIR = path.join(process.cwd(), 'public/uploads/figures');

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      researchTopic: true,
      paperBlueprint: true,
      paperSections: {
        orderBy: { updatedAt: 'desc' }
      }
    }
  });
}

/**
 * Build concise paper context string for LLM grounding.
 * This ensures generated figures are relevant to the paper, not generic.
 */
function buildPaperContext(session: any): string {
  const parts: string[] = [];

  const topic = session?.researchTopic;
  if (topic?.title) parts.push(`Paper title: "${topic.title}"`);
  if (topic?.abstractDraft) {
    const abstract = topic.abstractDraft.length > 500
      ? topic.abstractDraft.slice(0, 500) + '...'
      : topic.abstractDraft;
    parts.push(`Abstract: ${abstract}`);
  }

  const blueprint = session?.paperBlueprint;
  if (blueprint?.thesisStatement) parts.push(`Thesis: ${blueprint.thesisStatement}`);
  if (blueprint?.centralObjective) parts.push(`Objective: ${blueprint.centralObjective}`);

  if (Array.isArray(session?.paperSections)) {
    const sectionSnippets = session.paperSections
      .filter((s: any) => s?.sectionKey && s?.content)
      .slice(0, 4) // Limit to avoid token bloat
      .map((s: any) => {
        const content = s.content.length > 300 ? s.content.slice(0, 300) + '...' : s.content;
        return `[${s.sectionKey}] ${content}`;
      });
    if (sectionSnippets.length > 0) {
      parts.push(`Key sections:\n${sectionSnippets.join('\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

function withStageLimitGuidance(errorMessage: string | undefined, stageCode: string): string {
  const message = (errorMessage || 'LLM generation failed').trim();
  const normalized = message.toLowerCase();
  const isStageLimit = normalized.includes('input exceeds stage limit')
    || normalized.includes('configured limit')
    || normalized.includes('maxtokensin');

  if (!isStageLimit) return message;

  return [
    message,
    `Stage config issue: ${stageCode} has maxTokensIn lower than this request.`,
    'Fix by running one of:',
    '- npx tsx scripts/fix-figure-stage-limits.ts (quick patch for figure-related stage limits)',
    '- npx tsx scripts/seed-publication-ideation-stages.ts (full paper-stage reseed with generous limits)',
    'Then restart the app/PM2 process to reload configuration.'
  ].join('\n');
}

function wasRecentFailure(timestamp: unknown, withinHours: number = 24): boolean {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= withinHours * 60 * 60 * 1000;
}

function codeLooksMermaid(code?: string | null): boolean {
  if (!code) return false;
  return /(flowchart|graph\s+(TD|TB|BT|RL|LR)|sequenceDiagram|erDiagram|gantt|stateDiagram)/i.test(code);
}

function sanitizeAscii(input: string, keepNewlines: boolean = false): string {
  const normalized = (input || '').normalize('NFKD');
  return keepNewlines
    ? normalized.replace(/[^\x20-\x7E\n]/g, '')
    : normalized.replace(/[^\x20-\x7E]/g, '');
}

function sanitizeLabel(input: string): string {
  const cleaned = sanitizeAscii(input || '')
    .replace(/["'`[\]{}()<>:,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6);
  return (words.join(' ').slice(0, 28).trim() || 'Node');
}

function sanitizeAlias(input: string, index: number): string {
  const base = sanitizeAscii(input || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = base.split(' ').filter(Boolean);
  let alias = parts.map((part, idx) =>
    idx === 0 ? part.toLowerCase() : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`
  ).join('');
  if (!alias) alias = `node${index + 1}`;
  if (!/^[a-zA-Z]/.test(alias)) alias = `n${alias}`;
  return alias.slice(0, 24);
}

function normalizeDiagramSpec(spec?: DiagramStructuredSpec | null): DiagramStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : [])
    .slice(0, 15)
    .map((node, idx) => ({
      idHint: sanitizeAlias(node?.idHint || node?.label || `node${idx + 1}`, idx),
      label: sanitizeLabel(node?.label || node?.idHint || `Node ${idx + 1}`),
      group: node?.group ? sanitizeLabel(node.group) : undefined
    }));
  const nodeSet = new Set(nodes.map(n => n.idHint));
  const edges = (Array.isArray(spec.edges) ? spec.edges : [])
    .slice(0, 18)
    .map((edge, idx) => ({
      fromHint: sanitizeAlias(edge?.fromHint || `node${idx + 1}`, idx),
      toHint: sanitizeAlias(edge?.toHint || `node${idx + 2}`, idx + 1),
      label: edge?.label ? sanitizeLabel(edge.label) : undefined,
      type: (edge?.type === 'dashed' || edge?.type === 'async' ? edge.type : 'solid') as 'solid' | 'dashed' | 'async'
    }))
    .filter(edge => nodeSet.has(edge.fromHint) && nodeSet.has(edge.toHint));
  const groups = (Array.isArray(spec.groups) ? spec.groups : [])
    .slice(0, 8)
    .map(group => ({
      name: sanitizeLabel(group?.name || 'Group'),
      nodeIds: Array.isArray(group?.nodeIds)
        ? group.nodeIds.map((id, idx) => sanitizeAlias(id, idx)).filter(id => nodeSet.has(id))
        : undefined,
      description: group?.description ? sanitizeLabel(group.description) : undefined
    }))
    .filter(group => (group.nodeIds?.length || 0) > 0);

  if (nodes.length === 0) return undefined;

  return {
    layout: spec.layout === 'LR' ? 'LR' : 'TD',
    nodes,
    edges,
    groups,
    splitSuggestion: spec.splitSuggestion ? sanitizeAscii(spec.splitSuggestion).slice(0, 140) : undefined
  };
}

function buildFallbackSpec(title: string): DiagramStructuredSpec {
  return {
    layout: 'LR',
    nodes: [
      { idHint: 'inputStage', label: 'Input Stage', group: 'Input' },
      { idHint: 'processingStage', label: 'Processing Stage', group: 'Processing' },
      { idHint: 'validationStage', label: 'Validation Stage', group: 'Processing' },
      { idHint: 'outputStage', label: 'Output Stage', group: 'Output' }
    ],
    edges: [
      { fromHint: 'inputStage', toHint: 'processingStage', label: 'feeds', type: 'solid' },
      { fromHint: 'processingStage', toHint: 'validationStage', label: 'checks', type: 'solid' },
      { fromHint: 'validationStage', toHint: 'outputStage', label: 'outputs', type: 'solid' }
    ],
    groups: [
      { name: 'Input', nodeIds: ['inputStage'] },
      { name: 'Processing', nodeIds: ['processingStage', 'validationStage'] },
      { name: 'Output', nodeIds: ['outputStage'] }
    ],
    splitSuggestion: `If complexity grows, split ${sanitizeLabel(title)} into Fig A and Fig B.`
  };
}

function buildDeterministicPlantUMLTemplate(
  figureType: string,
  title: string,
  description?: string,
  spec?: DiagramStructuredSpec
): string {
  const safeTitle = sanitizeLabel(title).slice(0, 60);
  const normalizedSpec = normalizeDiagramSpec(spec) || buildFallbackSpec(title);
  const nodes = normalizedSpec.nodes || [];
  const edges = normalizedSpec.edges || [];
  const groups = normalizedSpec.groups || [];

  const styleBlock = [
    '@startuml',
    'skinparam backgroundColor #FFFFFF',
    'skinparam defaultFontName "Helvetica Neue"',
    'skinparam defaultFontSize 13',
    'skinparam shadowing false',
    'skinparam roundcorner 8',
    'skinparam ArrowColor #2F6DA3',
    'skinparam BoxPadding 10',
    'skinparam PackageBackgroundColor #F5F8FC',
    'skinparam PackageBorderColor #6CA0D6',
    'skinparam RectangleBackgroundColor #EEF4FB',
    'skinparam RectangleBorderColor #2F6DA3',
    `title ${safeTitle}`
  ];

  if ((figureType || '').toLowerCase() === 'flowchart') {
    const startLabel = sanitizeLabel(nodes[0]?.label || 'Input Stage');
    const decisionLabel = sanitizeLabel(nodes[1]?.label || 'Decision');
    const yesLabel = sanitizeLabel(nodes[2]?.label || 'Path A');
    const noLabel = sanitizeLabel(nodes[3]?.label || 'Path B');
    const endLabel = sanitizeLabel(nodes[4]?.label || 'Output Stage');

    return [
      ...styleBlock,
      'start',
      `:${startLabel};`,
      `if (${decisionLabel}?) then (yes)`,
      `  :${yesLabel};`,
      'else (no)',
      `  :${noLabel};`,
      'endif',
      `:${endLabel};`,
      'stop',
      '@enduml'
    ].join('\n');
  }

  if ((figureType || '').toLowerCase() === 'sequence') {
    const participants = nodes.slice(0, 6).map((node, idx) => `participant "${node.label}" as ${sanitizeAlias(node.idHint, idx)}`);
    const transitions = edges.slice(0, 18).map((edge, idx) => {
      const from = sanitizeAlias(edge.fromHint, idx);
      const to = sanitizeAlias(edge.toHint, idx + 1);
      const label = edge.label ? ` : ${sanitizeLabel(edge.label)}` : '';
      const arrow = edge.type === 'dashed' ? '-->' : '->';
      return `${from} ${arrow} ${to}${label}`;
    });
    return [...styleBlock, ...participants, ...transitions, '@enduml'].join('\n');
  }

  if ((figureType || '').toLowerCase() === 'state') {
    const stateLines = nodes.map((node, idx) => `state "${node.label}" as ${sanitizeAlias(node.idHint, idx)}`);
    const edgeLines = edges.map((edge, idx) => {
      const from = sanitizeAlias(edge.fromHint, idx);
      const to = sanitizeAlias(edge.toHint, idx + 1);
      const label = edge.label ? ` : ${sanitizeLabel(edge.label)}` : '';
      return `${from} --> ${to}${label}`;
    });
    const initial = nodes[0] ? `[*] --> ${sanitizeAlias(nodes[0].idHint, 0)}` : '';
    const final = nodes.length > 0 ? `${sanitizeAlias(nodes[nodes.length - 1].idHint, nodes.length - 1)} --> [*]` : '';
    return [...styleBlock, ...stateLines, initial, ...edgeLines, final, '@enduml'].filter(Boolean).join('\n');
  }

  const groupedIds = new Set<string>();
  const packageLines: string[] = [];
  groups.forEach((group, groupIdx) => {
    const groupName = sanitizeLabel(group.name || `Group ${groupIdx + 1}`);
    packageLines.push(`package "${groupName}" {`);
    (group.nodeIds || []).forEach((id, idIdx) => {
      const node = nodes.find(n => sanitizeAlias(n.idHint, 0) === sanitizeAlias(id, 0));
      if (node) {
        const alias = sanitizeAlias(node.idHint, idIdx);
        groupedIds.add(alias);
        packageLines.push(`  rectangle "${node.label}" as ${alias}`);
      }
    });
    packageLines.push('}');
  });

  const looseNodeLines = nodes
    .map((node, idx) => {
      const alias = sanitizeAlias(node.idHint, idx);
      if (groupedIds.has(alias)) return '';
      return `rectangle "${node.label}" as ${alias}`;
    })
    .filter(Boolean);

  const edgeLines = edges.map((edge, idx) => {
    const from = sanitizeAlias(edge.fromHint, idx);
    const to = sanitizeAlias(edge.toHint, idx + 1);
    const label = edge.label ? ` : ${sanitizeLabel(edge.label)}` : '';
    return `${from} --> ${to}${label}`;
  });

  const note = description ? `note bottom\n${sanitizeAscii(description).slice(0, 180)}\nend note` : '';
  return [...styleBlock, ...packageLines, ...looseNodeLines, ...edgeLines, note, '@enduml']
    .filter(Boolean)
    .join('\n');
}

export async function POST(
  request: NextRequest, 
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId, figureId } = await context.params;
    
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Get the figure plan
    const figurePlan = await prisma.figurePlan.findFirst({
      where: { id: figureId, sessionId }
    });
    
    if (!figurePlan) {
      return NextResponse.json({ error: 'Figure not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = generateSchema.parse(body);
    const normalizedPreferences = normalizeFigurePreferences(data.preferences);
    const resolvedTheme = (data.theme as any) || resolveThemeFromPreferences(normalizedPreferences);

    // Get request headers for LLM calls
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    let result: FigureGenerationResult;
    let llmMetadata: { tokensUsed?: number; model?: string } = {};
    const meta = (figurePlan.nodes as any) || {};
    let rendererDecisionMeta: { renderer: 'plantuml' | 'mermaid'; reason: string } | null = null;
    let finalDiagramRenderer: 'plantuml' | 'mermaid' | null = null;
    let mermaidRenderFailed = false;
    let plantUMLRenderFailed = false;
    let mermaidRenderError: string | null = null;
    let plantUMLRenderError: string | null = null;

    // Build paper context for LLM grounding
    const paperContext = buildPaperContext(session);

    // Generate based on category
    switch (data.category) {
      case 'DATA_CHART':
        // Check if we should use LLM to generate chart config
        if (data.useLLM && data.description && !data.data?.datasets) {
          console.log('[PaperFigures] Using LLM to generate chart config...');
          
          // Build a grounded description including paper context
          let groundedDescription = data.description;
          if (paperContext) {
            groundedDescription = `PAPER CONTEXT (use this to make the chart relevant to the research):\n${paperContext}\n\nFIGURE REQUEST:\n${data.description}`;
          }
          // Enrich with suggestion metadata so the LLM understands purpose and context
          const chartEnrichment = data.suggestionMeta || (meta.suggestionMeta as any) || {};
          if (chartEnrichment.relevantSection) {
            groundedDescription += `\n\nTARGET SECTION: This chart belongs in the "${chartEnrichment.relevantSection}" section of the paper.`;
          }
          if (chartEnrichment.whyThisFigure) {
            groundedDescription += `\nPURPOSE: ${chartEnrichment.whyThisFigure}`;
          }
          if (chartEnrichment.dataNeeded) {
            groundedDescription += `\nDATA TO VISUALIZE: ${chartEnrichment.dataNeeded}`;
          }
          if (data.modificationRequest) {
            groundedDescription += `\n\nUSER MODIFICATION REQUEST (apply these changes):\n${data.modificationRequest}`;
          }

          // Use LLM to generate chart configuration from description
          const llmResult = await generateChartConfig(
            {
              description: groundedDescription,
              chartType: data.figureType as any,
              title: data.title,
              sectionType: chartEnrichment.relevantSection,
              figureRole: chartEnrichment.figureRole as any,
              paperGenre: chartEnrichment.paperProfile?.paperGenre,
              studyType: chartEnrichment.paperProfile?.studyType,
              chartSpec: chartEnrichment.chartSpec,
              data: data.data?.labels && data.code ? {
                labels: data.data.labels,
                values: data.code.split(',').map(v => parseFloat(v.trim())).filter(n => !isNaN(n)),
                datasetLabel: data.title
              } : undefined,
              style: resolvedTheme as any
            },
            requestHeaders
          );

          if (llmResult.success && llmResult.config) {
            llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
            
            // Use the LLM-generated config to create the chart
            // Pass the full config options (including scales, fonts, etc.) through
            result = await generateChart(
              llmResult.config.type as any,
              llmResult.config.data,
              {
                title: data.title,
                theme: { preset: resolvedTheme as any },
                format: 'png'
              }
            );

            // Carry through the LLM-generated code for preview/debugging
            if (result.success) {
              result.generatedCode = JSON.stringify(llmResult.config, null, 2);
            }
          } else {
            result = {
              success: false,
              error: withStageLimitGuidance(llmResult.error || 'Failed to generate chart configuration', 'PAPER_CHART_GENERATOR'),
              errorCode: 'API_ERROR'
            };
          }
        } else if (data.data?.labels && data.data?.datasets) {
          // Direct data provided - use it directly
          result = await generateChart(
            data.figureType as any,
            data.data,
            {
              title: data.title,
              theme: { preset: resolvedTheme as any },
              format: 'png'
            }
          );
        } else {
          // No LLM and no data - generate a clearly labeled placeholder chart
          const sampleData = {
            labels: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E'],
            datasets: [{
              label: 'Sample Data (replace with actual values)',
              data: [45, 72, 58, 83, 67]
            }]
          };
          result = await generateChart(
            data.figureType as any,
            sampleData,
            {
              title: data.title,
              theme: { preset: resolvedTheme as any },
              format: 'png'
            }
          );
        }
        break;

      case 'DIAGRAM':
        {
          const diagramSpec = normalizeDiagramSpec(data.suggestionMeta?.diagramSpec) || buildFallbackSpec(data.title);
          const inheritedSuggestionMeta = (meta.suggestionMeta as any) || {};
          const suggestionRendererPreference =
            data.suggestionMeta?.rendererPreference ||
            inheritedSuggestionMeta.rendererPreference ||
            'auto';
          const recentMermaidFailure =
            wasRecentFailure(meta.lastMermaidRenderFailedAt) ||
            (typeof meta.lastError === 'string' && /\bmermaid\b/i.test(meta.lastError));
          const recentPlantUMLFailure =
            wasRecentFailure(meta.lastPlantUMLRenderFailedAt) ||
            (typeof meta.lastError === 'string' && /\bplantuml\b/i.test(meta.lastError));
          const rendererDecision = chooseDiagramRenderer({
            diagramType: data.figureType,
            title: data.title,
            description: `${data.description || ''}\n${data.modificationRequest || ''}`,
            rendererPreference: suggestionRendererPreference as any,
            hasRecentMermaidFailure: recentMermaidFailure,
            hasRecentPlantUMLFailure: recentPlantUMLFailure,
            specLooksMermaidLike: codeLooksMermaid(data.code) || /\bsubgraph\b/i.test(data.description || '')
          });
          rendererDecisionMeta = { renderer: rendererDecision.renderer, reason: rendererDecision.reason };

          const deterministicPlantUMLCode = () => buildDeterministicPlantUMLTemplate(
            data.figureType,
            data.title,
            data.description || '',
            diagramSpec
          );

          const renderMermaidWithTracking = async (rawCode: string): Promise<FigureGenerationResult> => {
            const mermaidResult = await generateFromMermaidCode(rawCode, {
              theme: { preset: resolvedTheme as any },
              format: 'svg'
            });
            if (mermaidResult.success) {
              finalDiagramRenderer = 'mermaid';
              return mermaidResult;
            }
            mermaidRenderFailed = true;
            mermaidRenderError = mermaidResult.error || 'Mermaid render failed';
            return mermaidResult;
          };

          // Local helper: render and recover for PlantUML with error-informed repair.
          const renderPlantUMLWithRecovery = async (initialCode: string): Promise<FigureGenerationResult> => {
            let currentCode = initialCode;

            for (let attempt = 0; attempt < 2; attempt++) {
              const renderResult = await generateFromPlantUMLCode(currentCode, { format: 'svg', useProxy: false });
              if (renderResult.success) {
                finalDiagramRenderer = 'plantuml';
                return renderResult;
              }
              plantUMLRenderFailed = true;
              plantUMLRenderError = renderResult.error || 'PlantUML render failed';

              const repair = await repairDiagramCode(
                {
                  brokenCode: currentCode,
                  errorMessage: renderResult.error || 'Unknown Kroki render failure',
                  diagramType: data.figureType as any,
                  title: data.title,
                  description: data.description || '',
                  diagramSpec
                },
                requestHeaders
              );

              if (!repair.success || !repair.code) {
                break;
              }
              currentCode = repair.code;
            }

            // Deterministic PlantUML fallback template.
            const deterministicCode = deterministicPlantUMLCode();
            const deterministicResult = await generateFromPlantUMLCode(deterministicCode, { format: 'svg', useProxy: false });
            if (deterministicResult.success) {
              deterministicResult.generatedCode = deterministicCode;
              finalDiagramRenderer = 'plantuml';
              return deterministicResult;
            }
            plantUMLRenderFailed = true;
            plantUMLRenderError = deterministicResult.error || 'Deterministic PlantUML fallback failed';

            // Final fallback to Mermaid only after PlantUML attempts.
            const mermaidFallback = getSampleDiagramCode(data.figureType, data.title, data.description || '');
            const mermaidResult = await renderMermaidWithTracking(mermaidFallback);
            if (mermaidResult.success) {
              mermaidResult.generatedCode = mermaidFallback;
            }
            return mermaidResult;
          };

          if (data.useLLM && data.description && !data.code) {
            console.log(`[PaperFigures] Using LLM to generate diagram code (${rendererDecision.renderer} preferred)...`);

            let groundedDescription = sanitizeAscii(data.description, true);
            if (paperContext) {
              groundedDescription = `PAPER CONTEXT (create a diagram that reflects this research):\n${sanitizeAscii(paperContext, true)}\n\nFIGURE REQUEST:\n${groundedDescription}`;
            }
            // Enrich with suggestion metadata so the LLM understands purpose and context
            const enrichmentMeta = data.suggestionMeta || inheritedSuggestionMeta;
            if (enrichmentMeta.relevantSection) {
              groundedDescription += `\n\nTARGET SECTION: This figure belongs in the "${sanitizeAscii(String(enrichmentMeta.relevantSection))}" section of the paper.`;
            }
            if (enrichmentMeta.whyThisFigure) {
              groundedDescription += `\nPURPOSE: ${sanitizeAscii(String(enrichmentMeta.whyThisFigure))}`;
            }
            if (enrichmentMeta.dataNeeded) {
              groundedDescription += `\nDATA/CONTENT TO VISUALIZE: ${sanitizeAscii(String(enrichmentMeta.dataNeeded))}`;
            }
            if (data.modificationRequest) {
              groundedDescription += `\n\nUSER MODIFICATION REQUEST (apply these changes):\n${sanitizeAscii(data.modificationRequest, true)}`;
            }

            const llmResult = await generateDiagramCode(
              {
                description: groundedDescription,
                diagramType: data.figureType as any,
                title: data.title,
                sectionType: enrichmentMeta.relevantSection,
                figureRole: enrichmentMeta.figureRole as any,
                paperGenre: enrichmentMeta.paperProfile?.paperGenre,
                diagramSpec,
                rendererPreference: rendererDecision.renderer,
                hasRecentMermaidFailure: recentMermaidFailure,
                hasRecentPlantUMLFailure: recentPlantUMLFailure,
                specLooksMermaidLike: /\bsubgraph\b/i.test(groundedDescription)
              },
              requestHeaders,
              rendererDecision.renderer !== 'mermaid',
              rendererDecision.renderer
            );

            if (llmResult.success && llmResult.code) {
              llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
              const isPlantUML = llmResult.code.includes('@startuml') || llmResult.diagramType === 'plantuml';

              if (isPlantUML) {
                result = await renderPlantUMLWithRecovery(llmResult.code);
              } else {
                result = await renderMermaidWithTracking(llmResult.code);
              }

              if (!result.success) {
                result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
              }

              if (result.success) {
                result.generatedCode = result.generatedCode || llmResult.code;
              }
            } else {
              const stageError = withStageLimitGuidance(llmResult.error, 'PAPER_DIAGRAM_GENERATOR');
              if (stageError !== (llmResult.error || '').trim()) {
                result = {
                  success: false,
                  error: stageError,
                  errorCode: 'API_ERROR'
                };
              } else if (rendererDecision.renderer === 'mermaid') {
                const mermaidFallback = getSampleDiagramCode(data.figureType, data.title, data.description || '');
                result = await renderMermaidWithTracking(mermaidFallback);
                if (result.success) {
                  result.generatedCode = mermaidFallback;
                } else {
                  result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
                }
              } else {
                result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
              }
            }
          } else if (data.code) {
            if (data.code.includes('@startuml') || data.figureType === 'plantuml') {
              result = await renderPlantUMLWithRecovery(data.code);
            } else if (codeLooksMermaid(data.code)) {
              result = await renderMermaidWithTracking(data.code);
              if (!result.success) {
                result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
              }
            } else if (rendererDecision.renderer === 'mermaid') {
              result = await renderMermaidWithTracking(data.code);
              if (!result.success) {
                result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
              }
            } else {
              result = await renderPlantUMLWithRecovery(data.code);
            }
          } else {
            if (rendererDecision.renderer === 'mermaid') {
              const mermaidFallback = getSampleDiagramCode(data.figureType, data.title, data.description || '');
              result = await renderMermaidWithTracking(mermaidFallback);
              if (result.success) {
                result.generatedCode = mermaidFallback;
              } else {
                result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
              }
            } else {
              result = await renderPlantUMLWithRecovery(deterministicPlantUMLCode());
            }
          }
        }
        break;

      case 'STATISTICAL_PLOT':
        {
          // Strictly prefer Python/matplotlib for publication-grade statistical plots.
          // If required data/server is missing, fail fast with actionable errors rather than silently degrading quality.
          const pythonPlotTypes = ['boxplot', 'violin', 'heatmap', 'confusion_matrix',
            'roc_curve', 'error_bar', 'errorbar', 'regression', 'bland_altman', 'forest_plot'];
          const isPythonType = pythonPlotTypes.includes(data.figureType);

          if (isPythonType) {
            if (!data.data) {
              result = {
                success: false,
                error: `Statistical plot "${data.figureType}" requires structured numeric data. Provide figure data (groups/xValues/yValues/matrix/datasets) to generate a publication-grade plot.`,
                errorCode: 'INVALID_DATA'
              };
              break;
            }

            const { isPythonChartServerHealthy, generatePythonChart, figureDataToPythonSpec } =
              await import('@/lib/figure-generation/python-chart-service');

            const healthy = await isPythonChartServerHealthy();
            if (!healthy) {
              result = {
                success: false,
                error: 'Python chart server is unavailable. Start/restore the matplotlib service to generate publication-grade statistical plots.',
                errorCode: 'API_ERROR'
              };
              break;
            }

            const spec = figureDataToPythonSpec(data.figureType, data.data, {
              title: data.title,
              journal: resolvedTheme === 'ieee' ? 'ieee' : resolvedTheme === 'nature' ? 'nature' : 'default',
            });

            if (!spec) {
              result = {
                success: false,
                error: `Invalid data shape for "${data.figureType}". Check required fields (e.g., groups for boxplot/violin, matrix for heatmap/confusion_matrix, xValues+yValues for regression).`,
                errorCode: 'INVALID_DATA'
              };
              break;
            }

            result = await generatePythonChart(spec);
            break;
          }

          // LLM-assisted Chart.js fallback (only for non-Python statistical chart families)
          if (data.useLLM && data.description) {
            let groundedDescription = `${data.description}\n\nThis is a STATISTICAL VISUALIZATION for an academic paper. Use appropriate statistical chart styling.`;
            if (paperContext) {
              groundedDescription = `PAPER CONTEXT:\n${paperContext}\n\nFIGURE REQUEST:\n${groundedDescription}`;
            }
            const statEnrichment = data.suggestionMeta || (meta.suggestionMeta as any) || {};
            if (statEnrichment.relevantSection) {
              groundedDescription += `\n\nTARGET SECTION: This plot belongs in the "${statEnrichment.relevantSection}" section.`;
            }
            if (statEnrichment.whyThisFigure) {
              groundedDescription += `\nPURPOSE: ${statEnrichment.whyThisFigure}`;
            }
            if (statEnrichment.dataNeeded) {
              groundedDescription += `\nDATA TO VISUALIZE: ${statEnrichment.dataNeeded}`;
            }

            const llmResult = await generateChartConfig(
              {
                description: groundedDescription,
                chartType: data.figureType as any || 'bar',
                title: data.title,
                sectionType: statEnrichment.relevantSection,
                figureRole: statEnrichment.figureRole as any,
                paperGenre: statEnrichment.paperProfile?.paperGenre,
                studyType: statEnrichment.paperProfile?.studyType,
                chartSpec: statEnrichment.chartSpec,
                style: resolvedTheme as any
              },
              requestHeaders
            );

            if (llmResult.success && llmResult.config) {
              llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
              result = await generateChart(
                llmResult.config.type as any,
                llmResult.config.data,
                {
                  title: data.title,
                  theme: { preset: resolvedTheme as any },
                  format: 'png'
                }
              );
            } else {
              result = {
                success: false,
                error: withStageLimitGuidance(llmResult.error || 'Failed to generate statistical plot', 'PAPER_CHART_GENERATOR'),
                errorCode: 'API_ERROR'
              };
            }
          } else if (data.data) {
            result = await generateChart(
              'bar',
              data.data,
              {
                title: data.title,
                theme: { preset: resolvedTheme as any }
              }
            );
          } else {
            result = {
              success: false,
              error: 'Statistical plots require data or a description',
              errorCode: 'INVALID_DATA'
            };
          }
        }
        break;

      case 'SKETCH':
      case 'ILLUSTRATED_FIGURE':
      case 'ILLUSTRATION':
        {
          // Route to the Gemini-based sketch service
          // Merge request-level and stored suggestion meta for maximum context
          const sketchMeta = data.suggestionMeta || (meta.suggestionMeta as any) || {};
          const sketchStyle = sketchMeta.sketchStyle
            || resolveSketchStyleFromPreferences(normalizedPreferences);
          const sketchPrompt = sketchMeta.sketchPrompt
            || data.description
            || data.title;
          const illustrationSpecV2 = sketchMeta.illustrationSpecV2
            || sketchMeta.renderSpec?.illustrationSpecV2
            || undefined;
          const figureGenre = sketchMeta.figureGenre
            || illustrationSpecV2?.figureGenre
            || data.figureGenre
            || undefined;
          const renderDirectives = sketchMeta.renderDirectives
            || illustrationSpecV2?.renderDirectives
            || undefined;
          const sketchMode = data.figureType?.startsWith('sketch-guided') || sketchMeta.sketchMode === 'GUIDED'
            ? 'GUIDED' as const
            : 'SUGGEST' as const;

          console.log(`[PaperFigures] Routing ${data.category} to sketch service (mode=${sketchMode}, style=${sketchStyle})...`);

          const sketchResult = await generatePaperSketch({
            paperId: sessionId,
            sessionId,
            figureId,
            mode: sketchMode,
            title: data.title,
            userPrompt: sketchPrompt,
            illustrationSpecV2,
            figureGenre,
            renderDirectives,
            style: sketchStyle
          }, user.id, undefined);

          if (sketchResult.success && sketchResult.imagePath) {
            // The sketch service already saved the image and updated the figurePlan.
            // Return the result to be consistent with chart/diagram responses.
            return NextResponse.json({
              success: true,
              imagePath: sketchResult.imagePath,
              format: 'png',
              fileSize: 0 // Sketch service doesn't return file size; client doesn't use it
            });
          }

          result = {
            success: false,
            error: sketchResult.error || 'Sketch generation failed',
            errorCode: 'API_ERROR'
          };
        }
        break;

      case 'CUSTOM':
      default:
        result = {
          success: false,
          error: `${data.category} figures require manual upload`,
          errorCode: 'UNSUPPORTED_TYPE'
        };
    }

    // If generation failed, return error
    if (!result.success || !result.imageBase64) {
      return NextResponse.json(
        { error: result.error || 'Figure generation failed' },
        { status: 400 }
      );
    }

    // Save the generated image
    await fs.mkdir(FIGURE_UPLOAD_DIR, { recursive: true });
    
    const format = result.format || 'png';
    const timestamp = Date.now();
    const filename = `figure_${figureId}_${timestamp}.${format}`;
    const filePath = path.join(FIGURE_UPLOAD_DIR, filename);
    
    const buffer = Buffer.from(result.imageBase64, 'base64');
    await fs.writeFile(filePath, buffer);
    
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const imagePath = `/uploads/figures/${filename}`;
    const nowIso = new Date().toISOString();

    // Update the figure plan with the generated image
    // NOTE: imagePath is stored in nodes JSON since the schema doesn't have a dedicated field
    const revisionHistory = Array.isArray(meta.revisionHistory) ? meta.revisionHistory : [];
    const shouldAppendRevision = !!data.modificationRequest || meta.status === 'GENERATED';
    const nextRevisionHistory = shouldAppendRevision
      ? [
          ...revisionHistory,
          {
            at: nowIso,
            request: data.modificationRequest || null,
            description: data.description || null,
            model: llmMetadata.model || null,
            tokensUsed: llmMetadata.tokensUsed || null
          }
        ].slice(-20)
      : revisionHistory;

    await prisma.figurePlan.update({
      where: { id: figureId },
      data: {
        nodes: {
          ...meta,
          status: 'GENERATED',
          imagePath, // Store in nodes JSON
          source: result.provider || 'quickchart',
          generatedAt: nowIso,
          checksum,
          generatedCode: result.generatedCode,
          fileSize: buffer.length,
          appliedPreferences: normalizedPreferences,
          suggestionMeta: data.suggestionMeta || meta.suggestionMeta || null,
          lastModificationRequest: data.modificationRequest || null,
          rendererDecision: rendererDecisionMeta?.renderer || meta.rendererDecision || null,
          rendererDecisionReason: rendererDecisionMeta?.reason || meta.rendererDecisionReason || null,
          lastDiagramRenderer: finalDiagramRenderer || meta.lastDiagramRenderer || null,
          lastMermaidRenderFailedAt: mermaidRenderFailed
            ? nowIso
            : (finalDiagramRenderer === 'mermaid' ? null : (meta.lastMermaidRenderFailedAt || null)),
          lastMermaidRenderError: mermaidRenderFailed
            ? (mermaidRenderError || null)
            : (finalDiagramRenderer === 'mermaid' ? null : (meta.lastMermaidRenderError || null)),
          lastPlantUMLRenderFailedAt: plantUMLRenderFailed
            ? nowIso
            : (finalDiagramRenderer === 'plantuml' ? null : (meta.lastPlantUMLRenderFailedAt || null)),
          lastPlantUMLRenderError: plantUMLRenderFailed
            ? (plantUMLRenderError || null)
            : (finalDiagramRenderer === 'plantuml' ? null : (meta.lastPlantUMLRenderError || null)),
          revisionHistory: nextRevisionHistory
        }
      }
    });

    console.log(`[PaperFigures] Generated figure: ${filename} (${buffer.length} bytes)`);

    return NextResponse.json({
      success: true,
      imagePath,
      generatedCode: result.generatedCode,
      format,
      fileSize: buffer.length
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Generate error:', error);
    return NextResponse.json(
      { error: 'Failed to generate figure' },
      { status: 500 }
    );
  }
}

/**
 * Generates professional-quality fallback Mermaid code.
 * Uses the title and description to create a more relevant diagram.
 */
function getSampleDiagramCode(figureType: string, title: string, description?: string): string {
  // Sanitize title for Mermaid (remove special chars that break syntax)
  const safeTitle = title.replace(/[[\]{}()#&;]/g, '').slice(0, 40);

  switch (figureType) {
    case 'flowchart':
      return `flowchart TD
    start([Start]) --> input[Data Input]
    input --> preprocess[Preprocessing]
    preprocess --> analyze{Analysis}
    analyze -->|Path A| methodA[Method A Processing]
    analyze -->|Path B| methodB[Method B Processing]
    methodA --> merge[Merge Results]
    methodB --> merge
    merge --> validate{Validation}
    validate -->|Pass| output[Generate Output]
    validate -->|Fail| preprocess
    output --> done([Complete])

    style start fill:#4E79A7,stroke:#3B6A96,color:#fff
    style done fill:#59A14F,stroke:#4A8A42,color:#fff
    style analyze fill:#F28E2B,stroke:#D97B1E,color:#fff
    style validate fill:#F28E2B,stroke:#D97B1E,color:#fff`;

    case 'architecture':
      return `flowchart LR
    subgraph Input["Input Layer"]
        direction TB
        src1[Data Source 1]
        src2[Data Source 2]
    end

    subgraph Processing["Processing Layer"]
        direction TB
        ingest[Data Ingestion]
        transform[Transformation]
        analyze[Analysis Engine]
    end

    subgraph Output["Output Layer"]
        direction TB
        results[Results Store]
        viz[Visualization]
        report[Report Generation]
    end

    src1 --> ingest
    src2 --> ingest
    ingest --> transform
    transform --> analyze
    analyze --> results
    results --> viz
    results --> report

    style Input fill:#E8F4FD,stroke:#4E79A7
    style Processing fill:#FFF3E0,stroke:#F28E2B
    style Output fill:#E8F5E9,stroke:#59A14F`;

    case 'sequence':
      return `sequenceDiagram
    participant U as User
    participant C as Client Application
    participant S as Processing Service
    participant D as Data Store

    U->>C: Submit Request
    activate C
    C->>S: Process Data
    activate S
    S->>D: Query Records
    activate D
    D-->>S: Return Results
    deactivate D
    S->>S: Apply Analysis
    S-->>C: Processed Output
    deactivate S
    C-->>U: Display Results
    deactivate C`;

    case 'class':
      return `classDiagram
    class DataProcessor {
        +String inputPath
        +Config settings
        +loadData() DataSet
        +preprocess() DataSet
        +validate() bool
    }
    class AnalysisEngine {
        +DataSet data
        +String method
        +analyze() Results
        +compare() Metrics
    }
    class ResultsExporter {
        +Results results
        +export(format) File
        +visualize() Chart
    }
    DataProcessor --> AnalysisEngine : feeds
    AnalysisEngine --> ResultsExporter : produces`;

    case 'er':
      return `erDiagram
    STUDY ||--o{ EXPERIMENT : contains
    EXPERIMENT ||--|{ DATASET : produces
    DATASET ||--o{ RESULT : yields
    STUDY {
        string id PK
        string title
        string methodology
        date startDate
    }
    EXPERIMENT {
        string id PK
        string configuration
        string parameters
        int trialNumber
    }
    DATASET {
        string id PK
        int sampleSize
        string format
        float completeness
    }
    RESULT {
        string id PK
        float value
        float confidence
        string metric
    }`;

    case 'gantt':
      return `gantt
    title ${safeTitle}
    dateFormat YYYY-MM-DD
    section Literature Review
        Survey Existing Work       :done, lr1, 2024-01-01, 30d
        Identify Research Gaps     :done, lr2, after lr1, 14d
    section Methodology Design
        Design Experiments         :active, md1, after lr2, 21d
        Prepare Data Collection    :md2, after md1, 14d
    section Data Collection
        Conduct Experiments        :dc1, after md2, 45d
        Data Validation            :dc2, after dc1, 14d
    section Analysis and Writing
        Statistical Analysis       :aw1, after dc2, 30d
        Draft Paper                :aw2, after aw1, 28d
        Revision and Submission    :aw3, after aw2, 21d`;

    case 'state':
      return `stateDiagram-v2
    [*] --> Idle
    Idle --> Initializing : Start Process
    Initializing --> DataLoading : Config Ready
    DataLoading --> Processing : Data Loaded
    DataLoading --> Error : Load Failed
    Processing --> Validating : Analysis Complete
    Validating --> Success : Valid Results
    Validating --> Processing : Retry Analysis
    Error --> Initializing : Reset
    Success --> Reporting : Generate Report
    Reporting --> [*]`;

    default:
      return `flowchart TD
    step1[Define Objectives] --> step2[Literature Review]
    step2 --> step3[Design Methodology]
    step3 --> step4[Data Collection]
    step4 --> step5[Analysis]
    step5 --> step6{Results Valid?}
    step6 -->|Yes| step7[Report Findings]
    step6 -->|No| step4
    step7 --> step8[Conclusions]

    style step1 fill:#4E79A7,stroke:#3B6A96,color:#fff
    style step8 fill:#59A14F,stroke:#4A8A42,color:#fff
    style step6 fill:#F28E2B,stroke:#D97B1E,color:#fff`;
  }
}
