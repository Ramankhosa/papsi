import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { featureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for LLM processing

const requestSchema = z.object({
  searchRunId: z.string().min(1),
  maxSuggestions: z.number().int().min(1).max(20).optional().default(10),
});

// Response structure from LLM
interface PaperRelevanceAnalysis {
  paperId: string;
  isRelevant: boolean;
  relevanceScore: number; // 0-100
  reasoning: string;
}

interface LLMResponse {
  suggestions: PaperRelevanceAnalysis[];
  summary: string;
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
  papers: Array<{ id: string; title: string; abstract?: string; authors?: string[]; year?: number }>,
  maxSuggestions: number
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

  return `You are a research assistant helping identify the most relevant papers for a literature review.

RESEARCH QUESTION:
${researchQuestion}

CANDIDATE PAPERS:
${paperList}

TASK:
Analyze these papers and identify the TOP ${maxSuggestions} most relevant papers for the research question above.

For each selected paper, provide:
1. Why it's relevant (1-2 sentences)
2. A relevance score (0-100)

IMPORTANT CRITERIA:
- Papers with abstracts should be preferred as they provide more context
- Consider methodological alignment with the research question
- Consider theoretical/conceptual relevance
- Consider recency and citation potential
- Avoid papers that seem tangentially related

Respond in the following JSON format ONLY (no markdown, no explanation outside JSON):
{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation>"
    }
  ],
  "summary": "<brief 1-sentence summary of your selection strategy>"
}

Return ONLY papers you recommend. Order by relevance score (highest first).`;
}

function parseAndValidateLLMResponse(output: string, validPaperIds: Set<string>): LLMResponse {
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

  const parsed = JSON.parse(cleaned);
  
  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array');
  }

  // Validate and filter suggestions
  const validatedSuggestions: PaperRelevanceAnalysis[] = [];
  
  for (const suggestion of parsed.suggestions) {
    if (!suggestion.paperId || !validPaperIds.has(suggestion.paperId)) {
      console.warn(`Skipping invalid paperId: ${suggestion.paperId}`);
      continue;
    }
    
    validatedSuggestions.push({
      paperId: suggestion.paperId,
      isRelevant: suggestion.isRelevant !== false,
      relevanceScore: Math.min(100, Math.max(0, Number(suggestion.relevanceScore) || 50)),
      reasoning: String(suggestion.reasoning || 'No reasoning provided').slice(0, 500),
    });
  }

  return {
    suggestions: validatedSuggestions,
    summary: String(parsed.summary || 'AI analysis completed'),
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
    const { searchRunId, maxSuggestions } = requestSchema.parse(body);

    // Get the search run
    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });
    
    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

    // Get research question from session
    const researchQuestion = session.researchTopic?.researchQuestion 
      || session.ideaRecord?.title 
      || session.ideaRecord?.problem
      || 'General research topic';

    // Parse search results
    const results = searchRun.results as any[];
    if (!results || results.length === 0) {
      return NextResponse.json({ error: 'No search results to analyze' }, { status: 400 });
    }

    // Filter to papers with abstracts for better analysis (but include all if few have abstracts)
    const papersWithAbstracts = results.filter(r => r.abstract);
    const papersToAnalyze = papersWithAbstracts.length >= 5 
      ? papersWithAbstracts 
      : results.slice(0, 30); // Limit to 30 to avoid token limits

    // Build valid paper ID set for validation
    const validPaperIds = new Set(papersToAnalyze.map(p => p.id));

    // Build prompt (batch all papers in single call)
    const prompt = buildPrompt(researchQuestion, papersToAnalyze, maxSuggestions);

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
        }
      }
    );

    if (!llmResult.success || !llmResult.response) {
      console.error('[LiteratureRelevance] LLM call failed:', llmResult.error);
      return NextResponse.json({ 
        error: llmResult.error?.message || 'AI analysis failed' 
      }, { status: 500 });
    }

    // Parse and validate LLM response
    let analysis: LLMResponse;
    try {
      analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds);
    } catch (parseError) {
      console.error('[LiteratureRelevance] Failed to parse LLM response:', parseError);
      console.error('Raw output:', llmResult.response.output);
      return NextResponse.json({ 
        error: 'Failed to parse AI response' 
      }, { status: 500 });
    }

    // Update search run with AI analysis
    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: analysis,
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
        }
      }
    });

    return NextResponse.json({
      success: true,
      searchRunId,
      analysis: {
        suggestions: analysis.suggestions,
        summary: analysis.summary,
        analyzedAt: new Date().toISOString(),
        papersAnalyzed: papersToAnalyze.length,
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

    // Get all search runs for session
    const searchRuns = await prisma.literatureSearchRun.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 10,
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

