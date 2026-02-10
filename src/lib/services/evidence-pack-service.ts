import { prisma } from '../prisma';
import { blueprintService } from './blueprint-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from './citation-mapping-service';

export interface EvidenceCitation {
  citationId: string;
  citationKey: string;
  title: string;
  year: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  relevanceScore: number;
  remark: string;
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: Array<
    'BACKGROUND' |
    'GAP' |
    'METHOD' |
    'LIMITATION' |
    'DATASET' |
    'IMPLEMENTATION_CONSTRAINT'
  >;
  evidenceBoundary?: string | null;
}

export interface DimensionEvidence {
  dimension: string;
  citations: EvidenceCitation[];
}

export interface SectionEvidencePack {
  sectionKey: string;
  hasBlueprint: boolean;
  allowedCitationKeys: string[];
  dimensionEvidence: DimensionEvidence[];
  gaps: string[];
}

const CONFIDENCE_WEIGHT: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
const CLAIM_TYPE_SET = new Set<string>(CLAIM_TYPE_VALUES);

const normalizeDimension = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeSectionKey = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeDoi = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:/, '').replace(/\s+/g, '')
    : '';
const normalizeProvider = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_') : '';
const normalizeTitleFingerprint = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
const normalizeAuthor = (value?: string | null) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

function clampText(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function extractCitationMeta(aiMeta: unknown): {
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: Array<
    'BACKGROUND' |
    'GAP' |
    'METHOD' |
    'LIMITATION' |
    'DATASET' |
    'IMPLEMENTATION_CONSTRAINT'
  >;
  evidenceBoundary?: string | null;
  relevanceScore: number;
} {
  const meta = (aiMeta || {}) as Record<string, unknown>;
  const relevanceScore = Number(meta.relevanceScore);
  const claimTypesSupported = Array.isArray(meta.claimTypesSupported)
    ? Array.from(
        new Set(
          meta.claimTypesSupported
            .map(value => String(value).trim().toUpperCase())
            .filter(value => CLAIM_TYPE_SET.has(value))
        )
      ).slice(0, 3) as Array<
        'BACKGROUND' |
        'GAP' |
        'METHOD' |
        'LIMITATION' |
        'DATASET' |
        'IMPLEMENTATION_CONSTRAINT'
      >
    : undefined;
  return {
    keyContribution: clampText(meta.keyContribution, 400),
    keyFindings: clampText(meta.keyFindings, 400),
    methodologicalApproach: clampText(meta.methodologicalApproach, 400) ?? null,
    relevanceToResearch: clampText(meta.relevanceToResearch, 500),
    limitationsOrGaps: clampText(meta.limitationsOrGaps, 500) ?? null,
    claimTypesSupported,
    evidenceBoundary: clampText(meta.evidenceBoundary, 400) ?? null,
    relevanceScore: Number.isFinite(relevanceScore) ? relevanceScore : 0
  };
}

type CitationLookupRow = {
  id: string;
  citationKey: string;
  doiNormalized: string | null;
  paperIdentityKey: string | null;
  importProvider: string | null;
  importProviderPaperId: string | null;
  titleFingerprint: string | null;
  year: number | null;
  firstAuthorNormalized: string | null;
};

type SuggestionForBackfill = {
  paperId?: string;
  paperDoi?: string;
  paperSource?: string;
  providerPaperId?: string;
  paperIdentityKey?: string;
  paperTitle?: string;
  relevanceScore?: number;
  citationMeta?: Record<string, unknown>;
  dimensionMappings?: Array<{
    sectionKey?: string;
    dimension?: string;
    remark?: string;
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  }>;
};

type CitationLookupIndex = {
  byId: Map<string, CitationLookupRow>;
  byIdentity: Map<string, CitationLookupRow[]>;
  byDoi: Map<string, CitationLookupRow[]>;
  byProviderAndPaperId: Map<string, CitationLookupRow[]>;
  byProviderPaperId: Map<string, CitationLookupRow[]>;
  byTitleFingerprint: Map<string, CitationLookupRow[]>;
};

function pushLookup(map: Map<string, CitationLookupRow[]>, key: string, row: CitationLookupRow) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(row);
}

function buildLookupIndex(rows: CitationLookupRow[]): CitationLookupIndex {
  const byId = new Map<string, CitationLookupRow>();
  const byIdentity = new Map<string, CitationLookupRow[]>();
  const byDoi = new Map<string, CitationLookupRow[]>();
  const byProviderAndPaperId = new Map<string, CitationLookupRow[]>();
  const byProviderPaperId = new Map<string, CitationLookupRow[]>();
  const byTitleFingerprint = new Map<string, CitationLookupRow[]>();

  for (const row of rows) {
    byId.set(row.id, row);
    if (row.paperIdentityKey) {
      pushLookup(byIdentity, row.paperIdentityKey, row);
    }
    if (row.doiNormalized) {
      pushLookup(byDoi, row.doiNormalized, row);
    }
    if (row.importProviderPaperId) {
      pushLookup(byProviderPaperId, row.importProviderPaperId, row);
      pushLookup(
        byProviderAndPaperId,
        `${normalizeProvider(row.importProvider)}::${row.importProviderPaperId}`,
        row
      );
    }
    if (row.titleFingerprint) {
      pushLookup(byTitleFingerprint, row.titleFingerprint, row);
    }
  }

  return {
    byId,
    byIdentity,
    byDoi,
    byProviderAndPaperId,
    byProviderPaperId,
    byTitleFingerprint
  };
}

function narrowCandidates(candidates: CitationLookupRow[], suggestion: SuggestionForBackfill): CitationLookupRow[] {
  if (candidates.length <= 1) {
    return candidates;
  }
  const identity = suggestion.paperIdentityKey || '';
  const yearMatch = identity.match(/\|y:([^|]+)/);
  const authorMatch = identity.match(/\|fa:([^|]+)/);
  const expectedYear = yearMatch && yearMatch[1] !== 'na' ? Number(yearMatch[1]) : undefined;
  const expectedAuthor = authorMatch && authorMatch[1] !== 'na' ? authorMatch[1] : '';

  let narrowed = candidates;
  if (typeof expectedYear === 'number' && Number.isFinite(expectedYear)) {
    const yearFiltered = narrowed.filter(c => c.year === expectedYear);
    if (yearFiltered.length > 0) {
      narrowed = yearFiltered;
    }
  }
  if (expectedAuthor) {
    const authorFiltered = narrowed.filter(c => (c.firstAuthorNormalized || '') === expectedAuthor);
    if (authorFiltered.length > 0) {
      narrowed = authorFiltered;
    }
  }
  return narrowed;
}

function resolveSuggestionCitation(suggestion: SuggestionForBackfill, lookup: CitationLookupIndex): CitationLookupRow | null {
  if (suggestion.paperId && lookup.byId.has(suggestion.paperId)) {
    return lookup.byId.get(suggestion.paperId) || null;
  }

  if (suggestion.paperIdentityKey) {
    const byIdentity = narrowCandidates(lookup.byIdentity.get(suggestion.paperIdentityKey) || [], suggestion);
    if (byIdentity.length > 0) {
      return byIdentity[0];
    }
  }

  const doi = normalizeDoi(suggestion.paperDoi);
  if (doi) {
    const byDoi = narrowCandidates(lookup.byDoi.get(doi) || [], suggestion);
    if (byDoi.length > 0) {
      return byDoi[0];
    }
  }

  const providerPaperId = suggestion.providerPaperId || suggestion.paperId || '';
  if (providerPaperId) {
    const providerPairKey = `${normalizeProvider(suggestion.paperSource)}::${providerPaperId}`;
    const byPair = narrowCandidates(lookup.byProviderAndPaperId.get(providerPairKey) || [], suggestion);
    if (byPair.length > 0) {
      return byPair[0];
    }

    const byProviderId = narrowCandidates(lookup.byProviderPaperId.get(providerPaperId) || [], suggestion);
    if (byProviderId.length > 0) {
      return byProviderId[0];
    }
  }

  const tf = normalizeTitleFingerprint(suggestion.paperTitle);
  if (tf) {
    const byTitle = narrowCandidates(lookup.byTitleFingerprint.get(tf) || [], suggestion);
    if (byTitle.length > 0) {
      return byTitle[0];
    }
  }

  return null;
}

function toSnapshotFromSuggestion(suggestion: SuggestionForBackfill): CitationMetaSnapshot | undefined {
  const meta = suggestion.citationMeta || {};
  const snapshot: CitationMetaSnapshot = {
    keyContribution: clampText(meta.keyContribution, 400),
    keyFindings: clampText(meta.keyFindings, 400),
    methodologicalApproach: clampText(meta.methodologicalApproach, 400) ?? null,
    relevanceToResearch: clampText(meta.relevanceToResearch, 500),
    limitationsOrGaps: clampText(meta.limitationsOrGaps, 500) ?? null,
    claimTypesSupported: Array.isArray(meta.claimTypesSupported)
      ? Array.from(
          new Set(
            meta.claimTypesSupported
              .map(value => String(value).trim().toUpperCase())
              .filter(value => CLAIM_TYPE_SET.has(value))
          )
        ).slice(0, 3) as CitationMetaSnapshot['claimTypesSupported']
      : undefined,
    evidenceBoundary: clampText(meta.evidenceBoundary, 400) ?? null,
    usage: meta.usage && typeof meta.usage === 'object'
      ? {
          introduction: Boolean((meta.usage as Record<string, unknown>).introduction),
          literatureReview: Boolean((meta.usage as Record<string, unknown>).literatureReview),
          methodology: Boolean((meta.usage as Record<string, unknown>).methodology),
          comparison: Boolean((meta.usage as Record<string, unknown>).comparison)
        }
      : undefined,
    relevanceScore: Number.isFinite(Number(suggestion.relevanceScore))
      ? Math.max(0, Math.min(100, Number(suggestion.relevanceScore)))
      : undefined,
    analyzedAt: new Date().toISOString()
  };

  return Object.values(snapshot).some(v => v !== undefined) ? snapshot : undefined;
}

class EvidencePackService {
  private async loadDimensionMappings(sessionId: string) {
    return prisma.citationUsage.findMany({
      where: {
        citation: {
          sessionId,
          isActive: true
        },
        usageKind: 'DIMENSION_MAPPING',
        dimension: { not: null }
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
            title: true,
            year: true,
            aiMeta: true
          }
        }
      }
    });
  }

  private async backfillMappingsFromLatestAnalysis(sessionId: string): Promise<number> {
    const latestAnalyzedRun = await prisma.literatureSearchRun.findFirst({
      where: {
        sessionId,
        aiAnalyzedAt: { not: null }
      },
      orderBy: [{ aiAnalyzedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        aiAnalysis: true
      }
    });

    if (!latestAnalyzedRun?.aiAnalysis) {
      return 0;
    }

    const suggestions = Array.isArray((latestAnalyzedRun.aiAnalysis as any)?.suggestions)
      ? ((latestAnalyzedRun.aiAnalysis as any).suggestions as SuggestionForBackfill[])
      : [];
    if (suggestions.length === 0) {
      return 0;
    }

    const citations = await prisma.citation.findMany({
      where: { sessionId, isActive: true },
      select: {
        id: true,
        citationKey: true,
        doiNormalized: true,
        paperIdentityKey: true,
        importProvider: true,
        importProviderPaperId: true,
        titleFingerprint: true,
        year: true,
        firstAuthorNormalized: true
      }
    });
    if (citations.length === 0) {
      return 0;
    }

    const lookup = buildLookupIndex(citations as CitationLookupRow[]);
    const mappings: PaperBlueprintMapping[] = [];
    const citationIds = new Set<string>();

    for (const suggestion of suggestions) {
      const citation = resolveSuggestionCitation(suggestion, lookup);
      if (!citation) {
        continue;
      }

      citationIds.add(citation.id);
      const citationMeta = toSnapshotFromSuggestion(suggestion);
      const dims = Array.isArray(suggestion.dimensionMappings) ? suggestion.dimensionMappings : [];
      if (dims.length === 0) {
        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED',
          citationMeta
        });
        continue;
      }

      const bySection = new Map<string, Array<{ dimension: string; remark: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }>>();
      for (const dim of dims) {
        const sectionKey = typeof dim.sectionKey === 'string' ? dim.sectionKey.trim() : '';
        const dimension = typeof dim.dimension === 'string' ? dim.dimension.trim() : '';
        if (!sectionKey || !dimension) {
          continue;
        }
        const remark = typeof dim.remark === 'string' && dim.remark.trim()
          ? dim.remark.trim().slice(0, 500)
          : 'No remark provided';
        const confidence = dim.confidence === 'HIGH' || dim.confidence === 'MEDIUM' || dim.confidence === 'LOW'
          ? dim.confidence
          : 'MEDIUM';
        if (!bySection.has(sectionKey)) {
          bySection.set(sectionKey, []);
        }
        bySection.get(sectionKey)!.push({ dimension, remark, confidence });
      }

      if (bySection.size === 0) {
        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED',
          citationMeta
        });
        continue;
      }

      for (const [sectionKey, sectionDims] of Array.from(bySection.entries())) {
        const highMediumCount = sectionDims.filter(d => d.confidence === 'HIGH' || d.confidence === 'MEDIUM').length;
        const mappingStatus: PaperBlueprintMapping['mappingStatus'] = highMediumCount >= 2
          ? 'MAPPED'
          : highMediumCount >= 1
            ? 'WEAK'
            : sectionDims.length > 0
              ? 'WEAK'
              : 'UNMAPPED';

        mappings.push({
          paperId: citation.id,
          citationKey: citation.citationKey,
          sectionKey,
          dimensionMappings: sectionDims,
          mappingStatus,
          citationMeta
        });
      }
    }

    if (mappings.length === 0) {
      return 0;
    }

    const ids = Array.from(citationIds);
    await citationMappingService.clearMappingsForCitations(sessionId, ids);
    await citationMappingService.storeMappings(sessionId, mappings);
    return mappings.length;
  }

  async getEvidencePack(sessionId: string, sectionKey: string): Promise<SectionEvidencePack> {
    const requestedSectionKey = sectionKey;
    const normalizedRequestedSectionKey = normalizeSectionKey(requestedSectionKey);
    const blueprint = await blueprintService.getBlueprint(sessionId);

    if (!blueprint) {
      return {
        sectionKey: requestedSectionKey,
        hasBlueprint: false,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: []
      };
    }

    const section = blueprint.sectionPlan.find(
      s => normalizeSectionKey(s.sectionKey) === normalizedRequestedSectionKey
    );
    const resolvedSectionKey = section?.sectionKey || requestedSectionKey;
    const mustCover = section?.mustCover || [];

    if (!section || mustCover.length === 0) {
      return {
        sectionKey: resolvedSectionKey,
        hasBlueprint: true,
        allowedCitationKeys: [],
        dimensionEvidence: [],
        gaps: []
      };
    }

    let allUsages = await this.loadDimensionMappings(sessionId);
    if (allUsages.length === 0) {
      const backfilled = await this.backfillMappingsFromLatestAnalysis(sessionId);
      if (backfilled > 0) {
        allUsages = await this.loadDimensionMappings(sessionId);
      }
    }

    const usages = allUsages.filter(
      usage => normalizeSectionKey(usage.sectionKey) === normalizeSectionKey(section.sectionKey)
    );

    const perDimension = new Map<string, EvidenceCitation[]>();

    for (const usage of usages) {
      const dim = usage.dimension || '';
      const normalized = normalizeDimension(dim);
      if (!normalized) continue;

      const citation = usage.citation;
      const citationMeta = extractCitationMeta(citation.aiMeta);
      const confidence = (usage.confidence || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW';
      const supportNote = usage.remark
        || citationMeta.relevanceToResearch
        || citationMeta.evidenceBoundary
        || citationMeta.keyFindings
        || citationMeta.keyContribution
        || '';

      const entry: EvidenceCitation = {
        citationId: citation.id,
        citationKey: citation.citationKey,
        title: citation.title,
        year: citation.year,
        confidence,
        relevanceScore: citationMeta.relevanceScore,
        remark: supportNote,
        keyContribution: citationMeta.keyContribution,
        keyFindings: citationMeta.keyFindings,
        methodologicalApproach: citationMeta.methodologicalApproach,
        relevanceToResearch: citationMeta.relevanceToResearch,
        limitationsOrGaps: citationMeta.limitationsOrGaps,
        claimTypesSupported: citationMeta.claimTypesSupported,
        evidenceBoundary: citationMeta.evidenceBoundary
      };

      if (!perDimension.has(normalized)) {
        perDimension.set(normalized, []);
      }
      perDimension.get(normalized)!.push(entry);
    }

    const dimensionEvidence: DimensionEvidence[] = [];
    const gaps: string[] = [];
    const allowedScore = new Map<string, number>();

    for (const dim of mustCover) {
      const normalized = normalizeDimension(dim);
      const rows = (perDimension.get(normalized) || [])
        .sort((a, b) => {
          const c = CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence];
          if (c !== 0) return c;
          const r = b.relevanceScore - a.relevanceScore;
          if (r !== 0) return r;
          const y = (b.year || 0) - (a.year || 0);
          if (y !== 0) return y;
          return a.citationKey.localeCompare(b.citationKey);
        });

      const uniqueRows: EvidenceCitation[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.citationId)) continue;
        seen.add(row.citationId);
        uniqueRows.push(row);
      }

      const top = uniqueRows.slice(0, 3);
      if (!top.length) {
        gaps.push(dim);
      }

      dimensionEvidence.push({
        dimension: dim,
        citations: top
      });

      for (const citation of top) {
        const score = CONFIDENCE_WEIGHT[citation.confidence] * 10000
          + citation.relevanceScore * 100
          + (citation.year || 0);
        const prev = allowedScore.get(citation.citationKey) || 0;
        if (score > prev) {
          allowedScore.set(citation.citationKey, score);
        }
      }
    }

    const allowedCitationKeys = Array.from(allowedScore.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([key]) => key);

    return {
      sectionKey: resolvedSectionKey,
      hasBlueprint: true,
      allowedCitationKeys,
      dimensionEvidence,
      gaps
    };
  }
}

export const evidencePackService = new EvidencePackService();
export { EvidencePackService };
