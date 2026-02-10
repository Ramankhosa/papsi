import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { defaultConfig as meteringDefaultConfig } from '@/lib/metering/config';
import { createReservationService } from '@/lib/metering/reservation';
import { featureFlags } from '@/lib/feature-flags';
import { blueprintService, type BlueprintWithSectionPlan, type SectionPlanItem } from '@/lib/services/blueprint-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 300s for LLM processing across all aggregated search runs

const requestSchema = z.object({
  searchRunId: z.string().min(1),
  maxSuggestions: z.number().int().min(1).max(20).optional().default(10),
  includeBlueprint: z.boolean().optional().default(true), // Include blueprint dimension mapping
  forceReanalyze: z.boolean().optional().default(false),  // Skip incremental — re-analyze all papers
});

const updateSchema = z.object({
  searchRunId: z.string().min(1),
  removedResultIds: z.array(z.string().min(1)).min(1)
});

const BATCH_SIZE = 12;
const DEFAULT_PARALLEL_BATCH_LIMIT = parsePositiveInt(
  process.env.LITERATURE_RELEVANCE_DEFAULT_PARALLEL_BATCH_LIMIT,
  5
);
const MAX_PARALLEL_BATCH_LIMIT = parsePositiveInt(
  process.env.LITERATURE_RELEVANCE_MAX_PARALLEL_BATCH_LIMIT,
  15
);
const LITERATURE_TASK_CODE = 'LITERATURE_RELEVANCE' as const;
const reservationService = createReservationService(meteringDefaultConfig);

async function runBatchesInParallel<T, R>(
  batches: T[],
  limit: number,
  worker: (batch: T, index: number) => Promise<R>
): Promise<R[]> {
  if (batches.length === 0) return [];
  const results: R[] = new Array(batches.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, batches.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= batches.length) break;
      results[currentIndex] = await worker(batches[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampParallelLimit(value: number): number {
  return Math.max(1, Math.min(value, MAX_PARALLEL_BATCH_LIMIT));
}

async function resolveParallelBatchLimit(tenantId?: string | null): Promise<number> {
  const defaultLimit = clampParallelLimit(DEFAULT_PARALLEL_BATCH_LIMIT);
  if (!tenantId) {
    return defaultLimit;
  }

  try {
    const meteringLimit = await reservationService.getConcurrencyLimit(tenantId, LITERATURE_TASK_CODE);
    if (typeof meteringLimit === 'number' && meteringLimit > 0) {
      return clampParallelLimit(meteringLimit);
    }
  } catch (error) {
    console.warn('[LiteratureRelevance] Failed to resolve policy concurrency limit, using default:', error);
  }

  return defaultLimit;
}

// Enhanced response structure from LLM with citation metadata
interface CitationUsage {
  introduction: boolean;      // Cite for background/context
  literatureReview: boolean;  // Cite for detailed analysis
  methodology: boolean;       // Reference their method
  comparison: boolean;        // Use as baseline/comparison
}

const CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
type ClaimType = (typeof CLAIM_TYPE_VALUES)[number];
const CLAIM_TYPE_SET = new Set<string>(CLAIM_TYPE_VALUES);

// Dimension mapping for blueprint integration
interface DimensionMapping {
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  dimensionIndex?: number;
}

interface CitationMeta {
  keyContribution: string;         // Main contribution (1 sentence)
  keyFindings: string;             // Main results/findings (1 sentence)
  methodologicalApproach: string | null;  // Their method (if relevant)
  relevanceToResearch: string;     // How it relates to user's research
  limitationsOrGaps: string | null;       // What they didn't address
  claimTypesSupported: ClaimType[]; // Structured claim categories this paper can support
  evidenceBoundary: string | null;  // What should NOT be claimed from this paper
  usage: CitationUsage;
}

interface PaperRelevanceAnalysis {
  paperId: string;
  paperTitle?: string;
  paperDoi?: string;
  paperSource?: string;
  providerPaperId?: string;
  paperIdentityKey?: string;
  isRelevant: boolean;
  relevanceScore: number; // 0-100
  reasoning: string;
  citationMeta: CitationMeta;  // Enhanced metadata for section generation
  dimensionMappings?: DimensionMapping[];  // Blueprint dimension mappings
  recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';  // Import recommendation
}

// Coverage analysis for blueprint gaps
interface BlueprintCoverage {
  totalDimensions: number;
  coveredDimensions: number;
  gaps: Array<{
    sectionKey: string;
    sectionTitle: string;
    dimension: string;
  }>;
  sectionCoverage: Record<string, {
    total: number;
    covered: number;
    dimensions: Array<{
      dimension: string;
      paperCount: number;
      papers: string[];
    }>;
  }>;
}

interface LLMResponse {
  suggestions: PaperRelevanceAnalysis[];
  summary: string;
  blueprintCoverage?: BlueprintCoverage;
}

// Normalize DOIs / titles to build deduplication keys
function normalizeDoi(doi?: string | null) {
  return typeof doi === 'string'
    ? doi.trim().toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
        .replace(/\s+/g, '')
    : '';
}

function normalizeTitle(title?: string | null) {
  return typeof title === 'string'
    ? title
        .trim()
        .toLowerCase()
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

function normalizeAuthor(author?: string | null): string {
  return typeof author === 'string'
    ? author
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function toCitationMetaSnapshot(
  suggestion: Pick<PaperRelevanceAnalysis, 'citationMeta' | 'relevanceScore'>
): CitationMetaSnapshot | undefined {
  const meta = suggestion.citationMeta;
  if (!meta) {
    return undefined;
  }

  return {
    keyContribution: typeof meta.keyContribution === 'string' ? meta.keyContribution.slice(0, 400) : undefined,
    keyFindings: typeof meta.keyFindings === 'string' ? meta.keyFindings.slice(0, 400) : undefined,
    methodologicalApproach: typeof meta.methodologicalApproach === 'string'
      ? meta.methodologicalApproach.slice(0, 400)
      : (meta.methodologicalApproach ?? null),
    relevanceToResearch: typeof meta.relevanceToResearch === 'string' ? meta.relevanceToResearch.slice(0, 500) : undefined,
    limitationsOrGaps: typeof meta.limitationsOrGaps === 'string'
      ? meta.limitationsOrGaps.slice(0, 500)
      : (meta.limitationsOrGaps ?? null),
    claimTypesSupported: Array.isArray(meta.claimTypesSupported)
      ? Array.from(
          new Set(
            meta.claimTypesSupported
              .map(v => String(v).trim().toUpperCase())
              .filter(v => CLAIM_TYPE_SET.has(v))
          )
        ).slice(0, 3) as ClaimType[]
      : undefined,
    evidenceBoundary: typeof meta.evidenceBoundary === 'string'
      ? meta.evidenceBoundary.slice(0, 400)
      : (meta.evidenceBoundary ?? null),
    usage: meta.usage ? {
      introduction: Boolean(meta.usage.introduction),
      literatureReview: Boolean(meta.usage.literatureReview),
      methodology: Boolean(meta.usage.methodology),
      comparison: Boolean(meta.usage.comparison)
    } : undefined,
    relevanceScore: Number.isFinite(Number(suggestion.relevanceScore))
      ? Math.max(0, Math.min(100, Number(suggestion.relevanceScore)))
      : undefined,
    analyzedAt: new Date().toISOString()
  };
}

function deduplicatePapers(papers: any[]) {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const p of papers) {
    const doiKey = normalizeDoi(p.doi);
    const titleKey = normalizeTitle(p.title);
    const idKey = String(p.id || p.paperId || p.citationKey || '').toLowerCase();

    const key = doiKey || titleKey || idKey;
    if (!key) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(p);
  }

  return unique;
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ 
      where: { id: sessionId },
      include: { researchTopic: true, ideaRecord: true }
    });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { researchTopic: true, ideaRecord: true }
  });
}

/**
 * Attempt to salvage a truncated JSON response
 * This handles cases where the LLM output was cut off due to token limits
 */
function attemptJsonSalvage(truncatedJson: string): { suggestions: any[]; summary: string } | null {
  try {
    // Find the suggestions array start
    const suggestionsMatch = truncatedJson.match(/"suggestions"\s*:\s*\[/);
    if (!suggestionsMatch) return null;
    
    const suggestionsStart = suggestionsMatch.index! + suggestionsMatch[0].length;
    
    // Try to find complete suggestion objects by looking for closing braces
    // Each suggestion ends with }] or }, 
    let lastCompleteIndex = -1;
    let braceDepth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = suggestionsStart; i < truncatedJson.length; i++) {
      const char = truncatedJson[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          // Found a complete top-level object in suggestions array
          lastCompleteIndex = i;
        }
      }
    }
    
    if (lastCompleteIndex === -1) return null;
    
    // Extract the valid portion up to the last complete suggestion
    const validSuggestions = truncatedJson.substring(suggestionsStart, lastCompleteIndex + 1);
    
    // Construct a valid JSON object
    const reconstructed = `{"suggestions":[${validSuggestions}],"summary":"Analysis partially completed (response was truncated)"}`;
    
    const parsed = JSON.parse(reconstructed);
    
    // Verify we have at least one suggestion
    if (!parsed.suggestions || parsed.suggestions.length === 0) {
      return null;
    }
    
    console.log(`[LiteratureRelevance] Salvaged ${parsed.suggestions.length} complete suggestion(s) from truncated response`);
    return parsed;
  } catch (error) {
    console.error('[LiteratureRelevance] JSON salvage failed:', error);
    return null;
  }
}

// Sections that should be included in dimension mapping for non-review papers
const LITERATURE_MAPPING_SECTIONS = [
  'introduction',
  'literature_review', 'literature-review', 'literaturereview',
  'background',
  'related_work', 'related-work', 'relatedwork',
  'theoretical_framework', 'theoretical-framework', 'theoreticalframework',
  'methodology', 'methods', 'research_methodology', 'research-methodology',
  'materials_and_methods', 'materials-and-methods'
];

// Check if a section key matches literature mapping sections
function isLiteratureMappingSection(sectionKey: string): boolean {
  const normalized = sectionKey.toLowerCase().replace(/[\s_-]+/g, '_');
  return LITERATURE_MAPPING_SECTIONS.some(s => 
    normalized.includes(s.replace(/[\s_-]+/g, '_')) ||
    s.replace(/[\s_-]+/g, '_').includes(normalized)
  );
}

// Check if paper type is a review paper
function isReviewPaper(paperTypeCode?: string): boolean {
  if (!paperTypeCode) return false;
  const normalized = paperTypeCode.toLowerCase();
  return normalized.includes('review') || 
         normalized.includes('survey') || 
         normalized.includes('meta-analysis') ||
         normalized.includes('systematic');
}

function buildPrompt(
  researchQuestion: string,
  papers: Array<{ id: string; title: string; abstract?: string; authors?: string[]; year?: number }>,
  blueprint?: BlueprintWithSectionPlan | null
): string {
  const paperList = papers.map((p, idx) => {
    const authorStr = p.authors?.slice(0, 3).join(', ') || 'Unknown';
    const yearStr = p.year ? ` (${p.year})` : '';
    const abstractStr = p.abstract 
      ? `\n   Abstract: ${p.abstract.slice(0, 500)}${p.abstract.length > 500 ? '...' : ''}`
      : '\n   Abstract: Not available';
    
    return `${idx + 1}. [ID: ${p.id}] "${p.title}"
   Authors: ${authorStr}${yearStr}${abstractStr}`;
  }).join('\n\n');

  // Build blueprint sections string if available
  let blueprintSection = '';
  let dimensionMappingInstructions = '';
  
  if (blueprint && blueprint.sectionPlan && blueprint.sectionPlan.length > 0) {
    // Filter sections for dimension mapping:
    // - For review papers: include all sections
    // - For other papers: only Introduction, Literature Review, and Methodology
    const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
    const sectionsForMapping = isReview 
      ? blueprint.sectionPlan 
      : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));
    
    console.log(`[LiteratureRelevance] Paper type: ${blueprint.paperTypeCode || 'unknown'}, isReview: ${isReview}, sections for mapping: ${sectionsForMapping.map(s => s.sectionKey).join(', ')}`);
    
    const sectionsText = sectionsForMapping.map((section, idx) => {
      const dimensions = section.mustCover && section.mustCover.length > 0
        ? section.mustCover.map((dim, i) => `    ${i + 1}. "${dim}"`).join('\n')
        : '    (No specific dimensions defined)';
      return `${idx + 1}. ${section.sectionKey} - "${section.purpose}"
   Must Cover Dimensions:
${dimensions}`;
    }).join('\n\n');

    blueprintSection = `
PAPER BLUEPRINT (Frozen Structure):
Central Objective: ${blueprint.centralObjective || 'Not specified'}

SECTIONS AND DIMENSIONS TO COVER:
${sectionsText}
`;

    dimensionMappingInstructions = `
7. DIMENSION MAPPINGS (CRITICAL):
   For each paper, identify which blueprint dimensions it supports:
   - Prefer the dimensionIndex (1-based) from the list above
   - If you provide dimension text, it must match EXACTLY from the blueprint above
   - Provide a grounded remark (1-2 sentences from abstract) explaining how it supports the dimension
   - Assign confidence: HIGH (directly addresses), MEDIUM (partially relevant), LOW (tangentially related)
   - A paper can map to multiple dimensions across different sections
   - Only map if there's concrete evidence in the abstract

8. RECOMMENDATION:
   - "IMPORT" if paper maps to 2+ dimensions with HIGH/MEDIUM confidence
   - "MAYBE" if paper maps to 1 dimension or has only LOW confidence mappings
   - "SKIP" if paper doesn't map to any blueprint dimensions (but might still be useful for background)
`;
  }

  const baseTasks = `
For each paper, determine:
1. Key contribution (1 sentence - what's new/important about this paper)
2. Key findings (1 sentence - main results or conclusions)
3. Methodological approach (if relevant to the research question)
4. How it relates to the research question (1-2 sentences, concrete and specific)
5. Limitations or gaps (what they didn't address - useful for positioning your work)
6. Claim types this paper can support (choose up to 3): BACKGROUND, GAP, METHOD, LIMITATION, DATASET, IMPLEMENTATION_CONSTRAINT
7. Evidence boundary (1 sentence: what NOT to claim from this paper)
8. WHERE to cite this paper:
   - Introduction: Good for background/context/motivation?
   - Literature Review: Needs detailed analysis/comparison?
   - Methodology: Reference their method/approach?
   - Comparison: Use as baseline/competing approach?`;

  // Build JSON schema based on whether blueprint exists
  const jsonSchema = blueprint ? `{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation of overall relevance>",
      "recommendation": "<IMPORT|MAYBE|SKIP>",
      "dimensionMappings": [
        {
          "sectionKey": "<exact section key from blueprint>",
          "dimensionIndex": <1-based index from the section list>,
          "dimension": "<exact dimension text from blueprint>",
          "remark": "<1-2 sentence grounded explanation from abstract>",
          "confidence": "<HIGH|MEDIUM|LOW>"
        }
      ],
      "citationMeta": {
        "keyContribution": "<main contribution in 1 sentence>",
        "keyFindings": "<main results/findings in 1 sentence>",
        "methodologicalApproach": "<their method, or null if not relevant>",
        "relevanceToResearch": "<how it connects to the research question>",
        "limitationsOrGaps": "<what they didn't address, or null>",
        "claimTypesSupported": ["<BACKGROUND|GAP|METHOD|LIMITATION|DATASET|IMPLEMENTATION_CONSTRAINT>"],
        "evidenceBoundary": "<one sentence boundary on what this paper does NOT support, or null>",
        "usage": {
          "introduction": <true/false>,
          "literatureReview": <true/false>,
          "methodology": <true/false>,
          "comparison": <true/false>
        }
      }
    }
  ],
  "summary": "<2-3 sentence summary of coverage analysis>"
}` : `{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation of overall relevance>",
      "citationMeta": {
        "keyContribution": "<main contribution in 1 sentence>",
        "keyFindings": "<main results/findings in 1 sentence>",
        "methodologicalApproach": "<their method, or null if not relevant>",
        "relevanceToResearch": "<how it connects to the research question>",
        "limitationsOrGaps": "<what they didn't address, or null>",
        "claimTypesSupported": ["<BACKGROUND|GAP|METHOD|LIMITATION|DATASET|IMPLEMENTATION_CONSTRAINT>"],
        "evidenceBoundary": "<one sentence boundary on what this paper does NOT support, or null>",
        "usage": {
          "introduction": <true/false>,
          "literatureReview": <true/false>,
          "methodology": <true/false>,
          "comparison": <true/false>
        }
      }
    }
  ],
  "summary": "<1-2 sentence summary of the selected papers>"
}`;

  return `You are a research assistant helping identify relevant papers for academic writing.${blueprint ? ' You will map papers to a structured blueprint with specific dimensions to cover.' : ''}

RESEARCH QUESTION:
${researchQuestion}
${blueprintSection}
CANDIDATE PAPERS:
${paperList}

TASK:
Analyze EVERY paper in the list above for relevance to the research question.${blueprint ? ' Map each paper to the blueprint dimensions it supports.' : ''} Assign a relevance score (0-100) and recommendation to each paper — do NOT skip any.
${baseTasks}${dimensionMappingInstructions}

IMPORTANT CRITERIA:
- Papers with abstracts provide more context - prefer them
- Include foundational/seminal works even if older
- Include papers showing contrasting viewpoints
- Consider methodological relevance${blueprint ? `
- Prioritize papers that cover uncovered dimensions
- A paper covering multiple dimensions is more valuable
- Be precise with dimension mapping - only map if abstract provides evidence` : ''}

Respond in the following JSON format ONLY (no markdown, no explanation outside JSON):
${jsonSchema}

Include ALL papers in the response with their analysis. Order by relevance score (highest first).`;
}

function parseAndValidateLLMResponse(
  output: string, 
  validPaperIds: Set<string>,
  blueprint?: BlueprintWithSectionPlan | null
): LLMResponse {
  const normalizeDimension = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();

  const extractJsonBlock = (text: string) => {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return text;
  };

  // Clean up response - remove markdown code blocks if present
  let cleaned = output.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Handle truncated JSON responses (common when output token limit is hit)
  // Try to salvage partial results by fixing common truncation issues
  let parsed: any;
  try {
    parsed = JSON.parse(extractJsonBlock(cleaned));
  } catch (parseError) {
    console.warn('[LiteratureRelevance] Initial JSON parse failed, attempting to salvage truncated response...');
    
    // Try to fix truncated JSON by finding the last complete suggestion
    const salvaged = attemptJsonSalvage(cleaned);
    if (salvaged) {
      console.log('[LiteratureRelevance] Successfully salvaged partial JSON response');
      parsed = salvaged;
    } else {
      // Re-throw if salvage failed
      throw parseError;
    }
  }
  
  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array');
  }

  // Build valid section keys and dimensions from blueprint
  const validSectionKeys = new Set<string>();
  const validDimensions = new Map<string, Map<string, string>>(); // sectionKey -> normalized -> canonical
  const sectionDimensionsByKey = new Map<string, string[]>(); // sectionKey -> ordered mustCover
  
  if (blueprint?.sectionPlan) {
    const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
    const sectionsForValidation = isReview
      ? blueprint.sectionPlan
      : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

    for (const section of sectionsForValidation) {
      validSectionKeys.add(section.sectionKey);
      const dimMap = new Map<string, string>();
      for (const dim of section.mustCover || []) {
        dimMap.set(normalizeDimension(dim), dim);
      }
      validDimensions.set(section.sectionKey, dimMap);
      sectionDimensionsByKey.set(section.sectionKey, section.mustCover || []);
    }
  }

  // Validate and filter suggestions
  const validatedSuggestions: PaperRelevanceAnalysis[] = [];
  
  for (const suggestion of parsed.suggestions) {
    if (!suggestion.paperId || !validPaperIds.has(suggestion.paperId)) {
      console.warn(`Skipping invalid paperId: ${suggestion.paperId}`);
      continue;
    }
    
    // Parse citation metadata with defaults
    const rawMeta = suggestion.citationMeta || {};
    const usage = rawMeta.usage || {};
    const claimTypesSupported = Array.isArray(rawMeta.claimTypesSupported)
      ? Array.from(
          new Set(
            rawMeta.claimTypesSupported
              .map((value: unknown) => String(value).trim().toUpperCase())
              .filter((value: string) => CLAIM_TYPE_SET.has(value))
          )
        ).slice(0, 3) as ClaimType[]
      : [];
    const evidenceBoundary = typeof rawMeta.evidenceBoundary === 'string'
      ? rawMeta.evidenceBoundary.trim().slice(0, 400)
      : null;
    
    const citationMeta: CitationMeta = {
      keyContribution: String(rawMeta.keyContribution || 'Not specified').slice(0, 400),
      keyFindings: String(rawMeta.keyFindings || 'Not specified').slice(0, 400),
      methodologicalApproach: rawMeta.methodologicalApproach 
        ? String(rawMeta.methodologicalApproach).slice(0, 400) 
        : null,
      relevanceToResearch: String(rawMeta.relevanceToResearch || suggestion.reasoning || 'Relevant to research').slice(0, 500),
      limitationsOrGaps: rawMeta.limitationsOrGaps 
        ? String(rawMeta.limitationsOrGaps).slice(0, 500) 
        : null,
      claimTypesSupported,
      evidenceBoundary: evidenceBoundary || null,
      usage: {
        introduction: Boolean(usage.introduction),
        literatureReview: Boolean(usage.literatureReview !== false), // Default true for relevant papers
        methodology: Boolean(usage.methodology),
        comparison: Boolean(usage.comparison),
      }
    };
    
    // Parse dimension mappings if blueprint exists
    let dimensionMappings: DimensionMapping[] | undefined;
    if (blueprint && suggestion.dimensionMappings && Array.isArray(suggestion.dimensionMappings)) {
      dimensionMappings = [];
      for (const dm of suggestion.dimensionMappings) {
        // Validate section key
        if (!dm.sectionKey || !validSectionKeys.has(dm.sectionKey)) {
          console.warn(`Skipping invalid sectionKey: ${dm.sectionKey}`);
          continue;
        }
        
        // Validate dimension exists in that section (fuzzy match for minor variations)
        let matchedDimension: string | undefined;
        const indexValue = dm.dimensionIndex ?? dm.dimension_index;
        const indexNum = typeof indexValue === 'number'
          ? indexValue
          : (typeof indexValue === 'string' && indexValue.trim() !== '' ? Number(indexValue) : undefined);
        if (typeof indexNum === 'number' && Number.isInteger(indexNum)) {
          const dims = sectionDimensionsByKey.get(dm.sectionKey) || [];
          matchedDimension = dims[indexNum - 1];
        } else {
          const sectionDimensions = validDimensions.get(dm.sectionKey);
          const normalizedInput = normalizeDimension(String(dm.dimension || ''));
          matchedDimension = sectionDimensions?.get(normalizedInput);
        }
        if (!matchedDimension) continue;

        dimensionMappings.push({
          sectionKey: dm.sectionKey,
          dimension: String(matchedDimension).slice(0, 500),
          remark: String(dm.remark || 'No remark provided').slice(0, 500),
          confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(dm.confidence) 
            ? dm.confidence 
            : 'MEDIUM'
        });
      }
    }
    
    // Determine recommendation based on dimension mappings
    let recommendation: 'IMPORT' | 'MAYBE' | 'SKIP' | undefined;
    if (blueprint) {
      if (suggestion.recommendation && ['IMPORT', 'MAYBE', 'SKIP'].includes(suggestion.recommendation)) {
        recommendation = suggestion.recommendation;
      } else if (dimensionMappings && dimensionMappings.length > 0) {
        const highMediumCount = dimensionMappings.filter(
          dm => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM'
        ).length;
        recommendation = highMediumCount >= 2 ? 'IMPORT' : highMediumCount >= 1 ? 'MAYBE' : 'SKIP';
      } else {
        recommendation = 'SKIP';
      }
    }
    
    validatedSuggestions.push({
      paperId: suggestion.paperId,
      isRelevant: suggestion.isRelevant !== false,
      relevanceScore: Math.min(100, Math.max(0, Number(suggestion.relevanceScore) || 50)),
      reasoning: String(suggestion.reasoning || 'No reasoning provided').slice(0, 500),
      citationMeta,
      dimensionMappings,
      recommendation,
    });
  }

  // Calculate blueprint coverage if blueprint exists
  let blueprintCoverage: BlueprintCoverage | undefined;
  if (blueprint?.sectionPlan) {
    blueprintCoverage = calculateBlueprintCoverage(blueprint, validatedSuggestions);
  }

  return {
    suggestions: validatedSuggestions,
    summary: String(parsed.summary || 'AI analysis completed'),
    blueprintCoverage,
  };
}

// Calculate coverage of blueprint dimensions
function calculateBlueprintCoverage(
  blueprint: BlueprintWithSectionPlan,
  suggestions: PaperRelevanceAnalysis[]
): BlueprintCoverage {
  const sectionCoverage: BlueprintCoverage['sectionCoverage'] = {};
  const gaps: BlueprintCoverage['gaps'] = [];
  let totalDimensions = 0;
  let coveredDimensions = 0;

  // Filter sections for coverage calculation (same logic as prompt building)
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForCoverage = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

  for (const section of sectionsForCoverage) {
    const dimensions = section.mustCover || [];
    const dimensionData: BlueprintCoverage['sectionCoverage'][string]['dimensions'] = [];
    
    for (const dimension of dimensions) {
      totalDimensions++;
      
      // Find papers that map to this dimension
      const matchingPapers: string[] = [];
      for (const suggestion of suggestions) {
        if (suggestion.dimensionMappings) {
          const hasMapping = suggestion.dimensionMappings.some(
            dm => dm.sectionKey === section.sectionKey && 
                  dm.dimension.toLowerCase().trim() === dimension.toLowerCase().trim()
          );
          if (hasMapping) {
            matchingPapers.push(suggestion.paperId);
          }
        }
      }
      
      dimensionData.push({
        dimension,
        paperCount: matchingPapers.length,
        papers: matchingPapers
      });
      
      if (matchingPapers.length > 0) {
        coveredDimensions++;
      } else {
        gaps.push({
          sectionKey: section.sectionKey,
          sectionTitle: section.purpose,
          dimension
        });
      }
    }
    
    sectionCoverage[section.sectionKey] = {
      total: dimensions.length,
      covered: dimensionData.filter(d => d.paperCount > 0).length,
      dimensions: dimensionData
    };
  }

  return {
    totalDimensions,
    coveredDimensions,
    gaps,
    sectionCoverage
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

type CitationLookupIndex = {
  byId: Map<string, CitationLookupRow>;
  byIdentity: Map<string, CitationLookupRow[]>;
  byDoi: Map<string, CitationLookupRow[]>;
  byProviderAndPaperId: Map<string, CitationLookupRow[]>;
  byProviderPaperId: Map<string, CitationLookupRow[]>;
  byTitleFingerprint: Map<string, CitationLookupRow[]>;
};

function pushLookup(map: Map<string, CitationLookupRow[]>, key: string, value: CitationLookupRow) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(value);
}

function buildCitationLookupIndex(citations: CitationLookupRow[]): CitationLookupIndex {
  const byId = new Map<string, CitationLookupRow>();
  const byIdentity = new Map<string, CitationLookupRow[]>();
  const byDoi = new Map<string, CitationLookupRow[]>();
  const byProviderAndPaperId = new Map<string, CitationLookupRow[]>();
  const byProviderPaperId = new Map<string, CitationLookupRow[]>();
  const byTitleFingerprint = new Map<string, CitationLookupRow[]>();

  for (const row of citations) {
    byId.set(row.id, row);
    if (row.paperIdentityKey) {
      pushLookup(byIdentity, row.paperIdentityKey, row);
    }
    if (row.doiNormalized) {
      pushLookup(byDoi, row.doiNormalized, row);
    }
    if (row.importProviderPaperId) {
      pushLookup(byProviderPaperId, row.importProviderPaperId, row);
      const providerPair = `${normalizeProvider(row.importProvider)}::${row.importProviderPaperId}`;
      pushLookup(byProviderAndPaperId, providerPair, row);
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

function narrowCitationCandidates(
  candidates: CitationLookupRow[],
  suggestion: PaperRelevanceAnalysis
): CitationLookupRow[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const identity = suggestion.paperIdentityKey || '';
  const yearMatch = identity.match(/\|y:([^|]+)/);
  const authorMatch = identity.match(/\|fa:([^|]+)/);
  const expectedYear = yearMatch && yearMatch[1] !== 'na' ? Number(yearMatch[1]) : undefined;
  const expectedAuthor = authorMatch?.[1] && authorMatch[1] !== 'na' ? authorMatch[1] : '';

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

function resolveCitationForSuggestion(
  suggestion: PaperRelevanceAnalysis,
  index: CitationLookupIndex
): CitationLookupRow | null {
  if (suggestion.paperId && index.byId.has(suggestion.paperId)) {
    return index.byId.get(suggestion.paperId) || null;
  }

  if (suggestion.paperIdentityKey) {
    const byIdentity = narrowCitationCandidates(index.byIdentity.get(suggestion.paperIdentityKey) || [], suggestion);
    if (byIdentity.length > 0) {
      return byIdentity[0];
    }
  }

  const normalizedDoi = normalizeDoi(suggestion.paperDoi);
  if (normalizedDoi) {
    const byDoi = narrowCitationCandidates(index.byDoi.get(normalizedDoi) || [], suggestion);
    if (byDoi.length > 0) {
      return byDoi[0];
    }
  }

  const providerPaperId = suggestion.providerPaperId || suggestion.paperId;
  if (providerPaperId) {
    const providerPairKey = `${normalizeProvider(suggestion.paperSource)}::${providerPaperId}`;
    const byProviderPair = narrowCitationCandidates(index.byProviderAndPaperId.get(providerPairKey) || [], suggestion);
    if (byProviderPair.length > 0) {
      return byProviderPair[0];
    }

    const byProviderPaperId = narrowCitationCandidates(index.byProviderPaperId.get(providerPaperId) || [], suggestion);
    if (byProviderPaperId.length > 0) {
      return byProviderPaperId[0];
    }
  }

  const titleFingerprint = normalizeTitle(suggestion.paperTitle);
  if (titleFingerprint) {
    const byTitle = narrowCitationCandidates(index.byTitleFingerprint.get(titleFingerprint) || [], suggestion);
    if (byTitle.length > 0) {
      return byTitle[0];
    }
  }

  return null;
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    // Check feature flag
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

    // Authenticate user
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Get session
    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Parse request
    const body = await request.json();
    const { searchRunId, maxSuggestions, includeBlueprint, forceReanalyze } = requestSchema.parse(body);

    // Get the search run
    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });
    
    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

    // Collect all search runs for the session to cover the full search space
    const allRuns = await prisma.literatureSearchRun.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 50 // safety cap
    });

    // Merge results across runs, excluding user-removed items
    const removedAcrossRuns = new Set<string>();
    for (const run of allRuns) {
      const removed = (run.aiAnalysis as any)?.removedResultIds;
      if (Array.isArray(removed)) {
        removed.forEach((id: string) => removedAcrossRuns.add(String(id)));
      }
    }

    const aggregatedResults = deduplicatePapers(
      allRuns.flatMap(run => Array.isArray(run.results) ? run.results : [])
    ).filter(p => !removedAcrossRuns.has(String(p.id || p.paperId || p.citationKey || p.doi || '')));

    // Fetch blueprint if requested and available
    let blueprint: BlueprintWithSectionPlan | null = null;
    if (includeBlueprint) {
      blueprint = await blueprintService.getBlueprint(sessionId);
    }

    // Get research question from session or blueprint
    const researchQuestion = blueprint?.centralObjective
      || session.researchTopic?.researchQuestion 
      || session.ideaRecord?.title 
      || session.ideaRecord?.problem
      || 'General research topic';

    // Parse search results
    const results = aggregatedResults;
    if (!results || results.length === 0) {
      return NextResponse.json({ error: 'No search results to analyze' }, { status: 400 });
    }

    // Prefer papers with abstracts — title-only papers produce lower-quality
    // results.  However, if fewer than 5 papers have abstracts fall back to
    // ALL papers so the user still gets analysis.  Skipped IDs are returned
    // in the response so the frontend can show a "No Abstract" indicator.
    const papersWithAbstracts = results.filter((r: any) => r.abstract);
    const papersToAnalyze = papersWithAbstracts.length >= 5
      ? papersWithAbstracts
      : results;  // fallback: include title-only papers when few abstracts are available
    const skippedNoAbstract = results.filter((r: any) => !r.abstract && !papersToAnalyze.includes(r));
    const skippedNoAbstractIds = skippedNoAbstract.map((r: any) => String(r.id || r.paperId || r.citationKey || ''));

    if (papersToAnalyze.length === 0) {
      return NextResponse.json({ error: 'No papers available for analysis (all results lack abstracts and fallback threshold not met)' }, { status: 400 });
    }

    // ── Incremental analysis: skip papers that already have a successful suggestion ──
    // On re-click we only send NEW + PREVIOUSLY-FAILED papers to the LLM.
    // Previous suggestions for successful papers are preserved and merged into the
    // final result.  Pass forceReanalyze=true to bypass this and re-analyze everything.
    const existingAnalysis = (searchRun.aiAnalysis as any) || {};
    const existingSuggestions: any[] = Array.isArray(existingAnalysis.suggestions) ? existingAnalysis.suggestions : [];
    const previouslyFailedIds = new Set<string>(
      Array.isArray(existingAnalysis.analysisMeta?.failedPaperIds) ? existingAnalysis.analysisMeta.failedPaperIds : []
    );
    const alreadyAnalyzedIds = new Set<string>(
      existingSuggestions.map((s: any) => String(s.paperId || ''))
    );

    let papersNeedingAnalysis: typeof papersToAnalyze;
    let carriedOverSuggestions: any[] = [];

    if (forceReanalyze || existingSuggestions.length === 0) {
      // First analysis or explicit re-analysis — send everything
      papersNeedingAnalysis = papersToAnalyze;
    } else {
      // Incremental: only analyze papers that are NEW or previously FAILED
      papersNeedingAnalysis = papersToAnalyze.filter((p: any) => {
        const pid = String(p.id || p.paperId || p.citationKey || '');
        return !alreadyAnalyzedIds.has(pid) || previouslyFailedIds.has(pid);
      });
      // Carry over successful suggestions from the previous run
      carriedOverSuggestions = existingSuggestions.filter((s: any) => {
        const pid = String(s.paperId || '');
        return !previouslyFailedIds.has(pid);
      });
    }

    console.log(`[LiteratureRelevance] Analyzing ${papersNeedingAnalysis.length} papers (${papersWithAbstracts.length} with abstracts, ${skippedNoAbstract.length} skipped, ${carriedOverSuggestions.length} carried over from previous analysis, forceReanalyze=${forceReanalyze})`);

    // If all papers were already analyzed and none need re-analysis, return the existing data
    if (papersNeedingAnalysis.length === 0 && carriedOverSuggestions.length > 0) {
      const blueprintCoverage = blueprint?.sectionPlan
        ? calculateBlueprintCoverage(blueprint, carriedOverSuggestions)
        : undefined;
      return NextResponse.json({
        success: true,
        searchRunId,
        analysis: {
          suggestions: carriedOverSuggestions,
          summary: 'All papers already analyzed. Click again with force re-analyze to refresh.',
          blueprintCoverage,
          analyzedAt: existingAnalysis.analyzedAt || new Date().toISOString(),
          papersAnalyzed: papersToAnalyze.length,
          blueprintIncluded: !!blueprint,
          parseError: false,
          analysisMeta: existingAnalysis.analysisMeta || {
            totalPapers: papersToAnalyze.length,
            reviewedPapers: carriedOverSuggestions.length,
            failedPapers: 0,
            failedPaperIds: [],
            skippedNoAbstractIds,
            skippedNoAbstractCount: skippedNoAbstractIds.length
          }
        }
      });
    }

    const batches: typeof papersNeedingAnalysis[] = [];
    for (let i = 0; i < papersNeedingAnalysis.length; i += BATCH_SIZE) {
      batches.push(papersNeedingAnalysis.slice(i, i + BATCH_SIZE));
    }

    const parallelBatchLimit = await resolveParallelBatchLimit(user.tenantId);
    console.log(
      `[LiteratureRelevance] Effective parallel batch limit: ${parallelBatchLimit} (default=${DEFAULT_PARALLEL_BATCH_LIMIT}, max=${MAX_PARALLEL_BATCH_LIMIT})`
    );

    const totalBatches = batches.length;

    // Get auth headers for LLM gateway
    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = { authorization: authHeader };

    // Token consumption safeguard: hard cap on LLM calls per request.
    let llmCallCount = 0;
    const MAX_LLM_CALLS_PER_REQUEST = 50;

    const processBatchWithRetry = async (
      batch: typeof papersToAnalyze,
      batchIndex: number,
      depth: number = 0
    ): Promise<{
      suggestions: PaperRelevanceAnalysis[];
      summary: string;
      parseError: boolean;
      outputTokens: number;
      modelClass: string;
      failedPaperIds: string[];
    }> => {
      // Outer try-catch: prevents ANY exception from propagating up and
      // killing Promise.all (which would abort all remaining batches)
      try {
        if (llmCallCount >= MAX_LLM_CALLS_PER_REQUEST) {
          console.warn(`[LiteratureRelevance] LLM call budget exhausted (${llmCallCount}/${MAX_LLM_CALLS_PER_REQUEST}), skipping batch ${batchIndex + 1}`);
          return { suggestions: [], summary: '', parseError: true, outputTokens: 0, modelClass: 'unknown', failedPaperIds: batch.map(p => p.id) };
        }

        const validPaperIds = new Set(batch.map(p => p.id));
        const prompt = buildPrompt(
          researchQuestion,
          batch,
          blueprint
        );

        // The metering system enforces a per-task concurrency limit on active
        // reservations. Retry with back-off so every batch eventually gets a slot.
        const MAX_CONCURRENCY_RETRIES = 8;
        let llmResult: any = null;

        for (let attempt = 0; attempt <= MAX_CONCURRENCY_RETRIES; attempt++) {
          llmResult = await llmGateway.executeLLMOperation(
            { headers },
            {
              taskCode: LITERATURE_TASK_CODE,
              stageCode: LITERATURE_TASK_CODE,
              prompt,
              parameters: {
                temperature: 0.3,
              },
              idempotencyKey: `lit-relevance-${searchRunId}-${Date.now()}-${batchIndex}-${depth}-${attempt}`,
              metadata: {
                sessionId,
                searchRunId,
                paperCount: batch.length,
                batchIndex: batchIndex + 1,
                totalBatches,
                blueprintId: blueprint?.id || null,
              }
            }
          );

          if (llmResult.success && llmResult.response) {
            llmCallCount++;
            break;
          }

          const errorCode = (llmResult.error as any)?.code;
          if (errorCode === 'CONCURRENCY_LIMIT' && attempt < MAX_CONCURRENCY_RETRIES) {
            const delayMs = (attempt + 1) * 3000;
            console.log(`[LiteratureRelevance] Concurrency limit hit for batch ${batchIndex + 1}, waiting ${delayMs / 1000}s (${attempt + 1}/${MAX_CONCURRENCY_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }

          break;
        }

        if (!llmResult?.success || !llmResult?.response) {
          const errorCode = (llmResult?.error as any)?.code || 'UNKNOWN';
          console.error(`[LiteratureRelevance] LLM call failed for batch ${batchIndex + 1} (${errorCode}):`, llmResult?.error);
          return { suggestions: [], summary: '', parseError: true, outputTokens: 0, modelClass: 'unknown', failedPaperIds: batch.map(p => p.id) };
        }

        try {
          const analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds, blueprint);
          const paperById = new Map(batch.map(paper => [paper.id, paper]));
          const enrichedSuggestions = analysis.suggestions.map(suggestion => {
            const paper = paperById.get(suggestion.paperId);
            const normalizedDoi = normalizeDoi(paper?.doi);
            const normalizedTitle = normalizeTitle(paper?.title);
            const firstAuthor = Array.isArray(paper?.authors) && paper?.authors.length > 0
              ? normalizeAuthor(String(paper.authors[0]))
              : 'na';
            const identityKey = normalizedDoi
              ? `doi:${normalizedDoi}`
              : (normalizedTitle
                ? `tfp:${normalizedTitle}|y:${paper?.year || 'na'}|fa:${firstAuthor || 'na'}`
                : undefined);
            return {
              ...suggestion,
              paperTitle: paper?.title,
              paperDoi: paper?.doi,
              paperSource: paper?.source,
              providerPaperId: paper?.id,
              paperIdentityKey: identityKey
            };
          });

          // Track papers the LLM omitted from its response
          const returnedPaperIds = new Set(analysis.suggestions.map(s => s.paperId));
          const missedInBatch = batch.filter(p => !returnedPaperIds.has(p.id));
          let missedSuggestions: PaperRelevanceAnalysis[] = [];
          let missedFailedIds: string[] = [];

          // Immediately retry missed papers with a smaller batch (avoids
          // waiting for a second pass or re-click). Only retry when there
          // are ≥1 missed papers AND the batch had more than just those
          // papers (otherwise we'd loop on the same set).
          if (missedInBatch.length > 0 && missedInBatch.length < batch.length && depth < 2) {
            console.warn(`[LiteratureRelevance] LLM missed ${missedInBatch.length} paper(s) in batch ${batchIndex + 1}, retrying missed papers immediately`);
            const missedResult = await processBatchWithRetry(missedInBatch, batchIndex, depth + 1);
            missedSuggestions = missedResult.suggestions;
            missedFailedIds = missedResult.failedPaperIds;
          } else if (missedInBatch.length > 0) {
            missedFailedIds = missedInBatch.map(p => p.id);
            console.warn(`[LiteratureRelevance] LLM missed ${missedInBatch.length} paper(s) in batch ${batchIndex + 1}: ${missedFailedIds.join(', ')}`);
          }

          return {
            ...analysis,
            suggestions: [...enrichedSuggestions, ...missedSuggestions] as any[],
            parseError: false,
            outputTokens: llmResult.response.outputTokens || 0,
            modelClass: llmResult.response.modelClass || 'unknown',
            failedPaperIds: missedFailedIds
          };
        } catch (parseError) {
          console.error(`[LiteratureRelevance] Failed to parse LLM response for batch ${batchIndex + 1}:`, parseError);
          console.error('Raw output preview:', llmResult.response.output?.slice(0, 500));
          if (batch.length > 1 && depth < 2) {
            console.warn(`[LiteratureRelevance] Retrying batch ${batchIndex + 1} with smaller chunks (size ${batch.length})`);
            const mid = Math.ceil(batch.length / 2);
            // Run both halves in parallel — halves the retry latency
            const [left, right] = await Promise.all([
              processBatchWithRetry(batch.slice(0, mid), batchIndex, depth + 1),
              processBatchWithRetry(batch.slice(mid), batchIndex, depth + 1)
            ]);
            return {
              suggestions: [...left.suggestions, ...right.suggestions],
              summary: left.summary || right.summary || '',
              parseError: left.parseError || right.parseError,
              outputTokens: (left.outputTokens || 0) + (right.outputTokens || 0),
              modelClass: left.modelClass !== 'unknown' ? left.modelClass : right.modelClass,
              failedPaperIds: [...left.failedPaperIds, ...right.failedPaperIds]
            };
          }
          return {
            suggestions: [],
            summary: '',
            parseError: true,
            outputTokens: llmResult.response.outputTokens || 0,
            modelClass: llmResult.response.modelClass || 'unknown',
            failedPaperIds: batch.map(p => p.id)
          };
        }
      } catch (outerError) {
        // Catch-all: LLM gateway exceptions, network errors, unexpected failures
        console.error(`[LiteratureRelevance] Unexpected error in batch ${batchIndex + 1}:`, outerError);
        return {
          suggestions: [],
          summary: '',
          parseError: true,
          outputTokens: 0,
          modelClass: 'unknown',
          failedPaperIds: batch.map(p => p.id)
        };
      }
    };

    const batchResults = await runBatchesInParallel(batches, parallelBatchLimit, async (batch, batchIndex) => {
      return processBatchWithRetry(batch, batchIndex);
    });

    let parseError = batchResults.some(r => r.parseError);
    let totalOutputTokens = batchResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
    let newSuggestions = batchResults.flatMap(r => r.suggestions || []);
    let failedPaperIds = Array.from(new Set(batchResults.flatMap(r => r.failedPaperIds || [])));

    // Second pass: retry failed/missed papers (ensures up to 2 attempts per paper)
    if (failedPaperIds.length > 0) {
      const failedSet = new Set(failedPaperIds);
      const retryPapers = papersNeedingAnalysis.filter((p: any) => failedSet.has(p.id));
      if (retryPapers.length > 0) {
        console.log(`[LiteratureRelevance] Retry pass: ${retryPapers.length} paper(s) failed/missed in first pass, retrying with smaller batches...`);
        const retryBatchSize = Math.min(BATCH_SIZE, 4); // smaller batches for retry
        const retryBatches: typeof papersNeedingAnalysis[] = [];
        for (let i = 0; i < retryPapers.length; i += retryBatchSize) {
          retryBatches.push(retryPapers.slice(i, i + retryBatchSize));
        }
        const retryResults = await runBatchesInParallel(retryBatches, parallelBatchLimit, async (batch, idx) => {
          return processBatchWithRetry(batch, totalBatches + idx);
        });
        const retrySuggestions = retryResults.flatMap(r => r.suggestions || []);
        const retryStillFailed = Array.from(new Set(retryResults.flatMap(r => r.failedPaperIds || [])));
        totalOutputTokens += retryResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);

        // Merge: prefer retry results for papers that were retried successfully
        const retryPaperIdSet = new Set(retrySuggestions.map((s: any) => String(s.paperId || '')));
        newSuggestions = [
          ...newSuggestions.filter((s: any) => !retryPaperIdSet.has(String(s.paperId || ''))),
          ...retrySuggestions
        ];
        failedPaperIds = retryStillFailed; // Only papers that failed BOTH passes
        parseError = parseError || retryResults.some(r => r.parseError);
        console.log(`[LiteratureRelevance] Retry complete: ${retrySuggestions.length} recovered, ${retryStillFailed.length} still failed`);
      }
    }

    // Merge new suggestions with carried-over suggestions from the previous run.
    // New suggestions take priority (in case a previously-failed paper now succeeded).
    const newSuggestionIds = new Set(newSuggestions.map((s: any) => String(s.paperId || '')));
    const mergedSuggestions = [
      ...newSuggestions,
      ...carriedOverSuggestions.filter((s: any) => !newSuggestionIds.has(String(s.paperId || '')))
    ];

    const totalPapers = papersToAnalyze.length;
    const reviewedPapers = Math.max(0, mergedSuggestions.length);
    // Return ALL analyzed papers sorted by relevance — don't truncate.
    // All papers consumed LLM tokens; discarding results wastes that spend.
    // The frontend can filter/paginate as needed.
    const sortedSuggestions = mergedSuggestions
      .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    const summary = totalBatches > 1
      ? `AI analysis completed across ${totalBatches} batches.`
      : (batchResults[0]?.summary || 'AI analysis completed.');
    const blueprintCoverage = blueprint?.sectionPlan
      ? calculateBlueprintCoverage(blueprint, sortedSuggestions)
      : undefined;

    // If all batches failed, return partial success with empty analysis
    if (sortedSuggestions.length === 0 && parseError) {
      return NextResponse.json({
        success: true,
        searchRunId,
        analysis: {
          suggestions: [],
          summary: 'AI analysis completed but results could not be parsed. You can still manually review papers.',
          blueprintCoverage: blueprint ? {
            totalDimensions: blueprint.sectionPlan.reduce((acc, s) => acc + (s.mustCover?.length || 0), 0),
            coveredDimensions: 0,
            gaps: blueprint.sectionPlan.flatMap(s => (s.mustCover || []).map(d => ({
              sectionKey: s.sectionKey,
              sectionTitle: s.purpose,
              dimension: d
            }))),
            sectionCoverage: {}
          } : undefined,
          analyzedAt: new Date().toISOString(),
          papersAnalyzed: papersToAnalyze.length,
          blueprintIncluded: !!blueprint,
          parseError: true,
          analysisMeta: {
            totalPapers,
            reviewedPapers,
            failedPapers: failedPaperIds.length,
            failedPaperIds,
            skippedNoAbstractIds,
            skippedNoAbstractCount: skippedNoAbstractIds.length
          }
        }
      });
    }

    const modelUsed = batchResults.find(r => r.modelClass && r.modelClass !== 'unknown')?.modelClass || 'unknown';
    const existingRemoved = Array.isArray((searchRun.aiAnalysis as any)?.removedResultIds)
      ? (searchRun.aiAnalysis as any).removedResultIds
      : [];

    // Update search run with AI analysis
    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: {
          suggestions: sortedSuggestions,
          summary,
          blueprintCoverage,
          parseError: parseError || undefined,
          removedResultIds: existingRemoved,
          analysisMeta: {
            totalPapers,
            reviewedPapers,
            failedPapers: failedPaperIds.length,
            failedPaperIds,
            skippedNoAbstractIds,
            skippedNoAbstractCount: skippedNoAbstractIds.length
          }
        } as any,
        aiAnalyzedAt: new Date(),
        aiModelUsed: modelUsed,
        aiTokensUsed: totalOutputTokens,
        researchQuestion,
      }
    });

    // ============================================================================
    // PERSIST DIMENSION MAPPINGS TO CitationUsage FOR DRAFTING SERVICE
    // This ensures the "Analyze & Map to Blueprint" button in search results
    // also populates the CitationUsage table used by the drafting service.
    // ============================================================================
    if (blueprint && sortedSuggestions.length > 0) {
      try {
        const citationRows = await prisma.citation.findMany({
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

        const citationLookup = buildCitationLookupIndex(citationRows as CitationLookupRow[]);

        const mappingsToPersist: PaperBlueprintMapping[] = [];
        const mappedCitationIds = new Set<string>();
        let unmatchedSuggestions = 0;

        for (const suggestion of sortedSuggestions) {
          const citation = resolveCitationForSuggestion(suggestion, citationLookup);
          if (!citation) {
            unmatchedSuggestions++;
            continue;
          }

          mappedCitationIds.add(citation.id);
          const citationMeta = toCitationMetaSnapshot(suggestion);
          const dimensionMappings = suggestion.dimensionMappings || [];
          if (dimensionMappings.length === 0) {
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: null,
              dimensionMappings: [],
              mappingStatus: 'UNMAPPED',
              citationMeta
            });
            continue;
          }

          // Group dimension mappings by section
          const bySection = new Map<string, typeof dimensionMappings>();
          for (const dm of dimensionMappings) {
            if (!dm.sectionKey) continue;
            if (!bySection.has(dm.sectionKey)) {
              bySection.set(dm.sectionKey, []);
            }
            bySection.get(dm.sectionKey)!.push(dm);
          }
          
          if (bySection.size === 0) {
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: null,
              dimensionMappings: [],
              mappingStatus: 'UNMAPPED',
              citationMeta
            });
            continue;
          }
          
          // Create one mapping entry per section
          for (const [mappedSectionKey, sectionMappings] of Array.from(bySection.entries())) {
            const highMediumCount = sectionMappings.filter(
              (dm: DimensionMapping) => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM'
            ).length;
            const mappingStatus = highMediumCount >= 2 ? 'MAPPED' 
              : highMediumCount >= 1 ? 'WEAK' 
              : sectionMappings.length > 0 ? 'WEAK' : 'UNMAPPED';
            
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: mappedSectionKey,
              dimensionMappings: sectionMappings.map((dm: DimensionMapping) => ({
                dimension: dm.dimension,
                remark: dm.remark,
                confidence: dm.confidence
              })),
              mappingStatus,
              citationMeta
            });
          }
        }

        if (unmatchedSuggestions > 0) {
          console.log(`[LiteratureRelevance] ${unmatchedSuggestions} suggestion(s) could not be reconciled to imported citations yet`);
        }

        // Persist to CitationUsage table
        if (mappingsToPersist.length > 0) {
          const citationIds = Array.from(mappedCitationIds);
          await citationMappingService.clearMappingsForCitations(sessionId, citationIds);
          await citationMappingService.storeMappings(sessionId, mappingsToPersist);
          console.log(`[LiteratureRelevance] Persisted ${mappingsToPersist.length} mapping row(s) to CitationUsage for ${citationIds.length} citation(s)`);
        }
      } catch (mappingError) {
        // Don't fail the request if mapping persistence fails - just log it
        console.error('[LiteratureRelevance] Failed to persist dimension mappings to CitationUsage:', mappingError);
      }
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'LITERATURE_AI_ANALYSIS',
        resource: `literature_search_run:${searchRunId}`,
        meta: {
          sessionId,
          papersAnalyzed: papersToAnalyze.length,
          suggestionsReturned: sortedSuggestions.length,
          tokensUsed: totalOutputTokens,
          blueprintIncluded: !!blueprint,
          dimensionsCovered: blueprintCoverage?.coveredDimensions || 0,
        }
      }
    });

    return NextResponse.json({
      success: true,
      searchRunId,
      analysis: {
        suggestions: sortedSuggestions,
        summary,
        blueprintCoverage,
        analyzedAt: new Date().toISOString(),
        papersAnalyzed: papersToAnalyze.length,
        blueprintIncluded: !!blueprint,
        parseError: parseError || undefined,
        analysisMeta: {
          totalPapers,
          reviewedPapers,
          failedPapers: failedPaperIds.length,
          failedPaperIds,
          skippedNoAbstractIds,
          skippedNoAbstractCount: skippedNoAbstractIds.length
        }
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureRelevance] POST error:', error);
    return NextResponse.json({ error: 'Failed to analyze literature relevance' }, { status: 500 });
  }
}

// PATCH - Persist removed search results for a run
export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
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
    const { searchRunId, removedResultIds } = updateSchema.parse(body);

    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });

    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

    const existingAnalysis = (searchRun.aiAnalysis as Record<string, any>) || {};
    const existingRemoved = Array.isArray(existingAnalysis.removedResultIds)
      ? existingAnalysis.removedResultIds
      : [];
    const merged = new Set<string>([...existingRemoved, ...removedResultIds]);

    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: {
          ...existingAnalysis,
          removedResultIds: Array.from(merged)
        }
      }
    });

    return NextResponse.json({
      success: true,
      removedResultIds: Array.from(merged)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureRelevance] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update removed results' }, { status: 500 });
  }
}

// GET - Retrieve existing AI analysis for a search run
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

    const { searchParams } = new URL(request.url);
    const searchRunId = searchParams.get('searchRunId');

    if (searchRunId) {
      // Get specific search run
      const searchRun = await prisma.literatureSearchRun.findFirst({
        where: { id: searchRunId, sessionId }
      });
      
      if (!searchRun) {
        return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
      }

      return NextResponse.json({
        searchRun: {
          id: searchRun.id,
          query: searchRun.query,
          results: searchRun.results,
          aiAnalysis: searchRun.aiAnalysis,
          aiAnalyzedAt: searchRun.aiAnalyzedAt,
          createdAt: searchRun.createdAt,
        }
      });
    }

    // Get all search runs for session (increased limit to preserve accumulated results across refresh)
    const searchRuns = await prisma.literatureSearchRun.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20, // Increased to preserve more accumulated results
      select: {
        id: true,
        query: true,
        sources: true,
        aiAnalysis: true,
        aiAnalyzedAt: true,
        createdAt: true,
      }
    });

    return NextResponse.json({ searchRuns });

  } catch (error) {
    console.error('[LiteratureRelevance] GET error:', error);
    return NextResponse.json({ error: 'Failed to retrieve search runs' }, { status: 500 });
  }
}
