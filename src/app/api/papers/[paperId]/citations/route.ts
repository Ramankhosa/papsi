import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';

export const runtime = 'nodejs';

const manualCitationSchema = z.object({
  sourceType: z.enum([
    'JOURNAL_ARTICLE',
    'CONFERENCE_PAPER',
    'BOOK',
    'BOOK_CHAPTER',
    'THESIS',
    'WORKING_PAPER',
    'REPORT',
    'WEBSITE',
    'PATENT',
    'OTHER'
  ]),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
});

// Schema for AI-generated citation metadata
const citationMetaSchema = z.object({
  keyContribution: z.string().optional(),
  keyFindings: z.string().optional(),
  methodologicalApproach: z.string().nullable().optional(),
  relevanceToResearch: z.string().optional(),
  limitationsOrGaps: z.string().nullable().optional(),
  usage: z.object({
    introduction: z.boolean().optional(),
    literatureReview: z.boolean().optional(),
    methodology: z.boolean().optional(),
    comparison: z.boolean().optional()
  }).optional(),
  relevanceScore: z.number().optional()
}).optional().nullable();

const createCitationSchema = z.object({
  citation: manualCitationSchema.optional(),
  searchResult: z.any().optional(),
  citationMeta: citationMetaSchema // AI-generated metadata for section generation
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      citationStyle: true
    }
  });
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

function getDefaultStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

function normalizeDoi(doi?: string | null): string {
  return typeof doi === 'string'
    ? doi.trim().toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
        .replace(/^doi:/, '')
        .replace(/\s+/g, '')
    : '';
}

function normalizeTitleFingerprint(title?: string | null): string {
  return typeof title === 'string'
    ? title.trim().toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeAuthor(author?: string | null): string {
  return typeof author === 'string'
    ? author.trim().toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeProvider(provider?: string | null): string {
  return typeof provider === 'string'
    ? provider.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

function buildPaperIdentityKey(input: {
  doi?: string | null;
  title?: string | null;
  year?: number | null;
  firstAuthor?: string | null;
}): string | undefined {
  const doi = normalizeDoi(input.doi);
  if (doi) {
    return `doi:${doi}`;
  }
  const titleFingerprint = normalizeTitleFingerprint(input.title);
  if (!titleFingerprint) {
    return undefined;
  }
  const yearPart = input.year ? String(input.year) : 'na';
  const authorPart = normalizeAuthor(input.firstAuthor) || 'na';
  return `tfp:${titleFingerprint}|y:${yearPart}|fa:${authorPart}`;
}

function toCitationMetaSnapshot(raw: any, fallbackRelevanceScore?: number): CitationMetaSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const result: CitationMetaSnapshot = {};
  if (typeof raw.keyContribution === 'string' && raw.keyContribution.trim()) {
    result.keyContribution = raw.keyContribution.trim().slice(0, 400);
  }
  if (typeof raw.keyFindings === 'string' && raw.keyFindings.trim()) {
    result.keyFindings = raw.keyFindings.trim().slice(0, 400);
  }
  if (typeof raw.methodologicalApproach === 'string') {
    const value = raw.methodologicalApproach.trim();
    result.methodologicalApproach = value ? value.slice(0, 400) : null;
  } else if (raw.methodologicalApproach === null) {
    result.methodologicalApproach = null;
  }
  if (typeof raw.relevanceToResearch === 'string' && raw.relevanceToResearch.trim()) {
    result.relevanceToResearch = raw.relevanceToResearch.trim().slice(0, 500);
  }
  if (typeof raw.limitationsOrGaps === 'string') {
    const value = raw.limitationsOrGaps.trim();
    result.limitationsOrGaps = value ? value.slice(0, 500) : null;
  } else if (raw.limitationsOrGaps === null) {
    result.limitationsOrGaps = null;
  }
  if (raw.usage && typeof raw.usage === 'object') {
    result.usage = {
      introduction: Boolean(raw.usage.introduction),
      literatureReview: Boolean(raw.usage.literatureReview),
      methodology: Boolean(raw.usage.methodology),
      comparison: Boolean(raw.usage.comparison)
    };
  }
  const relevanceScore = Number(raw.relevanceScore ?? fallbackRelevanceScore);
  if (Number.isFinite(relevanceScore)) {
    result.relevanceScore = Math.max(0, Math.min(100, relevanceScore));
  }
  result.analyzedAt = new Date().toISOString();

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildMappingsForCitation(
  citation: { id: string; citationKey: string },
  suggestion: any
): PaperBlueprintMapping[] {
  const citationMeta = toCitationMetaSnapshot(suggestion.citationMeta, Number(suggestion.relevanceScore));
  const rawMappings = Array.isArray(suggestion.dimensionMappings) ? suggestion.dimensionMappings : [];
  if (rawMappings.length === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const bySection = new Map<string, Array<{
    dimension: string;
    remark: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }>>();

  for (const raw of rawMappings) {
    const sectionKey = typeof raw?.sectionKey === 'string' ? raw.sectionKey.trim() : '';
    const dimension = typeof raw?.dimension === 'string' ? raw.dimension.trim() : '';
    if (!sectionKey || !dimension) {
      continue;
    }
    const remark = typeof raw?.remark === 'string' && raw.remark.trim()
      ? raw.remark.trim().slice(0, 500)
      : 'No remark provided';
    const confidence = raw?.confidence === 'HIGH' || raw?.confidence === 'MEDIUM' || raw?.confidence === 'LOW'
      ? raw.confidence
      : 'MEDIUM';

    if (!bySection.has(sectionKey)) {
      bySection.set(sectionKey, []);
    }
    bySection.get(sectionKey)!.push({ dimension, remark, confidence });
  }

  if (bySection.size === 0) {
    return [{
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'UNMAPPED',
      citationMeta
    }];
  }

  const mappings: PaperBlueprintMapping[] = [];
  for (const [sectionKey, dims] of Array.from(bySection.entries())) {
    const highMedium = dims.filter((d: { confidence: 'HIGH' | 'MEDIUM' | 'LOW' }) => d.confidence === 'HIGH' || d.confidence === 'MEDIUM').length;
    const mappingStatus: PaperBlueprintMapping['mappingStatus'] = highMedium >= 2
      ? 'MAPPED'
      : highMedium >= 1
        ? 'WEAK'
        : dims.length > 0
          ? 'WEAK'
          : 'UNMAPPED';

    mappings.push({
      paperId: citation.id,
      citationKey: citation.citationKey,
      sectionKey,
      dimensionMappings: dims,
      mappingStatus,
      citationMeta
    });
  }

  return mappings;
}

async function hydrateCitationMappingsFromAnalysis(
  sessionId: string,
  citation: {
    id: string;
    citationKey: string;
    doi?: string | null;
    year?: number | null;
    title?: string | null;
    authors?: string[] | null;
    doiNormalized?: string | null;
    paperIdentityKey?: string | null;
  },
  searchResult: any
): Promise<void> {
  const providerPaperId = typeof searchResult?.id === 'string' ? searchResult.id : '';
  const provider = normalizeProvider(searchResult?.source);
  const normalizedDoi = normalizeDoi(searchResult?.doi || citation.doi || citation.doiNormalized || '');
  const identityKey = buildPaperIdentityKey({
    doi: searchResult?.doi || citation.doi,
    title: searchResult?.title || citation.title,
    year: searchResult?.year || citation.year,
    firstAuthor: Array.isArray(searchResult?.authors) && searchResult.authors.length > 0
      ? searchResult.authors[0]
      : Array.isArray(citation.authors) && citation.authors.length > 0
        ? citation.authors[0]
        : undefined
  }) || citation.paperIdentityKey || undefined;
  const titleFingerprint = normalizeTitleFingerprint(searchResult?.title || citation.title || '');

  const searchRuns = await prisma.literatureSearchRun.findMany({
    where: { sessionId },
    orderBy: [
      { aiAnalyzedAt: 'desc' },
      { createdAt: 'desc' }
    ],
    take: 30,
    select: {
      id: true,
      aiAnalysis: true
    }
  });

  let matchedSuggestion: any = null;
  for (const run of searchRuns) {
    if (!run.aiAnalysis) {
      continue;
    }
    const suggestions = Array.isArray((run.aiAnalysis as any)?.suggestions)
      ? (run.aiAnalysis as any).suggestions
      : [];
    for (const suggestion of suggestions) {
      const suggestionIdentity = typeof suggestion?.paperIdentityKey === 'string' ? suggestion.paperIdentityKey : '';
      const suggestionDoi = normalizeDoi(suggestion?.paperDoi);
      const suggestionProviderPaperId = typeof suggestion?.providerPaperId === 'string'
        ? suggestion.providerPaperId
        : (typeof suggestion?.paperId === 'string' ? suggestion.paperId : '');
      const suggestionProvider = normalizeProvider(suggestion?.paperSource);
      const suggestionTitleFingerprint = normalizeTitleFingerprint(suggestion?.paperTitle);

      const matchesIdentity = Boolean(identityKey && suggestionIdentity && identityKey === suggestionIdentity);
      const matchesDoi = Boolean(normalizedDoi && suggestionDoi && normalizedDoi === suggestionDoi);
      const matchesProviderPaper = Boolean(
        providerPaperId
        && suggestionProviderPaperId
        && providerPaperId === suggestionProviderPaperId
        && (!provider || !suggestionProvider || provider === suggestionProvider)
      );
      const matchesTitle = Boolean(titleFingerprint && suggestionTitleFingerprint && titleFingerprint === suggestionTitleFingerprint);

      if (matchesIdentity || matchesDoi || matchesProviderPaper || matchesTitle) {
        matchedSuggestion = suggestion;
        break;
      }
    }
    if (matchedSuggestion) {
      break;
    }
  }

  if (!matchedSuggestion) {
    return;
  }

  const mappings = buildMappingsForCitation(citation, matchedSuggestion);
  if (mappings.length === 0) {
    return;
  }

  await citationMappingService.clearMappingsForCitations(sessionId, [citation.id]);
  await citationMappingService.storeMappings(sessionId, mappings);
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

    const citations = await citationService.getCitationsForSession(sessionId);
    const styleCode = getDefaultStyleCode(session);

    const formatted = await Promise.all(citations.map(async citation => {
      const data = toCitationData(citation);
      let inText = '';
      let bibliography = '';

      try {
        inText = await citationStyleService.formatInTextCitation(data, styleCode);
        bibliography = await citationStyleService.formatBibliographyEntry(data, styleCode);
      } catch (formatError) {
        console.warn('[Citations] Format preview failed:', formatError);
      }

      return {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      };
    }));

    return NextResponse.json({
      citations: formatted,
      citationStyle: styleCode
    });
  } catch (error) {
    console.error('[Citations] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch citations' }, { status: 500 });
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
    const data = createCitationSchema.parse(body);

    let citation;
    if (data.searchResult) {
      // Pass AI-generated citation metadata if available
      citation = await citationService.importFromSearchResult(
        sessionId, 
        data.searchResult,
        data.citationMeta || undefined
      );

      try {
        await hydrateCitationMappingsFromAnalysis(sessionId, citation, data.searchResult);
      } catch (mappingHydrationError) {
        console.warn('[Citations] Failed to hydrate mapping metadata for imported citation:', mappingHydrationError);
      }
    } else if (data.citation) {
      citation = await citationService.addManualCitation(sessionId, data.citation);
    } else {
      return NextResponse.json({ error: 'Citation payload is required' }, { status: 400 });
    }

    const styleCode = getDefaultStyleCode(session);
    const citationData = toCitationData(citation);
    let inText = '';
    let bibliography = '';

    try {
      inText = await citationStyleService.formatInTextCitation(citationData, styleCode);
      bibliography = await citationStyleService.formatBibliographyEntry(citationData, styleCode);
    } catch (formatError) {
      console.warn('[Citations] Format preview failed:', formatError);
    }

    return NextResponse.json({
      citation: {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      }
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to add citation';
    const status = message.toLowerCase().includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
