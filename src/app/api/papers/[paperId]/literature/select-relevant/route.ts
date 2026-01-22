import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { featureFlags } from '@/lib/feature-flags';
import { blueprintService, type BlueprintWithSectionPlan, type SectionPlanItem } from '@/lib/services/blueprint-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow up to 120s for LLM processing with blueprint

const requestSchema = z.object({
  searchRunId: z.string().min(1),
  maxSuggestions: z.number().int().min(1).max(20).optional().default(10),
  includeBlueprint: z.boolean().optional().default(true), // Include blueprint dimension mapping
});

// Enhanced response structure from LLM with citation metadata
interface CitationUsage {
  introduction: boolean;      // Cite for background/context
  literatureReview: boolean;  // Cite for detailed analysis
  methodology: boolean;       // Reference their method
  comparison: boolean;        // Use as baseline/comparison
}

// Dimension mapping for blueprint integration
interface DimensionMapping {
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface CitationMeta {
  keyContribution: string;         // Main contribution (1 sentence)
  keyFindings: string;             // Main results/findings (1 sentence)
  methodologicalApproach: string | null;  // Their method (if relevant)
  relevanceToResearch: string;     // How it relates to user's research
  limitationsOrGaps: string | null;       // What they didn't address
  usage: CitationUsage;
}

interface PaperRelevanceAnalysis {
  paperId: string;
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
  maxSuggestions: number,
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
   - Map to EXACT dimension text from the blueprint above
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
4. How it relates to the research question
5. Limitations or gaps (what they didn't address - useful for positioning your work)
6. WHERE to cite this paper:
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
Analyze these papers and identify the TOP ${maxSuggestions} most relevant papers.${blueprint ? ' Map each paper to the blueprint dimensions it supports.' : ''}
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

Return ONLY papers you recommend. Order by relevance score (highest first).`;
}

function parseAndValidateLLMResponse(
  output: string, 
  validPaperIds: Set<string>,
  blueprint?: BlueprintWithSectionPlan | null
): LLMResponse {
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
    parsed = JSON.parse(cleaned);
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
  const validDimensions = new Map<string, Set<string>>(); // sectionKey -> dimensions
  
  if (blueprint?.sectionPlan) {
    for (const section of blueprint.sectionPlan) {
      validSectionKeys.add(section.sectionKey);
      validDimensions.set(section.sectionKey, new Set(section.mustCover || []));
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
    
    const citationMeta: CitationMeta = {
      keyContribution: String(rawMeta.keyContribution || 'Not specified').slice(0, 300),
      keyFindings: String(rawMeta.keyFindings || 'Not specified').slice(0, 300),
      methodologicalApproach: rawMeta.methodologicalApproach 
        ? String(rawMeta.methodologicalApproach).slice(0, 300) 
        : null,
      relevanceToResearch: String(rawMeta.relevanceToResearch || suggestion.reasoning || 'Relevant to research').slice(0, 300),
      limitationsOrGaps: rawMeta.limitationsOrGaps 
        ? String(rawMeta.limitationsOrGaps).slice(0, 300) 
        : null,
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
        const sectionDimensions = validDimensions.get(dm.sectionKey);
        let matchedDimension = dm.dimension;
        
        if (sectionDimensions) {
          // Try exact match first
          if (!sectionDimensions.has(dm.dimension)) {
            // Try fuzzy match (lowercase, trimmed)
            const normalizedInput = String(dm.dimension).toLowerCase().trim();
            for (const validDim of Array.from(sectionDimensions)) {
              if (validDim.toLowerCase().trim() === normalizedInput) {
                matchedDimension = validDim; // Use the canonical dimension text
                break;
              }
            }
          }
        }
        
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
    const { searchRunId, maxSuggestions, includeBlueprint } = requestSchema.parse(body);

    // Get the search run
    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });
    
    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

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
    const results = searchRun.results as any[];
    if (!results || results.length === 0) {
      return NextResponse.json({ error: 'No search results to analyze' }, { status: 400 });
    }

    // Filter to papers with abstracts for better analysis (but include all if few have abstracts)
    // Limit batch size to avoid output token truncation - blueprint analysis needs more output tokens
    const maxPapersToAnalyze = blueprint ? 15 : 25; // Fewer papers when blueprint mapping is included
    const papersWithAbstracts = results.filter(r => r.abstract);
    const papersToAnalyze = papersWithAbstracts.length >= 5 
      ? papersWithAbstracts.slice(0, maxPapersToAnalyze)
      : results.slice(0, maxPapersToAnalyze);

    // Build valid paper ID set for validation
    const validPaperIds = new Set(papersToAnalyze.map(p => p.id));

    // Build prompt (batch all papers in single call) - include blueprint if available
    const prompt = buildPrompt(researchQuestion, papersToAnalyze, maxSuggestions, blueprint);

    // Get auth headers for LLM gateway
    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = { authorization: authHeader };

    // Execute LLM call (single batch call for cost efficiency)
    const llmResult = await llmGateway.executeLLMOperation(
      { headers },
      {
        taskCode: 'LITERATURE_RELEVANCE',
        stageCode: 'LITERATURE_RELEVANCE',
        prompt,
        parameters: {
          temperature: 0.3, // Lower temp for more consistent analysis
        },
        idempotencyKey: `lit-relevance-${searchRunId}-${Date.now()}`,
        metadata: {
          sessionId,
          searchRunId,
          paperCount: papersToAnalyze.length,
          blueprintId: blueprint?.id || null,
        }
      }
    );

    if (!llmResult.success || !llmResult.response) {
      console.error('[LiteratureRelevance] LLM call failed:', llmResult.error);
      return NextResponse.json({ 
        error: llmResult.error?.message || 'AI analysis failed' 
      }, { status: 500 });
    }

    // Parse and validate LLM response (pass blueprint for validation)
    let analysis: LLMResponse;
    try {
      analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds, blueprint);
    } catch (parseError) {
      console.error('[LiteratureRelevance] Failed to parse LLM response:', parseError);
      console.error('Raw output preview:', llmResult.response.output?.slice(0, 500));
      
      // Return partial success with empty analysis rather than failing completely
      // This allows users to still see their search results even if AI analysis fails
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
          parseError: true
        }
      });
    }

    // Update search run with AI analysis
    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: analysis as any,
        aiAnalyzedAt: new Date(),
        aiModelUsed: llmResult.response.modelClass || 'unknown',
        aiTokensUsed: llmResult.response.outputTokens || 0,
        researchQuestion,
      }
    });

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
          suggestionsReturned: analysis.suggestions.length,
          tokensUsed: llmResult.response.outputTokens,
          blueprintIncluded: !!blueprint,
          dimensionsCovered: analysis.blueprintCoverage?.coveredDimensions || 0,
        }
      }
    });

    return NextResponse.json({
      success: true,
      searchRunId,
      analysis: {
        suggestions: analysis.suggestions,
        summary: analysis.summary,
        blueprintCoverage: analysis.blueprintCoverage,
        analyzedAt: new Date().toISOString(),
        papersAnalyzed: papersToAnalyze.length,
        blueprintIncluded: !!blueprint,
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

