import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

const topicSchema = z.object({
  title: z.string().min(1).max(200),
  researchQuestion: z.string().min(10).max(2000),
  hypothesis: z.string().max(2000).optional().nullable(),
  keywords: z.array(z.string().min(1)).default([]),
  methodology: z.enum([
    'QUALITATIVE',
    'QUANTITATIVE',
    'MIXED_METHODS',
    'THEORETICAL',
    'CASE_STUDY',
    'ACTION_RESEARCH',
    'EXPERIMENTAL',
    'SURVEY',
    'OTHER'
  ]),
  contributionType: z.enum([
    'THEORETICAL',
    'EMPIRICAL',
    'METHODOLOGICAL',
    'APPLIED',
    'REVIEW',
    'CONCEPTUAL'
  ]),
  datasetDescription: z.string().max(2000).optional().nullable(),
  abstractDraft: z.string().max(5000).optional().nullable()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: { researchTopic: true }
  });
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

    return NextResponse.json({ topic: session.researchTopic });
  } catch (error) {
    console.error('[ResearchTopic] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch research topic' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: { paperId: string } }) {
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
    const data = topicSchema.parse(body);

    const topic = await prisma.researchTopic.upsert({
      where: { sessionId },
      update: {
        title: data.title,
        researchQuestion: data.researchQuestion,
        hypothesis: data.hypothesis ?? null,
        keywords: data.keywords,
        methodology: data.methodology,
        contributionType: data.contributionType,
        datasetDescription: data.datasetDescription ?? null,
        abstractDraft: data.abstractDraft ?? null
      },
      create: {
        sessionId,
        title: data.title,
        researchQuestion: data.researchQuestion,
        hypothesis: data.hypothesis ?? null,
        keywords: data.keywords,
        methodology: data.methodology,
        contributionType: data.contributionType,
        datasetDescription: data.datasetDescription ?? null,
        abstractDraft: data.abstractDraft ?? null
      }
    });

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'RESEARCH_TOPIC_UPDATED',
        userId: user.id,
        stage: session.status,
        newData: {
          title: topic.title,
          researchQuestion: topic.researchQuestion,
          hypothesis: topic.hypothesis,
          keywords: topic.keywords,
          methodology: topic.methodology,
          contributionType: topic.contributionType
        }
      }
    });

    return NextResponse.json({ topic });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[ResearchTopic] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update research topic' }, { status: 500 });
  }
}
