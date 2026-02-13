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
  // Persona style support (borrowed from patent drafting)
  usePersonaStyle: z.boolean().optional(),
  personaSelection: z.object({
    primaryPersonaId: z.string().optional(),
    primaryPersonaName: z.string().optional(),
    secondaryPersonaIds: z.array(z.string()).optional(),
    secondaryPersonaNames: z.array(z.string()).optional()
  }).optional()
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
  if (!rawKeys) return [];
  return rawKeys
    .split(/[;,]/)
    .map(key => key.trim())
    .filter(Boolean);
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
  const lookup = new Map<string, string>();
  for (const citation of citations) {
    const key = String(citation.citationKey || '').trim();
    if (!key) continue;
    lookup.set(key.toLowerCase(), key);
  }
  return lookup;
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
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(key);
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

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
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
      const canonical = canonicalLookup.get(rawKey.toLowerCase());
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
      const canonical = canonicalLookup.get(rawKey.toLowerCase());
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      ordered.push(canonical);
    }
  }

  return ordered;
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
}

interface EvidencePromptContext {
  useMappedEvidence: boolean;
  allowedCitationKeys: string[];
  dimensionEvidence: SectionEvidencePack['dimensionEvidence'];
  gaps: string[];
}

function formatDimensionEvidence(evidence: EvidencePromptContext['dimensionEvidence']): string {
  if (!evidence || evidence.length === 0) return '(No dimension evidence available)';

  return evidence.map(dim => {
    const citationNotes = dim.citations.length > 0
      ? dim.citations.map(c => {
          const primaryNote = c.remark || c.relevanceToResearch || c.keyFindings || c.keyContribution || c.title;
          const details = [
            c.claimTypesSupported?.length ? `claimTypes: ${c.claimTypesSupported.join(', ')}` : '',
            c.keyContribution ? `contribution: ${c.keyContribution}` : '',
            c.keyFindings ? `findings: ${c.keyFindings}` : '',
            c.methodologicalApproach ? `method: ${c.methodologicalApproach}` : '',
            c.limitationsOrGaps ? `gap: ${c.limitationsOrGaps}` : '',
            c.evidenceBoundary ? `boundary: ${c.evidenceBoundary}` : ''
          ].filter(Boolean).join(' | ');
          return details
            ? `  - [${c.citationKey}] (${c.year || 'n.d.'}, ${c.confidence}): ${primaryNote}\n    ${details}`
            : `  - [${c.citationKey}] (${c.year || 'n.d.'}, ${c.confidence}): ${primaryNote}`;
        }).join('\n')
      : '  (no citations mapped)';
    return `${dim.dimension}:\n${citationNotes}`;
  }).join('\n\n');
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
          boundary: c.evidenceBoundary
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
      if (c.claimTypesSupported?.length) {
        const merged = new Set([...(existing.claimTypes || []), ...c.claimTypesSupported]);
        existing.claimTypes = Array.from(merged);
      }
    }
  }

  return Array.from(allCitations.entries())
    .map(([key, data]) => {
      const parts = [
        data.claimTypes?.length ? `claimTypes: ${data.claimTypes.join(', ')}` : '',
        data.relevance ? `relevance: ${data.relevance}` : '',
        data.contribution ? `contribution: ${data.contribution}` : '',
        data.findings ? `findings: ${data.findings}` : '',
        data.method ? `method: ${data.method}` : '',
        data.limitations ? `gap: ${data.limitations}` : '',
        data.boundary ? `boundary: ${data.boundary}` : ''
      ].filter(Boolean);
      const base = `[${key}]: "${data.title}" - dimensions: ${Array.from(data.dimensions).join(', ')}`;
      return parts.length > 0 ? `${base}; ${parts.join(' | ')}` : base;
    })
    .join('\n');
}

async function buildPrompt(
  sectionKey: string,
  paperTypeCode: string,
  context: any,
  citationInstructions: string,
  userInstructions?: string,
  writingSampleBlock?: string,
  blueprintContext?: BlueprintPromptContext,
  evidenceContext?: EvidencePromptContext
): Promise<string> {
  let basePrompt = await sectionTemplateService.getPromptForSection(sectionKey, paperTypeCode, context);
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

  basePrompt = basePrompt.replace(/\{\{DIMENSION_EVIDENCE_NOTES\}\}/g, dimensionEvidenceNotes);
  basePrompt = basePrompt.replace(/\{\{RELEVANCE_NOTES\}\}/g, relevanceNotes);
  basePrompt = basePrompt.replace(/\{\{EVIDENCE_GAPS\}\}/g, evidenceGaps);

  // ============================================================================
  // FALLBACK: Append blocks if prompt doesn't use placeholders
  // ============================================================================
  const hasPlaceholdersForCitations = basePrompt.includes('CITATION MODE') || basePrompt.includes('AUTO_CITATION_MODE');
  
  const topicBlock = topic && !basePrompt.includes('RESEARCH TOPIC CONTEXT')
    ? `\n\nRESEARCH TOPIC CONTEXT:\nTitle: ${topic.title}\nResearch Question: ${topic.researchQuestion}\nMethodology: ${methodology}\nContribution: ${contribution}\nKeywords: ${(topic.keywords || []).join(', ')}`
    : '';

  // Only append citation instructions if the prompt doesn't have its own citation mode section
  const citationsBlock = citationInstructions && !hasPlaceholdersForCitations 
    ? `\n\n${citationInstructions}` 
    : '';
  
  const userBlock = userInstructions ? `\n\nUSER INSTRUCTIONS:\n${userInstructions}` : '';
  const styleBlock = writingSampleBlock ? `\n\n${writingSampleBlock}` : '';

  return `${basePrompt}${topicBlock}${citationsBlock}${styleBlock}${userBlock}

OUTPUT FORMAT (MANDATORY):
- Return ONLY clean Markdown text. No JSON, no code fences, no explanations.
- Use headings with ## for major subsections and ### for nested subsections when needed.
- Use "-" for bullet lists and "1." for numbered lists; use two-space indentation for nested list levels.
- Keep paragraph spacing clean (blank line between paragraphs and after headings).
- Preserve citation placeholders exactly in [CITE:key] format.
- Do not use HTML tags.`;
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
  dimensionEvidence?: EvidencePromptContext['dimensionEvidence']
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
    { headers },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'PAPER_SECTION_DRAFT',
      prompt,
      parameters: {
        temperature: 0.1
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
  const unique = Array.from(new Set(filteredRows.map(r => r.dimension).filter((d): d is string => Boolean(d))));
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
  },
  emitStatus?: GenerationStatusEmitter
): Promise<GenerateSectionResult> {
  const { sessionId, session, user, paperTypeCode, payload, requestHeaders } = params;
  const sectionKey = normalizeSectionKey(payload.sectionKey);
  const requestedMappedEvidence = payload.useMappedEvidence !== false;
  const sectionContextPolicy = await sectionTemplateService.getSectionContextPolicy(sectionKey, paperTypeCode);
  const useMappedEvidence = sectionContextPolicy.requiresCitations
    ? requestedMappedEvidence
    : false;

  await emitStatus?.(
    'load_context',
    useMappedEvidence
      ? 'Loading topic, citations, blueprint, and mapped evidence'
      : sectionContextPolicy.requiresCitations
        ? 'Loading topic and citations (mapped evidence disabled)'
        : 'Loading topic and citations (auto citations disabled for this section by policy)'
  );
  const researchTopic = await prisma.researchTopic.findUnique({
    where: { sessionId }
  });

  const citations = await citationService.getCitationsForSession(sessionId);
  const evidencePack = useMappedEvidence
    ? await evidencePackService.getEvidencePack(sessionId, sectionKey)
    : null;
  const citationContext = await DraftingService.buildCitationContext(sessionId, sectionKey, {
    useMappedEvidence,
    preloadedEvidencePack: evidencePack
  });
  const draft = await getOrCreatePaperDraft(sessionId, researchTopic?.title || 'Untitled Paper');
  const extraSections = normalizeExtraSections(draft.extraSections);

  // Load blueprint for prompt template injection
  let blueprintPromptContext: BlueprintPromptContext | undefined;
  const blueprint = await blueprintService.getBlueprint(sessionId);
  if (blueprint) {
    const currentSectionPlan = blueprint.sectionPlan.find(
      s => normalizeSectionKey(s.sectionKey) === normalizeSectionKey(sectionKey)
    );
    blueprintPromptContext = {
      thesisStatement: blueprint.thesisStatement,
      centralObjective: blueprint.centralObjective,
      keyContributions: blueprint.keyContributions,
      sectionPlan: blueprint.sectionPlan.map(s => ({ sectionKey: s.sectionKey, purpose: s.purpose })),
      mustCover: currentSectionPlan?.mustCover || []
    };
  }

  // Load full evidence pack for prompt template injection
  let evidencePromptContext: EvidencePromptContext | undefined;
  if (useMappedEvidence) {
    evidencePromptContext = {
      useMappedEvidence: true,
      // Keep prompt-level whitelist in sync with runtime validation whitelist.
      allowedCitationKeys: citationContext.allowedCitationKeys,
      dimensionEvidence: evidencePack?.dimensionEvidence || [],
      gaps: citationContext.evidenceGaps
    };

    if (
      evidencePack?.hasBlueprint
      && (evidencePack.allowedCitationKeys?.length || 0) === 0
      && (evidencePack.dimensionEvidence?.length || 0) > 0
    ) {
      throw new DraftingRequestError(
        'No mapped evidence is available for this section',
        409,
        {
          error: 'No mapped evidence is available for this section',
          hint: 'Run AI Relevance & Blueprint Mapping (or re-import citations) so citations can be mapped to this section.',
          evidence: {
            sectionKey,
            gaps: evidencePack.gaps
          }
        }
      );
    }
  } else {
    evidencePromptContext = {
      useMappedEvidence: false,
      allowedCitationKeys: [],
      dimensionEvidence: [],
      gaps: []
    };
  }

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
  
  // DEBUG: Log evidence and blueprint context for troubleshooting citation injection
  console.log(`[PaperDrafting] Section: ${sectionKey}, useMappedEvidence: ${useMappedEvidence}`);
  console.log(`[PaperDrafting] Blueprint exists: ${!!blueprintPromptContext}, mustCover count: ${blueprintPromptContext?.mustCover?.length || 0}`);
  console.log(`[PaperDrafting] Evidence pack - allowedKeys: ${evidencePromptContext?.allowedCitationKeys?.length || 0}, dimensions: ${evidencePromptContext?.dimensionEvidence?.length || 0}, gaps: ${evidencePromptContext?.gaps?.length || 0}`);
  if (evidencePromptContext?.allowedCitationKeys?.length) {
    console.log(`[PaperDrafting] Allowed citation keys: ${evidencePromptContext.allowedCitationKeys.join(', ')}`);
  }
  if (evidencePromptContext?.dimensionEvidence?.length) {
    for (const dim of evidencePromptContext.dimensionEvidence) {
      console.log(`[PaperDrafting] Dimension "${dim.dimension}": ${dim.citations.length} citations`);
    }
  }
  
  const prompt = await buildPrompt(
    sectionKey,
    paperTypeCode,
    {
      researchTopic,
      citationCount: citations.length,
      availableCitations: citations,
      previousSections: extraSections
    },
    useMappedEvidence ? citationContext.citationInstructions : '',
    payload.instructions,
    writingSampleBlock,
    blueprintPromptContext,
    evidencePromptContext
  );
  
  // DEBUG: Log a snippet of the final prompt to verify placeholder injection
  const promptSnippet = prompt.substring(0, 500);
  console.log(`[PaperDrafting] Prompt snippet (first 500 chars):\n${promptSnippet}`);
  if (prompt.includes('{{AUTO_CITATION_MODE}}')) {
    console.warn('[PaperDrafting] WARNING: {{AUTO_CITATION_MODE}} placeholder was NOT replaced - check if DB prompt has placeholders');
  }
  if (prompt.includes('ALLOWED_CITATION_KEYS: (none)')) {
    console.warn('[PaperDrafting] WARNING: No allowed citation keys - evidence pack may be empty');
  }

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
  const result = await llmGateway.executeLLMOperation({ headers: requestHeaders }, llmRequest);

  if (!result.success || !result.response) {
    throw new Error(result.error?.message || 'Generation failed');
  }

  const rawOutput = (result.response.output || '').trim();

  let rawContent = rawOutput;
  try {
    if (rawOutput.startsWith('{') || rawOutput.includes('"content"')) {
      let jsonText = rawOutput;

      const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonText = fenceMatch[1].trim();
      }

      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');

      if (start !== -1 && end !== -1 && end > start) {
        jsonText = jsonText.slice(start, end + 1);
        const parsed = JSON.parse(jsonText);

        if (parsed.content && typeof parsed.content === 'string') {
          rawContent = parsed.content;
          console.log(`[PaperDrafting] Extracted content from JSON (${rawContent.length} chars), discarded memory`);
        }
      }
    }
  } catch (parseErr) {
    console.warn('[PaperDrafting] Could not parse JSON output, using raw:', parseErr);
  }

  if (useMappedEvidence && rawContent.includes('[CITATION_NEEDED')) {
    throw new DraftingRequestError(
      'Generated section contains [CITATION_NEEDED] placeholders which are not allowed when Auto citations is ON',
      422,
      {
        error: 'Citation format violation',
        hint: 'The model used [CITATION_NEEDED] instead of [CITE:key] format'
      }
    );
  }

  await emitStatus?.(
    'citation_validation',
    useMappedEvidence
      ? 'Validating mapped citation whitelist for this section'
      : 'Validating citation keys (mapped whitelist disabled)'
  );
  let contentForPostProcess = polishDraftMarkdown(rawContent);
  const initialValidation = DraftingService.validateCitationKeys(
    contentForPostProcess,
    useMappedEvidence ? citationContext.allowedCitationKeys : undefined
  );

  if (
    useMappedEvidence &&
    initialValidation.disallowedKeys.length > 0 &&
    citationContext.allowedCitationKeys.length > 0
  ) {
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
      evidencePromptContext?.dimensionEvidence
    );
    let postRepairValidation = DraftingService.validateCitationKeys(
      contentForPostProcess,
      citationContext.allowedCitationKeys
    );

    // P0 Fix: If LLM repair didn't remove all disallowed keys, retry once more
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
        evidencePromptContext?.dimensionEvidence
      );
      postRepairValidation = DraftingService.validateCitationKeys(
        contentForPostProcess,
        citationContext.allowedCitationKeys
      );
    }

    // P0 Fix: Deterministic strip fallback -- if LLM repair still fails,
    // programmatically remove remaining disallowed citation placeholders
    // rather than throwing a hard 422 error.
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
    useMappedEvidence ? citationContext.allowedCitationKeys : undefined
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
    tokensUsed: result.response.outputTokens,
    prompt
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

    const body = await request.json();
    const actionData = actionSchema.parse(body);

    const paperTypeCode = session.paperType?.code
      || process.env.DEFAULT_PAPER_TYPE
      || 'JOURNAL_ARTICLE';

    switch (actionData.action) {
      case 'generate_section':
      case 'regenerate_section': {
        const payload = generateSchema.parse(body);
        const headers = Object.fromEntries(request.headers.entries());
        const wantsStream = Boolean(body.stream);

        if (!wantsStream) {
          const generated = await generateSection(
            {
              sessionId,
              session,
              user,
              paperTypeCode,
              payload,
              requestHeaders: headers
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
              requestHeaders: headers
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

      case 'save_section': {
        const payload = saveSchema.parse(body);
        const sectionKey = normalizeSectionKey(payload.sectionKey);
        const content = polishDraftMarkdown(payload.content || '');

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

        const citations = await citationService.getCitationsForSession(sessionId);
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
              .map(key => canonicalLookup.get(key.trim().toLowerCase()))
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
