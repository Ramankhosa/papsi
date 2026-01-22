import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { featureFlags } from '@/lib/feature-flags';
import { blueprintService, type BlueprintWithSectionPlan } from '@/lib/services/blueprint-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const requestSchema = z.object({
  citations: z.array(z.object({
    id: z.string(),
    title: z.string(),
    abstract: z.string().nullable().optional(),
    authors: z.array(z.string()).optional(),
    year: z.number().nullable().optional(),
    doi: z.string().nullable().optional()
  })).min(1).max(50),
  includeBlueprint: z.boolean().optional().default(true),
});

// Dimension mapping for blueprint integration
interface DimensionMapping {
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface CitationAnalysis {
  paperId: string;
  isRelevant: boolean;
  relevanceScore: number;
  reasoning: string;
  dimensionMappings?: DimensionMapping[];
  recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
}

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
  suggestions: CitationAnalysis[];
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

function buildPrompt(
  researchQuestion: string,
  papers: Array<{ id: string; title: string; abstract?: string | null; authors?: string[]; year?: number | null }>,
  blueprint: BlueprintWithSectionPlan
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
  const isLiteratureMappingSection = (sectionKey: string): boolean => {
    const normalized = sectionKey.toLowerCase().replace(/[\s_-]+/g, '_');
    return LITERATURE_MAPPING_SECTIONS.some(s => 
      normalized.includes(s.replace(/[\s_-]+/g, '_')) ||
      s.replace(/[\s_-]+/g, '_').includes(normalized)
    );
  };

  // Check if paper type is a review paper
  const isReviewPaper = (paperTypeCode?: string): boolean => {
    if (!paperTypeCode) return false;
    const normalized = paperTypeCode.toLowerCase();
    return normalized.includes('review') || 
           normalized.includes('survey') || 
           normalized.includes('meta-analysis') ||
           normalized.includes('systematic');
  };

  // Filter sections for dimension mapping:
  // - For review papers: include all sections
  // - For other papers: only Introduction, Literature Review, and Methodology
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForMapping = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));
  
  console.log(`[CitationMapping] Paper type: ${blueprint.paperTypeCode || 'unknown'}, isReview: ${isReview}, sections for mapping: ${sectionsForMapping.map(s => s.sectionKey).join(', ')}`);

  // Build blueprint sections string
  const sectionsText = sectionsForMapping.map((section, idx) => {
    const dimensions = section.mustCover && section.mustCover.length > 0
      ? section.mustCover.map((dim, i) => `    ${i + 1}. "${dim}"`).join('\n')
      : '    (No specific dimensions defined)';
    return `${idx + 1}. ${section.sectionKey} - "${section.purpose}"
   Must Cover Dimensions:
${dimensions}`;
  }).join('\n\n');

  return `You are a research assistant analyzing imported citations against a paper blueprint. Map each citation to the blueprint dimensions it supports.

RESEARCH OBJECTIVE:
${researchQuestion}

PAPER BLUEPRINT:
Central Objective: ${blueprint.centralObjective || 'Not specified'}

SECTIONS AND DIMENSIONS TO COVER:
${sectionsText}

IMPORTED CITATIONS TO ANALYZE:
${paperList}

TASK:
For each citation, identify which blueprint dimensions it supports:
- Map to EXACT dimension text from the blueprint above
- Provide a grounded remark (1-2 sentences) explaining how it supports the dimension
- Assign confidence: HIGH (directly addresses), MEDIUM (partially relevant), LOW (tangentially related)
- A citation can map to multiple dimensions across different sections
- Only map if there's concrete evidence in the title/abstract

Respond in the following JSON format ONLY (no markdown, no explanation outside JSON):
{
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
          "remark": "<1-2 sentence grounded explanation>",
          "confidence": "<HIGH|MEDIUM|LOW>"
        }
      ]
    }
  ],
  "summary": "<2-3 sentence summary of how well the citations cover the blueprint>"
}

Analyze ALL citations provided. Be precise with dimension mapping.`;
}

/**
 * Attempt to salvage a truncated JSON response
 */
function attemptJsonSalvage(truncatedJson: string): { suggestions: any[]; summary: string } | null {
  try {
    const suggestionsMatch = truncatedJson.match(/"suggestions"\s*:\s*\[/);
    if (!suggestionsMatch) return null;
    
    const suggestionsStart = suggestionsMatch.index! + suggestionsMatch[0].length;
    let lastCompleteIndex = -1;
    let braceDepth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = suggestionsStart; i < truncatedJson.length; i++) {
      const char = truncatedJson[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{') braceDepth++;
      else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0) lastCompleteIndex = i;
      }
    }
    
    if (lastCompleteIndex === -1) return null;
    
    const validSuggestions = truncatedJson.substring(suggestionsStart, lastCompleteIndex + 1);
    const reconstructed = `{"suggestions":[${validSuggestions}],"summary":"Analysis partially completed (response was truncated)"}`;
    const parsed = JSON.parse(reconstructed);
    
    if (!parsed.suggestions || parsed.suggestions.length === 0) return null;
    console.log(`[CitationMapping] Salvaged ${parsed.suggestions.length} complete suggestion(s) from truncated response`);
    return parsed;
  } catch (error) {
    console.error('[CitationMapping] JSON salvage failed:', error);
    return null;
  }
}

function parseAndValidateLLMResponse(
  output: string, 
  validPaperIds: Set<string>,
  blueprint: BlueprintWithSectionPlan
): LLMResponse {
  // Clean up response
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

  // Handle truncated JSON responses
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    console.warn('[CitationMapping] Initial JSON parse failed, attempting to salvage truncated response...');
    const salvaged = attemptJsonSalvage(cleaned);
    if (salvaged) {
      console.log('[CitationMapping] Successfully salvaged partial JSON response');
      parsed = salvaged;
    } else {
      throw parseError;
    }
  }
  
  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array');
  }

  // Build valid section keys and dimensions
  const validSectionKeys = new Set<string>();
  const validDimensions = new Map<string, Set<string>>();
  
  for (const section of blueprint.sectionPlan) {
    validSectionKeys.add(section.sectionKey);
    validDimensions.set(section.sectionKey, new Set(section.mustCover || []));
  }

  // Validate suggestions
  const validatedSuggestions: CitationAnalysis[] = [];
  
  for (const suggestion of parsed.suggestions) {
    if (!suggestion.paperId || !validPaperIds.has(suggestion.paperId)) {
      console.warn(`Skipping invalid paperId: ${suggestion.paperId}`);
      continue;
    }
    
    // Parse dimension mappings
    let dimensionMappings: DimensionMapping[] | undefined;
    if (suggestion.dimensionMappings && Array.isArray(suggestion.dimensionMappings)) {
      dimensionMappings = [];
      for (const dm of suggestion.dimensionMappings) {
        if (!dm.sectionKey || !validSectionKeys.has(dm.sectionKey)) {
          continue;
        }
        
        dimensionMappings.push({
          sectionKey: dm.sectionKey,
          dimension: String(dm.dimension || '').slice(0, 500),
          remark: String(dm.remark || 'No remark provided').slice(0, 500),
          confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(dm.confidence) ? dm.confidence : 'MEDIUM'
        });
      }
    }
    
    // Determine recommendation
    let recommendation: 'IMPORT' | 'MAYBE' | 'SKIP' | undefined;
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
    
    validatedSuggestions.push({
      paperId: suggestion.paperId,
      isRelevant: suggestion.isRelevant !== false,
      relevanceScore: Math.min(100, Math.max(0, Number(suggestion.relevanceScore) || 50)),
      reasoning: String(suggestion.reasoning || 'No reasoning provided').slice(0, 500),
      dimensionMappings,
      recommendation,
    });
  }

  // Calculate blueprint coverage
  const blueprintCoverage = calculateBlueprintCoverage(blueprint, validatedSuggestions);

  return {
    suggestions: validatedSuggestions,
    summary: String(parsed.summary || 'Analysis completed'),
    blueprintCoverage,
  };
}

function calculateBlueprintCoverage(
  blueprint: BlueprintWithSectionPlan,
  suggestions: CitationAnalysis[]
): BlueprintCoverage {
  const sectionCoverage: BlueprintCoverage['sectionCoverage'] = {};
  const gaps: BlueprintCoverage['gaps'] = [];
  let totalDimensions = 0;
  let coveredDimensions = 0;

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
  const isLiteratureMappingSection = (sectionKey: string): boolean => {
    const normalized = sectionKey.toLowerCase().replace(/[\s_-]+/g, '_');
    return LITERATURE_MAPPING_SECTIONS.some(s => 
      normalized.includes(s.replace(/[\s_-]+/g, '_')) ||
      s.replace(/[\s_-]+/g, '_').includes(normalized)
    );
  };

  // Check if paper type is a review paper
  const isReviewPaper = (paperTypeCode?: string): boolean => {
    if (!paperTypeCode) return false;
    const normalized = paperTypeCode.toLowerCase();
    return normalized.includes('review') || 
           normalized.includes('survey') || 
           normalized.includes('meta-analysis') ||
           normalized.includes('systematic');
  };

  // Filter sections for coverage calculation
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForCoverage = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

  for (const section of sectionsForCoverage) {
    const dimensions = section.mustCover || [];
    const dimensionData: BlueprintCoverage['sectionCoverage'][string]['dimensions'] = [];
    
    for (const dimension of dimensions) {
      totalDimensions++;
      
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
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

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
    const { citations, includeBlueprint } = requestSchema.parse(body);

    // Blueprint is required for mapping
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint || !blueprint.sectionPlan || blueprint.sectionPlan.length === 0) {
      return NextResponse.json({ 
        error: 'Blueprint not found or has no section plan. Please generate a blueprint first.' 
      }, { status: 400 });
    }

    const researchQuestion = blueprint.centralObjective
      || session.researchTopic?.researchQuestion 
      || session.ideaRecord?.title 
      || 'General research topic';

    // Filter to papers with abstracts for better analysis
    // Limit to 15 papers per batch to avoid output token truncation
    const MAX_CITATIONS_PER_BATCH = 15;
    const citationsWithAbstracts = citations.filter(c => c.abstract);
    
    let papersToAnalyze: typeof citations;
    if (citationsWithAbstracts.length >= 3) {
      papersToAnalyze = citationsWithAbstracts.slice(0, MAX_CITATIONS_PER_BATCH);
    } else {
      // If few have abstracts, include all but still limit
      papersToAnalyze = citations.slice(0, MAX_CITATIONS_PER_BATCH);
    }

    const validPaperIds = new Set(papersToAnalyze.map(p => p.id));
    const prompt = buildPrompt(researchQuestion, papersToAnalyze, blueprint);

    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = { authorization: authHeader };

    const llmResult = await llmGateway.executeLLMOperation(
      { headers },
      {
        taskCode: 'LITERATURE_RELEVANCE',
        stageCode: 'LITERATURE_RELEVANCE',
        prompt,
        parameters: {
          temperature: 0.3,
        },
        idempotencyKey: `citation-mapping-${sessionId}-${Date.now()}`,
        metadata: {
          sessionId,
          citationCount: papersToAnalyze.length,
          blueprintId: blueprint.id,
        }
      }
    );

    if (!llmResult.success || !llmResult.response) {
      console.error('[CitationMapping] LLM call failed:', llmResult.error);
      return NextResponse.json({ 
        error: llmResult.error?.message || 'AI analysis failed' 
      }, { status: 500 });
    }

    let analysis: LLMResponse;
    try {
      analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds, blueprint);
    } catch (parseError) {
      console.error('[CitationMapping] Failed to parse LLM response:', parseError);
      console.error('Raw output preview:', llmResult.response.output?.slice(0, 500));
      
      // Return partial success with empty analysis rather than failing completely
      return NextResponse.json({
        success: true,
        analysis: {
          suggestions: [],
          summary: 'Analysis completed but results could not be parsed. Try again with fewer citations.',
          blueprintCoverage: {
            totalDimensions: blueprint.sectionPlan.reduce((acc, s) => acc + (s.mustCover?.length || 0), 0),
            coveredDimensions: 0,
            gaps: blueprint.sectionPlan.flatMap(s => (s.mustCover || []).map(d => ({
              sectionKey: s.sectionKey,
              sectionTitle: s.purpose,
              dimension: d
            }))),
            sectionCoverage: {}
          },
          analyzedAt: new Date().toISOString(),
          citationsAnalyzed: 0,
          parseError: true
        }
      });
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'CITATION_BLUEPRINT_MAPPING',
        resource: `session:${sessionId}`,
        meta: {
          sessionId,
          citationsAnalyzed: papersToAnalyze.length,
          dimensionsCovered: analysis.blueprintCoverage?.coveredDimensions || 0,
          tokensUsed: llmResult.response.outputTokens,
        }
      }
    });

    return NextResponse.json({
      success: true,
      analysis: {
        suggestions: analysis.suggestions,
        summary: analysis.summary,
        blueprintCoverage: analysis.blueprintCoverage,
        analyzedAt: new Date().toISOString(),
        citationsAnalyzed: papersToAnalyze.length,
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[CitationMapping] POST error:', error);
    return NextResponse.json({ error: 'Failed to map citations to blueprint' }, { status: 500 });
  }
}
