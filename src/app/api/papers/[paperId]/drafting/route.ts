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
import { getWritingSample, buildWritingSampleBlock } from '@/lib/writing-sample-service';
import { blueprintService } from '@/lib/services/blueprint-service';
import { evidencePackService, type SectionEvidencePack } from '@/lib/services/evidence-pack-service';
import { formatBibliographyMarkdown, polishDraftMarkdown } from '@/lib/markdown-draft-formatter';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { sectionPolishService } from '@/lib/services/section-polish-service';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import type { TenantContext } from '@/lib/metering';
import {
  buildCitationKeyLookup,
  citationKeyIdentity,
  resolveCitationKeyFromLookup,
  splitCitationKeyList
} from '@/lib/utils/citation-key-normalization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  action: z.enum([
    'generate_section',
    'regenerate_section',
    'start_dimension_flow',
    'generate_dimension',
    'accept_dimension',
    'reject_dimension',
    'get_dimension_flow',
    'save_section',
    'insert_citation',
    'check_citations',
    'get_humanization_data',
    'humanize_section',
    'save_humanized_section',
    'validate_humanized_citations',
    'generate_bibliography',
    'get_citation_sequence_history',
    'analyze_structure',
    'word_count',
    'run_ai_review',
    'apply_ai_fix'
  ])
});

const generateSchema = z.object({
  sectionKey: z.string().min(1),
  instructions: z.string().max(5000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(), // Deprecated: output tokens now controlled via super admin LLM config
  useMappedEvidence: z.boolean().optional(),
  generationMode: z.enum(['two_pass', 'topup_final']).optional(),
  autoCitationRepair: z.boolean().optional(),
  // Persona style support (borrowed from patent drafting)
  usePersonaStyle: z.boolean().optional(),
  personaSelection: z.object({
    primaryPersonaId: z.string().optional(),
    primaryPersonaName: z.string().optional(),
    secondaryPersonaIds: z.array(z.string()).optional(),
    secondaryPersonaNames: z.array(z.string()).optional()
  }).optional()
});

const startDimensionFlowSchema = z.object({
  sectionKey: z.string().min(1),
  instructions: z.string().max(5000).optional(),
  useMappedEvidence: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional()
});

const generateDimensionSchema = z.object({
  sectionKey: z.string().min(1),
  dimensionKey: z.string().min(1).optional(),
  feedback: z.string().max(2000).optional(),
  forceRegenerate: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional(),
  useMappedEvidence: z.boolean().optional()
});

const acceptDimensionSchema = z.object({
  sectionKey: z.string().min(1),
  dimensionKey: z.string().min(1),
  content: z.string().optional(),
  prefetchNext: z.boolean().optional(),
  useMappedEvidence: z.boolean().optional(),
  allowCitationBypass: z.boolean().optional()
});

const rejectDimensionSchema = z.object({
  sectionKey: z.string().min(1),
  dimensionKey: z.string().min(1),
  feedback: z.string().max(2000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  useMappedEvidence: z.boolean().optional()
});

const getDimensionFlowSchema = z.object({
  sectionKey: z.string().min(1)
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
  sortOrder: z.enum(['alphabetical', 'order_of_appearance']).optional(),
  styleCode: z.string().min(1).optional()
});

const citationSequenceHistorySchema = z.object({
  styleCode: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const aiReviewSchema = z.object({
  sessionId: z.string().min(1),
  draft: z.record(z.string())
});

const aiFixSchema = z.object({
  sessionId: z.string().min(1),
  sectionKey: z.string().min(1),
  issue: z.object({
    id: z.string(),
    sectionKey: z.string(),
    sectionLabel: z.string(),
    type: z.enum(['error', 'warning', 'suggestion']),
    category: z.string(),
    title: z.string(),
    description: z.string(),
    suggestion: z.string(),
    fixPrompt: z.string(),
    relatedSections: z.array(z.string()).optional(),
    severity: z.number()
  }),
  currentContent: z.string(),
  relatedContent: z.record(z.string()).optional(),
  previewOnly: z.boolean().optional()
});

const humanizeSectionSchema = z.object({
  sectionKey: z.string().min(1),
  sourceDraftFingerprint: z.string().min(3).optional(),
  options: z.record(z.any()).optional()
});

const saveHumanizedSectionSchema = z.object({
  sectionKey: z.string().min(1),
  content: z.string()
});

const validateHumanizedCitationsSchema = z.object({
  sectionKey: z.string().min(1).optional(),
  validateAll: z.boolean().optional()
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

async function resolveTenantContext(
  request: NextRequest,
  userId: string,
  tenantId?: string | null
): Promise<TenantContext | null> {
  const authorization = request.headers.get('authorization');
  let authContext: TenantContext | null = null;

  if (authorization) {
    authContext = await extractTenantContextFromRequest({ headers: { authorization } });
    if (authContext && (!tenantId || authContext.tenantId === tenantId)) {
      return {
        ...authContext,
        userId: authContext.userId || userId,
      };
    }
  }

  if (!tenantId) {
    return authContext
      ? {
          ...authContext,
          userId: authContext.userId || userId,
        }
      : null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });

  if (tenant && tenant.status === 'ACTIVE' && tenant.tenantPlans[0]) {
    if (authContext && authContext.tenantId !== tenantId) {
      console.warn(
        `[Drafting] Tenant mismatch between JWT (${authContext.tenantId}) and session (${tenantId}); using session tenant context`
      );
    }
    return {
      tenantId: tenant.id,
      planId: tenant.tenantPlans[0].planId,
      tenantStatus: tenant.status,
      userId,
    };
  }

  return null;
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
  const normalize = (sections: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const [key, sectionValue] of Object.entries(sections)) {
      if (typeof sectionValue === 'string') {
        normalized[key] = polishDraftMarkdown(sectionValue);
      }
    }
    return normalized;
  };

  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? normalize(parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return normalize(value as Record<string, unknown>);
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

const normalizeSectionKey = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const SINGLE_PASS_SECTION_KEYS = new Set(['abstract', 'conclusion']);

function isSinglePassSection(sectionKey: string): boolean {
  return SINGLE_PASS_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

function buildSinglePassSectionError(sectionKey: string) {
  return {
    error: `Structured dimension flow is disabled for "${sectionKey}"`,
    hint: 'Use generate_section or regenerate_section. Abstract and conclusion are generated in a single pass.'
  };
}

function formatSectionLabel(sectionKey: string): string {
  return normalizeSectionKey(sectionKey)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  literature_review: 'Literature Review',
  related_work: 'Related Work',
  methodology: 'Methodology',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  acknowledgments: 'Acknowledgments',
  references: 'References',
  future_directions: 'Future Directions',
  future_work: 'Future Work',
  case_description: 'Case Description',
  analysis: 'Analysis',
  recommendations: 'Recommendations',
  main_content: 'Main Content',
  case_studies: 'Case Studies',
  main_findings: 'Main Findings',
  appendix: 'Appendix'
};

function getSectionGenerationOrder(
  sectionPlan: Array<{ sectionKey: string; dependencies: string[] }>
): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const visit = (sectionKey: string) => {
    if (visited.has(sectionKey)) return;
    if (temp.has(sectionKey)) return;
    temp.add(sectionKey);
    const section = sectionPlan.find(s => s.sectionKey === sectionKey);
    if (section) {
      for (const dep of section.dependencies) {
        if (sectionPlan.some(s => s.sectionKey === dep)) {
          visit(dep);
        }
      }
    }
    temp.delete(sectionKey);
    visited.add(sectionKey);
    order.push(sectionKey);
  };

  for (const section of sectionPlan) {
    visit(section.sectionKey);
  }
  return order;
}

async function getPreviousSectionMemories(
  sessionId: string,
  currentSectionKey: string,
  blueprint: { sectionPlan: Array<{ sectionKey: string; purpose: string; dependencies: string[]; outputsPromised: string[] }> }
): Promise<PreviousSectionMemoryEntry[]> {
  const generationOrder = getSectionGenerationOrder(blueprint.sectionPlan);
  const normalizedCurrent = normalizeSectionKey(currentSectionKey);
  const currentIndex = generationOrder.findIndex(
    k => normalizeSectionKey(k) === normalizedCurrent
  );
  const previousKeys = currentIndex > 0 ? generationOrder.slice(0, currentIndex) : [];
  if (previousKeys.length === 0) return [];

  const sections = await prisma.paperSection.findMany({
    where: {
      sessionId,
      sectionKey: { in: previousKeys },
      memory: { not: null as any }
    },
    select: { sectionKey: true, memory: true }
  });

  const sectionMap = new Map(sections.map(s => [s.sectionKey, s]));

  return previousKeys
    .map(key => {
      const record = sectionMap.get(key);
      const mem = record?.memory as any;
      if (!mem) return null;
      const plan = blueprint.sectionPlan.find(s => s.sectionKey === key);
      return {
        sectionKey: key,
        displayName: SECTION_DISPLAY_NAMES[normalizeSectionKey(key)] || formatSectionLabel(key),
        keyPoints: Array.isArray(mem.keyPoints) ? mem.keyPoints : [],
        termsIntroduced: Array.isArray(mem.termsIntroduced) ? mem.termsIntroduced : [],
        mainClaims: Array.isArray(mem.mainClaims) ? mem.mainClaims : [],
        forwardReferences: Array.isArray(mem.forwardReferences) ? mem.forwardReferences : [],
        outputsPromised: Array.isArray(plan?.outputsPromised) ? plan.outputsPromised : []
      } satisfies PreviousSectionMemoryEntry;
    })
    .filter((entry): entry is PreviousSectionMemoryEntry => entry !== null);
}

function formatPreviousSectionMemoriesBlock(memories: PreviousSectionMemoryEntry[]): string {
  if (memories.length === 0) return '';
  const parts = memories.map(pm => {
    const lines: string[] = [`### ${pm.displayName}`];
    if (pm.outputsPromised.length > 0) {
      lines.push(`- Promised Outputs: ${pm.outputsPromised.join('; ')}`);
    }
    if (pm.keyPoints.length > 0) {
      lines.push(`- Key Points: ${pm.keyPoints.join('; ')}`);
    }
    if (pm.termsIntroduced.length > 0) {
      lines.push(`- Terms Introduced: ${pm.termsIntroduced.join(', ')}`);
    }
    if (pm.mainClaims.length > 0) {
      lines.push(`- Claims Made: ${pm.mainClaims.join('; ')}`);
    }
    if (pm.forwardReferences.length > 0) {
      lines.push(`- Forward References: ${pm.forwardReferences.join('; ')}`);
    }
    return lines.join('\n');
  });
  return `
═══════════════════════════════════════════════════════════════════════════════
[CONTINUITY] PREVIOUS SECTIONS MEMORY (for cross-section coherence)
═══════════════════════════════════════════════════════════════════════════════
Use the terminology, concepts, and outputs established by previous sections.
Do NOT re-derive what earlier sections already established. Build on their outputs.

${parts.join('\n\n')}
`;
}

function computeContentFingerprint(content: string): string {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }

  const positive = hash >>> 0;
  return `${positive.toString(16)}_${normalized.length}`;
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
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey
  };
}

function getStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

const NUMERIC_ORDER_STYLES = new Set(['IEEE', 'VANCOUVER']);
const CITE_MARKER_REGEX = /\[CITE:([^\]]+)\]/gi;
const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi;

type SessionCitation = Awaited<ReturnType<typeof citationService.getCitationsForSession>>[number];

function splitCitationKeys(rawKeys: string): string[] {
  return splitCitationKeyList(rawKeys);
}

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '');
  if (!raw) return '';

  const replaceLegacySpans = (value: string): string => value.replace(
    LEGACY_CITATION_SPAN_REGEX,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim();
      return citationKey ? `[CITE:${citationKey}]` : _full;
    }
  );

  const decoded = raw
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  return replaceLegacySpans(replaceLegacySpans(decoded));
}

function buildCanonicalCitationLookup(citations: Array<{ citationKey: string }>): Map<string, string> {
  return buildCitationKeyLookup(citations.map(citation => citation.citationKey));
}

function mergeSectionOrder(
  preferredOrder: string[],
  extraSections: Record<string, string>,
  additionalSections: string[] = []
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const append = (sectionKey: string) => {
    const normalized = normalizeSectionKey(sectionKey || '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  };

  for (const key of preferredOrder) append(key);
  for (const key of Object.keys(extraSections)) append(key);
  for (const key of additionalSections) append(key);

  return ordered;
}

function mergeCitationOrder(primaryOrder: string[], secondaryOrder: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  const append = (key: string) => {
    const canonical = String(key || '').trim();
    const normalized = citationKeyIdentity(canonical);
    if (!canonical || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(canonical);
  };

  for (const key of primaryOrder) append(key);
  for (const key of secondaryOrder) append(key);

  return merged;
}

type CitationSequenceRenumbered = {
  citationKey: string;
  from: number;
  to: number;
};

type CitationSequenceDiff = {
  added: string[];
  removed: string[];
  renumbered: CitationSequenceRenumbered[];
};

type CitationSequenceSnapshot = {
  id: string;
  styleCode: string;
  sortOrder: 'alphabetical' | 'order_of_appearance';
  orderedCitationKeys: string[];
  numbering: Record<string, number>;
  changes: CitationSequenceDiff;
  version: number;
  createdAt: string;
};

type CitationTrackingState = {
  sequenceHistory: CitationSequenceSnapshot[];
  latestByStyle: Record<string, string>;
};

type HumanizationStatus =
  | 'not_started'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'outdated';

type HumanizedCitationValidation = {
  checkedAt: string;
  draftCitationKeys: string[];
  humanizedCitationKeys: string[];
  missingCitationKeys: string[];
  extraCitationKeys: string[];
  valid: boolean;
};

type HumanizedSectionRecord = {
  id?: string;
  version?: number;
  draftId?: string | null;
  sectionKey: string;
  humanizedContent?: string;
  status?: HumanizationStatus;
  provider?: string;
  sourceDraftFingerprint?: string;
  sourceDraftWordCount?: number;
  sourceDraftUpdatedAt?: string;
  humanizedWordCount?: number;
  humanizedAt?: string;
  updatedAt?: string;
  error?: string | null;
  citationValidation?: HumanizedCitationValidation;
};

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

type DbHumanizationStatus = 'NOT_STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'OUTDATED';

function mapDbStatusToApi(status: DbHumanizationStatus | null | undefined): HumanizationStatus {
  switch (status) {
    case 'PROCESSING':
      return 'processing';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'OUTDATED':
      return 'outdated';
    default:
      return 'not_started';
  }
}

function deriveHumanizationStatus(
  draftContent: string,
  record?: HumanizedSectionRecord
): HumanizationStatus {
  const normalizedDraft = String(draftContent || '').trim();
  if (!normalizedDraft) return 'not_started';
  if (!record) return 'not_started';
  const mappedStatus = mapDbStatusToApi(
    (record.status || 'not_started').toUpperCase() as DbHumanizationStatus
  );
  if (mappedStatus === 'failed') return 'failed';
  if (mappedStatus === 'processing') return 'processing';
  const hasHumanized = Boolean(record.humanizedContent && record.humanizedContent.trim());
  if (!hasHumanized) return 'not_started';

  const currentFingerprint = computeContentFingerprint(normalizedDraft);
  if (record.sourceDraftFingerprint && record.sourceDraftFingerprint !== currentFingerprint) {
    return 'outdated';
  }

  if (mappedStatus === 'outdated') return 'outdated';

  return 'completed';
}

async function loadHumanizationRecords(
  sessionId: string
): Promise<Record<string, HumanizedSectionRecord>> {
  const rows = await prisma.paperSectionHumanization.findMany({
    where: { sessionId },
    include: {
      citationValidations: {
        orderBy: { checkedAt: 'desc' },
        take: 10
      }
    }
  });

  const map: Record<string, HumanizedSectionRecord> = {};
  for (const row of rows) {
    const sectionKey = normalizeSectionKey(row.sectionKey);
    const latestValidation = row.citationValidations.find(
      validation => validation.humanizationVersion === row.version
    ) || null;

    map[sectionKey] = {
      id: row.id,
      version: row.version,
      draftId: row.draftId,
      sectionKey,
      humanizedContent: row.humanizedContent || '',
      status: mapDbStatusToApi(row.status as DbHumanizationStatus),
      provider: row.provider || undefined,
      sourceDraftFingerprint: row.sourceDraftFingerprint || undefined,
      sourceDraftWordCount: row.sourceDraftWordCount ?? undefined,
      sourceDraftUpdatedAt: row.sourceDraftUpdatedAt ? row.sourceDraftUpdatedAt.toISOString() : undefined,
      humanizedWordCount: row.humanizedWordCount ?? undefined,
      humanizedAt: row.humanizedAt ? row.humanizedAt.toISOString() : undefined,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : undefined,
      error: row.errorMessage || null,
      citationValidation: latestValidation
        ? {
          checkedAt: latestValidation.checkedAt.toISOString(),
          draftCitationKeys: latestValidation.draftCitationKeys,
          humanizedCitationKeys: latestValidation.humanizedCitationKeys,
          missingCitationKeys: latestValidation.missingCitationKeys,
          extraCitationKeys: latestValidation.extraCitationKeys,
          valid: latestValidation.isValid
        }
        : undefined
    };
  }

  return map;
}

function extractHumanizedText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';

  const data = response as Record<string, unknown>;
  const directCandidates = [
    data.humanizedText,
    data.humanized_content,
    data.humanized,
    data.content,
    data.output,
    data.text,
    data.result
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const nested = data.data as Record<string, unknown>;
    const nestedCandidates = [
      nested.humanizedText,
      nested.humanized_content,
      nested.humanized,
      nested.content,
      nested.output,
      nested.text,
      nested.result
    ];
    for (const candidate of nestedCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
  }

  return '';
}

async function callHumanizerService(params: {
  sessionId: string;
  sectionKey: string;
  draftContent: string;
  styleCode?: string;
  options?: Record<string, unknown>;
}): Promise<{ content: string; provider: string }> {
  const url = String(process.env.PAPER_HUMANIZER_API_URL || '').trim();
  if (!url) {
    throw new DraftingRequestError(
      'Humanizer service is not configured',
      503,
      {
        error: 'Humanizer service is not configured',
        hint: 'Set PAPER_HUMANIZER_API_URL (and optional PAPER_HUMANIZER_API_KEY).'
      }
    );
  }

  const timeoutMs = Math.max(
    1_000,
    Number(process.env.PAPER_HUMANIZER_TIMEOUT_MS || 60_000)
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const requestBody = {
    text: params.draftContent,
    sectionKey: params.sectionKey,
    sessionId: params.sessionId,
    styleCode: params.styleCode || null,
    preserveCitations: true,
    outputFormat: 'markdown',
    options: params.options || {}
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const apiKey = String(process.env.PAPER_HUMANIZER_API_KEY || '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const rawText = await response.text();
    let parsedPayload: unknown = null;
    if (rawText) {
      try {
        parsedPayload = JSON.parse(rawText);
      } catch {
        parsedPayload = rawText;
      }
    }

    if (!response.ok) {
      const parsedObject = parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)
        ? parsedPayload as Record<string, unknown>
        : null;
      const message =
        (parsedObject && typeof parsedObject.error === 'string' && parsedObject.error)
        || (parsedObject && typeof parsedObject.message === 'string' && parsedObject.message)
        || (typeof parsedPayload === 'string' ? parsedPayload.slice(0, 400) : '')
        || 'Humanizer service request failed';

      throw new DraftingRequestError(message, response.status, {
        error: message,
        status: response.status
      });
    }

    const extracted = extractHumanizedText(parsedPayload);
    const content = polishDraftMarkdown(extracted || (typeof parsedPayload === 'string' ? parsedPayload : ''));
    if (!content.trim()) {
      throw new DraftingRequestError(
        'Humanizer service returned empty content',
        502,
        { error: 'Humanizer service returned empty content' }
      );
    }

    const provider = parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)
      ? String((parsedPayload as Record<string, unknown>).provider || 'humanizer_api')
      : 'humanizer_api';

    return { content, provider };
  } catch (error) {
    if (error instanceof DraftingRequestError) {
      throw error;
    }

    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (isAbort) {
      throw new DraftingRequestError(
        'Humanizer service timed out',
        504,
        { error: 'Humanizer service timed out' }
      );
    }

    throw new DraftingRequestError(
      error instanceof Error ? error.message : 'Humanizer service call failed',
      502,
      { error: 'Humanizer service call failed' }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildCitationNumberingMap(orderedCitationKeys: string[]): Record<string, number> {
  return Object.fromEntries(
    orderedCitationKeys.map((citationKey, index) => [citationKey, index + 1])
  );
}

function buildCitationSequenceDiff(
  previousOrdered: string[],
  nextOrdered: string[]
): CitationSequenceDiff {
  const previousSet = new Set(previousOrdered);
  const nextSet = new Set(nextOrdered);
  const previousNumbering = buildCitationNumberingMap(previousOrdered);
  const nextNumbering = buildCitationNumberingMap(nextOrdered);

  const added = nextOrdered.filter(key => !previousSet.has(key));
  const removed = previousOrdered.filter(key => !nextSet.has(key));
  const renumbered: CitationSequenceRenumbered[] = nextOrdered
    .filter(key => previousSet.has(key))
    .map(key => ({
      citationKey: key,
      from: previousNumbering[key],
      to: nextNumbering[key]
    }))
    .filter(change => change.from !== change.to);

  return { added, removed, renumbered };
}

function readCitationTrackingState(validationReport: unknown): CitationTrackingState {
  const report = asPlainObject(validationReport);
  const rawTracking = asPlainObject(report.citationTracking);
  const rawHistory = Array.isArray(rawTracking.sequenceHistory)
    ? rawTracking.sequenceHistory
    : [];
  const sequenceHistory: CitationSequenceSnapshot[] = rawHistory
    .map((item) => {
      const snapshot = asPlainObject(item);
      const styleCode = String(snapshot.styleCode || '').trim().toUpperCase();
      const sortOrder = snapshot.sortOrder === 'order_of_appearance'
        ? 'order_of_appearance'
        : 'alphabetical';
      const orderedCitationKeys = Array.isArray(snapshot.orderedCitationKeys)
        ? snapshot.orderedCitationKeys.map(v => String(v || '').trim()).filter(Boolean)
        : [];
      const numberingRaw = asPlainObject(snapshot.numbering);
      const numbering: Record<string, number> = {};
      for (const [key, value] of Object.entries(numberingRaw)) {
        const n = Number(value);
        if (key && Number.isFinite(n)) numbering[key] = n;
      }
      const rawChanges = asPlainObject(snapshot.changes);
      const changes: CitationSequenceDiff = {
        added: Array.isArray(rawChanges.added)
          ? rawChanges.added.map(v => String(v || '').trim()).filter(Boolean)
          : [],
        removed: Array.isArray(rawChanges.removed)
          ? rawChanges.removed.map(v => String(v || '').trim()).filter(Boolean)
          : [],
        renumbered: Array.isArray(rawChanges.renumbered)
          ? rawChanges.renumbered
            .map((entry) => {
              const row = asPlainObject(entry);
              const citationKey = String(row.citationKey || '').trim();
              const from = Number(row.from);
              const to = Number(row.to);
              if (!citationKey || !Number.isFinite(from) || !Number.isFinite(to)) return null;
              return { citationKey, from, to };
            })
            .filter((entry): entry is CitationSequenceRenumbered => Boolean(entry))
          : []
      };
      const version = Number(snapshot.version);
      const createdAt = String(snapshot.createdAt || '').trim() || new Date(0).toISOString();
      const id = String(snapshot.id || '').trim();
      if (!id || !styleCode) return null;
      return {
        id,
        styleCode,
        sortOrder,
        orderedCitationKeys,
        numbering,
        changes,
        version: Number.isFinite(version) ? version : 1,
        createdAt
      } satisfies CitationSequenceSnapshot;
    })
    .filter((item): item is CitationSequenceSnapshot => Boolean(item));

  const latestByStyleRaw = asPlainObject(rawTracking.latestByStyle);
  const latestByStyle: Record<string, string> = {};
  for (const [styleCode, snapshotId] of Object.entries(latestByStyleRaw)) {
    const normalizedStyle = styleCode.trim().toUpperCase();
    const id = String(snapshotId || '').trim();
    if (normalizedStyle && id) {
      latestByStyle[normalizedStyle] = id;
    }
  }

  return {
    sequenceHistory,
    latestByStyle
  };
}

function findLatestSnapshotForStyle(
  tracking: CitationTrackingState,
  styleCode: string
): CitationSequenceSnapshot | null {
  const normalizedStyleCode = styleCode.trim().toUpperCase();
  if (!normalizedStyleCode) return null;

  const preferredId = tracking.latestByStyle[normalizedStyleCode];
  if (preferredId) {
    const match = tracking.sequenceHistory.find(snapshot => snapshot.id === preferredId);
    if (match) return match;
  }

  const fallback = [...tracking.sequenceHistory]
    .reverse()
    .find(snapshot => snapshot.styleCode === normalizedStyleCode);
  return fallback || null;
}

async function persistCitationSequenceSnapshot(params: {
  draftId: string;
  validationReport: unknown;
  styleCode: string;
  sortOrder: 'alphabetical' | 'order_of_appearance';
  orderedCitationKeys: string[];
}): Promise<{
  snapshotId: string;
  version: number;
  previousVersion: number | null;
  changed: boolean;
  changes: CitationSequenceDiff;
  historyCount: number;
}> {
  const {
    draftId,
    validationReport,
    styleCode,
    sortOrder,
    orderedCitationKeys
  } = params;
  const normalizedStyleCode = styleCode.trim().toUpperCase();
  const baseReport = asPlainObject(validationReport);
  const tracking = readCitationTrackingState(validationReport);
  const previousSnapshot = findLatestSnapshotForStyle(tracking, normalizedStyleCode);
  const previousOrdered = previousSnapshot?.orderedCitationKeys || [];
  const changes = buildCitationSequenceDiff(previousOrdered, orderedCitationKeys);
  const changed = !previousSnapshot
    || changes.added.length > 0
    || changes.removed.length > 0
    || changes.renumbered.length > 0;

  if (!changed && previousSnapshot) {
    return {
      snapshotId: previousSnapshot.id,
      version: previousSnapshot.version,
      previousVersion: previousSnapshot.version,
      changed: false,
      changes,
      historyCount: tracking.sequenceHistory.length
    };
  }

  const snapshot: CitationSequenceSnapshot = {
    id: crypto.randomUUID(),
    styleCode: normalizedStyleCode,
    sortOrder,
    orderedCitationKeys,
    numbering: buildCitationNumberingMap(orderedCitationKeys),
    changes,
    version: (previousSnapshot?.version || 0) + 1,
    createdAt: new Date().toISOString()
  };

  const nextHistory = [...tracking.sequenceHistory, snapshot].slice(-100);
  const nextLatestByStyle = {
    ...tracking.latestByStyle,
    [normalizedStyleCode]: snapshot.id
  };
  const nextValidationReport = {
    ...baseReport,
    citationTracking: {
      sequenceHistory: nextHistory,
      latestByStyle: nextLatestByStyle
    }
  };

  await prisma.annexureDraft.update({
    where: { id: draftId },
    data: {
      validationReport: nextValidationReport
    }
  });

  return {
    snapshotId: snapshot.id,
    version: snapshot.version,
    previousVersion: previousSnapshot?.version || null,
    changed: Boolean(previousSnapshot),
    changes,
    historyCount: nextHistory.length
  };
}

function extractSectionCitationKeys(
  sectionContent: string,
  canonicalLookup: Map<string, string>
): string[] {
  const normalizedContent = normalizeCitationMarkupForExtraction(sectionContent);
  const ordered: string[] = [];
  const seen = new Set<string>();
  CITE_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = CITE_MARKER_REGEX.exec(normalizedContent)) !== null) {
    const keys = splitCitationKeys(match[1] || '');
    for (const rawKey of keys) {
      const canonical = resolveCitationKeyFromLookup(rawKey, canonicalLookup);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      ordered.push(canonical);
    }
  }

  // Fallback: recover canonical keys from bare [CitationKey] markers.
  const bareMarkerRegex = /\[([^\[\]]+)\]/g;
  bareMarkerRegex.lastIndex = 0;
  while ((match = bareMarkerRegex.exec(normalizedContent)) !== null) {
    const token = String(match[1] || '').trim();
    if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
    const keys = splitCitationKeys(token);
    for (const rawKey of keys) {
      const canonical = resolveCitationKeyFromLookup(rawKey, canonicalLookup);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      ordered.push(canonical);
    }
  }

  return ordered;
}

function buildHumanizedCitationValidation(
  draftContent: string,
  humanizedContent: string,
  canonicalLookup: Map<string, string>
): HumanizedCitationValidation {
  const extractComparableCitationKeys = (content: string): string[] => {
    const normalizedContent = normalizeCitationMarkupForExtraction(content);
    const ordered: string[] = [];
    const seen = new Set<string>();
    CITE_MARKER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = CITE_MARKER_REGEX.exec(normalizedContent)) !== null) {
      const keys = splitCitationKeys(match[1] || '');
      for (const rawKey of keys) {
        const fallback = rawKey.trim();
        if (!fallback) continue;
        const canonical = resolveCitationKeyFromLookup(fallback, canonicalLookup) || fallback;
        const identity = citationKeyIdentity(canonical);
        if (seen.has(identity)) continue;
        seen.add(identity);
        ordered.push(canonical);
      }
    }

    const bareMarkerRegex = /\[([^\[\]]+)\]/g;
    bareMarkerRegex.lastIndex = 0;
    while ((match = bareMarkerRegex.exec(normalizedContent)) !== null) {
      const token = String(match[1] || '').trim();
      if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
      const keys = splitCitationKeys(token);
      for (const rawKey of keys) {
        const fallback = rawKey.trim();
        if (!fallback) continue;
        const canonical = resolveCitationKeyFromLookup(fallback, canonicalLookup) || fallback;
        const identity = citationKeyIdentity(canonical);
        if (seen.has(identity)) continue;
        seen.add(identity);
        ordered.push(canonical);
      }
    }

    return ordered;
  };

  const draftCitationKeys = extractComparableCitationKeys(draftContent);
  const humanizedCitationKeys = extractComparableCitationKeys(humanizedContent);
  const humanizedSet = new Set(humanizedCitationKeys);
  const draftSet = new Set(draftCitationKeys);

  const missingCitationKeys = draftCitationKeys.filter((key) => !humanizedSet.has(key));
  const extraCitationKeys = humanizedCitationKeys.filter((key) => !draftSet.has(key));

  return {
    checkedAt: new Date().toISOString(),
    draftCitationKeys,
    humanizedCitationKeys,
    missingCitationKeys,
    extraCitationKeys,
    valid: missingCitationKeys.length === 0
  };
}

type HumanizationSectionPayload = {
  sectionKey: string;
  label: string;
  status: HumanizationStatus;
  draftWordCount: number;
  humanizedWordCount: number;
  draftFingerprint: string;
  sourceDraftFingerprint: string | null;
  draftContent: string;
  humanizedContent: string;
  provider: string | null;
  lastHumanizedAt: string | null;
  lastValidatedAt: string | null;
  citationValidation: HumanizedCitationValidation | null;
  error: string | null;
};

async function buildHumanizationData(params: {
  sessionId: string;
  paperTypeCode: string;
  draft: Awaited<ReturnType<typeof getPaperDraft>> | null;
}): Promise<{
  sections: HumanizationSectionPayload[];
  summary: {
    total: number;
    completed: number;
    outdated: number;
    failed: number;
    pending: number;
  };
}> {
  const { sessionId, paperTypeCode, draft } = params;
  const extraSections = draft ? normalizeExtraSections(draft.extraSections) : {};
  const humanization = await loadHumanizationRecords(sessionId);

  const paperType = await paperTypeService.getPaperType(paperTypeCode);
  const preferredOrder = Array.isArray(paperType?.sectionOrder) ? paperType.sectionOrder : [];
  const orderedSectionKeys = mergeSectionOrder(
    preferredOrder,
    extraSections,
    Object.keys(humanization)
  );

  const sections: HumanizationSectionPayload[] = orderedSectionKeys.map((rawSectionKey) => {
    const sectionKey = normalizeSectionKey(rawSectionKey);
    const label = formatSectionLabel(sectionKey);
    const draftContent = extraSections[sectionKey] || '';
    const draftWordCount = computeWordCount(draftContent);
    const draftFingerprint = computeContentFingerprint(draftContent);
    const record = humanization[sectionKey];
    const status = deriveHumanizationStatus(draftContent, record);
    const humanizedContent = typeof record?.humanizedContent === 'string'
      ? record.humanizedContent
      : '';
    const humanizedWordCount = computeWordCount(humanizedContent);
    const citationValidation = record?.citationValidation || null;

    return {
      sectionKey,
      label,
      status,
      draftWordCount,
      humanizedWordCount,
      draftFingerprint,
      sourceDraftFingerprint: record?.sourceDraftFingerprint || null,
      draftContent,
      humanizedContent,
      provider: record?.provider || null,
      lastHumanizedAt: record?.humanizedAt || null,
      lastValidatedAt: citationValidation?.checkedAt || null,
      citationValidation,
      error: record?.error || null
    };
  });

  const summary = sections.reduce(
    (acc, section) => {
      if (section.status === 'completed') acc.completed += 1;
      else if (section.status === 'outdated') acc.outdated += 1;
      else if (section.status === 'failed') acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: sections.length, completed: 0, outdated: 0, failed: 0, pending: 0 }
  );

  return { sections, summary };
}

function extractOrderedCitationKeysFromSections(
  extraSections: Record<string, string>,
  orderedSectionKeys: string[],
  canonicalLookup: Map<string, string>
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const sectionKey of orderedSectionKeys) {
    const sectionContent = extraSections[sectionKey] || '';
    if (!sectionContent.trim()) continue;
    const sectionKeys = extractSectionCitationKeys(sectionContent, canonicalLookup);
    for (const key of sectionKeys) {
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
  }

  return ordered;
}

function sortCitationsByOrderedKeys<T extends { citationKey: string }>(
  citations: T[],
  orderedCitationKeys: string[]
): T[] {
  const orderLookup = new Map<string, number>();
  orderedCitationKeys.forEach((key, index) => orderLookup.set(key, index));

  return [...citations].sort((a, b) => {
    const left = orderLookup.get(a.citationKey);
    const right = orderLookup.get(b.citationKey);
    const leftRank = typeof left === 'number' ? left : Number.MAX_SAFE_INTEGER;
    const rightRank = typeof right === 'number' ? right : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return a.citationKey.localeCompare(b.citationKey);
  });
}

async function syncSectionDraftCitationUsage(params: {
  sessionId: string;
  sectionKey: string;
  sectionContent: string;
  citations: SessionCitation[];
}): Promise<{
  citationKeys: string[];
  attributedCount: number;
  ambiguousCount: number;
  unattributedKeys: string[];
}> {
  const { sessionId, sectionContent, citations } = params;
  const sectionKey = normalizeSectionKey(params.sectionKey || '');
  if (!sectionKey) {
    return {
      citationKeys: [],
      attributedCount: 0,
      ambiguousCount: 0,
      unattributedKeys: []
    };
  }
  const canonicalLookup = buildCanonicalCitationLookup(citations);
  const citationByKey = new Map(citations.map(c => [c.citationKey, c]));
  const citationKeys = extractSectionCitationKeys(sectionContent, canonicalLookup);

  const activeCitationIds = new Set(
    citationKeys
      .map(key => citationByKey.get(key)?.id)
      .filter((id): id is string => Boolean(id))
  );

  const existing = await prisma.citationUsage.findMany({
    where: {
      sectionKey,
      usageKind: 'DRAFT_CITATION',
      citation: { sessionId }
    },
    select: {
      id: true,
      citationId: true
    }
  });

  const staleUsageIds = existing
    .filter(usage => !activeCitationIds.has(usage.citationId))
    .map(usage => usage.id);
  if (staleUsageIds.length > 0) {
    await prisma.citationUsage.deleteMany({
      where: { id: { in: staleUsageIds } }
    });
  }

  let attributedCount = 0;
  let ambiguousCount = 0;
  const unattributedKeys: string[] = [];

  for (const citationKey of citationKeys) {
    const citation = citationByKey.get(citationKey);
    if (!citation) continue;

    const attribution = await resolveCitationAttribution(citation.id, sectionKey);
    if (attribution.dimension) {
      attributedCount++;
    } else if (attribution.ambiguous) {
      ambiguousCount++;
      unattributedKeys.push(citationKey);
    } else {
      unattributedKeys.push(citationKey);
    }

    await citationService.markCitationUsed(
      citation.id,
      sectionKey,
      sectionContent.slice(0, 200),
      undefined,
      {
        usageKind: 'DRAFT_CITATION',
        dimension: attribution.dimension
      }
    );
  }

  return {
    citationKeys,
    attributedCount,
    ambiguousCount,
    unattributedKeys
  };
}

async function syncDraftCitationUsage(params: {
  sessionId: string;
  paperTypeCode: string;
  citations: SessionCitation[];
  extraSections: Record<string, string>;
}): Promise<{
  orderedSectionKeys: string[];
  orderedCitationKeys: string[];
}> {
  const { sessionId, paperTypeCode, citations, extraSections } = params;
  const normalizedSections: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(extraSections)) {
    const sectionKey = normalizeSectionKey(rawKey);
    if (!sectionKey) continue;
    const value = String(rawValue || '');
    if (!value.trim()) continue;
    const existing = normalizedSections[sectionKey];
    normalizedSections[sectionKey] = existing
      ? `${existing}\n\n${value}`
      : value;
  }

  const paperType = await paperTypeService.getPaperType(paperTypeCode);
  const preferredOrder = Array.isArray(paperType?.sectionOrder) ? paperType.sectionOrder : [];
  const existingUsageSections = await prisma.citationUsage.findMany({
    where: {
      usageKind: 'DRAFT_CITATION',
      citation: { sessionId }
    },
    select: { sectionKey: true },
    distinct: ['sectionKey']
  });

  const orderedSectionKeys = mergeSectionOrder(
    preferredOrder,
    normalizedSections,
    existingUsageSections.map(row => row.sectionKey)
  );

  for (const sectionKey of orderedSectionKeys) {
    await syncSectionDraftCitationUsage({
      sessionId,
      sectionKey,
      sectionContent: normalizedSections[sectionKey] || '',
      citations
    });
  }

  const canonicalLookup = buildCanonicalCitationLookup(citations);
  const orderedCitationKeys = extractOrderedCitationKeysFromSections(
    normalizedSections,
    orderedSectionKeys,
    canonicalLookup
  );

  return { orderedSectionKeys, orderedCitationKeys };
}

interface BlueprintPromptContext {
  thesisStatement?: string;
  centralObjective?: string;
  keyContributions?: string[];
  sectionPlan?: Array<{ sectionKey: string; purpose?: string }>;
  mustCover?: string[];
  mustAvoid?: string[];
  wordBudget?: number;
}

interface PreviousSectionMemoryEntry {
  sectionKey: string;
  displayName: string;
  keyPoints: string[];
  termsIntroduced: string[];
  mainClaims: string[];
  forwardReferences: string[];
  outputsPromised: string[];
}

interface EvidencePromptContext {
  useMappedEvidence: boolean;
  allowedCitationKeys: string[];
  dimensionEvidence: SectionEvidencePack['dimensionEvidence'];
  gaps: string[];
  coverageAssignments: SectionEvidencePack['coverageAssignments'];
}

interface DimensionPlanEntry {
  dimensionKey: string;
  dimensionLabel: string;
  objective: string;
  mustUseCitationKeys: string[];
  avoidClaims: string[];
  bridgeHint: string;
  role?: DimensionRole;
  targetWords?: number;
  minWords?: number;
  maxWords?: number;
}

interface DimensionAcceptedBlock {
  dimensionKey: string;
  dimensionLabel: string;
  content: string;
  citationKeys: string[];
  source: 'llm' | 'user';
  version: number;
  updatedAt: string;
}

interface Pass1DimensionBrief {
  dimensionKey: string;
  dimensionLabel: string;
  roleHint?: DimensionRole;
  sourceSummary: string;
  claimFocus: string[];
  mustUseCitationKeys: string[];
  bridgeToNext?: string;
}

interface PersistedPass1Artifact {
  version: number;
  content: string;
  memory?: Pass1MemorySnapshot | null;
  contentFingerprint: string;
  wordCount: number;
  generatedAt?: string;
  promptUsed?: string;
  tokensUsed?: number;
}

interface Pass1MemorySnapshot {
  keyPoints: string[];
  termsIntroduced: string[];
  mainClaims: string[];
  forwardReferences: string[];
  sectionIntent?: string;
  openingStrategy?: string;
  closingStrategy?: string;
  sectionOutline?: string[];
  dimensionBriefs?: Pass1DimensionBrief[];
}

interface DimensionPass1SourceTrace {
  source: 'pass1_section_draft';
  contentFingerprint: string;
  wordCount: number;
  preview: string;
  generatedAt?: string;
  reused: boolean;
  memory?: Pass1MemorySnapshot | null;
}

interface DimensionProposalReviewTrace {
  pass1Fingerprint: string;
  pass1WordCount: number;
  role: DimensionRole;
  bridgeHint: string;
  requiredCitationKeys: string[];
  previousDimensionLabel?: string | null;
  nextDimensionLabel?: string | null;
  acceptedBlockCount: number;
  acceptedContextHash: string;
  acceptedSummary: string;
  acceptedContextPreview: string;
  pass1DimensionSummary?: string;
  targetEvidenceSummary?: string;
}

interface DimensionDraftProposal {
  dimensionKey: string;
  content: string;
  contextHash: string;
  citationValidation: {
    allowedCitationKeys: string[];
    disallowedKeys: string[];
    unknownKeys: string[];
    missingRequiredKeys: string[];
  };
  createdAt: string;
  reviewTrace?: DimensionProposalReviewTrace;
}

interface DimensionFlowState {
  version: number;
  sectionKey: string;
  createdAt: string;
  updatedAt: string;
  sectionWordBudget?: number;
  plan: DimensionPlanEntry[];
  acceptedBlocks: DimensionAcceptedBlock[];
  pass1Source?: DimensionPass1SourceTrace;
  pendingProposal?: DimensionDraftProposal;
  bufferedProposals?: Record<string, DimensionDraftProposal>;
  lastAcceptedContextHash?: string;
}

const DIMENSION_FLOW_VERSION = 1;
const MAX_DIMENSION_SUMMARY_ITEMS = 8;
const MAX_CITATIONS_PER_DIMENSION = 8;
type DimensionRole = 'introduction' | 'body' | 'conclusion' | 'intro_conclusion';

interface DimensionBudgetSnapshot {
  sectionWordBudget?: number;
  usedWords: number;
  remainingWords?: number;
}

interface DimensionDraftBudget {
  role: DimensionRole;
  sectionWordBudget?: number;
  targetWords?: number;
  minWords?: number;
  maxWords?: number;
  usedWordsExcludingTarget: number;
  remainingWordsForTarget?: number;
}

function normalizeDimensionKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_');
}

function normalizePositiveWordBudget(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return undefined;
  return rounded;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeDimensionRoleValue(value: unknown): DimensionRole | undefined {
  const normalized = String(value || '').trim();
  return normalized === 'introduction'
    || normalized === 'body'
    || normalized === 'conclusion'
    || normalized === 'intro_conclusion'
    ? normalized
    : undefined;
}

function normalizePass1DimensionBriefs(value: unknown): Pass1DimensionBrief[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const dimensionLabel = String(record.dimensionLabel || '').trim();
      const dimensionKey = normalizeDimensionKey(String(record.dimensionKey || dimensionLabel));
      const sourceSummary = String(record.sourceSummary || '').trim();
      if (!dimensionKey || !dimensionLabel || !sourceSummary) return null;

      return {
        dimensionKey,
        dimensionLabel,
        roleHint: normalizeDimensionRoleValue(record.roleHint),
        sourceSummary,
        claimFocus: normalizeStringList(record.claimFocus),
        mustUseCitationKeys: normalizeStringList(record.mustUseCitationKeys),
        bridgeToNext: String(record.bridgeToNext || '').trim() || undefined
      } satisfies Pass1DimensionBrief;
    })
    .filter(Boolean) as Pass1DimensionBrief[];
}

function normalizePass1MemorySnapshot(value: unknown): Pass1MemorySnapshot | null {
  const record = asRecord(value);
  const keyPoints = normalizeStringList(record.keyPoints);
  const termsIntroduced = normalizeStringList(record.termsIntroduced);
  const mainClaims = normalizeStringList(record.mainClaims);
  const forwardReferences = normalizeStringList(record.forwardReferences);
  const sectionIntent = String(record.sectionIntent || '').trim() || undefined;
  const openingStrategy = String(record.openingStrategy || '').trim() || undefined;
  const closingStrategy = String(record.closingStrategy || '').trim() || undefined;
  const sectionOutline = normalizeStringList(record.sectionOutline);
  const dimensionBriefs = normalizePass1DimensionBriefs(record.dimensionBriefs);

  if (
    keyPoints.length === 0
    && termsIntroduced.length === 0
    && mainClaims.length === 0
    && forwardReferences.length === 0
    && !sectionIntent
    && !openingStrategy
    && !closingStrategy
    && sectionOutline.length === 0
    && dimensionBriefs.length === 0
  ) {
    return null;
  }

  return {
    keyPoints,
    termsIntroduced,
    mainClaims,
    forwardReferences,
    sectionIntent,
    openingStrategy,
    closingStrategy,
    sectionOutline,
    dimensionBriefs
  };
}

function readPersistedPass1Artifact(value: unknown): PersistedPass1Artifact | null {
  const record = asRecord(value);
  const version = Number(record.version);
  const content = String(record.content || '').trim();
  if (!content || !Number.isFinite(version) || version <= 0) {
    return null;
  }

  return {
    version,
    content,
    memory: normalizePass1MemorySnapshot(record.memory),
    contentFingerprint: String(record.contentFingerprint || '').trim() || computeContentFingerprint(content),
    wordCount: Number(record.wordCount) > 0 ? Number(record.wordCount) : computeWordCount(content),
    generatedAt: String(record.generatedAt || '').trim() || undefined,
    promptUsed: String(record.promptUsed || '').trim() || undefined,
    tokensUsed: Number(record.tokensUsed) > 0 ? Number(record.tokensUsed) : undefined,
  };
}

function buildPersistedPass1Artifact(params: {
  content: string;
  memory?: unknown;
  generatedAt?: string | Date | null;
  promptUsed?: string;
  tokensUsed?: number | null;
}): PersistedPass1Artifact | null {
  const content = String(params.content || '').trim();
  if (!content) return null;
  const generatedAt = params.generatedAt instanceof Date
    ? params.generatedAt.toISOString()
    : String(params.generatedAt || '').trim() || undefined;

  return {
    version: 1,
    content,
    memory: normalizePass1MemorySnapshot(params.memory),
    contentFingerprint: computeContentFingerprint(content),
    wordCount: computeWordCount(content),
    generatedAt,
    promptUsed: String(params.promptUsed || '').trim() || undefined,
    tokensUsed: Number(params.tokensUsed) > 0 ? Number(params.tokensUsed) : undefined
  };
}

function readStoredPass1Data(sectionRecord: {
  baseContentInternal?: unknown;
  baseMemory?: unknown;
  pass1Artifact?: unknown;
  pass1CompletedAt?: unknown;
  pass1PromptUsed?: unknown;
  pass1TokensUsed?: unknown;
} | null | undefined): {
  content: string;
  memory: unknown;
  artifact: PersistedPass1Artifact | null;
  generatedAt?: string | Date | null;
  promptUsed?: string;
  tokensUsed?: number;
} {
  const artifact = readPersistedPass1Artifact(sectionRecord?.pass1Artifact);
  const baseContent = String(sectionRecord?.baseContentInternal || '').trim();
  const content = artifact?.content || baseContent || '';
  const memory = artifact?.memory ?? sectionRecord?.baseMemory ?? null;
  const storedPass1CompletedAt = sectionRecord?.pass1CompletedAt instanceof Date
    ? sectionRecord.pass1CompletedAt
    : String(sectionRecord?.pass1CompletedAt || '').trim() || undefined;
  const generatedAt = artifact?.generatedAt || storedPass1CompletedAt;
  const promptUsed = artifact?.promptUsed || String(sectionRecord?.pass1PromptUsed || '').trim();
  const tokensUsed = artifact?.tokensUsed ?? (
    Number(sectionRecord?.pass1TokensUsed) > 0
      ? Number(sectionRecord?.pass1TokensUsed)
      : undefined
  );

  return {
    content,
    memory,
    artifact,
    generatedAt,
    promptUsed: promptUsed || undefined,
    tokensUsed
  };
}

function resolveDimensionRole(index: number, total: number): DimensionRole {
  if (total <= 1) return 'intro_conclusion';
  if (index === 0) return 'introduction';
  if (index === total - 1) return 'conclusion';
  return 'body';
}

function clampWordAllocation(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyDimensionPlanMetadata(
  basePlan: DimensionPlanEntry[],
  sectionWordBudget?: number
): DimensionPlanEntry[] {
  if (!Array.isArray(basePlan) || basePlan.length === 0) return [];
  const total = basePlan.length;
  const roles = basePlan.map((_, index) => resolveDimensionRole(index, total));
  const budget = normalizePositiveWordBudget(sectionWordBudget);

  if (!budget) {
    return basePlan.map((entry, index) => ({
      ...entry,
      role: roles[index]
    }));
  }

  const weights = roles.map((role) => {
    if (role === 'intro_conclusion') return 1.3;
    if (role === 'introduction') return 1.15;
    if (role === 'conclusion') return 1.1;
    return 1.0;
  });
  const baseMin = clampWordAllocation(Math.floor(budget / Math.max(total * 2, 1)), 30, 120);
  let mins = roles.map((role) => {
    if (role === 'intro_conclusion') return Math.max(70, baseMin + 25);
    if (role === 'introduction' || role === 'conclusion') return Math.max(45, baseMin + 10);
    return Math.max(35, baseMin);
  });

  let minSum = mins.reduce((sum, value) => sum + value, 0);
  if (minSum > budget) {
    const scale = budget / minSum;
    mins = mins.map((value) => Math.max(20, Math.floor(value * scale)));
    minSum = mins.reduce((sum, value) => sum + value, 0);
    while (minSum > budget) {
      const index = mins.findIndex((value) => value > 20);
      if (index === -1) break;
      mins[index] -= 1;
      minSum -= 1;
    }
  }

  const extraPool = Math.max(budget - minSum, 0);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const extras = weights.map((weight) => Math.floor(extraPool * (weight / totalWeight)));
  let assignedExtra = extras.reduce((sum, value) => sum + value, 0);
  let remainder = extraPool - assignedExtra;
  const priority = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.index);
  let cursor = 0;
  while (remainder > 0 && priority.length > 0) {
    const index = priority[cursor % priority.length];
    extras[index] += 1;
    assignedExtra += 1;
    remainder -= 1;
    cursor += 1;
  }

  const targets = mins.map((minWords, index) => minWords + extras[index]);
  const maxes = targets.map((target, index) => {
    const role = roles[index];
    const slack = role === 'intro_conclusion'
      ? Math.max(25, Math.round(target * 0.15))
      : (role === 'introduction' || role === 'conclusion')
        ? Math.max(20, Math.round(target * 0.12))
        : Math.max(15, Math.round(target * 0.1));
    return Math.min(budget, target + slack);
  });

  return basePlan.map((entry, index) => ({
    ...entry,
    role: roles[index],
    targetWords: targets[index],
    minWords: Math.min(mins[index], targets[index]),
    maxWords: Math.max(targets[index], maxes[index])
  }));
}

function computeAcceptedWordCount(flow: DimensionFlowState, excludeDimensionKey?: string): number {
  const excluded = normalizeDimensionKey(excludeDimensionKey || '');
  return flow.acceptedBlocks.reduce((sum, block) => {
    const key = normalizeDimensionKey(block.dimensionKey);
    if (excluded && key === excluded) return sum;
    return sum + computeWordCount(block.content || '');
  }, 0);
}

function resolveDimensionDraftBudget(
  flow: DimensionFlowState,
  dimensionKey: string
): DimensionDraftBudget {
  const normalizedTargetKey = normalizeDimensionKey(dimensionKey);
  const plan = applyDimensionPlanMetadata(flow.plan, flow.sectionWordBudget);
  const targetIndex = plan.findIndex(
    (entry) => normalizeDimensionKey(entry.dimensionKey) === normalizedTargetKey
  );
  const role = targetIndex >= 0
    ? (plan[targetIndex].role || resolveDimensionRole(targetIndex, plan.length))
    : 'body';
  const sectionWordBudget = normalizePositiveWordBudget(flow.sectionWordBudget);
  const targetPlan = targetIndex >= 0 ? plan[targetIndex] : undefined;
  const usedWordsExcludingTarget = computeAcceptedWordCount(flow, normalizedTargetKey);
  const remainingWordsForTarget = sectionWordBudget !== undefined
    ? Math.max(sectionWordBudget - usedWordsExcludingTarget, 0)
    : undefined;

  const plannedTarget = normalizePositiveWordBudget(targetPlan?.targetWords);
  const plannedMin = normalizePositiveWordBudget(targetPlan?.minWords);
  const plannedMax = normalizePositiveWordBudget(targetPlan?.maxWords);

  let targetWords = plannedTarget;
  let minWords = plannedMin;
  let maxWords = plannedMax;

  if (remainingWordsForTarget !== undefined) {
    maxWords = maxWords !== undefined
      ? Math.min(maxWords, remainingWordsForTarget)
      : remainingWordsForTarget;
    if (targetWords !== undefined) {
      targetWords = Math.min(targetWords, maxWords);
    } else if (maxWords > 0) {
      targetWords = Math.max(1, Math.min(maxWords, Math.max(40, Math.floor(maxWords * 0.7))));
    }
    if (minWords !== undefined) {
      minWords = Math.min(minWords, maxWords);
    } else if (targetWords !== undefined) {
      minWords = Math.max(1, Math.min(Math.floor(targetWords * 0.65), maxWords));
    }
  }

  return {
    role,
    sectionWordBudget,
    targetWords,
    minWords,
    maxWords,
    usedWordsExcludingTarget,
    remainingWordsForTarget
  };
}

function buildDimensionBudgetSnapshot(
  flow: DimensionFlowState,
  stitchedContent: string
): DimensionBudgetSnapshot {
  const sectionWordBudget = normalizePositiveWordBudget(flow.sectionWordBudget);
  const usedWords = computeWordCount(stitchedContent || '');
  if (!sectionWordBudget) {
    return { usedWords };
  }
  return {
    sectionWordBudget,
    usedWords,
    remainingWords: Math.max(sectionWordBudget - usedWords, 0)
  };
}

function truncateContentToWordLimit(content: string, maxWords: number): {
  content: string;
  originalWords: number;
  finalWords: number;
  trimmed: boolean;
} {
  const normalized = String(content || '').trim();
  const limit = Math.max(Math.floor(maxWords || 0), 0);
  const originalWords = computeWordCount(normalized);
  if (!normalized || limit <= 0) {
    return {
      content: '',
      originalWords,
      finalWords: 0,
      trimmed: originalWords > 0
    };
  }
  if (originalWords <= limit) {
    return {
      content: normalized,
      originalWords,
      finalWords: originalWords,
      trimmed: false
    };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const clipped = words.slice(0, limit).join(' ').trim();
  const finalWords = computeWordCount(clipped);
  return {
    content: clipped,
    originalWords,
    finalWords,
    trimmed: true
  };
}

function buildDimensionRoleDirective(role: DimensionRole): string {
  switch (role) {
    case 'introduction':
      return 'Open the section: orient the reader to this section scope, establish context, and set up the upcoming analysis.';
    case 'conclusion':
      return 'Close the section: synthesize the section-level takeaway and end cleanly without introducing new major subtopics.';
    case 'intro_conclusion':
      return 'Because this is the only dimension, both introduce and conclude the section in a compact arc.';
    default:
      return 'Develop the core body analysis for this dimension while maintaining continuity with the surrounding dimensions.';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractJsonObjectFromOutput(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  const jsonSlice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonSlice);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function extractSectionOutput(
  rawOutput: string
): { content: string; memory: Record<string, unknown> | null } {
  let extracted = rawOutput;
  let extractedMemory: Record<string, unknown> | null = null;

  try {
    const parsed = extractJsonObjectFromOutput(rawOutput);
    if (parsed) {
      if (typeof parsed.content === 'string' && parsed.content.trim()) {
        extracted = parsed.content;
      }
      if (parsed.memory && typeof parsed.memory === 'object' && !Array.isArray(parsed.memory)) {
        extractedMemory = parsed.memory as Record<string, unknown>;
      }
      console.log(
        `[PaperDrafting] Extracted JSON section payload (${extracted.length} chars${extractedMemory ? ', memory preserved' : ''})`
      );
    }
  } catch (parseErr) {
    console.warn('[PaperDrafting] Could not parse JSON output, using raw:', parseErr);
  }

  return { content: polishDraftMarkdown(extracted), memory: extractedMemory };
}

function stripDimensionFlowFromValidationReport(existing: unknown): Record<string, unknown> | null {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return null;
  }

  const base = existing as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(base, 'dimensionFlow')) {
    return null;
  }

  const next = { ...base };
  delete next.dimensionFlow;
  return next;
}

function parseDimensionFlowState(value: unknown): DimensionFlowState | null {
  const raw = asRecord(value);
  const flow = (
    Number(raw.version) === DIMENSION_FLOW_VERSION
    && String(raw.sectionKey || '').trim()
  )
    ? raw
    : asRecord(raw.dimensionFlow);
  if (!flow.version || Number(flow.version) !== DIMENSION_FLOW_VERSION) return null;

  const sectionKey = String(flow.sectionKey || '').trim();
  if (!sectionKey) return null;
  const sectionWordBudget = normalizePositiveWordBudget(flow.sectionWordBudget);

  const planRaw = Array.isArray(flow.plan) ? flow.plan : [];
  const acceptedRaw = Array.isArray(flow.acceptedBlocks) ? flow.acceptedBlocks : [];
  const bufferedRaw = asRecord(flow.bufferedProposals);
  const pendingRaw = asRecord(flow.pendingProposal);

  const plan: DimensionPlanEntry[] = planRaw
    .map((entry) => asRecord(entry))
    .map((entry) => {
      const dimensionLabel = String(entry.dimensionLabel || '').trim();
      const inferredLabel = dimensionLabel || String(entry.dimensionKey || '').trim();
      const dimensionKey = normalizeDimensionKey(String(entry.dimensionKey || inferredLabel));
      const roleCandidate = String(entry.role || '').trim();
      const role: DimensionRole | undefined = (
        roleCandidate === 'introduction'
        || roleCandidate === 'body'
        || roleCandidate === 'conclusion'
        || roleCandidate === 'intro_conclusion'
      )
        ? roleCandidate
        : undefined;
      return {
        dimensionKey,
        dimensionLabel: inferredLabel || dimensionKey,
        objective: String(entry.objective || '').trim(),
        mustUseCitationKeys: Array.isArray(entry.mustUseCitationKeys)
          ? entry.mustUseCitationKeys.map((key) => String(key || '').trim()).filter(Boolean)
          : [],
        avoidClaims: Array.isArray(entry.avoidClaims)
          ? entry.avoidClaims.map((text) => String(text || '').trim()).filter(Boolean)
          : [],
        bridgeHint: String(entry.bridgeHint || '').trim(),
        role,
        targetWords: normalizePositiveWordBudget(entry.targetWords),
        minWords: normalizePositiveWordBudget(entry.minWords),
        maxWords: normalizePositiveWordBudget(entry.maxWords)
      };
    })
    .filter((entry) => entry.dimensionKey.length > 0);

  const acceptedBlocks: DimensionAcceptedBlock[] = acceptedRaw
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      dimensionKey: normalizeDimensionKey(String(entry.dimensionKey || '')),
      dimensionLabel: String(entry.dimensionLabel || entry.dimensionKey || '').trim(),
      content: String(entry.content || ''),
      citationKeys: Array.isArray(entry.citationKeys)
        ? entry.citationKeys.map((key) => String(key || '').trim()).filter(Boolean)
        : [],
      source: entry.source === 'user' ? ('user' as const) : ('llm' as const),
      version: Number(entry.version) > 0 ? Number(entry.version) : 1,
      updatedAt: String(entry.updatedAt || new Date().toISOString())
    }))
    .filter((entry) => entry.dimensionKey.length > 0);

  const pass1SourceRaw = asRecord(flow.pass1Source);
  const pass1Source = String(pass1SourceRaw.source || '').trim() === 'pass1_section_draft'
    && String(pass1SourceRaw.contentFingerprint || '').trim()
    ? {
        source: 'pass1_section_draft' as const,
        contentFingerprint: String(pass1SourceRaw.contentFingerprint || '').trim(),
        wordCount: Number(pass1SourceRaw.wordCount) > 0 ? Number(pass1SourceRaw.wordCount) : 0,
        preview: String(pass1SourceRaw.preview || '').trim(),
        generatedAt: String(pass1SourceRaw.generatedAt || '').trim() || undefined,
        reused: Boolean(pass1SourceRaw.reused),
        memory: normalizePass1MemorySnapshot(pass1SourceRaw.memory)
      }
    : undefined;

  const parseProposal = (entry: Record<string, unknown>): DimensionDraftProposal | undefined => {
    const dimensionKey = normalizeDimensionKey(String(entry.dimensionKey || ''));
    const content = String(entry.content || '').trim();
    if (!dimensionKey || !content) return undefined;

    const validation = asRecord(entry.citationValidation);
    const reviewTraceRaw = asRecord(entry.reviewTrace);
    const roleCandidate = String(reviewTraceRaw.role || '').trim();
    const reviewTrace: DimensionProposalReviewTrace | undefined = (
      String(reviewTraceRaw.pass1Fingerprint || '').trim()
      && (
        roleCandidate === 'introduction'
        || roleCandidate === 'body'
        || roleCandidate === 'conclusion'
        || roleCandidate === 'intro_conclusion'
      )
    )
      ? {
          pass1Fingerprint: String(reviewTraceRaw.pass1Fingerprint || '').trim(),
          pass1WordCount: Number(reviewTraceRaw.pass1WordCount) > 0 ? Number(reviewTraceRaw.pass1WordCount) : 0,
          role: roleCandidate as DimensionRole,
          bridgeHint: String(reviewTraceRaw.bridgeHint || '').trim(),
          requiredCitationKeys: normalizeStringList(reviewTraceRaw.requiredCitationKeys),
          previousDimensionLabel: String(reviewTraceRaw.previousDimensionLabel || '').trim() || null,
          nextDimensionLabel: String(reviewTraceRaw.nextDimensionLabel || '').trim() || null,
          acceptedBlockCount: Number(reviewTraceRaw.acceptedBlockCount) > 0 ? Number(reviewTraceRaw.acceptedBlockCount) : 0,
          acceptedContextHash: String(reviewTraceRaw.acceptedContextHash || '').trim(),
          acceptedSummary: String(reviewTraceRaw.acceptedSummary || '').trim(),
          acceptedContextPreview: String(reviewTraceRaw.acceptedContextPreview || '').trim(),
          pass1DimensionSummary: String(reviewTraceRaw.pass1DimensionSummary || '').trim() || undefined,
          targetEvidenceSummary: String(reviewTraceRaw.targetEvidenceSummary || '').trim() || undefined,
        }
      : undefined;
    return {
      dimensionKey,
      content,
      contextHash: String(entry.contextHash || ''),
      citationValidation: {
        allowedCitationKeys: Array.isArray(validation.allowedCitationKeys)
          ? validation.allowedCitationKeys.map((key) => String(key || '').trim()).filter(Boolean)
          : [],
        disallowedKeys: Array.isArray(validation.disallowedKeys)
          ? validation.disallowedKeys.map((key) => String(key || '').trim()).filter(Boolean)
          : [],
        unknownKeys: Array.isArray(validation.unknownKeys)
          ? validation.unknownKeys.map((key) => String(key || '').trim()).filter(Boolean)
          : [],
        missingRequiredKeys: Array.isArray(validation.missingRequiredKeys)
          ? validation.missingRequiredKeys.map((key) => String(key || '').trim()).filter(Boolean)
          : []
      },
      createdAt: String(entry.createdAt || new Date().toISOString()),
      reviewTrace,
    };
  };

  const pendingProposal = parseProposal(pendingRaw);
  const bufferedProposals: Record<string, DimensionDraftProposal> = {};
  for (const [key, value] of Object.entries(bufferedRaw)) {
    const proposal = parseProposal(asRecord(value));
    if (!proposal) continue;
    bufferedProposals[normalizeDimensionKey(key)] = proposal;
  }

  return {
    version: DIMENSION_FLOW_VERSION,
    sectionKey,
    createdAt: String(flow.createdAt || new Date().toISOString()),
    updatedAt: String(flow.updatedAt || new Date().toISOString()),
    sectionWordBudget,
    plan: applyDimensionPlanMetadata(plan, sectionWordBudget),
    acceptedBlocks,
    pass1Source,
    pendingProposal,
    bufferedProposals,
    lastAcceptedContextHash: String(flow.lastAcceptedContextHash || '')
  };
}

function summarizeAcceptedBlocks(blocks: DimensionAcceptedBlock[]): string {
  if (!blocks.length) return '(none accepted yet)';
  return blocks
    .slice(0, MAX_DIMENSION_SUMMARY_ITEMS)
    .map((block, index) => {
      const normalized = polishDraftMarkdown(block.content || '');
      const snippet = normalized
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      return `${index + 1}. ${block.dimensionLabel}: ${snippet}`;
    })
    .join('\n');
}

function buildDimensionPriorContext(stitchedContent: string, maxChars: number = 9000): string {
  const normalized = String(stitchedContent || '').trim();
  if (!normalized) return '(none accepted yet)';
  if (normalized.length <= maxChars) return normalized;

  const headChars = Math.max(1200, Math.floor(maxChars * 0.33));
  const tailChars = Math.max(2500, maxChars - headChars);
  const head = normalized.slice(0, headChars).trim();
  const tail = normalized.slice(-tailChars).trim();

  return `${head}\n\n[... earlier accepted content omitted for length ...]\n\n${tail}`;
}

function buildPass1SourceTrace(params: {
  content: string;
  memory?: unknown;
  generatedAt?: string | Date | null;
  reused: boolean;
}): DimensionPass1SourceTrace | undefined {
  const content = String(params.content || '').trim();
  if (!content) return undefined;

  const generatedAt = params.generatedAt instanceof Date
    ? params.generatedAt.toISOString()
    : String(params.generatedAt || '').trim() || undefined;

  return {
    source: 'pass1_section_draft',
    contentFingerprint: computeContentFingerprint(content),
    wordCount: computeWordCount(content),
    preview: buildDimensionPriorContext(content, 4200),
    generatedAt,
    reused: params.reused,
    memory: normalizePass1MemorySnapshot(params.memory),
  };
}

function formatPass1MemoryForPrompt(memory?: Pass1MemorySnapshot | null): string {
  if (!memory) {
    return '(No pass 1 memory available)';
  }

  const parts: string[] = [];
  if (memory.keyPoints.length > 0) {
    parts.push(`Key points: ${memory.keyPoints.join('; ')}`);
  }
  if (memory.termsIntroduced.length > 0) {
    parts.push(`Terms introduced: ${memory.termsIntroduced.join(', ')}`);
  }
  if (memory.mainClaims.length > 0) {
    parts.push(`Main claims: ${memory.mainClaims.join('; ')}`);
  }
  if (memory.forwardReferences.length > 0) {
    parts.push(`Forward references: ${memory.forwardReferences.join('; ')}`);
  }
  if (memory.sectionIntent) {
    parts.push(`Section intent: ${memory.sectionIntent}`);
  }
  if (memory.openingStrategy) {
    parts.push(`Opening strategy: ${memory.openingStrategy}`);
  }
  if (memory.closingStrategy) {
    parts.push(`Closing strategy: ${memory.closingStrategy}`);
  }
  if (memory.sectionOutline && memory.sectionOutline.length > 0) {
    parts.push(`Section outline: ${memory.sectionOutline.join(' | ')}`);
  }
  if (memory.dimensionBriefs && memory.dimensionBriefs.length > 0) {
    parts.push(`Dimension briefs available: ${memory.dimensionBriefs.map((brief) => brief.dimensionLabel).join('; ')}`);
  }

  return parts.length > 0 ? parts.join('\n') : '(No pass 1 memory available)';
}

function findPass1DimensionBrief(
  memory: Pass1MemorySnapshot | null | undefined,
  dimensionKey: string,
  dimensionLabel?: string
): Pass1DimensionBrief | null {
  if (!memory?.dimensionBriefs?.length) return null;
  const normalizedKey = normalizeDimensionKey(dimensionKey);
  const normalizedLabel = normalizeDimensionKey(dimensionLabel || '');

  return memory.dimensionBriefs.find((brief) => {
    const briefKey = normalizeDimensionKey(brief.dimensionKey);
    const briefLabel = normalizeDimensionKey(brief.dimensionLabel);
    return briefKey === normalizedKey || (normalizedLabel && briefLabel === normalizedLabel);
  }) || null;
}

function formatPass1DimensionBriefForPrompt(
  brief: Pass1DimensionBrief | null | undefined
): string {
  if (!brief) {
    return '(No dimension-specific pass 1 brief available)';
  }

  const lines = [
    `Dimension label: ${brief.dimensionLabel}`,
    brief.roleHint ? `Role hint from pass 1: ${brief.roleHint}` : '',
    `Source summary: ${brief.sourceSummary}`,
    brief.claimFocus.length > 0 ? `Claim focus: ${brief.claimFocus.join('; ')}` : '',
    brief.mustUseCitationKeys.length > 0 ? `Pass 1 citation anchors: ${brief.mustUseCitationKeys.join(', ')}` : '',
    brief.bridgeToNext ? `Bridge to next: ${brief.bridgeToNext}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function summarizeTargetDimensionEvidence(
  evidenceContext: EvidencePromptContext,
  dimensionKey: string,
  dimensionLabel?: string
): string {
  const normalizedKey = normalizeDimensionKey(dimensionKey);
  const normalizedLabel = normalizeDimensionKey(dimensionLabel || '');
  const target = (evidenceContext.dimensionEvidence || []).find((entry) => {
    const entryKey = normalizeDimensionKey(entry.dimension);
    return entryKey === normalizedKey || (normalizedLabel && entryKey === normalizedLabel);
  });

  if (!target) {
    return '(No target-dimension evidence pack available)';
  }

  return formatDimensionEvidence([target]);
}

function summarizeTargetDimensionEvidenceCompact(
  evidenceContext: EvidencePromptContext,
  dimensionKey: string,
  dimensionLabel?: string
): string {
  const normalizedKey = normalizeDimensionKey(dimensionKey);
  const normalizedLabel = normalizeDimensionKey(dimensionLabel || '');
  const target = (evidenceContext.dimensionEvidence || []).find((entry) => {
    const entryKey = normalizeDimensionKey(entry.dimension);
    return entryKey === normalizedKey || (normalizedLabel && entryKey === normalizedLabel);
  });

  if (!target) {
    return '';
  }

  const rows = target.citations.slice(0, 3).map((citation) => {
    const card = Array.isArray(citation.evidenceCards) ? citation.evidenceCards[0] : null;
    if (card) {
      const detail = card.quantitativeDetail ? ` | ${card.quantitativeDetail}` : '';
      const boundary = card.doesNotSupport ? ` | doesNotSupport=${card.doesNotSupport}` : '';
      return `[${citation.citationKey}] ${card.claim}${detail}${boundary}`;
    }
    return `[${citation.citationKey}] ${citation.remark || citation.keyFindings || citation.title}`;
  });

  return rows.join(' || ');
}

function buildAcceptedContextHash(blocks: DimensionAcceptedBlock[]): string {
  const stable = blocks
    .map((block) => `${block.dimensionKey}::${block.version}::${computeContentFingerprint(block.content)}`)
    .join('|');
  return computeContentFingerprint(stable);
}

function stitchAcceptedBlocks(
  flow: DimensionFlowState
): { stitchedContent: string; orderedBlocks: DimensionAcceptedBlock[] } {
  const acceptedByDimension = new Map(
    flow.acceptedBlocks.map((block) => [normalizeDimensionKey(block.dimensionKey), block])
  );
  const orderedBlocks: DimensionAcceptedBlock[] = [];

  for (const planItem of flow.plan) {
    const block = acceptedByDimension.get(normalizeDimensionKey(planItem.dimensionKey));
    if (block) orderedBlocks.push(block);
  }

  for (const block of flow.acceptedBlocks) {
    if (orderedBlocks.find((entry) => normalizeDimensionKey(entry.dimensionKey) === normalizeDimensionKey(block.dimensionKey))) continue;
    orderedBlocks.push(block);
  }

  const stitchedContent = orderedBlocks
    .map((block) => String(block.content || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return { stitchedContent, orderedBlocks };
}

interface SectionPromptRuntimeBundle {
  sectionKey: string;
  paperTypeCode: string;
  prompt: string;
  pass1Prompt: string;
  researchTopic: any;
  citations: SessionCitation[];
  useMappedEvidence: boolean;
  citationContext: Awaited<ReturnType<typeof DraftingService.buildCitationContext>>;
  sectionWordBudget?: number;
  blueprintPromptContext?: BlueprintPromptContext;
  evidencePromptContext: EvidencePromptContext;
  previousSectionMemories: PreviousSectionMemoryEntry[];
}

function formatDimensionEvidence(evidence: EvidencePromptContext['dimensionEvidence']): string {
  if (!evidence || evidence.length === 0) return '(No dimension evidence available)';

  const lines: string[] = [
    '[PRIORITY 2.5 - EVIDENCE] VERIFIED CITATIONS FOR THIS SECTION',
    'Use these evidence cards as your PRIMARY citation source.',
    'Rules:',
    '- Do not invent findings that are not present below.',
    '- Prefer cards with HIGH confidence and verified quotes.',
    '- Include quantitative details when available.',
    '- Acknowledge evidence boundaries via "Does NOT support".',
    '- Use the card useAs tag to choose citation tone (SUPPORT/CONTRAST/CONTEXT/DEFINITION).',
    '',
  ];

  for (const dim of evidence) {
    lines.push(`Dimension: "${dim.dimension}"`);

    if (!dim.citations.length) {
      lines.push('  (no citations mapped)');
      lines.push('');
      continue;
    }

    for (const citation of dim.citations) {
      const cards = Array.isArray(citation.evidenceCards) ? citation.evidenceCards : [];

      if (cards.length === 0) {
        const fallback = citation.remark
          || citation.relevanceToResearch
          || citation.keyFindings
          || citation.keyContribution
          || citation.title;
        lines.push(
          `  [${citation.citationKey}] (${citation.year || 'n.d.'}, ${citation.confidence}) [fallback-meta]: ${fallback}`
        );
        continue;
      }

      for (const card of cards.slice(0, 3)) {
        const archetype = citation.referenceArchetype || card.referenceArchetype || 'UNKNOWN_ARCHETYPE';
        const depth = citation.deepAnalysisLabel || card.deepAnalysisLabel || 'UNKNOWN_DEPTH';
        const verificationLabel = card.quoteVerified ? 'quote-verified' : 'quote-unverified';

        lines.push(
          `  [${citation.citationKey}] [${archetype}] (${depth}) useAs=${card.useAs} confidence=${card.confidence} ${verificationLabel}`
        );
        lines.push(`    Claim: ${card.claim}`);
        if (card.quantitativeDetail) {
          lines.push(`    Detail: ${card.quantitativeDetail}`);
        }
        if (card.conditions) {
          lines.push(`    Conditions: ${card.conditions}`);
        }
        if (card.studyDesign) {
          lines.push(`    Study design: ${card.studyDesign}`);
        }
        if (card.doesNotSupport) {
          lines.push(`    Does NOT support: ${card.doesNotSupport}`);
        }
        if (card.sourceFragment) {
          lines.push(`    Quote: "${card.sourceFragment}"${card.pageHint ? ` (${card.pageHint})` : ''}`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

function formatRelevanceNotes(evidence: EvidencePromptContext['dimensionEvidence']): string {
  if (!evidence || evidence.length === 0) return '(No relevance notes available)';

  const allCitations = new Map<string, {
    title: string;
    dimensions: Set<string>;
    relevance?: string;
    contribution?: string;
    findings?: string;
    method?: string | null;
    limitations?: string | null;
    claimTypes?: string[];
    boundary?: string | null;
    hasDeepAnalysis?: boolean;
    archetype?: string | null;
    depth?: string | null;
    cardClaims?: string[];
  }>();

  for (const dim of evidence) {
    for (const c of dim.citations) {
      if (!allCitations.has(c.citationKey)) {
        allCitations.set(c.citationKey, {
          title: c.title,
          dimensions: new Set<string>(),
          relevance: c.relevanceToResearch,
          contribution: c.keyContribution,
          findings: c.keyFindings,
          method: c.methodologicalApproach,
          limitations: c.limitationsOrGaps,
          claimTypes: c.claimTypesSupported ? [...c.claimTypesSupported] : [],
          boundary: c.evidenceBoundary,
          hasDeepAnalysis: Boolean(c.hasDeepAnalysis),
          archetype: c.referenceArchetype || null,
          depth: c.deepAnalysisLabel || null,
          cardClaims: Array.isArray(c.evidenceCards)
            ? c.evidenceCards
              .map(card => String(card.claim || '').trim())
              .filter(Boolean)
              .slice(0, 3)
            : []
        });
      }
      const existing = allCitations.get(c.citationKey)!;
      existing.dimensions.add(dim.dimension);
      if (!existing.relevance && c.relevanceToResearch) existing.relevance = c.relevanceToResearch;
      if (!existing.contribution && c.keyContribution) existing.contribution = c.keyContribution;
      if (!existing.findings && c.keyFindings) existing.findings = c.keyFindings;
      if (!existing.method && c.methodologicalApproach) existing.method = c.methodologicalApproach;
      if (!existing.limitations && c.limitationsOrGaps) existing.limitations = c.limitationsOrGaps;
      if (!existing.boundary && c.evidenceBoundary) existing.boundary = c.evidenceBoundary;
      if (!existing.archetype && c.referenceArchetype) existing.archetype = c.referenceArchetype;
      if (!existing.depth && c.deepAnalysisLabel) existing.depth = c.deepAnalysisLabel;
      if (c.hasDeepAnalysis) existing.hasDeepAnalysis = true;
      if (c.claimTypesSupported?.length) {
        const merged = new Set([...(existing.claimTypes || []), ...c.claimTypesSupported]);
        existing.claimTypes = Array.from(merged);
      }
      if (Array.isArray(c.evidenceCards) && c.evidenceCards.length) {
        const mergedClaims = [...(existing.cardClaims || [])];
        for (const card of c.evidenceCards) {
          const claim = String(card.claim || '').trim();
          if (!claim || mergedClaims.includes(claim)) continue;
          mergedClaims.push(claim);
          if (mergedClaims.length >= 4) break;
        }
        existing.cardClaims = mergedClaims;
      }
    }
  }

  return Array.from(allCitations.entries())
    .map(([key, data]) => {
      const parts = [
        data.hasDeepAnalysis ? 'source=deep-cards' : 'source=fallback-meta',
        data.archetype ? `archetype: ${data.archetype}` : '',
        data.depth ? `depth: ${data.depth}` : '',
        data.claimTypes?.length ? `claimTypes: ${data.claimTypes.join(', ')}` : '',
        data.relevance ? `relevance: ${data.relevance}` : '',
        data.contribution ? `contribution: ${data.contribution}` : '',
        data.findings ? `findings: ${data.findings}` : '',
        data.method ? `method: ${data.method}` : '',
        data.limitations ? `gap: ${data.limitations}` : '',
        data.boundary ? `boundary: ${data.boundary}` : '',
        data.cardClaims?.length ? `cardClaims: ${data.cardClaims.join(' || ')}` : '',
      ].filter(Boolean);
      const base = `[${key}]: "${data.title}" - dimensions: ${Array.from(data.dimensions).join(', ')}`;
      return parts.length > 0 ? `${base}; ${parts.join(' | ')}` : base;
    })
    .join('\n');
}

function formatCoverageAssignments(assignments: EvidencePromptContext['coverageAssignments']): string {
  if (!assignments || assignments.length === 0) return '(No coverage assignments)';

  const lines: string[] = [
    '[PRIORITY 2.7 - CITATION COVERAGE] MANDATORY CITATIONS FOR THIS SECTION',
    'These citations are assigned for full-paper citation coverage.',
    'You MUST cite each one at least once using [CITE:key].',
    'Each citation may appear at most 2 times in this section.',
    ''
  ];

  for (const assignment of assignments) {
    const reason = assignment.claimType || 'GENERAL';
    const findings = assignment.keyFindings ? ` | Key finding: ${assignment.keyFindings}` : '';
    lines.push(`- key: ${assignment.citationKey} | "${assignment.title}" | Use for: ${reason}${findings}`);
  }

  return lines.join('\n');
}

type SectionPromptOutputMode = 'markdown' | 'pass1_json';

function buildPass1ArtifactOutputInstructions(
  blueprintContext?: BlueprintPromptContext,
  evidenceContext?: EvidencePromptContext
): string {
  const mustCover = Array.isArray(blueprintContext?.mustCover)
    ? blueprintContext!.mustCover.map((label) => String(label || '').trim()).filter(Boolean)
    : [];
  const roleGuide = mustCover.length > 0
    ? mustCover
      .map((dimensionLabel, index) => {
        const role = resolveDimensionRole(index, mustCover.length);
        return `- ${normalizeDimensionKey(dimensionLabel)} | ${dimensionLabel} | role=${role}`;
      })
      .join('\n')
    : '- (no blueprint dimensions available for this section)';
  const evidenceByDimension = new Map<string, string[]>();
  for (const entry of evidenceContext?.dimensionEvidence || []) {
    const dimensionKey = normalizeDimensionKey(entry.dimension);
    if (!dimensionKey) continue;
    const citationKeys: string[] = Array.from(new Set<string>(
      (entry.citations || [])
        .map((citation) => String(citation.citationKey || '').trim())
        .filter((key): key is string => Boolean(key))
    )).slice(0, MAX_CITATIONS_PER_DIMENSION);
    evidenceByDimension.set(dimensionKey, citationKeys);
  }
  const citationGuide = mustCover.length > 0
    ? mustCover
      .map((dimensionLabel) => {
        const dimensionKey = normalizeDimensionKey(dimensionLabel);
        const citationKeys = evidenceByDimension.get(dimensionKey) || [];
        return `- ${dimensionKey}: ${citationKeys.join(', ') || '(none mapped)'}`;
      })
      .join('\n')
    : '- (no dimension-level citation guidance available)';

  return `OUTPUT FORMAT (MANDATORY):
Return ONLY raw JSON. No markdown code fences. Start with { and end with }.
{
  "content": "<complete markdown section draft>",
  "memory": {
    "keyPoints": ["3-5 concrete points covered by this section"],
    "termsIntroduced": ["term introduced for the first time here"],
    "mainClaims": ["TYPE: claim"],
    "forwardReferences": ["promise or bridge to a later section"],
    "sectionIntent": "Single sentence describing what this section must accomplish for the paper.",
    "openingStrategy": "How the section should open and orient the reader.",
    "closingStrategy": "How the section should close or bridge onward.",
    "sectionOutline": ["planned subsection 1", "planned subsection 2"],
    "dimensionBriefs": [
      {
        "dimensionKey": "normalized_dimension_key",
        "dimensionLabel": "Exact blueprint dimension label",
        "roleHint": "introduction|body|conclusion|intro_conclusion",
        "sourceSummary": "2-4 sentences summarizing only the part of the section draft that belongs to this dimension.",
        "claimFocus": ["specific claim or analytical angle"],
        "mustUseCitationKeys": ["citationKey1", "citationKey2"],
        "bridgeToNext": "Short note on how this dimension should connect to the next one."
      }
    ]
  }
}

PASS 1 MEMORY RULES:
- "content" must be the full section draft in markdown, with headings, paragraphs, bullets, and [CITE:key] anchors when needed.
- "dimensionBriefs" must follow the blueprint dimension order exactly when blueprint dimensions exist.
- Each dimensionBrief must summarize only its own slice of the section draft.
- "mustUseCitationKeys" should reflect mapped evidence for that dimension when available.
- "openingStrategy" should help the first dimension introduce the section.
- "closingStrategy" should help the last dimension conclude the section.
- If no blueprint dimensions exist, return "dimensionBriefs": [].

BLUEPRINT DIMENSION ORDER / ROLE HINTS:
${roleGuide}

MAPPED CITATION HINTS BY DIMENSION:
${citationGuide}`;
}

async function buildPrompt(
  sectionKey: string,
  paperTypeCode: string,
  context: any,
  citationInstructions: string,
  userInstructions?: string,
  writingSampleBlock?: string,
  blueprintContext?: BlueprintPromptContext,
  evidenceContext?: EvidencePromptContext,
  outputMode: SectionPromptOutputMode = 'markdown',
  previousSectionMemories?: PreviousSectionMemoryEntry[]
): Promise<string> {
  let basePrompt = await sectionTemplateService.getPromptForSection(sectionKey, paperTypeCode, context);
  const hasCitationModePlaceholders = /\{\{AUTO_CITATION_MODE\}\}|\{\{ALLOWED_CITATION_KEYS\}\}/.test(basePrompt);
  const hasEvidencePlaceholders = /\{\{DIMENSION_EVIDENCE_NOTES\}\}|\{\{RELEVANCE_NOTES\}\}|\{\{EVIDENCE_GAPS\}\}/.test(basePrompt);
  const hasCoveragePlaceholders = /\{\{CITATION_COVERAGE_ASSIGNMENTS\}\}/.test(basePrompt);
  const topic = context?.researchTopic;
  const sectionTitle = sectionKey
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const methodology = Array.isArray(topic?.methodology)
    ? topic.methodology.join(', ')
    : (topic?.methodology ? String(topic.methodology) : '');
  const contribution = Array.isArray(topic?.contributionType)
    ? topic.contributionType.join(', ')
    : (topic?.contributionType ? String(topic.contributionType) : '');
  const archetype = context?.archetype;
  const archetypeId = archetype?.archetypeId ? String(archetype.archetypeId) : '(not detected)';
  const archetypeConfidence = Number(archetype?.archetypeConfidence || 0);
  const archetypeTags = [
    archetype?.contributionMode ? `ContributionMode=${archetype.contributionMode}` : '',
    archetype?.evaluationScope ? `EvaluationScope=${archetype.evaluationScope}` : '',
    archetype?.evidenceModality ? `EvidenceModality=${archetype.evidenceModality}` : ''
  ].filter(Boolean).join(', ');
  const archetypeRationale = archetype?.archetypeRationale
    ? String(archetype.archetypeRationale)
    : '';

  // ============================================================================
  // CITATION MODE PLACEHOLDERS
  // ============================================================================
  const autoCitationMode = evidenceContext?.useMappedEvidence ? 'ON' : 'OFF';
  const allowedKeys = evidenceContext?.allowedCitationKeys?.length
    ? evidenceContext.allowedCitationKeys.join(', ')
    : '(none)';

  basePrompt = basePrompt.replace(/\{\{SECTION_KEY\}\}/g, sectionKey);
  basePrompt = basePrompt.replace(/\{\{SECTION_NAME\}\}/g, sectionTitle);
  basePrompt = basePrompt.replace(/\{\{SECTION_TITLE\}\}/g, sectionTitle);

  basePrompt = basePrompt.replace(/\{\{AUTO_CITATION_MODE\}\}/g, autoCitationMode);
  basePrompt = basePrompt.replace(/\{\{ALLOWED_CITATION_KEYS\}\}/g, allowedKeys);

  // ============================================================================
  // BLUEPRINT PLACEHOLDERS
  // ============================================================================
  const blueprintThesis = blueprintContext?.thesisStatement || topic?.thesis || '(not available)';
  const blueprintContributions = blueprintContext?.keyContributions?.length
    ? blueprintContext.keyContributions.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(not available)';
  const blueprintRoadmap = blueprintContext?.sectionPlan?.length
    ? blueprintContext.sectionPlan.map(s => s.sectionKey.replace(/_/g, ' ')).join(' → ')
    : '(not available)';
  const mustCoverDimensions = blueprintContext?.mustCover?.length
    ? blueprintContext.mustCover.map(d => `- ${d}`).join('\n')
    : '(none specified)';

  basePrompt = basePrompt.replace(/\{\{BLUEPRINT_THESIS\}\}/g, blueprintThesis);
  basePrompt = basePrompt.replace(/\{\{BLUEPRINT_CONTRIBUTIONS\}\}/g, blueprintContributions);
  basePrompt = basePrompt.replace(/\{\{BLUEPRINT_ROADMAP\}\}/g, blueprintRoadmap);
  basePrompt = basePrompt.replace(/\{\{MUST_COVER_DIMENSIONS\}\}/g, mustCoverDimensions);

  // ============================================================================
  // RESEARCH TOPIC PLACEHOLDERS
  // ============================================================================
  basePrompt = basePrompt.replace(/\{\{RESEARCH_QUESTION\}\}/g, topic?.researchQuestion || '(not available)');
  basePrompt = basePrompt.replace(/\{\{HYPOTHESIS\}\}/g, topic?.hypothesis || '(not specified)');
  basePrompt = basePrompt.replace(/\{\{METHODOLOGY\}\}/g, methodology || '(not specified)');
  basePrompt = basePrompt.replace(/\{\{CONTRIBUTION_TYPE\}\}/g, contribution || '(not specified)');
  basePrompt = basePrompt.replace(/\{\{RESEARCH_ARCHETYPE\}\}/g, archetypeId);
  basePrompt = basePrompt.replace(/\{\{RESEARCH_ARCHETYPE_TAGS\}\}/g, archetypeTags || '(none)');

  // ============================================================================
  // EVIDENCE PACK PLACEHOLDERS
  // ============================================================================
  const dimensionEvidenceNotes = evidenceContext?.dimensionEvidence
    ? formatDimensionEvidence(evidenceContext.dimensionEvidence)
    : '(no evidence pack available)';
  const relevanceNotes = evidenceContext?.dimensionEvidence
    ? formatRelevanceNotes(evidenceContext.dimensionEvidence)
    : '(no relevance notes available)';
  const evidenceGaps = evidenceContext?.gaps?.length
    ? evidenceContext.gaps.join(', ')
    : '(none detected)';
  const coverageAssignments = Array.isArray(evidenceContext?.coverageAssignments)
    ? evidenceContext.coverageAssignments
    : [];
  const coverageNotes = coverageAssignments.length > 0
    ? formatCoverageAssignments(coverageAssignments)
    : '(no mandatory coverage citations for this section)';

  basePrompt = basePrompt.replace(/\{\{DIMENSION_EVIDENCE_NOTES\}\}/g, dimensionEvidenceNotes);
  basePrompt = basePrompt.replace(/\{\{RELEVANCE_NOTES\}\}/g, relevanceNotes);
  basePrompt = basePrompt.replace(/\{\{EVIDENCE_GAPS\}\}/g, evidenceGaps);
  basePrompt = basePrompt.replace(/\{\{CITATION_COVERAGE_ASSIGNMENTS\}\}/g, coverageNotes);

  // ============================================================================
  // FALLBACK: Append blocks if prompt doesn't use placeholders
  // ============================================================================
  const hasPlaceholdersForCitations = hasCitationModePlaceholders
    || basePrompt.includes('CITATION MODE')
    || basePrompt.includes('AUTO_CITATION_MODE');

  const topicBlock = topic && !basePrompt.includes('RESEARCH TOPIC CONTEXT')
    ? `\n\nRESEARCH TOPIC CONTEXT:\nTitle: ${topic.title}\nResearch Question: ${topic.researchQuestion}\nMethodology: ${methodology}\nContribution: ${contribution}\nKeywords: ${(topic.keywords || []).join(', ')}`
    : '';
  const archetypeBlock = archetypeId !== '(not detected)' && !basePrompt.includes('RESEARCH ARCHETYPE CONTEXT')
    ? `\n\nRESEARCH ARCHETYPE CONTEXT:\nArchetype: ${archetypeId} (${Math.round(archetypeConfidence * 100)}% confidence)\nRouting Tags: ${archetypeTags || '(none)'}\nRationale: ${archetypeRationale || '(not provided)'}\nConstraint: Keep claims aligned with this archetype and avoid methodological overreach.`
    : '';

  // Only append citation instructions if the prompt doesn't have its own citation mode section
  const citationsBlock = citationInstructions && !hasPlaceholdersForCitations
    ? `\n\n${citationInstructions}`
    : '';

  // Always inject evidence block when mapped evidence is enabled, even if prompt templates
  // do not have dedicated placeholders.
  const evidenceBlock = evidenceContext?.useMappedEvidence
    && evidenceContext.dimensionEvidence.length > 0
    && !hasEvidencePlaceholders
    ? `\n\n${dimensionEvidenceNotes}\n\n[EVIDENCE GAPS]\n${evidenceGaps}`
    : '';
  const coverageBlock = evidenceContext?.useMappedEvidence
    && coverageAssignments.length > 0
    && !hasCoveragePlaceholders
    ? `\n\n${coverageNotes}`
    : '';

  const userBlock = userInstructions ? `\n\nUSER INSTRUCTIONS:\n${userInstructions}` : '';
  const styleBlock = writingSampleBlock ? `\n\n${writingSampleBlock}` : '';
  const crossSectionBlock = formatPreviousSectionMemoriesBlock(previousSectionMemories || []);
  const outputInstructions = outputMode === 'pass1_json'
    ? buildPass1ArtifactOutputInstructions(blueprintContext, evidenceContext)
    : `OUTPUT FORMAT (MANDATORY):
- Return ONLY clean Markdown text. No JSON, no code fences, no explanations.
- Use headings with ## for major subsections and ### for nested subsections when needed.
- Use "-" for bullet lists and "1." for numbered lists; use two-space indentation for nested list levels.
- Keep paragraph spacing clean (blank line between paragraphs and after headings).
- Preserve citation placeholders exactly in [CITE:key] format.
- Do not use HTML tags.`;

  return `${basePrompt}${topicBlock}${archetypeBlock}${crossSectionBlock}${evidenceBlock}${coverageBlock}${citationsBlock}${styleBlock}${userBlock}

${outputInstructions}`;
}

function extractCitationKeys(content: string): string[] {
  return DraftingService.extractCitationKeys(content);
}

async function repairSectionCitations(
  headers: Record<string, string>,
  sessionId: string,
  sectionKey: string,
  content: string,
  allowedCitationKeys: string[],
  dimensionEvidence?: EvidencePromptContext['dimensionEvidence'],
  tenantContext?: TenantContext | null
): Promise<string> {
  if (!allowedCitationKeys.length) {
    return content;
  }

  // Build a context block so the repair LLM knows what each citation key covers.
  // Without this, it would guess blindly which valid key to substitute.
  let evidenceContextBlock = '';
  if (dimensionEvidence && dimensionEvidence.length > 0) {
    const lines: string[] = [];
    for (const dim of dimensionEvidence) {
      if (dim.citations.length === 0) continue;
      const citLines = dim.citations.map(c => {
        const cards = Array.isArray(c.evidenceCards) ? c.evidenceCards : [];
        if (cards.length > 0) {
          const cardNotes = cards
            .slice(0, 2)
            .map(card => {
              const detail = card.quantitativeDetail ? ` | detail=${card.quantitativeDetail}` : '';
              const support = card.doesNotSupport ? ` | doesNotSupport=${card.doesNotSupport}` : '';
              return `claim=${card.claim}${detail}${support} | useAs=${card.useAs}`;
            })
            .join(' || ');
          return `  [${c.citationKey}]: ${cardNotes}`;
        }
        const note = c.remark || c.relevanceToResearch || c.keyFindings || c.title;
        return `  [${c.citationKey}]: ${note}`;
      }).join('\n');
      lines.push(`Dimension: ${dim.dimension}\n${citLines}`);
    }
    if (lines.length > 0) {
      evidenceContextBlock = `\nCITATION EVIDENCE MAP (use this to choose the correct replacement key):\n${lines.join('\n\n')}\n`;
    }
  }

  const prompt = `You are fixing citation placeholders in a drafted paper section.

SECTION: ${sectionKey}
ALLOWED CITATION KEYS: ${allowedCitationKeys.join(', ')}
${evidenceContextBlock}
RULES:
- Keep the same writing and meaning.
- Keep citation placeholders in [CITE:key] format.
- Replace any disallowed or unknown key with the SEMANTICALLY closest valid key from the allowed list, based on the evidence map above.
- If no allowed key is relevant to the claim being cited, REMOVE the placeholder entirely rather than guessing.
- Do NOT add new claims or new citation placeholders that were not in the original text.
- Do NOT change the text itself, only fix the citation keys.

CONTENT TO FIX:
${content}

Return ONLY the corrected section content, no markdown fences.`;

  const repaired = await llmGateway.executeLLMOperation(
    tenantContext ? { tenantContext } : { headers },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'PAPER_SECTION_IMPROVE',
      prompt,
      parameters: {
        temperature: 0
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId,
        sectionKey,
        purpose: 'citation_whitelist_repair'
      }
    }
  );

  if (!repaired.success || !repaired.response?.output) {
    return content;
  }

  return repaired.response.output.trim();
}

async function resolveCitationAttribution(
  citationId: string,
  sectionKey: string
): Promise<{ dimension: string | null; ambiguous: boolean }> {
  const rows = await prisma.citationUsage.findMany({
    where: {
      citationId,
      usageKind: 'DIMENSION_MAPPING',
      dimension: { not: null },
      inclusionStatus: 'INCLUDED'
    },
    select: {
      sectionKey: true,
      dimension: true
    }
  });

  const filteredRows = rows.filter(
    r => normalizeSectionKey(r.sectionKey) === normalizeSectionKey(sectionKey)
  );
  const unique: string[] = Array.from(new Set(
    filteredRows
      .map((r) => String(r.dimension || '').trim())
      .filter((d): d is string => Boolean(d))
  ));
  if (unique.length === 1) {
    return { dimension: unique[0], ambiguous: false };
  }
  return { dimension: null, ambiguous: unique.length > 1 };
}

type GenerateSectionResult = {
  sectionKey: string;
  content: string;
  citationsUsed: string[];
  warnings: string[];
  citationValidation: {
    allowedCitationKeys: string[];
    disallowedKeys: string[];
    unknownKeys: string[];
  };
  attribution: {
    attributedCount: number;
    ambiguousCount: number;
    unattributedKeys: string[];
  };
  evidence: {
    usedEvidencePack: boolean;
    gaps: string[];
  };
  tokensUsed: number | undefined;
  prompt: string;
};

type GenerationStatusEmitter = (phase: string, message: string) => Promise<void> | void;

class DraftingRequestError extends Error {
  readonly status: number;
  readonly payload?: any;

  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.name = 'DraftingRequestError';
    this.status = status;
    this.payload = payload;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function splitForStreaming(content: string, targetSize: number = 140): string[] {
  const text = content || '';
  if (!text.trim()) return [''];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + targetSize, text.length);
    if (end < text.length) {
      const nextBreak = text.lastIndexOf(' ', end);
      if (nextBreak > cursor + Math.floor(targetSize / 2)) {
        end = nextBreak + 1;
      }
    }
    chunks.push(text.slice(cursor, end));
    cursor = end;
  }
  return chunks;
}

function createSSEStreamResponse(
  streamHandler: (send: (event: string, payload: unknown) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      try {
        await streamHandler(send);
        send('done', { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Generation failed';
        if (error instanceof DraftingRequestError) {
          send('error', {
            message,
            status: error.status,
            payload: error.payload
          });
        } else {
          send('error', { message });
        }
        send('done', { ok: false });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

async function generateSection(
  params: {
    sessionId: string;
    session: any;
    user: { id: string };
    paperTypeCode: string;
    payload: z.infer<typeof generateSchema>;
    requestHeaders: Record<string, string>;
    tenantContext?: TenantContext | null;
  },
  emitStatus?: GenerationStatusEmitter
): Promise<GenerateSectionResult> {
  const { sessionId, session, user, paperTypeCode, payload, requestHeaders, tenantContext } = params;
  const sectionKey = normalizeSectionKey(payload.sectionKey);
  const requestedMappedEvidence = payload.useMappedEvidence !== false;
  const sectionContextPolicy = await sectionTemplateService.getSectionContextPolicy(sectionKey, paperTypeCode);

  await emitStatus?.(
    'load_context',
    requestedMappedEvidence
      ? 'Loading topic, citations, blueprint, and mapped evidence'
      : sectionContextPolicy.requiresCitations
        ? 'Loading topic and citations (mapped evidence disabled)'
        : 'Loading topic and citations (auto citations disabled for this section by policy)'
  );

  await emitStatus?.('persona_style', 'Loading writing style guidance');
  let writingSampleBlock = '';
  if (payload.usePersonaStyle && user.id) {
    try {
      const writingSample = await getWritingSample(
        user.id,
        sectionKey,
        'PAPER',
        payload.personaSelection
      );
      if (writingSample) {
        writingSampleBlock = buildWritingSampleBlock(writingSample, sectionKey);
      }
    } catch (err) {
      console.warn('[PaperDrafting] Failed to fetch writing sample:', err);
    }
  }

  await emitStatus?.('build_prompt', 'Building section prompt from super-admin publication rules');

  const bundle = await buildSectionPromptRuntimeBundle({
    sessionId,
    session,
    paperTypeCode,
    sectionKey,
    instructions: payload.instructions,
    useMappedEvidence: payload.useMappedEvidence,
    writingSampleBlock
  });
  const researchTopic = bundle.researchTopic;
  const citations = bundle.citations;
  const useMappedEvidence = bundle.useMappedEvidence;
  const citationContext = bundle.citationContext;
  const evidencePromptContext = bundle.evidencePromptContext;
  const blueprintPromptContext = bundle.blueprintPromptContext;
  const prompt = bundle.prompt;
  const pass1Prompt = bundle.pass1Prompt;
  const draft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');

  // DEBUG: Log evidence and blueprint context for troubleshooting citation injection
  console.log(`[PaperDrafting] Section: ${sectionKey}, useMappedEvidence: ${useMappedEvidence}`);
  console.log(`[PaperDrafting] Blueprint exists: ${!!blueprintPromptContext}, mustCover count: ${blueprintPromptContext?.mustCover?.length || 0}`);
  console.log(`[PaperDrafting] Evidence pack - allowedKeys: ${evidencePromptContext?.allowedCitationKeys?.length || 0}, dimensions: ${evidencePromptContext?.dimensionEvidence?.length || 0}, coverageAssignments: ${evidencePromptContext?.coverageAssignments?.length || 0}, gaps: ${evidencePromptContext?.gaps?.length || 0}`);
  if (evidencePromptContext?.allowedCitationKeys?.length) {
    console.log(`[PaperDrafting] Allowed citation keys: ${evidencePromptContext.allowedCitationKeys.join(', ')}`);
  }
  if (evidencePromptContext?.dimensionEvidence?.length) {
    for (const dim of evidencePromptContext.dimensionEvidence) {
      console.log(`[PaperDrafting] Dimension "${dim.dimension}": ${dim.citations.length} citations`);
    }
  }

  // DEBUG: Log a snippet of the final prompt to verify placeholder injection
  const promptSnippet = prompt.substring(0, 500);
  console.log(`[PaperDrafting] Prompt snippet (first 500 chars):\n${promptSnippet}`);
  if (prompt.includes('{{AUTO_CITATION_MODE}}')) {
    console.warn('[PaperDrafting] WARNING: {{AUTO_CITATION_MODE}} placeholder was NOT replaced - check if DB prompt has placeholders');
  }
  if (prompt.includes('ALLOWED_CITATION_KEYS: (none)')) {
    console.warn('[PaperDrafting] WARNING: No allowed citation keys - evidence pack may be empty');
  }

  let rawContent: string | null = null;
  let llmTokensUsed: number | undefined;
  let sectionRecord: any | null = null;
  let pass2PromptUsed: string | undefined;
  let pass2TokensUsed: number | undefined;
  let pass2ValidationReport: unknown;
  let pass2CompletedAt: Date | undefined;
  const requestedGenerationMode =
    payload.generationMode === 'two_pass'
      ? 'two_pass'
      : 'topup_final';
  const twoPassEnabled = isFeatureEnabled('ENABLE_TWO_PASS_GENERATION');
  const useTwoPassPipeline = twoPassEnabled && requestedGenerationMode === 'two_pass';
  const autoCitationRepair = payload.autoCitationRepair === true;

  if (useTwoPassPipeline) {
    sectionRecord = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    const storedPass1 = readStoredPass1Data(sectionRecord);
    let pass1Content: string | null = null;
    const hasFinalContent = Boolean(String(sectionRecord?.content || '').trim());

    // Fast path: reuse pre-generated Pass 1 draft if available.
    // Also reuse when section has base content but no usable final content
    // (e.g. dimension flow created/cleared visible content while retaining base draft).
    if (
      storedPass1.content
      && (
        sectionRecord.status === 'BASE_READY'
        || !hasFinalContent
      )
    ) {
      pass1Content = storedPass1.content;
      llmTokensUsed = storedPass1.tokensUsed;
    }

    // No pre-generated base content: run inline Pass 1 and persist as BASE_READY
    if (!pass1Content) {
      const pass1Request = {
        taskCode: 'LLM2_DRAFT' as const,
        stageCode: 'PAPER_SECTION_DRAFT',
        prompt: pass1Prompt,
        parameters: {
          temperature: payload.temperature,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          sessionId,
          paperId: sessionId,
          sectionKey,
          action: `generate_section_${sectionKey}`,
          module: 'publication_ideation',
          purpose: 'paper_section_pass1_inline'
        }
      };

      await emitStatus?.('llm_generation', 'Generating evidence-grounded base draft');
      const pass1Result = await llmGateway.executeLLMOperation(
        tenantContext ? { tenantContext } : { headers: requestHeaders },
        pass1Request
      );
      if (!pass1Result.success || !pass1Result.response) {
        throw new Error(pass1Result.error?.message || 'Pass 1 generation failed');
      }

      llmTokensUsed = pass1Result.response.outputTokens;
      const pass1RawOutput = (pass1Result.response.output || '').trim();
      const pass1ParsedOutput = extractSectionOutput(pass1RawOutput);
      pass1Content = pass1ParsedOutput.content;
      const pass1CompletedAt = new Date();
      const pass1Artifact = buildPersistedPass1Artifact({
        content: pass1Content,
        memory: pass1ParsedOutput.memory,
        generatedAt: pass1CompletedAt,
        promptUsed: pass1Prompt,
        tokensUsed: pass1Result.response.outputTokens
      });

      if (!pass1Content?.trim()) {
        throw new Error('Pass 1 generation returned empty content');
      }

      const pass1Data = {
        displayName: sectionRecord?.displayName || formatSectionLabel(sectionKey),
        content: sectionRecord?.content || '',
        wordCount: sectionRecord?.wordCount || 0,
        memory: pass1ParsedOutput.memory as any,
        generationMode: 'two_pass',
        baseContentInternal: pass1Content,
        baseMemory: pass1ParsedOutput.memory as any,
        pass1Artifact: pass1Artifact as any,
        pass1PromptUsed: pass1Prompt,
        pass1LlmResponse: pass1RawOutput,
        pass1TokensUsed: pass1Result.response.outputTokens,
        pass1CompletedAt,
        status: 'BASE_READY' as const,
        isStale: false,
        generatedAt: pass1CompletedAt
      };

      if (sectionRecord) {
        sectionRecord = await prisma.paperSection.update({
          where: { id: sectionRecord.id },
          data: { ...pass1Data, version: { increment: 1 } }
        });
      } else {
        sectionRecord = await prisma.paperSection.create({
          data: {
            sessionId,
            sectionKey,
            ...pass1Data
          } as any
        });
      }
    }

    await emitStatus?.('llm_generation', 'Polishing evidence draft for publication');
    const dimensionCitations = (evidencePromptContext.dimensionEvidence || []).map(dim => ({
      dimensionKey: normalizeDimensionKey(dim.dimension),
      dimensionLabel: dim.dimension,
      expectedCitationKeys: (dim.citations || []).map(c => String(c.citationKey || '').trim()).filter(Boolean),
    }));
    const runPolish = () => sectionPolishService.polishWithRetry({
      sectionKey,
      displayName: sectionRecord?.displayName || formatSectionLabel(sectionKey),
      baseContent: pass1Content!,
      sessionId,
      paperTypeCode,
      tenantContext: tenantContext || null,
      dimensionCitations: dimensionCitations.length > 0 ? dimensionCitations : undefined,
    });
    let polishResult = await runPolish();

    if (!polishResult.success || !polishResult.polishedContent) {
      console.warn('[PaperDrafting] Pass 2 polish failed on first attempt; retrying once.', {
        sectionKey,
        error: polishResult.error
      });
      await sleep(800);
      polishResult = await runPolish();
    }

    if (!polishResult.success || !polishResult.polishedContent) {
      if (sectionRecord?.id) {
        try {
          sectionRecord = await prisma.paperSection.update({
            where: { id: sectionRecord.id },
            data: {
              status: 'BASE_READY',
              validationReport: polishResult.driftReport as any,
              version: { increment: 1 }
            }
          });
        } catch (persistError) {
          console.warn('[PaperDrafting] Failed to persist BASE_READY fallback after polish failure', {
            sectionKey,
            error: persistError instanceof Error ? persistError.message : String(persistError)
          });
        }
      }

      throw new DraftingRequestError(
        polishResult.error || 'Pass 2 polish failed',
        422,
        {
          error: polishResult.error || 'Pass 2 polish failed',
          hint: 'Base draft is saved. Retry generation to run polish again.',
          retryable: true,
          retryAction: 'generate_section',
          sectionStatus: 'BASE_READY',
          hasBaseContent: Boolean(pass1Content && pass1Content.trim()),
          polishValidation: polishResult.driftReport || null
        }
      );
    }

    rawContent = polishResult.polishedContent;
    pass2PromptUsed = polishResult.promptUsed;
    pass2TokensUsed = polishResult.tokensUsed ?? undefined;
    pass2ValidationReport = polishResult.driftReport;
    pass2CompletedAt = new Date();
    llmTokensUsed = (llmTokensUsed || 0) + (polishResult.tokensUsed || 0);
    if (llmTokensUsed === 0) llmTokensUsed = undefined;
  } else {
    const llmRequest = {
      taskCode: 'LLM2_DRAFT' as const,
      stageCode: 'PAPER_SECTION_DRAFT',
      prompt,
      parameters: {
        temperature: payload.temperature,
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId,
        paperId: sessionId,
        sectionKey,
        action: `generate_section_${sectionKey}`,
        module: 'publication_ideation',
        purpose: 'paper_section_generation'
      }
    };

    await emitStatus?.('llm_generation', 'Generating section draft');
    const result = await llmGateway.executeLLMOperation(
      tenantContext ? { tenantContext } : { headers: requestHeaders },
      llmRequest
    );
    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'Generation failed');
    }

    llmTokensUsed = result.response.outputTokens;
    const rawOutput = (result.response.output || '').trim();
    rawContent = extractSectionOutput(rawOutput).content;
  }

  if (!rawContent?.trim()) {
    throw new DraftingRequestError(
      'Section generation returned empty content',
      500,
      { error: 'LLM returned empty or invalid output', retryable: true }
    );
  }

  const sectionContent = rawContent;
  const knownSessionKeys = new Set(citations.map(c => c.citationKey));

  await emitStatus?.(
    'citation_validation',
    useMappedEvidence
      ? 'Validating mapped citation whitelist for this section'
      : 'Validating citation keys (mapped whitelist disabled)'
  );
  let contentForPostProcess = polishDraftMarkdown(sectionContent);

  // Normalize malformed placeholders into [CITE:*] so the existing tested
  // pipeline handles them consistently:
  // validate -> repair (LLM) -> revalidate -> deterministic strip fallback.
  if (useMappedEvidence && /\[CITATION_NEEDED[^\]]*\]/i.test(contentForPostProcess)) {
    console.warn('[PaperDrafting] Found [CITATION_NEEDED] placeholders; normalizing for standard validation pipeline', {
      sectionKey
    });
    contentForPostProcess = contentForPostProcess.replace(
      /\[CITATION_NEEDED[^\]]*\]/gi,
      '[CITE:CITATION_NEEDED]'
    );
  }

  const initialValidation = DraftingService.validateCitationKeys(
    contentForPostProcess,
    useMappedEvidence ? citationContext.allowedCitationKeys : undefined,
    knownSessionKeys
  );

  if (
    useMappedEvidence &&
    initialValidation.disallowedKeys.length > 0 &&
    citationContext.allowedCitationKeys.length > 0
  ) {
    if (!autoCitationRepair) {
      console.warn('[PaperDrafting] Disallowed citation keys detected; auto repair disabled', {
        sectionKey,
        disallowedCount: initialValidation.disallowedKeys.length,
        disallowedSample: initialValidation.disallowedKeys.slice(0, 10)
      });
    } else {
      console.warn('[PaperDrafting] Initial citation validation found disallowed keys; attempting repair', {
        sectionKey,
        disallowedCount: initialValidation.disallowedKeys.length,
        disallowedSample: initialValidation.disallowedKeys.slice(0, 10)
      });
      // Pass dimension evidence so the repair LLM can make semantically correct substitutions
      contentForPostProcess = await repairSectionCitations(
        requestHeaders,
        sessionId,
        sectionKey,
        contentForPostProcess,
        citationContext.allowedCitationKeys,
        evidencePromptContext?.dimensionEvidence,
        tenantContext
      );
      let postRepairValidation = DraftingService.validateCitationKeys(
        contentForPostProcess,
        citationContext.allowedCitationKeys,
        knownSessionKeys
      );

      // Retry once when repair is enabled.
      if (postRepairValidation.disallowedKeys.length > 0) {
        console.warn('[PaperDrafting] First repair pass still has disallowed keys; retrying', {
          sectionKey,
          disallowedCount: postRepairValidation.disallowedKeys.length,
          disallowedSample: postRepairValidation.disallowedKeys.slice(0, 5)
        });
        contentForPostProcess = await repairSectionCitations(
          requestHeaders,
          sessionId,
          sectionKey,
          contentForPostProcess,
          citationContext.allowedCitationKeys,
          evidencePromptContext?.dimensionEvidence,
          tenantContext
        );
        postRepairValidation = DraftingService.validateCitationKeys(
          contentForPostProcess,
          citationContext.allowedCitationKeys,
          knownSessionKeys
        );
      }

      // Keep deterministic strip only when auto repair is explicitly enabled.
      if (postRepairValidation.disallowedKeys.length > 0) {
        console.warn('[PaperDrafting] Citation repair exhausted; stripping remaining disallowed keys deterministically', {
          sectionKey,
          strippedCount: postRepairValidation.disallowedKeys.length,
          strippedKeys: postRepairValidation.disallowedKeys
        });
        contentForPostProcess = DraftingService.stripDisallowedCitations(
          contentForPostProcess,
          citationContext.allowedCitationKeys
        );
      }
    }
  }

  const styleCode = getStyleCode(session);
  const postProcessed = await DraftingService.postProcessSection(
    contentForPostProcess,
    sessionId,
    styleCode,
    {
      allowedCitationKeys: useMappedEvidence ? citationContext.allowedCitationKeys : undefined,
      strictWhitelist: useMappedEvidence,
      preserveCitationPlaceholders: true
    }
  );

  const polishedContent = polishDraftMarkdown(postProcessed.processedContent);

  // P1 Fix: Only throw on unknownCitationKeys when strictWhitelist is active.
  // When mapped evidence is OFF, unknown keys from bare brackets (e.g. [BERT], [ResNet])
  // are false positives from technical terms -- they should NOT cause a hard failure.
  const finalValidation = DraftingService.validateCitationKeys(
    polishedContent,
    useMappedEvidence ? citationContext.allowedCitationKeys : undefined,
    knownSessionKeys
  );
  const hasDisallowedInStrict = useMappedEvidence && finalValidation.disallowedKeys.length > 0;
  const hasUnknownInStrict = useMappedEvidence && postProcessed.unknownCitationKeys.length > 0;

  if (hasDisallowedInStrict || hasUnknownInStrict) {
    console.warn('[PaperDrafting] Post-process citation validation failed', {
      sectionKey,
      disallowedCount: finalValidation.disallowedKeys.length,
      disallowedSample: finalValidation.disallowedKeys.slice(0, 10),
      unknownCount: postProcessed.unknownCitationKeys.length,
      unknownSample: postProcessed.unknownCitationKeys.slice(0, 10)
    });
    throw new DraftingRequestError(
      'Section contains invalid citation keys',
      422,
      {
        error: 'Section contains invalid citation keys',
        citationValidation: {
          allowedCitationKeys: useMappedEvidence ? citationContext.allowedCitationKeys : [],
          disallowedKeys: finalValidation.disallowedKeys,
          unknownKeys: postProcessed.unknownCitationKeys
        }
      }
    );
  } else if (postProcessed.unknownCitationKeys.length > 0) {
    // Non-strict mode: log unknown keys as warnings but don't block generation
    console.warn('[PaperDrafting] Non-strict mode: unknown citation keys detected but not blocking', {
      sectionKey,
      unknownCount: postProcessed.unknownCitationKeys.length,
      unknownSample: postProcessed.unknownCitationKeys.slice(0, 10)
    });
  }

  await emitStatus?.('persist', 'Saving section and citation usage metadata');
  const updatedDraft = await updateDraftContent(
    draft.id,
    sectionKey,
    polishedContent,
    paperTypeCode,
    {
      prompt,
      response: sectionContent,
      tokensUsed: llmTokensUsed
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

  const usageSync = await syncSectionDraftCitationUsage({
    sessionId,
    sectionKey,
    sectionContent: polishedContent,
    citations
  });
  const finalCitationKeys = usageSync.citationKeys;
  const attributedCount = usageSync.attributedCount;
  const ambiguousCount = usageSync.ambiguousCount;
  const unattributedKeys = usageSync.unattributedKeys;

  if (useTwoPassPipeline) {
    const resolvedSectionRecord = sectionRecord ?? await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      select: { id: true }
    });

    if (resolvedSectionRecord?.id) {
      await prisma.paperSection.update({
        where: { id: resolvedSectionRecord.id },
        data: {
          content: polishedContent,
          wordCount: computeWordCount(polishedContent),
          generationMode: 'two_pass',
          promptUsed: pass2PromptUsed || prompt,
          llmResponse: polishedContent,
          tokensUsed: llmTokensUsed,
          pass2PromptUsed,
          pass2TokensUsed,
          pass2CompletedAt: pass2CompletedAt || new Date(),
          validationReport: pass2ValidationReport as any,
          status: 'DRAFT',
          isStale: false,
          generatedAt: new Date(),
          version: { increment: 1 }
        }
      });
    } else {
      console.warn('[PaperDrafting] Two-pass finalize skipped: section record missing', {
        sessionId,
        sectionKey
      });
    }
  }

  const dimensionCoverageReport = pass2ValidationReport
    ? (pass2ValidationReport as any).dimensionCoverage
    : undefined;

  return {
    sectionKey,
    content: polishedContent,
    citationsUsed: finalCitationKeys,
    warnings: postProcessed.warnings,
    citationValidation: {
      allowedCitationKeys: useMappedEvidence ? citationContext.allowedCitationKeys : [],
      disallowedKeys: [],
      unknownKeys: []
    },
    attribution: {
      attributedCount,
      ambiguousCount,
      unattributedKeys
    },
    evidence: {
      usedEvidencePack: useMappedEvidence ? citationContext.usedEvidencePack : false,
      gaps: citationContext.evidenceGaps
    },
    ...(dimensionCoverageReport && !dimensionCoverageReport.passed
      ? { dimensionCoverage: dimensionCoverageReport }
      : {}),
    tokensUsed: llmTokensUsed,
    prompt
  };
}

async function resolveSectionWordBudget(params: {
  sectionKey: string;
  paperTypeCode: string;
  blueprintWordBudget?: number;
}): Promise<number | undefined> {
  const normalizedSectionKey = normalizeSectionKey(params.sectionKey);
  const fromBlueprint = normalizePositiveWordBudget(params.blueprintWordBudget);
  if (fromBlueprint) return fromBlueprint;

  try {
    const template = await sectionTemplateService.getSectionTemplate(
      normalizedSectionKey,
      params.paperTypeCode
    );
    const fromTemplate = normalizePositiveWordBudget(template?.constraints?.wordLimit);
    if (fromTemplate) return fromTemplate;
  } catch {
    // ignore and fall back
  }

  try {
    const paperType = await paperTypeService.getPaperType(params.paperTypeCode);
    const defaults = (paperType as any)?.defaultWordLimits as Record<string, unknown> | undefined;
    if (!defaults) return undefined;

    const direct = normalizePositiveWordBudget(defaults[normalizedSectionKey]);
    if (direct) return direct;

    const alias = normalizedSectionKey.replace(/_/g, '');
    const aliasBudget = normalizePositiveWordBudget(defaults[alias]);
    if (aliasBudget) return aliasBudget;
  } catch {
    // ignore
  }

  return undefined;
}

async function buildSectionPromptRuntimeBundle(params: {
  sessionId: string;
  session: any;
  paperTypeCode: string;
  sectionKey: string;
  instructions?: string;
  useMappedEvidence?: boolean;
  writingSampleBlock?: string;
}): Promise<SectionPromptRuntimeBundle> {
  const { sessionId, session, paperTypeCode, sectionKey } = params;
  const normalizedSectionKey = normalizeSectionKey(sectionKey);
  const requestedMappedEvidence = params.useMappedEvidence !== false;
  const sectionContextPolicy = await sectionTemplateService.getSectionContextPolicy(normalizedSectionKey, paperTypeCode);
  const useMappedEvidence = sectionContextPolicy.requiresCitations ? requestedMappedEvidence : false;

  const researchTopic = await prisma.researchTopic.findUnique({
    where: { sessionId }
  });
  const citations = await citationService.getCitationsForSession(sessionId);
  const evidencePack = useMappedEvidence
    ? await evidencePackService.getEvidencePack(sessionId, normalizedSectionKey)
    : null;
  const citationContext = await DraftingService.buildCitationContext(sessionId, normalizedSectionKey, {
    useMappedEvidence,
    preloadedEvidencePack: evidencePack
  });

  const draft = await getPaperDraft(sessionId);
  const extraSections = normalizeExtraSections(draft?.extraSections);

  let blueprintPromptContext: BlueprintPromptContext | undefined;
  let blueprintWordBudget: number | undefined;
  const blueprint = await blueprintService.getBlueprint(sessionId);
  if (blueprint) {
    const currentSectionPlan = blueprint.sectionPlan.find(
      (entry) => normalizeSectionKey(entry.sectionKey) === normalizedSectionKey
    );
    blueprintWordBudget = normalizePositiveWordBudget(currentSectionPlan?.wordBudget);
    blueprintPromptContext = {
      thesisStatement: blueprint.thesisStatement,
      centralObjective: blueprint.centralObjective,
      keyContributions: blueprint.keyContributions,
      sectionPlan: blueprint.sectionPlan.map((entry) => ({ sectionKey: entry.sectionKey, purpose: entry.purpose })),
      mustCover: currentSectionPlan?.mustCover || [],
      mustAvoid: currentSectionPlan?.mustAvoid || [],
      wordBudget: blueprintWordBudget
    };
  }

  const previousSectionMemories = blueprint
    ? await getPreviousSectionMemories(sessionId, normalizedSectionKey, blueprint)
    : [];

  const sectionWordBudget = await resolveSectionWordBudget({
    sectionKey: normalizedSectionKey,
    paperTypeCode,
    blueprintWordBudget
  });

  let evidencePromptContext: EvidencePromptContext;
  if (useMappedEvidence) {
    evidencePromptContext = {
      useMappedEvidence: true,
      allowedCitationKeys: citationContext.allowedCitationKeys,
      dimensionEvidence: evidencePack?.dimensionEvidence || [],
      gaps: citationContext.evidenceGaps,
      coverageAssignments: evidencePack?.coverageAssignments || []
    };

    if (
      evidencePack?.hasBlueprint
      && citationContext.allowedCitationKeys.length === 0
      && (
        (evidencePack.dimensionEvidence?.length || 0) > 0
        || (evidencePack.coverageAssignments?.length || 0) > 0
      )
    ) {
      throw new DraftingRequestError(
        'No mapped evidence is available for this section',
        409,
        {
          error: 'No mapped evidence is available for this section',
          hint: 'Run AI Relevance & Blueprint Mapping (or re-import citations) so citations can be mapped to this section.',
          evidence: {
            sectionKey: normalizedSectionKey,
            gaps: evidencePack?.gaps || []
          }
        }
      );
    }
  } else {
    evidencePromptContext = {
      useMappedEvidence: false,
      allowedCitationKeys: [],
      dimensionEvidence: [],
      gaps: [],
      coverageAssignments: []
    };
  }

  const sharedContext = {
    researchTopic,
    archetype: {
      archetypeId: session.archetypeId,
      archetypeConfidence: session.archetypeConfidence,
      contributionMode: session.contributionMode,
      evaluationScope: session.evaluationScope,
      evidenceModality: session.evidenceModality,
      archetypeRationale: session.archetypeRationale,
      archetypeEvidenceStale: session.archetypeEvidenceStale
    },
    citationCount: citations.length,
    availableCitations: citations,
    previousSections: extraSections
  };

  const prompt = await buildPrompt(
    normalizedSectionKey,
    paperTypeCode,
    sharedContext,
    useMappedEvidence ? citationContext.citationInstructions : '',
    params.instructions,
    params.writingSampleBlock,
    blueprintPromptContext,
    evidencePromptContext,
    'markdown',
    previousSectionMemories
  );
  const pass1Prompt = await buildPrompt(
    normalizedSectionKey,
    paperTypeCode,
    sharedContext,
    useMappedEvidence ? citationContext.citationInstructions : '',
    params.instructions,
    params.writingSampleBlock,
    blueprintPromptContext,
    evidencePromptContext,
    'pass1_json',
    previousSectionMemories
  );

  return {
    sectionKey: normalizedSectionKey,
    paperTypeCode,
    prompt,
    pass1Prompt,
    researchTopic,
    citations,
    useMappedEvidence,
    citationContext,
    sectionWordBudget,
    blueprintPromptContext,
    evidencePromptContext,
    previousSectionMemories
  };
}

/**
 * Build dimension plan deterministically from the frozen blueprint mustCover
 * dimensions ONLY (same labels + same order). No new dimensions are created
 * in drafting flow. Evidence mappings are used only to attach citation keys.
 *
 * Returns null when the blueprint has no mustCover for this section.
 */
function buildBlueprintDimensionPlan(
  bundle: SectionPromptRuntimeBundle
): DimensionPlanEntry[] | null {
  const mustCover = (bundle.blueprintPromptContext?.mustCover || [])
    .map((dimensionLabel) => String(dimensionLabel || '').trim())
    .filter(Boolean);

  if (mustCover.length === 0) return null;

  const evidenceByDimension = new Map<string, string[]>();
  for (const entry of bundle.evidencePromptContext.dimensionEvidence || []) {
    const dimensionKey = normalizeDimensionKey(String(entry.dimension || '').trim());
    if (!dimensionKey) continue;
    const keys: string[] = Array.from(new Set<string>(
      (entry.citations || [])
        .map((citation) => String(citation.citationKey || '').trim())
        .filter((key): key is string => Boolean(key))
    )).slice(0, MAX_CITATIONS_PER_DIMENSION);
    evidenceByDimension.set(dimensionKey, keys);
  }

  const sectionAvoidClaims = (bundle.blueprintPromptContext?.mustAvoid || [])
    .map((claim) => String(claim || '').trim())
    .filter(Boolean);

  const plan: DimensionPlanEntry[] = mustCover
    .map((dimensionLabel, index) => {
      const dimensionKey = normalizeDimensionKey(dimensionLabel);
      if (!dimensionKey) return null;
      const mustUseCitationKeys = evidenceByDimension.get(dimensionKey) || [];
      const isLast = index === mustCover.length - 1;
      const nextLabel = isLast ? null : mustCover[index + 1];
      const bridgeHint = isLast
        ? 'Conclude this dimension naturally as the final topic of the section.'
        : `Transition smoothly from "${dimensionLabel}" into the next topic: "${nextLabel}".`;
      return {
      dimensionKey: normalizeDimensionKey(dimensionLabel),
      dimensionLabel,
      objective: mustUseCitationKeys.length > 0
        ? `Cover the frozen blueprint dimension "${dimensionLabel}" with evidence-grounded analysis.`
        : `Address the frozen blueprint dimension "${dimensionLabel}" clearly and defensibly.`,
      mustUseCitationKeys,
      avoidClaims: sectionAvoidClaims,
      bridgeHint
      } satisfies DimensionPlanEntry;
    })
    .filter((entry): entry is DimensionPlanEntry => Boolean(entry))
    .filter((entry) => entry.dimensionKey.length > 0);

  if (plan.length === 0) return null;
  return applyDimensionPlanMetadata(plan, bundle.sectionWordBudget);
}

// parseDimensionPlan removed — blueprint mustCover dimensions are now the
// single source of truth.  See buildBlueprintDimensionPlan().

function collectCanonicalCitationKeys(
  content: string,
  knownSessionKeys: Set<string>,
  canonicalLookup: Map<string, string>
): string[] {
  const extracted = DraftingService.extractCitationKeys(content, knownSessionKeys)
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  return Array.from(new Set(
    extracted.map((key) => resolveCitationKeyFromLookup(key, canonicalLookup) || key)
  ));
}

function findNextDimensionPlanEntry(flow: DimensionFlowState): DimensionPlanEntry | null {
  const accepted = new Set(flow.acceptedBlocks.map((block) => normalizeDimensionKey(block.dimensionKey)));
  return flow.plan.find((entry) => !accepted.has(normalizeDimensionKey(entry.dimensionKey))) || null;
}

async function getOrCreateDimensionSectionRecord(
  sessionId: string,
  sectionKey: string
) {
  const normalizedSectionKey = normalizeSectionKey(sectionKey);
  const existing = await prisma.paperSection.findUnique({
    where: {
      sessionId_sectionKey: {
        sessionId,
        sectionKey: normalizedSectionKey
      }
    }
  });
  if (existing) return existing;

  return prisma.paperSection.create({
    data: {
      sessionId,
      sectionKey: normalizedSectionKey,
      displayName: formatSectionLabel(normalizedSectionKey),
      content: '',
      wordCount: 0,
      generationMode: 'dimension_flow',
      status: 'DRAFT',
      isStale: false,
      generatedAt: new Date()
    } as any
  });
}

async function persistDimensionFlowState(params: {
  sectionId: string;
  existingValidationReport: unknown;
  flow: DimensionFlowState;
  stitchedContent?: string;
}) {
  const now = new Date();
  const content = params.stitchedContent ?? undefined;
  const cleanedValidationReport = stripDimensionFlowFromValidationReport(params.existingValidationReport);
  return prisma.paperSection.update({
    where: { id: params.sectionId },
    data: {
      generationMode: 'dimension_flow',
      dimensionFlowState: params.flow as any,
      ...(cleanedValidationReport !== null
        ? { validationReport: cleanedValidationReport as any }
        : {}),
      ...(typeof content === 'string'
        ? {
          content,
          wordCount: computeWordCount(content),
          updatedAt: now
        }
        : {})
    }
  });
}

async function executeDraftSectionPrompt(params: {
  sessionId: string;
  sectionKey: string;
  prompt: string;
  headers: Record<string, string>;
  tenantContext?: TenantContext | null;
  purpose: string;
  temperature?: number;
  stageCode?: string;
}) {
  const result = await llmGateway.executeLLMOperation(
    params.tenantContext
      ? { tenantContext: params.tenantContext }
      : { headers: params.headers },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: params.stageCode || 'PAPER_SECTION_DRAFT',
      prompt: params.prompt,
      parameters: {
        temperature: params.temperature
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId: params.sessionId,
        paperId: params.sessionId,
        sectionKey: params.sectionKey,
        action: `${params.purpose}_${params.sectionKey}`,
        module: 'publication_ideation',
        purpose: params.purpose
      }
    }
  );

  if (!result.success || !result.response) {
    throw new DraftingRequestError(
      result.error?.message || 'Draft generation failed',
      502,
      { error: result.error?.message || 'Draft generation failed' }
    );
  }

  return {
    output: String(result.response.output || '').trim(),
    outputTokens: result.response.outputTokens
  };
}

function resolveRequiredCitationKeys(
  keys: string[],
  canonicalLookup: Map<string, string>
): string[] {
  return Array.from(new Set(
    keys
      .map((key) => String(key || '').trim())
      .filter(Boolean)
      .map((key) => resolveCitationKeyFromLookup(key, canonicalLookup) || key)
  ));
}

function evaluateDimensionCitationValidation(params: {
  content: string;
  bundle: SectionPromptRuntimeBundle;
  requiredCitationKeys: string[];
}): {
  polishedContent: string;
  citationKeys: string[];
  citationValidation: DimensionDraftProposal['citationValidation'];
} {
  const polishedContent = polishDraftMarkdown(params.content || '');
  const knownSessionKeys = new Set(params.bundle.citations.map((citation) => citation.citationKey));
  const canonicalLookup = buildCanonicalCitationLookup(params.bundle.citations);
  const allowedCitationKeys = params.bundle.useMappedEvidence
    ? params.bundle.citationContext.allowedCitationKeys
    : [];
  const validation = DraftingService.validateCitationKeys(
    polishedContent,
    params.bundle.useMappedEvidence ? allowedCitationKeys : undefined,
    knownSessionKeys
  );
  const extractedKeys: string[] = DraftingService.extractCitationKeys(polishedContent, knownSessionKeys)
    .map((key) => String(key || '').trim())
    .filter((key): key is string => Boolean(key));
  const unknownKeys: string[] = Array.from(new Set(
    extractedKeys.filter((key) => !resolveCitationKeyFromLookup(key, canonicalLookup))
  ));
  const citationKeys = collectCanonicalCitationKeys(polishedContent, knownSessionKeys, canonicalLookup);
  const requiredCitationKeys = resolveRequiredCitationKeys(params.requiredCitationKeys, canonicalLookup);
  const usedCitationSet = new Set(citationKeys.map((key) => citationKeyIdentity(key)));
  const missingRequiredKeys = requiredCitationKeys.filter((key) => !usedCitationSet.has(citationKeyIdentity(key)));

  return {
    polishedContent,
    citationKeys,
    citationValidation: {
      allowedCitationKeys,
      disallowedKeys: validation.disallowedKeys,
      unknownKeys,
      missingRequiredKeys
    }
  };
}

function extractDimensionContentFromOutput(rawOutput: string): string {
  const parsed = extractJsonObjectFromOutput(rawOutput);
  if (parsed && typeof parsed.content === 'string' && parsed.content.trim()) {
    return parsed.content.trim();
  }

  const fenced = rawOutput.match(/```(?:markdown|md|text)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  return rawOutput.trim();
}

function buildDimensionFlowResponse(
  flow: DimensionFlowState,
  stitchedContentOverride?: string
) {
  const { stitchedContent, orderedBlocks } = stitchAcceptedBlocks(flow);
  const effectiveStitchedContent = typeof stitchedContentOverride === 'string'
    ? stitchedContentOverride
    : stitchedContent;
  const budget = buildDimensionBudgetSnapshot(flow, effectiveStitchedContent);
  const nextDimension = findNextDimensionPlanEntry(flow);
  const acceptedSet = new Set(flow.acceptedBlocks.map((block) => normalizeDimensionKey(block.dimensionKey)));
  const pendingKey = normalizeDimensionKey(flow.pendingProposal?.dimensionKey || '');

  return {
    flow,
    stitchedContent: effectiveStitchedContent,
    pass1Source: flow.pass1Source || null,
    orderedBlocks,
    nextDimension,
    completed: !nextDimension,
    plan: flow.plan.map((entry) => {
      const key = normalizeDimensionKey(entry.dimensionKey);
      let status: 'accepted' | 'pending' | 'todo' = 'todo';
      if (acceptedSet.has(key)) status = 'accepted';
      else if (pendingKey && pendingKey === key) status = 'pending';
      return {
        ...entry,
        status
      };
    }),
    budget,
    progress: {
      total: flow.plan.length,
      accepted: acceptedSet.size,
      remaining: Math.max(flow.plan.length - acceptedSet.size, 0)
    }
  };
}

// buildDimensionPlannerPrompt removed — dimension planning no longer uses an
// LLM call.  Blueprint mustCover dimensions are the single source of truth.
// See buildBlueprintDimensionPlan().

async function generateDimensionProposal(params: {
  sessionId: string;
  sectionKey: string;
  bundle: SectionPromptRuntimeBundle;
  flow: DimensionFlowState;
  targetDimension: DimensionPlanEntry;
  pass1Content: string;
  pass1Memory?: unknown;
  headers: Record<string, string>;
  tenantContext?: TenantContext | null;
  feedback?: string;
  temperature?: number;
}): Promise<{
  proposal: DimensionDraftProposal;
  citationKeys: string[];
  outputTokens?: number;
}> {
  const budget = resolveDimensionDraftBudget(params.flow, params.targetDimension.dimensionKey);
  if (budget.maxWords !== undefined && budget.maxWords <= 0) {
    throw new DraftingRequestError(
      'Section word budget is exhausted before this dimension',
      422,
      {
        error: 'Section word budget is exhausted before this dimension',
        hint: 'Shorten earlier accepted dimensions or increase section word budget.'
      }
    );
  }

  const { stitchedContent } = stitchAcceptedBlocks(params.flow);
  const acceptedSummary = summarizeAcceptedBlocks(params.flow.acceptedBlocks);
  const priorContext = buildDimensionPriorContext(stitchedContent, 9000);
  const pass1Content = String(params.pass1Content || '').trim();
  const pass1Memory = normalizePass1MemorySnapshot(params.pass1Memory);
  const pass1Source = params.flow.pass1Source || buildPass1SourceTrace({
    content: pass1Content,
    memory: pass1Memory,
    reused: true
  });
  const pass1SourceFull = pass1Content;
  const targetPass1Brief = findPass1DimensionBrief(
    pass1Memory,
    params.targetDimension.dimensionKey,
    params.targetDimension.dimensionLabel
  );
  const requiredKeys = params.targetDimension.mustUseCitationKeys.join(', ') || '(none)';
  const avoidClaims = params.targetDimension.avoidClaims.join('; ') || '(none)';
  const feedback = params.feedback?.trim() ? `\nREWRITE FEEDBACK:\n${params.feedback.trim()}` : '';
  const roleDirective = buildDimensionRoleDirective(budget.role);
  const targetIndex = params.flow.plan.findIndex(
    (entry) => normalizeDimensionKey(entry.dimensionKey) === normalizeDimensionKey(params.targetDimension.dimensionKey)
  );
  const previousDimensionLabel = targetIndex > 0
    ? params.flow.plan[targetIndex - 1]?.dimensionLabel || null
    : null;
  const nextDimensionLabel = targetIndex >= 0 && targetIndex < params.flow.plan.length - 1
    ? params.flow.plan[targetIndex + 1]?.dimensionLabel || null
    : null;
  const coverageKeys = params.bundle.evidencePromptContext.coverageAssignments
    .map((assignment) => assignment.citationKey)
    .filter(Boolean)
    .join(', ') || '(none)';
  const roleLabel = budget.role.replace(/_/g, ' ').toUpperCase();
  const budgetLines = [
    `DIMENSION ROLE: ${roleLabel}`,
    budget.sectionWordBudget
      ? `SECTION WORD BUDGET: ${budget.sectionWordBudget} words`
      : 'SECTION WORD BUDGET: (not configured)',
    budget.sectionWordBudget
      ? `WORDS ALREADY LOCKED (other accepted dimensions): ${budget.usedWordsExcludingTarget}`
      : '',
    budget.remainingWordsForTarget !== undefined
      ? `WORDS REMAINING AVAILABLE FOR THIS DIMENSION: ${budget.remainingWordsForTarget}`
      : '',
    budget.targetWords !== undefined
      ? `TARGET WORDS FOR THIS DIMENSION: ~${budget.targetWords}`
      : '',
    budget.minWords !== undefined
      ? `MIN WORDS FOR THIS DIMENSION: ${budget.minWords}`
      : '',
    budget.maxWords !== undefined
      ? `HARD MAX WORDS FOR THIS DIMENSION: ${budget.maxWords}`
      : ''
  ].filter(Boolean).join('\n');
  const lengthRule = budget.maxWords !== undefined
    ? `- Hard cap: ${budget.maxWords} words for this dimension block.`
    : '- Keep the block concise and tightly scoped to this dimension.';
  const targetRule = budget.targetWords !== undefined
    ? `- Aim for about ${budget.targetWords} words.`
    : '';
  const minRule = budget.minWords !== undefined
    ? `- Keep at least ${budget.minWords} words unless evidence is genuinely sparse.`
    : '';
  const canonicalLookup = buildCanonicalCitationLookup(params.bundle.citations);
  const targetEvidenceNotes = summarizeTargetDimensionEvidence(
    params.bundle.evidencePromptContext,
    params.targetDimension.dimensionKey,
    params.targetDimension.dimensionLabel
  );
  const targetEvidenceSummary = summarizeTargetDimensionEvidenceCompact(
    params.bundle.evidencePromptContext,
    params.targetDimension.dimensionKey,
    params.targetDimension.dimensionLabel
  );
  const roleSpecificPass1Guidance = [
    budget.role === 'introduction' || budget.role === 'intro_conclusion'
      ? `Pass 1 opening guidance: ${pass1Memory?.openingStrategy || '(none)'}` : '',
    budget.role === 'conclusion' || budget.role === 'intro_conclusion'
      ? `Pass 1 closing guidance: ${pass1Memory?.closingStrategy || '(none)'}` : ''
  ].filter(Boolean).join('\n');

  const crossSectionBlock = formatPreviousSectionMemoriesBlock(params.bundle.previousSectionMemories);

  const isEvidenceGapDimension = !params.targetDimension.mustUseCitationKeys.length
    && (params.bundle.evidencePromptContext.gaps || []).some(
      gap => normalizeDimensionKey(gap) === normalizeDimensionKey(params.targetDimension.dimensionKey)
        || normalizeDimensionKey(gap) === normalizeDimensionKey(params.targetDimension.dimensionLabel)
    );
  const evidenceGapGuardrail = isEvidenceGapDimension
    ? `
═══════════════════════════════════════════════════════════════════════════════
⚠️  EVIDENCE GAP — ANTI-HALLUCINATION GUARD (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
No mapped evidence exists for this dimension. STRICT RULES:
- Do NOT fabricate or invent citation keys. Do NOT use [CITE:...] unless the key
  appears in the MANDATORY SECTION COVERAGE KEYS above.
- Make theoretical or analytical arguments only. Ground claims in reasoning, not
  invented references.
- If empirical evidence is needed but unavailable, explicitly state:
  "Further empirical investigation is warranted" or similar hedging.
- You may reference concepts from the PASS 1 source but do NOT cite papers
  that are not in your allowed citation set.
`
    : '';

  const prompt = `You are drafting ONE dimension for a paper section.

SECTION KEY: ${params.sectionKey}
SECTION LABEL: ${formatSectionLabel(params.sectionKey)}
TARGET DIMENSION KEY: ${params.targetDimension.dimensionKey}
TARGET DIMENSION LABEL: ${params.targetDimension.dimensionLabel}
TARGET OBJECTIVE: ${params.targetDimension.objective}
REQUIRED CITATION KEYS FOR THIS DIMENSION: ${requiredKeys}
MANDATORY SECTION COVERAGE KEYS (global): ${coverageKeys}
AVOID THESE CLAIMS: ${avoidClaims}
BRIDGE HINT: ${params.targetDimension.bridgeHint || '(none)'}
${budgetLines}
ROLE DIRECTIVE: ${roleDirective}
${evidenceGapGuardrail}
PASS 1 SECTION SOURCE (use this as the source of truth for section-level content):
${pass1SourceFull || '(No pass 1 source available)'}

PASS 1 MEMORY SUMMARY:
${formatPass1MemoryForPrompt(pass1Memory)}

PASS 1 TARGET-DIMENSION BRIEF:
${formatPass1DimensionBriefForPrompt(targetPass1Brief)}

TARGET DIMENSION EVIDENCE PACK:
${targetEvidenceNotes}

ROLE-SPECIFIC PASS 1 GUIDANCE:
${roleSpecificPass1Guidance || '(No extra opening/closing guidance)'}

ALREADY ACCEPTED DIMENSIONS (locked):
${acceptedSummary}

ACCEPTED SECTION CONTENT SO FAR (for continuity; do not rewrite it):
${priorContext}
${crossSectionBlock}
MASTER SECTION GUIDANCE:
${params.bundle.prompt}
${feedback}

Write ONLY the content block for this target dimension.
Rules:
- Use the PASS 1 SECTION SOURCE above as the source of truth for this section.
- Use the PASS 1 TARGET-DIMENSION BRIEF as the primary extraction target when available.
- Use the TARGET DIMENSION EVIDENCE PACK first when grounding claims and citation placement.
- Extract and adapt only the parts of the pass 1 draft that belong to this target dimension.
- Do not repeat prior accepted content.
- Keep continuity with the previous accepted dimension.
- If this role is introduction, open the section naturally before narrowing into the target dimension.
- If this role is conclusion, close the section cleanly and synthesize the section-level takeaway without adding new major claims.
- If there is a next dimension, leave a natural bridge toward "${nextDimensionLabel || 'the next required dimension'}".
- Use [CITE:key] placeholders exactly.
- If this dimension has REQUIRED CITATION KEYS, include each at least once.
- Keep output focused on this dimension only.
- Use the same terminology and concepts established by previous sections (see PREVIOUS SECTIONS MEMORY).
${targetRule}
${minRule}
${lengthRule}

Return ONLY JSON:
{
  "dimensionKey": "${params.targetDimension.dimensionKey}",
  "dimensionLabel": "${params.targetDimension.dimensionLabel}",
  "content": "markdown content for this dimension"
}`;

  const generated = await executeDraftSectionPrompt({
    sessionId: params.sessionId,
    sectionKey: params.sectionKey,
    prompt,
    headers: params.headers,
    tenantContext: params.tenantContext,
    purpose: 'paper_dimension_generation',
    temperature: params.temperature
  });

  const extractedContent = extractDimensionContentFromOutput(generated.output);
  if (!extractedContent.trim()) {
    throw new DraftingRequestError(
      'Dimension generation returned empty content',
      422,
      { error: 'Dimension generation returned empty content' }
    );
  }
  const trimmed = budget.maxWords !== undefined
    ? truncateContentToWordLimit(extractedContent, budget.maxWords)
    : null;
  const content = trimmed ? trimmed.content : extractedContent;
  if (!content.trim()) {
    throw new DraftingRequestError(
      'Dimension generation exceeded budget and was fully trimmed',
      422,
      { error: 'Dimension generation exceeded budget and was fully trimmed' }
    );
  }

  const evaluation = evaluateDimensionCitationValidation({
    content,
    bundle: params.bundle,
    requiredCitationKeys: params.targetDimension.mustUseCitationKeys
  });

  return {
    proposal: {
      dimensionKey: params.targetDimension.dimensionKey,
      content: evaluation.polishedContent,
      contextHash: buildAcceptedContextHash(params.flow.acceptedBlocks),
      citationValidation: evaluation.citationValidation,
      createdAt: new Date().toISOString(),
      reviewTrace: {
        pass1Fingerprint: pass1Source?.contentFingerprint || '',
        pass1WordCount: pass1Source?.wordCount || computeWordCount(pass1Content),
        role: budget.role,
        bridgeHint: params.targetDimension.bridgeHint || '',
        requiredCitationKeys: resolveRequiredCitationKeys(params.targetDimension.mustUseCitationKeys, canonicalLookup),
        previousDimensionLabel,
        nextDimensionLabel,
        acceptedBlockCount: params.flow.acceptedBlocks.length,
        acceptedContextHash: buildAcceptedContextHash(params.flow.acceptedBlocks),
        acceptedSummary,
        acceptedContextPreview: priorContext,
        pass1DimensionSummary: targetPass1Brief?.sourceSummary || '',
        targetEvidenceSummary
      }
    },
    citationKeys: evaluation.citationKeys,
    outputTokens: generated.outputTokens
  };
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
    const tenantContext = await resolveTenantContext(request, user.id, session.tenantId);

    const body = await request.json();
    const actionData = actionSchema.parse(body);

    const paperTypeCode = session.paperType?.code
      || process.env.DEFAULT_PAPER_TYPE
      || 'JOURNAL_ARTICLE';
    const requestHeaders = Object.fromEntries(request.headers.entries());

    switch (actionData.action) {
      case 'generate_section':
      case 'regenerate_section': {
        const payload = generateSchema.parse(body);
        const wantsStream = Boolean(body.stream);

        if (!wantsStream) {
          const generated = await generateSection(
            {
              sessionId,
              session,
              user,
              paperTypeCode,
              payload,
              requestHeaders,
              tenantContext,
            }
          );
          return NextResponse.json(generated);
        }

        return createSSEStreamResponse(async (send) => {
          const sectionKey = payload.sectionKey;
          const sendStatus: GenerationStatusEmitter = async (phase, message) => {
            send('status', {
              sectionKey,
              phase,
              message,
              at: new Date().toISOString()
            });
          };

          await sendStatus('thinking', 'Analyzing mapped evidence and section guidance');
          const generated = await generateSection(
            {
              sessionId,
              session,
              user,
              paperTypeCode,
              payload,
              requestHeaders,
              tenantContext,
            },
            sendStatus
          );

          await sendStatus('compose', 'Composing final draft for live output');
          await sleep(900);

          const chunks = splitForStreaming(generated.content, 140);
          let assembled = '';
          for (let index = 0; index < chunks.length; index++) {
            const delta = chunks[index];
            assembled += delta;
            send('chunk', {
              sectionKey,
              index: index + 1,
              total: chunks.length,
              delta,
              content: assembled
            });

            const shouldPause = index > 0 && index < chunks.length - 1 && index % 6 === 0;
            if (shouldPause) {
              send('pause', { sectionKey, ms: 900 });
              await sleep(900);
            } else {
              await sleep(120);
            }
          }

          send('result', generated);
        });
      }

      case 'start_dimension_flow': {
        const payload = startDimensionFlowSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        if (isSinglePassSection(sectionKey)) {
          return NextResponse.json(
            {
              sectionKey,
              ...buildSinglePassSectionError(sectionKey)
            },
            { status: 422 }
          );
        }
        const bundle = await buildSectionPromptRuntimeBundle({
          sessionId,
          session,
          paperTypeCode,
          sectionKey,
          instructions: payload.instructions,
          useMappedEvidence: payload.useMappedEvidence
        });
        let sectionRecord = await getOrCreateDimensionSectionRecord(sessionId, sectionKey);
        let storedPass1 = readStoredPass1Data(sectionRecord);
        let pass1Content = storedPass1.content;
        let pass1Memory = storedPass1.memory;
        let reusedPass1 = Boolean(pass1Content);
        if (!pass1Content) {
          const generatedPass1 = await executeDraftSectionPrompt({
            sessionId,
            sectionKey,
            prompt: bundle.pass1Prompt,
            headers: requestHeaders,
            tenantContext,
            purpose: 'paper_section_pass1_dimension_flow',
            temperature: payload.temperature,
            stageCode: 'PAPER_SECTION_DRAFT'
          });
          const parsedPass1 = extractSectionOutput(generatedPass1.output);
          pass1Content = String(parsedPass1.content || '').trim();
          if (!pass1Content) {
            throw new DraftingRequestError(
              'Pass 1 generation returned empty content',
              422,
              { error: 'Pass 1 generation returned empty content' }
            );
          }

          pass1Memory = parsedPass1.memory;
          reusedPass1 = false;
          const pass1CompletedAt = new Date();
          const pass1Artifact = buildPersistedPass1Artifact({
            content: pass1Content,
            memory: parsedPass1.memory,
            generatedAt: pass1CompletedAt,
            promptUsed: bundle.pass1Prompt,
            tokensUsed: generatedPass1.outputTokens
          });
          sectionRecord = await prisma.paperSection.update({
            where: { id: sectionRecord.id },
            data: {
              displayName: sectionRecord.displayName || formatSectionLabel(sectionKey),
              baseContentInternal: pass1Content,
              baseMemory: parsedPass1.memory as any,
              pass1Artifact: pass1Artifact as any,
              memory: parsedPass1.memory as any,
              pass1PromptUsed: bundle.pass1Prompt,
              pass1LlmResponse: generatedPass1.output,
              pass1TokensUsed: generatedPass1.outputTokens,
              pass1CompletedAt,
              status: 'BASE_READY',
              isStale: false,
              generatedAt: pass1CompletedAt,
              version: { increment: 1 }
            }
          });
          storedPass1 = readStoredPass1Data(sectionRecord);
          pass1Content = storedPass1.content;
          pass1Memory = storedPass1.memory;
        }

        const pass1Source = buildPass1SourceTrace({
          content: pass1Content,
          memory: pass1Memory,
          generatedAt: storedPass1.generatedAt,
          reused: reusedPass1
        });

        // Dimension plan is built deterministically from the frozen blueprint
        // mustCover dimensions — no LLM call needed.  These are the same
        // dimensions used for paper relevance mapping, citation mapping, and
        // evidence card mapping.
        const plan = buildBlueprintDimensionPlan(bundle);
        if (!plan || plan.length === 0) {
          return NextResponse.json(
            {
              error: 'No blueprint dimensions found for this section',
              hint: 'Ensure the blueprint has mustCover dimensions defined for this section before starting dimension flow.',
              sectionKey
            },
            { status: 422 }
          );
        }

        const nowIso = new Date().toISOString();

        const flow: DimensionFlowState = {
          version: DIMENSION_FLOW_VERSION,
          sectionKey,
          createdAt: nowIso,
          updatedAt: nowIso,
          sectionWordBudget: bundle.sectionWordBudget,
          plan,
          acceptedBlocks: [],
          pass1Source,
          bufferedProposals: {},
          lastAcceptedContextHash: ''
        };

        await persistDimensionFlowState({
          sectionId: sectionRecord.id,
          existingValidationReport: sectionRecord.validationReport,
          flow,
          stitchedContent: ''
        });

        return NextResponse.json({
          sectionKey,
          plannerUsedFallback: false,
          plannerTokensUsed: 0,
          ...buildDimensionFlowResponse(flow)
        });
      }

      case 'generate_dimension': {
        const payload = generateDimensionSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        if (isSinglePassSection(sectionKey)) {
          return NextResponse.json(
            {
              sectionKey,
              ...buildSinglePassSectionError(sectionKey)
            },
            { status: 422 }
          );
        }
        const sectionRecord = await getOrCreateDimensionSectionRecord(sessionId, sectionKey);
        const flow = parseDimensionFlowState(sectionRecord.dimensionFlowState ?? sectionRecord.validationReport);
        if (!flow) {
          return NextResponse.json(
            {
              error: 'Dimension flow not initialized for this section',
              hint: 'Call start_dimension_flow first.'
            },
            { status: 409 }
          );
        }

        const storedPass1 = readStoredPass1Data(sectionRecord);
        if (!flow.pass1Source && storedPass1.content) {
          flow.pass1Source = buildPass1SourceTrace({
            content: storedPass1.content,
            memory: storedPass1.memory,
            generatedAt: storedPass1.generatedAt,
            reused: true
          });
        }

        const bundle = await buildSectionPromptRuntimeBundle({
          sessionId,
          session,
          paperTypeCode,
          sectionKey,
          useMappedEvidence: payload.useMappedEvidence
        });

        const resolvedFlowBudget = normalizePositiveWordBudget(flow.sectionWordBudget)
          || normalizePositiveWordBudget(bundle.sectionWordBudget);
        if (resolvedFlowBudget) {
          flow.sectionWordBudget = resolvedFlowBudget;
          flow.plan = applyDimensionPlanMetadata(flow.plan, resolvedFlowBudget);
        }

        const requestedDimensionKey = payload.dimensionKey
          ? normalizeDimensionKey(payload.dimensionKey)
          : '';

        const acceptedContextHash = buildAcceptedContextHash(flow.acceptedBlocks);
        let targetDimension = requestedDimensionKey
          ? flow.plan.find((entry) => normalizeDimensionKey(entry.dimensionKey) === requestedDimensionKey) || null
          : null;
        if (!targetDimension) {
          const pendingKey = normalizeDimensionKey(flow.pendingProposal?.dimensionKey || '');
          if (pendingKey) {
            targetDimension = flow.plan.find((entry) => normalizeDimensionKey(entry.dimensionKey) === pendingKey) || null;
          }
        }
        if (!targetDimension) {
          targetDimension = findNextDimensionPlanEntry(flow);
        }
        if (!targetDimension) {
          return NextResponse.json({
            sectionKey,
            message: 'All dimensions are already accepted.',
            ...buildDimensionFlowResponse(flow)
          });
        }

        const targetKey = normalizeDimensionKey(targetDimension.dimensionKey);
        const cachedPending = flow.pendingProposal
          && normalizeDimensionKey(flow.pendingProposal.dimensionKey) === targetKey
          && flow.pendingProposal.contextHash === acceptedContextHash
          && !payload.feedback
          && !payload.forceRegenerate
          ? flow.pendingProposal
          : null;
        if (cachedPending) {
          return NextResponse.json({
            sectionKey,
            dimension: targetDimension,
            proposal: cachedPending,
            cached: true,
            ...buildDimensionFlowResponse(flow)
          });
        }

        const buffered = flow.bufferedProposals?.[targetKey];
        if (
          buffered
          && buffered.contextHash === acceptedContextHash
          && !payload.feedback
          && !payload.forceRegenerate
        ) {
          flow.pendingProposal = buffered;
          if (flow.bufferedProposals) {
            delete flow.bufferedProposals[targetKey];
          }
          flow.updatedAt = new Date().toISOString();
          await persistDimensionFlowState({
            sectionId: sectionRecord.id,
            existingValidationReport: sectionRecord.validationReport,
            flow
          });
          return NextResponse.json({
            sectionKey,
            dimension: targetDimension,
            proposal: buffered,
            cached: true,
            ...buildDimensionFlowResponse(flow)
          });
        }

        const generated = await generateDimensionProposal({
          sessionId,
          sectionKey,
          bundle,
          flow,
          targetDimension,
          pass1Content: storedPass1.content,
          pass1Memory: storedPass1.memory,
          headers: requestHeaders,
          tenantContext,
          feedback: payload.feedback,
          temperature: payload.temperature
        });

        flow.pendingProposal = generated.proposal;
        if (flow.bufferedProposals) {
          delete flow.bufferedProposals[targetKey];
        }
        flow.updatedAt = new Date().toISOString();

        await persistDimensionFlowState({
          sectionId: sectionRecord.id,
          existingValidationReport: sectionRecord.validationReport,
          flow
        });

        return NextResponse.json({
          sectionKey,
          dimension: targetDimension,
          proposal: generated.proposal,
          citationKeys: generated.citationKeys,
          tokensUsed: generated.outputTokens,
          ...buildDimensionFlowResponse(flow)
        });
      }

      case 'accept_dimension': {
        const payload = acceptDimensionSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        if (isSinglePassSection(sectionKey)) {
          return NextResponse.json(
            {
              sectionKey,
              ...buildSinglePassSectionError(sectionKey)
            },
            { status: 422 }
          );
        }
        const dimensionKey = normalizeDimensionKey(payload.dimensionKey);
        const sectionRecord = await getOrCreateDimensionSectionRecord(sessionId, sectionKey);
        const flow = parseDimensionFlowState(sectionRecord.dimensionFlowState ?? sectionRecord.validationReport);
        if (!flow) {
          return NextResponse.json(
            {
              error: 'Dimension flow not initialized for this section',
              hint: 'Call start_dimension_flow first.'
            },
            { status: 409 }
          );
        }

        const targetDimension = flow.plan.find(
          (entry) => normalizeDimensionKey(entry.dimensionKey) === dimensionKey
        );
        if (!targetDimension) {
          return NextResponse.json(
            { error: 'Dimension not found in this section plan' },
            { status: 404 }
          );
        }

        const pendingForDimension = flow.pendingProposal
          && normalizeDimensionKey(flow.pendingProposal.dimensionKey) === dimensionKey
          ? flow.pendingProposal
          : undefined;
        const bufferedForDimension = flow.bufferedProposals?.[dimensionKey];
        const candidateContent = payload.content
          || pendingForDimension?.content
          || bufferedForDimension?.content
          || '';
        if (!candidateContent.trim()) {
          return NextResponse.json(
            {
              error: 'No generated content found for this dimension',
              hint: 'Call generate_dimension first or provide content.'
            },
            { status: 400 }
          );
        }

        const bundle = await buildSectionPromptRuntimeBundle({
          sessionId,
          session,
          paperTypeCode,
          sectionKey,
          useMappedEvidence: payload.useMappedEvidence
        });
        const resolvedFlowBudget = normalizePositiveWordBudget(flow.sectionWordBudget)
          || normalizePositiveWordBudget(bundle.sectionWordBudget);
        if (resolvedFlowBudget) {
          flow.sectionWordBudget = resolvedFlowBudget;
          flow.plan = applyDimensionPlanMetadata(flow.plan, resolvedFlowBudget);
        }

        const dimensionBudget = resolveDimensionDraftBudget(flow, targetDimension.dimensionKey);
        if (dimensionBudget.maxWords !== undefined && dimensionBudget.maxWords <= 0) {
          return NextResponse.json(
            {
              error: 'Section word budget is exhausted before this dimension',
              sectionKey,
              dimensionKey,
              budget: {
                sectionWordBudget: dimensionBudget.sectionWordBudget,
                usedWords: dimensionBudget.usedWordsExcludingTarget,
                remainingWords: dimensionBudget.remainingWordsForTarget || 0
              },
              hint: 'Shorten previously accepted dimensions or raise the section word budget.'
            },
            { status: 422 }
          );
        }

        const trimmedCandidate = dimensionBudget.maxWords !== undefined
          ? truncateContentToWordLimit(candidateContent, dimensionBudget.maxWords)
          : null;
        const candidateTrimmedToBudget = Boolean(trimmedCandidate?.trimmed);
        const candidateForEvaluation = trimmedCandidate ? trimmedCandidate.content : candidateContent;
        if (!candidateForEvaluation.trim()) {
          return NextResponse.json(
            {
              error: 'No content remains after applying section word budget',
              sectionKey,
              dimensionKey,
              budget: {
                sectionWordBudget: dimensionBudget.sectionWordBudget,
                maxWords: dimensionBudget.maxWords || 0
              }
            },
            { status: 422 }
          );
        }
        const evaluation = evaluateDimensionCitationValidation({
          content: candidateForEvaluation,
          bundle,
          requiredCitationKeys: targetDimension.mustUseCitationKeys
        });

        const hasStrictDisallowed = bundle.useMappedEvidence && evaluation.citationValidation.disallowedKeys.length > 0;
        const hasStrictUnknown = bundle.useMappedEvidence && evaluation.citationValidation.unknownKeys.length > 0;
        const hasMissingRequired = evaluation.citationValidation.missingRequiredKeys.length > 0;
        const hasCitationValidationIssues = hasStrictDisallowed || hasStrictUnknown || hasMissingRequired;
        const allowCitationBypass = payload.allowCitationBypass === true;
        if (hasCitationValidationIssues && !allowCitationBypass) {
          return NextResponse.json(
            {
              error: 'Dimension content failed citation validation',
              citationValidation: evaluation.citationValidation
            },
            { status: 422 }
          );
        }
        if (hasCitationValidationIssues && allowCitationBypass) {
          console.warn('[PaperDrafting] Accepting dimension with citation validation bypass', {
            sectionKey,
            dimensionKey,
            disallowed: evaluation.citationValidation.disallowedKeys,
            unknown: evaluation.citationValidation.unknownKeys,
            missingRequired: evaluation.citationValidation.missingRequiredKeys
          });
        }

        const existingBlock = flow.acceptedBlocks.find(
          (block) => normalizeDimensionKey(block.dimensionKey) === dimensionKey
        );
        const nowIso = new Date().toISOString();
        const acceptedBlock: DimensionAcceptedBlock = {
          dimensionKey: targetDimension.dimensionKey,
          dimensionLabel: targetDimension.dimensionLabel,
          content: evaluation.polishedContent,
          citationKeys: evaluation.citationKeys,
          source: payload.content ? 'user' : 'llm',
          version: (existingBlock?.version || 0) + 1,
          updatedAt: nowIso
        };

        flow.acceptedBlocks = [
          ...flow.acceptedBlocks.filter(
            (block) => normalizeDimensionKey(block.dimensionKey) !== dimensionKey
          ),
          acceptedBlock
        ];
        if (
          flow.pendingProposal
          && normalizeDimensionKey(flow.pendingProposal.dimensionKey) === dimensionKey
        ) {
          flow.pendingProposal = undefined;
        }
        if (flow.bufferedProposals) {
          delete flow.bufferedProposals[dimensionKey];
        }
        flow.lastAcceptedContextHash = buildAcceptedContextHash(flow.acceptedBlocks);
        flow.updatedAt = nowIso;

        const stitched = stitchAcceptedBlocks(flow);
        const flowCompleted = !findNextDimensionPlanEntry(flow);
        let sectionContentForPersist = stitched.stitchedContent;
        let polishSummary: {
          attempted: boolean;
          applied: boolean;
          error?: string;
          trimmedToBudget?: {
            maxWords: number;
            originalWords: number;
            finalWords: number;
          };
        } | null = null;
        let polishMetadata: { promptUsed?: string; tokensUsed?: number; completedAt: Date } | null = null;

        if (flowCompleted && sectionContentForPersist.trim()) {
          polishSummary = { attempted: true, applied: false };
          const acceptDimCitations = (bundle.evidencePromptContext.dimensionEvidence || []).map(dim => ({
            dimensionKey: normalizeDimensionKey(dim.dimension),
            dimensionLabel: dim.dimension,
            expectedCitationKeys: (dim.citations || []).map(c => String(c.citationKey || '').trim()).filter(Boolean),
          }));
          const polishResult = await sectionPolishService.polishWithRetry({
            sectionKey,
            displayName: sectionRecord.displayName || formatSectionLabel(sectionKey),
            baseContent: sectionContentForPersist,
            sessionId,
            paperTypeCode,
            tenantContext: tenantContext || null,
            dimensionCitations: acceptDimCitations.length > 0 ? acceptDimCitations : undefined,
          });

          if (polishResult.success && polishResult.polishedContent) {
            sectionContentForPersist = polishResult.polishedContent;
            polishSummary.applied = true;
            polishMetadata = {
              promptUsed: polishResult.promptUsed,
              tokensUsed: polishResult.tokensUsed ?? undefined,
              completedAt: new Date()
            };
          } else {
            polishSummary.error = polishResult.error || 'Final section polish failed';
            console.warn('[PaperDrafting] Final stitched section polish failed; using unpolished stitched content', {
              sectionKey,
              error: polishSummary.error
            });
          }
          if (polishResult.driftReport?.dimensionCoverage && !polishResult.driftReport.dimensionCoverage.passed) {
            (polishSummary as any).dimensionCoverage = polishResult.driftReport.dimensionCoverage;
          }
        }

        const finalSectionBudget = normalizePositiveWordBudget(flow.sectionWordBudget);
        const finalSectionTrim = finalSectionBudget !== undefined
          ? truncateContentToWordLimit(sectionContentForPersist, finalSectionBudget)
          : null;
        if (finalSectionTrim?.trimmed) {
          sectionContentForPersist = finalSectionTrim.content;
          if (!polishSummary) {
            polishSummary = { attempted: false, applied: false };
          }
          polishSummary.trimmedToBudget = {
            maxWords: finalSectionBudget!,
            originalWords: finalSectionTrim.originalWords,
            finalWords: finalSectionTrim.finalWords
          };
        }

        let persistedSection = await persistDimensionFlowState({
          sectionId: sectionRecord.id,
          existingValidationReport: sectionRecord.validationReport,
          flow,
          stitchedContent: sectionContentForPersist
        });

        if (polishMetadata) {
          persistedSection = await prisma.paperSection.update({
            where: { id: sectionRecord.id },
            data: {
              pass2PromptUsed: polishMetadata.promptUsed,
              pass2TokensUsed: polishMetadata.tokensUsed,
              pass2CompletedAt: polishMetadata.completedAt,
              status: 'DRAFT',
              version: { increment: 1 }
            }
          });
        }

        const researchTopic = await prisma.researchTopic.findUnique({
          where: { sessionId }
        });
        const draft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');
        const updatedDraft = await updateDraftContent(
          draft.id,
          sectionKey,
          sectionContentForPersist,
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

        const usageSync = await syncSectionDraftCitationUsage({
          sessionId,
          sectionKey,
          sectionContent: sectionContentForPersist,
          citations: bundle.citations
        });

        let prefetchedProposal: DimensionDraftProposal | null = null;
        if (payload.prefetchNext) {
          const nextDimension = findNextDimensionPlanEntry(flow);
          if (nextDimension) {
            const storedPass1 = readStoredPass1Data(sectionRecord);
            const prefetched = await generateDimensionProposal({
              sessionId,
              sectionKey,
              bundle,
              flow,
              targetDimension: nextDimension,
              pass1Content: storedPass1.content,
              pass1Memory: storedPass1.memory,
              headers: requestHeaders,
              tenantContext,
              temperature: 0.2
            });
            if (!flow.bufferedProposals) flow.bufferedProposals = {};
            flow.bufferedProposals[normalizeDimensionKey(nextDimension.dimensionKey)] = prefetched.proposal;
            flow.updatedAt = new Date().toISOString();
            persistedSection = await persistDimensionFlowState({
              sectionId: sectionRecord.id,
              existingValidationReport: persistedSection.validationReport,
              flow,
              stitchedContent: sectionContentForPersist
            });
            prefetchedProposal = prefetched.proposal;
          }
        }

        const flowResponse = buildDimensionFlowResponse(flow);
        return NextResponse.json({
          sectionKey,
          acceptedBlock,
          citationsUsed: usageSync.citationKeys,
          prefetchedProposal,
          citationBypassApplied: hasCitationValidationIssues && allowCitationBypass,
          citationValidation: evaluation.citationValidation,
          ...flowResponse,
          stitchedContent: sectionContentForPersist,
          lengthControl: {
            candidateTrimmedToBudget,
            ...(trimmedCandidate?.trimmed
              ? {
                candidateWordCountBeforeTrim: trimmedCandidate.originalWords,
                candidateWordCountAfterTrim: trimmedCandidate.finalWords,
                candidateMaxWords: dimensionBudget.maxWords
              }
              : {}),
            ...(finalSectionTrim?.trimmed
              ? {
                sectionTrimmedToBudget: true,
                sectionWordCountBeforeTrim: finalSectionTrim.originalWords,
                sectionWordCountAfterTrim: finalSectionTrim.finalWords,
                sectionMaxWords: finalSectionBudget
              }
              : {})
          },
          ...(polishSummary ? { polish: polishSummary } : {}),
          ...(polishSummary?.attempted && !polishSummary?.applied
            ? { polishFailed: true }
            : {})
        });
      }

      case 'reject_dimension': {
        const payload = rejectDimensionSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        if (isSinglePassSection(sectionKey)) {
          return NextResponse.json(
            {
              sectionKey,
              ...buildSinglePassSectionError(sectionKey)
            },
            { status: 422 }
          );
        }
        const dimensionKey = normalizeDimensionKey(payload.dimensionKey);
        const sectionRecord = await getOrCreateDimensionSectionRecord(sessionId, sectionKey);
        const flow = parseDimensionFlowState(sectionRecord.dimensionFlowState ?? sectionRecord.validationReport);
        if (!flow) {
          return NextResponse.json(
            {
              error: 'Dimension flow not initialized for this section',
              hint: 'Call start_dimension_flow first.'
            },
            { status: 409 }
          );
        }

        const targetDimension = flow.plan.find(
          (entry) => normalizeDimensionKey(entry.dimensionKey) === dimensionKey
        );
        if (!targetDimension) {
          return NextResponse.json(
            { error: 'Dimension not found in this section plan' },
            { status: 404 }
          );
        }

        const bundle = await buildSectionPromptRuntimeBundle({
          sessionId,
          session,
          paperTypeCode,
          sectionKey,
          useMappedEvidence: payload.useMappedEvidence
        });
        const resolvedFlowBudget = normalizePositiveWordBudget(flow.sectionWordBudget)
          || normalizePositiveWordBudget(bundle.sectionWordBudget);
        if (resolvedFlowBudget) {
          flow.sectionWordBudget = resolvedFlowBudget;
          flow.plan = applyDimensionPlanMetadata(flow.plan, resolvedFlowBudget);
        }
        const storedPass1 = readStoredPass1Data(sectionRecord);
        const rewritten = await generateDimensionProposal({
          sessionId,
          sectionKey,
          bundle,
          flow,
          targetDimension,
          pass1Content: storedPass1.content,
          pass1Memory: storedPass1.memory,
          headers: requestHeaders,
          tenantContext,
          feedback: payload.feedback,
          temperature: payload.temperature
        });

        flow.pendingProposal = rewritten.proposal;
        if (flow.bufferedProposals) {
          delete flow.bufferedProposals[dimensionKey];
        }
        flow.updatedAt = new Date().toISOString();

        await persistDimensionFlowState({
          sectionId: sectionRecord.id,
          existingValidationReport: sectionRecord.validationReport,
          flow
        });

        return NextResponse.json({
          sectionKey,
          dimension: targetDimension,
          proposal: rewritten.proposal,
          citationKeys: rewritten.citationKeys,
          tokensUsed: rewritten.outputTokens,
          ...buildDimensionFlowResponse(flow)
        });
      }

      case 'get_dimension_flow': {
        const payload = getDimensionFlowSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        if (isSinglePassSection(sectionKey)) {
          return NextResponse.json({
            sectionKey,
            started: false,
            flow: null,
            stitchedContent: '',
            ...buildSinglePassSectionError(sectionKey)
          });
        }
        const sectionRecord = await prisma.paperSection.findUnique({
          where: {
            sessionId_sectionKey: {
              sessionId,
              sectionKey
            }
          }
        });

        if (!sectionRecord) {
          return NextResponse.json({
            sectionKey,
            started: false,
            flow: null,
            stitchedContent: ''
          });
        }

        const flow = parseDimensionFlowState(sectionRecord.dimensionFlowState ?? sectionRecord.validationReport);
        if (!flow) {
          return NextResponse.json({
            sectionKey,
            started: false,
            flow: null,
            stitchedContent: sectionRecord.content || ''
          });
        }

        const storedPass1 = readStoredPass1Data(sectionRecord);
        if (!flow.pass1Source && storedPass1.content) {
          flow.pass1Source = buildPass1SourceTrace({
            content: storedPass1.content,
            memory: storedPass1.memory,
            generatedAt: storedPass1.generatedAt,
            reused: true
          });
        }

        return NextResponse.json({
          sectionKey,
          started: true,
          ...buildDimensionFlowResponse(
            flow,
            typeof sectionRecord.content === 'string' ? sectionRecord.content : undefined
          )
        });
      }

      case 'save_section': {
        const payload = saveSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        const content = polishDraftMarkdown(payload.content || '');
        const citations = await citationService.getCitationsForSession(sessionId);
        const knownSessionKeys = new Set(citations.map(c => c.citationKey));

        const sectionContextPolicy = await sectionTemplateService.getSectionContextPolicy(sectionKey, paperTypeCode);
        if (sectionContextPolicy.requiresCitations) {
          const citationContext = await DraftingService.buildCitationContext(sessionId, sectionKey, {
            useMappedEvidence: true
          });
          const validation = DraftingService.validateCitationKeys(
            content,
            citationContext.allowedCitationKeys,
            knownSessionKeys
          );
          const canonicalLookup = buildCanonicalCitationLookup(citations);
          const unknownKeys = Array.from(new Set(
            DraftingService.extractCitationKeys(content, knownSessionKeys)
              .map(key => String(key || '').trim())
              .filter(key => key.length > 0 && !resolveCitationKeyFromLookup(key, canonicalLookup))
          ));

          if (validation.disallowedKeys.length > 0 || unknownKeys.length > 0) {
            return NextResponse.json(
              {
                error: 'Section contains invalid citation keys',
                citationValidation: {
                  allowedCitationKeys: citationContext.allowedCitationKeys,
                  disallowedKeys: validation.disallowedKeys,
                  unknownKeys
                }
              },
              { status: 422 }
            );
          }
        }

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

        const usageSync = await syncSectionDraftCitationUsage({
          sessionId,
          sectionKey,
          sectionContent: content,
          citations
        });

        return NextResponse.json({
          sectionKey,
          content,
          saved: true,
          citationsUsed: usageSync.citationKeys
        });
      }

      case 'insert_citation': {
        const payload = insertCitationSchema.parse(body);
        const sectionKey = payload.sectionKey
          ? normalizeSectionKey(payload.sectionKey)
          : undefined;
        const citations = await citationService.getCitationsForSession(sessionId);
        const citationMap = new Map(citations.map(c => [c.citationKey, c]));

        if (sectionKey) {
          const citationContext = await DraftingService.buildCitationContext(sessionId, sectionKey);
          if (citationContext.allowedCitationKeys.length > 0) {
            const allowedSet = new Set(citationContext.allowedCitationKeys);
            const disallowed = payload.citationKeys.filter(key => !allowedSet.has(key));
            if (disallowed.length > 0) {
              return NextResponse.json({
                error: 'One or more citations are not allowed for this section',
                citationValidation: {
                  allowedCitationKeys: citationContext.allowedCitationKeys,
                  disallowedKeys: disallowed
                }
              }, { status: 422 });
            }
          }
        }

        const placeholders = payload.citationKeys.map(key => {
          const citation = citationMap.get(key);
          const canonicalKey = citation?.citationKey || key;
          return `[CITE:${canonicalKey}]`;
        });

        const insertText = placeholders.join(' ');
        const position = payload.position ?? payload.content.length;
        const updatedRaw = payload.content.slice(0, position) + insertText + payload.content.slice(position);
        const updated = polishDraftMarkdown(updatedRaw);

        await Promise.all(payload.citationKeys.map(async key => {
          const citation = citationMap.get(key);
          if (!citation || !sectionKey) return;
          const attribution = await resolveCitationAttribution(citation.id, sectionKey);
          await citationService.markCitationUsed(
            citation.id,
            sectionKey,
            updated.slice(0, 200),
            undefined,
            {
              usageKind: 'DRAFT_CITATION',
              dimension: attribution.dimension
            }
          );
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
        const canonicalLookup = buildCanonicalCitationLookup(citations);
        const found = keys
          .map((key) => resolveCitationKeyFromLookup(key, canonicalLookup))
          .filter((key): key is string => Boolean(key));
        const missing = keys.filter((key) => !resolveCitationKeyFromLookup(key, canonicalLookup));

        return NextResponse.json({
          total: keys.length,
          found,
          missing
        });
      }

      case 'get_humanization_data': {
        const draft = await getPaperDraft(sessionId);
        const data = await buildHumanizationData({
          sessionId,
          paperTypeCode,
          draft
        });

        return NextResponse.json(data);
      }

      case 'humanize_section': {
        const payload = humanizeSectionSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        const draft = await getPaperDraft(sessionId);
        if (!draft) {
          return NextResponse.json(
            { error: 'No paper draft found. Draft at least one section first.' },
            { status: 404 }
          );
        }

        const extraSections = normalizeExtraSections(draft.extraSections);
        const draftContent = extraSections[sectionKey] || '';
        if (!draftContent.trim()) {
          return NextResponse.json(
            { error: 'Draft content is empty for this section.' },
            { status: 400 }
          );
        }

        const draftFingerprint = computeContentFingerprint(draftContent);
        if (
          payload.sourceDraftFingerprint
          && payload.sourceDraftFingerprint !== draftFingerprint
        ) {
          return NextResponse.json(
            {
              error: 'Draft changed before humanization. Refresh and retry.',
              code: 'DRAFT_CHANGED',
              latestDraftFingerprint: draftFingerprint
            },
            { status: 409 }
          );
        }

        const now = new Date();
        const existingRecord = await prisma.paperSectionHumanization.findUnique({
          where: {
            sessionId_sectionKey: {
              sessionId,
              sectionKey
            }
          }
        });

        if (existingRecord) {
          await prisma.paperSectionHumanization.update({
            where: {
              sessionId_sectionKey: {
                sessionId,
                sectionKey
              }
            },
            data: {
              draftId: draft.id,
              status: 'PROCESSING',
              errorMessage: null,
              sourceDraftFingerprint: draftFingerprint,
              sourceDraftWordCount: computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt
            }
          });
        } else {
          await prisma.paperSectionHumanization.create({
            data: {
              sessionId,
              draftId: draft.id,
              sectionKey,
              status: 'PROCESSING',
              sourceDraftFingerprint: draftFingerprint,
              sourceDraftWordCount: computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt
            }
          });
        }

        try {
          const result = await callHumanizerService({
            sessionId,
            sectionKey,
            draftContent,
            styleCode: session?.citationStyle?.code || undefined,
            options: payload.options
          });

          const updatedRecord = await prisma.paperSectionHumanization.update({
            where: {
              sessionId_sectionKey: {
                sessionId,
                sectionKey
              }
            },
            data: {
              draftId: draft.id,
              status: 'COMPLETED',
              provider: result.provider,
              humanizedContent: result.content,
              errorMessage: null,
              sourceDraftFingerprint: draftFingerprint,
              sourceDraftWordCount: computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt,
              humanizedWordCount: computeWordCount(result.content),
              humanizedAt: now,
              citationValidationAt: null,
              ...(existingRecord
                ? { version: { increment: 1 as const } }
                : {})
            }
          });

          await prisma.paperSectionCitationValidation.deleteMany({
            where: {
              humanizationId: updatedRecord.id
            }
          });

          const refreshedDraft = await getPaperDraft(sessionId);
          const data = await buildHumanizationData({
            sessionId,
            paperTypeCode,
            draft: refreshedDraft
          });

          return NextResponse.json({
            section: data.sections.find((section) => section.sectionKey === sectionKey) || null,
            summary: data.summary
          });
        } catch (error) {
          await prisma.paperSectionHumanization.update({
            where: {
              sessionId_sectionKey: {
                sessionId,
                sectionKey
              }
            },
            data: {
              status: 'FAILED',
              errorMessage: error instanceof Error ? error.message : 'Humanization failed'
            }
          });

          throw error;
        }
      }

      case 'save_humanized_section': {
        const payload = saveHumanizedSectionSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        const draft = await getPaperDraft(sessionId);
        if (!draft) {
          return NextResponse.json(
            { error: 'No paper draft found.' },
            { status: 404 }
          );
        }

        const extraSections = normalizeExtraSections(draft.extraSections);
        const draftContent = extraSections[sectionKey] || '';
        const polishedHumanized = polishDraftMarkdown(payload.content || '');
        const now = new Date();
        const draftFingerprint = computeContentFingerprint(draftContent);
        const existingRecord = await prisma.paperSectionHumanization.findUnique({
          where: {
            sessionId_sectionKey: {
              sessionId,
              sectionKey
            }
          }
        });

        const status: DbHumanizationStatus = polishedHumanized.trim()
          ? 'COMPLETED'
          : 'NOT_STARTED';

        if (existingRecord) {
          await prisma.paperSectionHumanization.update({
            where: {
              sessionId_sectionKey: {
                sessionId,
                sectionKey
              }
            },
            data: {
              draftId: draft.id,
              status,
              provider: polishedHumanized.trim() ? 'manual_edit' : null,
              humanizedContent: polishedHumanized,
              errorMessage: null,
              sourceDraftFingerprint: draftFingerprint,
              sourceDraftWordCount: computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt,
              humanizedWordCount: computeWordCount(polishedHumanized),
              humanizedAt: polishedHumanized.trim() ? now : null,
              citationValidationAt: null,
              version: { increment: 1 }
            }
          });
        } else {
          await prisma.paperSectionHumanization.create({
            data: {
              sessionId,
              draftId: draft.id,
              sectionKey,
              status,
              provider: 'manual_edit',
              humanizedContent: polishedHumanized,
              sourceDraftFingerprint: draftFingerprint,
              sourceDraftWordCount: computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt,
              humanizedWordCount: computeWordCount(polishedHumanized),
              humanizedAt: polishedHumanized.trim() ? now : null
            }
          });
        }

        const refreshedDraft = await getPaperDraft(sessionId);
        const data = await buildHumanizationData({
          sessionId,
          paperTypeCode,
          draft: refreshedDraft
        });

        return NextResponse.json({
          section: data.sections.find((section) => section.sectionKey === sectionKey) || null,
          summary: data.summary
        });
      }

      case 'validate_humanized_citations': {
        const payload = validateHumanizedCitationsSchema.parse(body);
        const draft = await getPaperDraft(sessionId);
        if (!draft) {
          return NextResponse.json(
            { error: 'No paper draft found.' },
            { status: 404 }
          );
        }

        const citations = await citationService.getCitationsForSession(sessionId);
        const canonicalLookup = buildCanonicalCitationLookup(citations);
        const extraSections = normalizeExtraSections(draft.extraSections);
        const existingRows = await prisma.paperSectionHumanization.findMany({
          where: { sessionId }
        });
        const rowBySection = new Map(
          existingRows.map((row) => [normalizeSectionKey(row.sectionKey), row])
        );

        const paperType = await paperTypeService.getPaperType(paperTypeCode);
        const preferredOrder = Array.isArray(paperType?.sectionOrder) ? paperType.sectionOrder : [];
        const orderedSectionKeys = mergeSectionOrder(
          preferredOrder,
          extraSections,
          Array.from(rowBySection.keys())
        );

        const targetSectionKeys = payload.validateAll
          ? orderedSectionKeys
          : payload.sectionKey
            ? [normalizeSectionKey(payload.sectionKey)]
            : orderedSectionKeys.filter((key) => {
              const row = rowBySection.get(normalizeSectionKey(key));
              return Boolean(row?.humanizedContent && row.humanizedContent.trim());
            });

        const now = new Date();
        const results: Array<{
          sectionKey: string;
          label: string;
          status: HumanizationStatus;
          citationValidation: HumanizedCitationValidation;
        }> = [];

        for (const rawSectionKey of targetSectionKeys) {
          const sectionKey = normalizeSectionKey(rawSectionKey);
          const draftContent = extraSections[sectionKey] || '';
          const draftFingerprint = computeContentFingerprint(draftContent);
          let currentRow = rowBySection.get(sectionKey);
          if (!currentRow) {
            currentRow = await prisma.paperSectionHumanization.create({
              data: {
                sessionId,
                draftId: draft.id,
                sectionKey,
                status: 'NOT_STARTED',
                sourceDraftFingerprint: draftFingerprint,
                sourceDraftWordCount: computeWordCount(draftContent),
                sourceDraftUpdatedAt: draft.updatedAt
              }
            });
            rowBySection.set(sectionKey, currentRow);
          }

          const humanizedContent = currentRow.humanizedContent || '';
          const citationValidation = buildHumanizedCitationValidation(
            draftContent,
            humanizedContent,
            canonicalLookup
          );

          await prisma.paperSectionCitationValidation.create({
            data: {
              sessionId,
              humanizationId: currentRow.id,
              sectionKey,
              humanizationVersion: currentRow.version,
              draftCitationKeys: citationValidation.draftCitationKeys,
              humanizedCitationKeys: citationValidation.humanizedCitationKeys,
              missingCitationKeys: citationValidation.missingCitationKeys,
              extraCitationKeys: citationValidation.extraCitationKeys,
              isValid: citationValidation.valid,
              checkedAt: now
            }
          });

          const dbStatus: DbHumanizationStatus = currentRow.status === 'FAILED'
            ? 'FAILED'
            : (currentRow.sourceDraftFingerprint && currentRow.sourceDraftFingerprint !== draftFingerprint)
              ? 'OUTDATED'
              : currentRow.status as DbHumanizationStatus;
          const updatedRow = await prisma.paperSectionHumanization.update({
            where: { id: currentRow.id },
            data: {
              status: dbStatus,
              citationValidationAt: now,
              sourceDraftFingerprint: currentRow.sourceDraftFingerprint || draftFingerprint,
              sourceDraftWordCount: currentRow.sourceDraftWordCount ?? computeWordCount(draftContent),
              sourceDraftUpdatedAt: draft.updatedAt
            }
          });
          rowBySection.set(sectionKey, updatedRow as any);

          const projectedRecord: HumanizedSectionRecord = {
            sectionKey,
            status: mapDbStatusToApi(updatedRow.status as DbHumanizationStatus),
            humanizedContent: updatedRow.humanizedContent || '',
            sourceDraftFingerprint: updatedRow.sourceDraftFingerprint || undefined
          };

          results.push({
            sectionKey,
            label: formatSectionLabel(sectionKey),
            status: deriveHumanizationStatus(draftContent, projectedRecord),
            citationValidation
          });
        }

        const validCount = results.filter((row) => row.citationValidation.valid).length;
        return NextResponse.json({
          validated: results.length,
          validCount,
          invalidCount: results.length - validCount,
          results
        });
      }

      case 'generate_bibliography': {
        const payload = bibliographySchema.parse(body);
        const styleCode = payload.styleCode || getStyleCode(session);
        const normalizedStyleCode = styleCode.toUpperCase();
        const citations = await citationService.getCitationsForSession(sessionId);
        const canonicalLookup = buildCanonicalCitationLookup(citations);
        const draft = await getPaperDraft(sessionId);

        let orderedCitationKeys: string[] = [];
        if (draft) {
          const sections = normalizeExtraSections(draft.extraSections);
          const synced = await syncDraftCitationUsage({
            sessionId,
            paperTypeCode,
            citations,
            extraSections: sections
          });
          orderedCitationKeys = synced.orderedCitationKeys;
        }

        const requestedKeys = payload.citationKeys
          ? payload.citationKeys
            .map(key => resolveCitationKeyFromLookup(key.trim(), canonicalLookup))
            .filter((key): key is string => Boolean(key))
          : [];

        const selectedCitationKeys = Array.from(new Set(
          requestedKeys.length > 0
            ? requestedKeys
            : orderedCitationKeys.length > 0
              ? orderedCitationKeys
              : citations.map(c => c.citationKey)
        ));

        const selectedSet = new Set(selectedCitationKeys);
        let filtered = citations.filter(c => selectedSet.has(c.citationKey));

        const styleDefinition = await citationStyleService.getCitationStyle(styleCode);
        const styleDefaultSortOrder = styleDefinition?.bibliographySortOrder === 'order_of_appearance'
          ? 'order_of_appearance'
          : 'alphabetical';

        let effectiveSortOrder = payload.sortOrder || styleDefaultSortOrder;
        if (NUMERIC_ORDER_STYLES.has(normalizedStyleCode)) {
          effectiveSortOrder = 'order_of_appearance';
        }

        if (effectiveSortOrder === 'order_of_appearance') {
          const fallbackOrder = selectedCitationKeys.length > 0
            ? selectedCitationKeys
            : citations.map(c => c.citationKey);
          const ordering = mergeCitationOrder(orderedCitationKeys, fallbackOrder);
          filtered = sortCitationsByOrderedKeys(filtered, ordering);
        }

        const rawBibliography = await citationStyleService.generateBibliography(
          filtered.map(toCitationData),
          styleCode,
          { sortOrder: effectiveSortOrder }
        );

        const bibliography = formatBibliographyMarkdown(
          rawBibliography,
          effectiveSortOrder
        );

        const orderedCitationKeysForResponse = effectiveSortOrder === 'order_of_appearance'
          ? filtered.map(citation => citation.citationKey)
          : [];
        const numbering = buildCitationNumberingMap(orderedCitationKeysForResponse);

        let sequenceTracking: {
          snapshotId: string;
          version: number;
          previousVersion: number | null;
          changed: boolean;
          changes: CitationSequenceDiff;
          historyCount: number;
        } | null = null;
        if (draft && effectiveSortOrder === 'order_of_appearance') {
          sequenceTracking = await persistCitationSequenceSnapshot({
            draftId: draft.id,
            validationReport: draft.validationReport,
            styleCode,
            sortOrder: effectiveSortOrder,
            orderedCitationKeys: orderedCitationKeysForResponse
          });
        }

        return NextResponse.json({
          bibliography,
          styleCode,
          sortOrder: effectiveSortOrder,
          usedCount: filtered.length,
          sequence: {
            orderedCitationKeys: orderedCitationKeysForResponse,
            numbering,
            snapshotId: sequenceTracking?.snapshotId || null,
            version: sequenceTracking?.version || null,
            previousVersion: sequenceTracking?.previousVersion || null,
            changed: sequenceTracking?.changed || false,
            changes: sequenceTracking?.changes || {
              added: [],
              removed: [],
              renumbered: []
            },
            historyCount: sequenceTracking?.historyCount || 0
          }
        });
      }

      case 'get_citation_sequence_history': {
        const payload = citationSequenceHistorySchema.parse(body);
        const draft = await getPaperDraft(sessionId);
        if (!draft) {
          return NextResponse.json({
            styleCode: payload.styleCode || null,
            total: 0,
            latest: null,
            history: []
          });
        }

        const styleFilter = payload.styleCode
          ? payload.styleCode.trim().toUpperCase()
          : null;
        const tracking = readCitationTrackingState(draft.validationReport);
        let history = [...tracking.sequenceHistory];
        if (styleFilter) {
          history = history.filter(snapshot => snapshot.styleCode === styleFilter);
        }

        history.sort((a, b) => {
          const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.version - a.version;
        });

        const limit = payload.limit || 20;
        const slicedHistory = history.slice(0, limit);
        const latest = styleFilter
          ? findLatestSnapshotForStyle(tracking, styleFilter)
          : (slicedHistory[0] || null);

        return NextResponse.json({
          styleCode: styleFilter,
          total: history.length,
          latest,
          history: slicedHistory
        });
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

      case 'run_ai_review': {
        const payload = aiReviewSchema.parse(body);
        const draft = payload.draft;

        // Build review prompt
        const sectionContents = Object.entries(draft)
          .filter(([_, content]) => content && content.trim())
          .map(([key, content]) => `## ${key.replace(/_/g, ' ').toUpperCase()}\n${content}`)
          .join('\n\n');

        if (!sectionContents) {
          return NextResponse.json({
            success: true,
            issues: [],
            summary: {
              totalIssues: 0,
              errors: 0,
              warnings: 0,
              suggestions: 0,
              overallScore: 100,
              recommendation: 'No content to review. Generate sections first.'
            }
          });
        }

        const reviewPrompt = `You are an academic paper reviewer. Analyze the following paper draft and identify issues.

PAPER CONTENT:
${sectionContents}

For each issue found, provide a JSON object with these fields:
- id: unique identifier (e.g., "issue-1")
- sectionKey: which section contains the issue (e.g., "introduction", "methodology")
- sectionLabel: human-readable section name
- type: "error" | "warning" | "suggestion"
- category: "consistency" | "citation" | "completeness" | "academic" | "clarity" | "structure"
- title: brief issue title
- description: detailed description of the issue
- suggestion: how to fix it
- fixPrompt: specific instruction for AI to fix this issue
- severity: 1-5 (5 being most severe)

Return a JSON object with this structure:
{
  "issues": [...],
  "summary": {
    "totalIssues": number,
    "errors": number,
    "warnings": number,
    "suggestions": number,
    "overallScore": number (0-100),
    "recommendation": "overall assessment string"
  }
}

Focus on:
1. Logical consistency between sections
2. Citation usage and coverage
3. Academic writing standards
4. Structural completeness
5. Clarity and readability

Return ONLY valid JSON, no other text.`;

        // maxTokensOut is controlled via super admin LLM config for PAPER_AI_REVIEW stage
        const llmRequest = {
          taskCode: 'LLM2_DRAFT' as const,
          stageCode: 'PAPER_AI_REVIEW',
          prompt: reviewPrompt,
          parameters: {
            temperature: 0.3,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId,
            paperId: sessionId,
            action: 'ai_review',
            module: 'publication_ideation',
            purpose: 'paper_ai_review'
          }
        };

        const headers = Object.fromEntries(request.headers.entries());
        const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

        if (!result.success || !result.response) {
          return NextResponse.json({
            success: false,
            error: result.error?.message || 'AI Review failed'
          }, { status: 500 });
        }

        try {
          const output = result.response.output || '';
          // Extract JSON from response (handle markdown code blocks)
          const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, output];
          const jsonStr = jsonMatch[1] || output;
          const parsed = JSON.parse(jsonStr.trim());

          return NextResponse.json({
            success: true,
            issues: parsed.issues || [],
            summary: parsed.summary || {
              totalIssues: (parsed.issues || []).length,
              errors: (parsed.issues || []).filter((i: any) => i.type === 'error').length,
              warnings: (parsed.issues || []).filter((i: any) => i.type === 'warning').length,
              suggestions: (parsed.issues || []).filter((i: any) => i.type === 'suggestion').length,
              overallScore: 75,
              recommendation: 'Review complete.'
            },
            reviewId: crypto.randomUUID()
          });
        } catch (parseError) {
          console.error('[PaperDrafting] Failed to parse AI review response:', parseError);
          return NextResponse.json({
            success: true,
            issues: [],
            summary: {
              totalIssues: 0,
              errors: 0,
              warnings: 0,
              suggestions: 0,
              overallScore: 80,
              recommendation: 'Unable to parse review results. Please try again.'
            },
            reviewId: crypto.randomUUID()
          });
        }
      }

      case 'apply_ai_fix': {
        const payload = aiFixSchema.parse(body);
        const { sectionKey, issue, currentContent, relatedContent } = payload;

        const fixPrompt = `You are an academic writing assistant. Fix the following issue in a paper section.

ISSUE:
Type: ${issue.type}
Category: ${issue.category}
Title: ${issue.title}
Description: ${issue.description}
Suggestion: ${issue.suggestion}
Fix Instructions: ${issue.fixPrompt}

CURRENT CONTENT OF "${sectionKey.replace(/_/g, ' ').toUpperCase()}":
${currentContent}

${relatedContent && Object.keys(relatedContent).length > 0 ? `
RELATED SECTIONS FOR CONTEXT:
${Object.entries(relatedContent).map(([k, v]) => `## ${k.replace(/_/g, ' ').toUpperCase()}\n${v}`).join('\n\n')}
` : ''}

Provide the COMPLETE revised section content that addresses the issue while preserving:
- Academic tone and style
- Existing citations and references
- Overall structure and flow

Return ONLY the revised section content in polished Markdown:
- No code fences, no JSON, no explanations.
- Preserve heading and list hierarchy.
- Preserve [CITE:key] placeholders exactly.`;

        // maxTokensOut is controlled via super admin LLM config for PAPER_AI_FIX stage
        const llmRequest = {
          taskCode: 'LLM2_DRAFT' as const,
          stageCode: 'PAPER_AI_FIX',
          prompt: fixPrompt,
          parameters: {
            temperature: 0.2,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId,
            paperId: sessionId,
            sectionKey,
            issueId: issue.id,
            action: 'ai_fix',
            module: 'publication_ideation',
            purpose: 'paper_ai_fix'
          }
        };

        const headers = Object.fromEntries(request.headers.entries());
        const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);

        if (!result.success || !result.response) {
          return NextResponse.json({
            success: false,
            error: result.error?.message || 'AI Fix failed'
          }, { status: 500 });
        }

        const fixedContent = polishDraftMarkdown((result.response.output || '').trim());

        // If preview only, return without saving
        if (payload.previewOnly) {
          return NextResponse.json({
            success: true,
            fixedContent,
            previewOnly: true
          });
        }

        // Otherwise, save the fix
        const researchTopic = await prisma.researchTopic.findUnique({
          where: { sessionId }
        });

        const existingDraft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');
        await updateDraftContent(existingDraft.id, sectionKey, fixedContent, paperTypeCode);

        return NextResponse.json({
          success: true,
          fixedContent,
          saved: true
        });
      }

      default:
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    if (error instanceof DraftingRequestError) {
      return NextResponse.json(
        error.payload || { error: error.message },
        { status: error.status }
      );
    }

    console.error('[PaperDrafting] error:', error);
    return NextResponse.json({ error: 'Failed to process drafting action' }, { status: 500 });
  }
}
