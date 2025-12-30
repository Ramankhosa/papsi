import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import { paperTypeService } from '@/lib/services/paper-type-service';
import { sectionTemplateService } from '@/lib/services/section-template-service';
import { DraftingService } from '@/lib/drafting-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  action: z.enum([
    'generate_section',
    'regenerate_section',
    'save_section',
    'insert_citation',
    'check_citations',
    'generate_bibliography',
    'analyze_structure',
    'word_count'
  ])
});

const generateSchema = z.object({
  sectionKey: z.string().min(1),
  instructions: z.string().max(5000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional()
});

const saveSchema = z.object({
  sectionKey: z.string().min(1),
  content: z.string()
});

const insertCitationSchema = z.object({
  content: z.string().min(1),
  citationKeys: z.array(z.string().min(1)).min(1),
  sectionKey: z.string().min(1).optional(),
  position: z.number().int().nonnegative().optional()
});

const checkCitationsSchema = z.object({
  content: z.string().min(1)
});

const bibliographySchema = z.object({
  citationKeys: z.array(z.string().min(1)).optional(),
  sortOrder: z.enum(['alphabetical', 'order_of_appearance']).optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      paperType: true,
      citationStyle: true
    }
  });
}

async function getPaperDraft(sessionId: string) {
  return prisma.annexureDraft.findFirst({
    where: {
      sessionId,
      jurisdiction: 'PAPER'
    },
    orderBy: { version: 'desc' }
  });
}

async function getOrCreatePaperDraft(sessionId: string, title: string) {
  const existing = await getPaperDraft(sessionId);
  if (existing) return existing;

  return prisma.annexureDraft.create({
    data: {
      sessionId,
      jurisdiction: 'PAPER',
      title: title || 'Untitled Paper',
      fullDraftText: ''
    }
  });
}

function normalizeExtraSections(value: any): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, string>;
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

async function updateDraftContent(
  draftId: string,
  sectionKey: string,
  content: string,
  paperTypeCode: string | null,
  llmMeta?: { prompt: string; response: string; tokensUsed?: number }
) {
  const draft = await prisma.annexureDraft.findUnique({ where: { id: draftId } });
  if (!draft) return null;

  const extraSections = normalizeExtraSections(draft.extraSections);
  extraSections[sectionKey] = content;

  const sectionOrder = paperTypeCode
    ? (await paperTypeService.getPaperType(paperTypeCode))?.sectionOrder || []
    : [];

  const updates: any = {
    extraSections,
    fullDraftText: buildFullDraftText(extraSections, sectionOrder)
  };

  if (sectionKey.toLowerCase() === 'abstract') {
    updates.abstract = content;
  }

  if (sectionKey.toLowerCase() === 'title') {
    updates.title = content || draft.title;
  }

  if (llmMeta) {
    updates.llmPromptUsed = llmMeta.prompt;
    updates.llmResponse = { sectionKey, output: llmMeta.response };
    updates.tokensUsed = llmMeta.tokensUsed;
  }

  return prisma.annexureDraft.update({
    where: { id: draftId },
    data: updates
  });
}

function buildFullDraftText(extraSections: Record<string, string>, sectionOrder: string[]): string {
  const headings: string[] = [];
  const keys = Object.keys(extraSections);

  const orderedKeys = sectionOrder.length > 0
    ? [...sectionOrder, ...keys.filter(key => !sectionOrder.includes(key))]
    : keys;

  orderedKeys.forEach(key => {
    const value = extraSections[key];
    if (!value || !value.trim()) return;
    const heading = key.replace(/_/g, ' ').toUpperCase();
    headings.push(`${heading}\n\n${value.trim()}`);
  });

  return headings.join('\n\n');
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    citationKey: citation.citationKey
  };
}

function getStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

async function buildPrompt(
  sectionKey: string,
  paperTypeCode: string,
  context: any,
  citationInstructions: string,
  userInstructions?: string
): Promise<string> {
  const basePrompt = await sectionTemplateService.getPromptForSection(sectionKey, paperTypeCode, context);
  const topic = context?.researchTopic;

  const methodology = Array.isArray(topic?.methodology)
    ? topic.methodology.join(', ')
    : (topic?.methodology ? String(topic.methodology) : '');
  const contribution = Array.isArray(topic?.contributionType)
    ? topic.contributionType.join(', ')
    : (topic?.contributionType ? String(topic.contributionType) : '');

  const topicBlock = topic
    ? `\n\nRESEARCH TOPIC CONTEXT:\nTitle: ${topic.title}\nResearch Question: ${topic.researchQuestion}\nMethodology: ${methodology}\nContribution: ${contribution}\nKeywords: ${(topic.keywords || []).join(', ')}`
    : '';

  const citationsBlock = citationInstructions ? `\n\n${citationInstructions}` : '';
  const userBlock = userInstructions ? `\n\nUSER INSTRUCTIONS:\n${userInstructions}` : '';

  return `${basePrompt}${topicBlock}${citationsBlock}${userBlock}\n\nReturn ONLY the section content, without headings.`;
}

function extractCitationKeys(content: string): string[] {
  const pattern = /\[CITE:([^\]]+)\]/g;
  const keys = new Set<string>();
  let match;
  while ((match = pattern.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return Array.from(keys);
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
    const actionData = actionSchema.parse(body);

    const paperTypeCode = session.paperType?.code
      || process.env.DEFAULT_PAPER_TYPE
      || 'JOURNAL_ARTICLE';

    switch (actionData.action) {
      case 'generate_section':
      case 'regenerate_section': {
        const payload = generateSchema.parse(body);
        const sectionKey = payload.sectionKey;

        const researchTopic = await prisma.researchTopic.findUnique({
          where: { sessionId }
        });

        const citations = await citationService.getCitationsForSession(sessionId);
        const citationContext = await DraftingService.buildCitationContext(sessionId, sectionKey);
        const draft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');
        const extraSections = normalizeExtraSections(draft.extraSections);

        const prompt = await buildPrompt(
          sectionKey,
          paperTypeCode,
          {
            researchTopic,
            citationCount: citations.length,
            availableCitations: citations,
            previousSections: extraSections
          },
          citationContext.citationInstructions,
          payload.instructions
        );

        const llmRequest = {
          taskCode: 'LLM2_DRAFT' as const,
          stageCode: 'PAPER_SECTION_DRAFT',
          prompt,
          parameters: {
            temperature: payload.temperature,
            maxOutputTokens: payload.maxOutputTokens
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId,
            paperId: sessionId, // Paper ID for cost tracking
            sectionKey,
            action: `generate_section_${sectionKey}`,
            module: 'publication_ideation', // Module identifier for cost reports
            purpose: 'paper_section_generation'
          }
        };

        const headers = Object.fromEntries(request.headers.entries());
        const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

        if (!result.success || !result.response) {
          return NextResponse.json({ error: result.error?.message || 'Generation failed' }, { status: 500 });
        }

        const rawContent = (result.response.output || '').trim();
        const styleCode = getStyleCode(session);
        const postProcessed = await DraftingService.postProcessSection(rawContent, sessionId, styleCode);

        const updatedDraft = await updateDraftContent(
          draft.id,
          sectionKey,
          postProcessed.processedContent,
          paperTypeCode,
          {
            prompt,
            response: rawContent,
            tokensUsed: result.response.outputTokens
          }
        );

        if (updatedDraft) {
          const sections = normalizeExtraSections(updatedDraft.extraSections);
          const totalWordCount = Object.values(sections).reduce((acc, value) => acc + computeWordCount(value), 0);
          await prisma.draftingSession.update({
            where: { id: sessionId },
            data: {
              currentWordCount: totalWordCount
            }
          });
        }

        const citationMap = new Map(citations.map(c => [c.citationKey, c]));
        await Promise.all(postProcessed.citationsUsed.map(async key => {
          const citation = citationMap.get(key);
          if (!citation) return;
          await citationService.markCitationUsed(
            citation.id,
            sectionKey,
            postProcessed.processedContent.slice(0, 200)
          );
        }));

        return NextResponse.json({
          sectionKey,
          content: postProcessed.processedContent,
          citationsUsed: postProcessed.citationsUsed,
          warnings: postProcessed.warnings,
          tokensUsed: result.response.outputTokens,
          prompt
        });
      }

      case 'save_section': {
        const payload = saveSchema.parse(body);
        const sectionKey = payload.sectionKey;
        const content = payload.content || '';

        const researchTopic = await prisma.researchTopic.findUnique({
          where: { sessionId }
        });

        const draft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');
        const updatedDraft = await updateDraftContent(
          draft.id,
          sectionKey,
          content,
          paperTypeCode
        );

        if (updatedDraft) {
          const sections = normalizeExtraSections(updatedDraft.extraSections);
          const totalWordCount = Object.values(sections).reduce((acc, value) => acc + computeWordCount(value), 0);
          await prisma.draftingSession.update({
            where: { id: sessionId },
            data: {
              currentWordCount: totalWordCount
            }
          });
        }

        return NextResponse.json({
          sectionKey,
          content,
          saved: true
        });
      }

      case 'insert_citation': {
        const payload = insertCitationSchema.parse(body);
        const styleCode = getStyleCode(session);
        const citations = await citationService.getCitationsForSession(sessionId);
        const citationMap = new Map(citations.map(c => [c.citationKey, c]));

        const formatted = await Promise.all(payload.citationKeys.map(async key => {
          const citation = citationMap.get(key);
          if (!citation) return `[${key}]`;
          return citationStyleService.formatInTextCitation(toCitationData(citation), styleCode);
        }));

        const insertText = formatted.join(' ');
        const position = payload.position ?? payload.content.length;
        const updated = payload.content.slice(0, position) + insertText + payload.content.slice(position);

        await Promise.all(payload.citationKeys.map(async key => {
          const citation = citationMap.get(key);
          if (!citation || !payload.sectionKey) return;
          await citationService.markCitationUsed(citation.id, payload.sectionKey, updated.slice(0, 200));
        }));

        return NextResponse.json({
          content: updated,
          inserted: insertText
        });
      }

      case 'check_citations': {
        const payload = checkCitationsSchema.parse(body);
        const keys = extractCitationKeys(payload.content);
        const citations = await citationService.getCitationsForSession(sessionId);
        const knownKeys = new Set(citations.map(c => c.citationKey));
        const missing = keys.filter(key => !knownKeys.has(key));

        return NextResponse.json({
          total: keys.length,
          found: keys.filter(key => knownKeys.has(key)),
          missing
        });
      }

      case 'generate_bibliography': {
        const payload = bibliographySchema.parse(body);
        const styleCode = getStyleCode(session);
        const citations = await citationService.getCitationsForSession(sessionId);

        const filtered = payload.citationKeys
          ? citations.filter(c => payload.citationKeys!.includes(c.citationKey))
          : citations;

        const bibliography = await citationStyleService.generateBibliography(
          filtered.map(toCitationData),
          styleCode,
          { sortOrder: payload.sortOrder }
        );

        return NextResponse.json({ bibliography });
      }

      case 'analyze_structure': {
        const draft = await getPaperDraft(sessionId);
        const sections = draft ? normalizeExtraSections(draft.extraSections) : {};
        const sectionKeys = Object.keys(sections).filter(key => (sections[key] || '').trim().length > 0);

        const validation = await paperTypeService.validateSectionStructure(paperTypeCode, sectionKeys);

        return NextResponse.json({
          paperType: paperTypeCode,
          sectionKeys,
          validation
        });
      }

      case 'word_count': {
        const draft = await getPaperDraft(sessionId);
        const sections = draft ? normalizeExtraSections(draft.extraSections) : {};
        const perSection: Record<string, number> = {};
        let total = 0;

        for (const [key, value] of Object.entries(sections)) {
          const count = computeWordCount(value || '');
          perSection[key] = count;
          total += count;
        }

        return NextResponse.json({ total, perSection });
      }

      default:
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[PaperDrafting] error:', error);
    return NextResponse.json({ error: 'Failed to process drafting action' }, { status: 500 });
  }
}
