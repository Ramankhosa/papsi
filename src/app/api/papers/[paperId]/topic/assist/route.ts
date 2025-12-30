import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { buildTopicAssistPrompt, type TopicAssistAction } from '@/lib/prompts/paper-topic-prompts';

export const runtime = 'nodejs';

// Map action types to stage codes for LLM gateway model resolution
// Super Admin can configure which model to use for each stage
const ACTION_TO_STAGE_CODE: Record<string, string> = {
  'refine_question': 'PAPER_TOPIC_REFINE_QUESTION',
  'suggest_keywords': 'PAPER_TOPIC_SUGGEST_KEYWORDS',
  'generate_hypothesis': 'PAPER_TOPIC_GENERATE_HYPOTHESIS',
  'draft_abstract': 'PAPER_TOPIC_DRAFT_ABSTRACT',
  'help_formulate_question': 'PAPER_TOPIC_FORMULATE_QUESTION',
  'suggest_all': 'PAPER_TOPIC_ENHANCE_ALL',
};

const assistSchema = z.object({
  action: z.enum([
    'refine_question', 
    'suggest_keywords', 
    'generate_hypothesis', 
    'draft_abstract',
    'help_formulate_question',
    'suggest_all'
  ]),
  title: z.string().max(200).optional().nullable(),
  researchQuestion: z.string().max(2000).optional().nullable(),
  hypothesis: z.string().max(2000).optional().nullable(),
  keywords: z.array(z.string().min(1)).optional().nullable(),
  methodology: z.string().max(100).optional().nullable(),
  contributionType: z.string().max(100).optional().nullable(),
  datasetDescription: z.string().max(2000).optional().nullable(),
  abstractDraft: z.string().max(5000).optional().nullable(),
  // Extended fields for new segmented data structure
  field: z.string().max(100).optional().nullable(),
  subfield: z.string().max(100).optional().nullable(),
  topicDescription: z.string().max(3000).optional().nullable(),
  problemStatement: z.string().max(2000).optional().nullable(),
  researchGaps: z.string().max(2000).optional().nullable(),
  methodologyApproach: z.string().max(2000).optional().nullable(),
  expectedResults: z.string().max(2000).optional().nullable(),
  novelty: z.string().max(1000).optional().nullable(),
  context: z.any().optional(),
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: { researchTopic: true, paperType: true }
  });
}

function parseJsonOutput(output: string): any | null {
  let jsonText = (output || '').trim();
  if (!jsonText) return null;

  const fenceStart = jsonText.indexOf('```');
  if (fenceStart !== -1) {
    jsonText = jsonText.slice(fenceStart + 3);
    jsonText = jsonText.replace(/^json\s*/i, '');
    const fenceEnd = jsonText.indexOf('```');
    if (fenceEnd !== -1) {
      jsonText = jsonText.slice(0, fenceEnd);
    }
  }

  const startBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
    jsonText = jsonText.slice(startBrace, lastBrace + 1);
  }

  jsonText = jsonText
    .replace(/`+/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(quotedKeys);
    } catch {
      return null;
    }
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
    const payload = assistSchema.parse(body);

    const topic = session.researchTopic;
    const contextPayload = {
      title: payload.title ?? topic?.title ?? '',
      researchQuestion: payload.researchQuestion ?? topic?.researchQuestion ?? '',
      hypothesis: payload.hypothesis ?? topic?.hypothesis ?? '',
      keywords: payload.keywords ?? topic?.keywords ?? [],
      methodology: payload.methodology ?? topic?.methodology ?? '',
      contributionType: payload.contributionType ?? topic?.contributionType ?? '',
      datasetDescription: payload.datasetDescription ?? topic?.datasetDescription ?? '',
      abstractDraft: payload.abstractDraft ?? topic?.abstractDraft ?? '',
      paperTypeCode: session.paperType?.code ?? ''
    };

    const prompt = buildTopicAssistPrompt(payload.action as TopicAssistAction, contextPayload);
    const headers = Object.fromEntries(request.headers.entries());

    // Resolve the stage code for this action - Super Admin can configure model per stage
    const stageCode = ACTION_TO_STAGE_CODE[payload.action] || 'PAPER_TOPIC_REFINE_QUESTION';

    const llmRequest = {
      taskCode: 'LLM2_DRAFT' as const,
      stageCode, // Stage code determines which model is used (configured by Super Admin)
      prompt,
      parameters: { temperature: 0.4 },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId,
        paperId: sessionId, // Paper ID for cost tracking
        action: payload.action,
        stageCode, // Include for tracking
        module: 'publication_ideation' // Module identifier for cost reports
      }
    };

    const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);
    if (!result.success || !result.response) {
      return NextResponse.json({ error: result.error?.message || 'AI assistant failed' }, { status: 500 });
    }

    const parsed = parseJsonOutput(result.response.output || '');
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    return NextResponse.json({
      action: payload.action,
      result: parsed
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[TopicAssist] error:', error);
    return NextResponse.json({ error: 'Failed to process topic assistant request' }, { status: 500 });
  }
}
