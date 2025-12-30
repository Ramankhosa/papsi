import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().min(1),
  caption: z.string().min(1),
  figureType: z.string().min(1),
  notes: z.string().optional()
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
  return {
    id: plan.id,
    figureNo: plan.figureNo,
    title: plan.title,
    caption: meta.caption || plan.description || '',
    figureType: meta.figureType || 'OTHER',
    notes: meta.notes || ''
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const plans = await prisma.figurePlan.findMany({
      where: { sessionId },
      orderBy: { figureNo: 'asc' }
    });

    return NextResponse.json({ figures: plans.map(toResponse) });
  } catch (error) {
    console.error('[PaperFigures] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch figures' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
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
    const nextFigureNo = (latest?.figureNo || 0) + 1;
    const meta = {
      figureType: data.figureType,
      caption: data.caption,
      notes: data.notes || ''
    };

    const plan = await prisma.figurePlan.create({
      data: {
        sessionId,
        figureNo: nextFigureNo,
        title: data.title,
        description: data.caption,
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
