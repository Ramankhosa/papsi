import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const createSchema = z.object({
  title: z.string().min(1),
  caption: z.string().optional().default(''),
  figureType: z.string().min(1),
  category: z.enum(['DATA_CHART', 'DIAGRAM', 'STATISTICAL_PLOT', 'ILLUSTRATION', 'SKETCH', 'CUSTOM']).optional(),
  notes: z.string().optional(),
  figureNo: z.number().optional(),
  status: z.enum(['PLANNED', 'GENERATING', 'GENERATED', 'FAILED']).optional(),
  suggestionMeta: z.object({
    relevantSection: z.string().optional().nullable(),
    importance: z.enum(['required', 'recommended', 'optional']).optional().nullable(),
    dataNeeded: z.string().optional().nullable(),
    whyThisFigure: z.string().optional().nullable(),
    rendererPreference: z.enum(['plantuml', 'mermaid', 'auto']).optional().nullable(),
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
    }).optional().nullable(),
    // Sketch/illustration-specific fields
    sketchStyle: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional().nullable(),
    sketchPrompt: z.string().optional().nullable(),
    sketchMode: z.enum(['SUGGEST', 'GUIDED']).optional().nullable()
  }).optional().nullable()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where
  });
}

function toResponse(plan: any) {
  const meta = typeof plan.nodes === 'object' && plan.nodes !== null ? plan.nodes : {};
  
  // Image path is stored in nodes JSON (not a separate field)
  const imagePath = meta.imagePath || null;
  
  // Determine status based on whether image exists or explicit status
  let status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED' = 'PLANNED';
  if (meta.status) {
    status = meta.status;
  } else if (imagePath) {
    status = 'GENERATED';
  }
  
  // Map figureType to category
  const typeToCategory: Record<string, string> = {
    'bar': 'DATA_CHART',
    'line': 'DATA_CHART',
    'pie': 'DATA_CHART',
    'scatter': 'DATA_CHART',
    'radar': 'DATA_CHART',
    'doughnut': 'DATA_CHART',
    'horizontalBar': 'DATA_CHART',
    'flowchart': 'DIAGRAM',
    'sequence': 'DIAGRAM',
    'class': 'DIAGRAM',
    'er': 'DIAGRAM',
    'gantt': 'DIAGRAM',
    'state': 'DIAGRAM',
    'architecture': 'DIAGRAM',
    'plantuml': 'DIAGRAM',
    'histogram': 'STATISTICAL_PLOT',
    'boxplot': 'STATISTICAL_PLOT',
    'heatmap': 'STATISTICAL_PLOT',
    'custom': 'CUSTOM'
  };
  
  const figureType = meta.figureType || 'flowchart';
  const category = meta.category || typeToCategory[figureType] || 'DIAGRAM';
  
  return {
    id: plan.id,
    figureNo: plan.figureNo,
    title: plan.title,
    caption: meta.caption || plan.description || '',
    figureType,
    category,
    notes: meta.notes || '',
    status,
    imagePath,
    generatedCode: meta.generatedCode || null,
    suggestionMeta: meta.suggestionMeta || null
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ paperId: string }> }) {
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

    const plans = await prisma.figurePlan.findMany({
      where: { sessionId },
      orderBy: { figureNo: 'asc' }
    });

    // Backward-compatible guard for any legacy soft-delete markers in nodes JSON.
    const visiblePlans = plans.filter((plan: any) => {
      const meta = typeof plan.nodes === 'object' && plan.nodes !== null && !Array.isArray(plan.nodes)
        ? plan.nodes as Record<string, unknown>
        : {};
      return meta.isDeleted !== true && meta.deleted !== true && meta.status !== 'DELETED';
    });

    return NextResponse.json(
      { figures: visiblePlans.map(toResponse) },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0'
        }
      }
    );
  } catch (error) {
    console.error('[PaperFigures] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch figures' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ paperId: string }> }) {
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
    const data = createSchema.parse(body);

    const latest = await prisma.figurePlan.findFirst({
      where: { sessionId },
      orderBy: { figureNo: 'desc' }
    });
    const nextFigureNo = data.figureNo || (latest?.figureNo || 0) + 1;
    
    const meta = {
      figureType: data.figureType,
      category: data.category || 'DIAGRAM',
      caption: data.caption || '',
      notes: data.notes || '',
      status: data.status || 'PLANNED',
      suggestionMeta: data.suggestionMeta || null
    };

    const plan = await prisma.figurePlan.create({
      data: {
        sessionId,
        figureNo: nextFigureNo,
        title: data.title,
        description: data.caption || '',
        nodes: meta,
        edges: []
      }
    });

    return NextResponse.json({ figure: toResponse(plan) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[PaperFigures] POST error:', error);
    return NextResponse.json({ error: 'Failed to create figure' }, { status: 500 });
  }
}
