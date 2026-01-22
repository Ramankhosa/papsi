import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { generateFigureSuggestions } from '@/lib/figure-generation/llm-figure-service';
import { FigureSuggestion, FigureCategory } from '@/lib/figure-generation/types';

export const runtime = 'nodejs';

const suggestSchema = z.object({
  paperTitle: z.string().optional(),
  paperAbstract: z.string().optional(),
  sections: z.record(z.string()).optional(),
  researchType: z.string().optional(),
  // Whether to use LLM for suggestions (default true)
  useLLM: z.boolean().optional().default(true)
});


async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      paperType: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  });
}

export async function POST(
  request: NextRequest, 
  context: { params: Promise<{ paperId: string }> }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Await params for Next.js 15 compatibility
    const { paperId: sessionId } = await context.params;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = suggestSchema.parse(body);

    // Get existing figures to avoid duplicates
    const existingFigures = await prisma.figurePlan.findMany({
      where: { sessionId },
      select: { title: true, nodes: true }
    });
    
    const existingFigureList = existingFigures.map(f => ({
      title: f.title,
      type: (f.nodes as any)?.figureType || 'unknown'
    }));

    let suggestions: import('@/lib/figure-generation/types').FigureSuggestion[];
    let llmMetadata: { tokensUsed?: number; model?: string } = {};

    // Check if we should use LLM for suggestions
    if (data.useLLM !== false) {
      console.log('[PaperFigures] Using LLM for figure suggestions...');
      
      // Get request headers for LLM call
      const requestHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });

      // Extract paper content from session if not provided
      const paperTitle = data.paperTitle || (session as any).researchTopic?.title || '';
      const paperAbstract = data.paperAbstract || (session as any).researchTopic?.abstract || '';
      const sections = data.sections || (session.annexureDrafts?.[0] as any)?.extraSections || {};
      const researchType = data.researchType || session.paperType?.name || 'research article';

      const llmResult = await generateFigureSuggestions(
        {
          paperTitle,
          paperAbstract,
          sections,
          researchType,
          existingFigures: existingFigureList,
          maxSuggestions: 6
        },
        requestHeaders
      );

      if (llmResult.success && llmResult.suggestions) {
        suggestions = llmResult.suggestions;
        llmMetadata = { tokensUsed: llmResult.tokensUsed, model: llmResult.model };
        console.log(`[PaperFigures] LLM generated ${suggestions.length} suggestions using ${llmResult.model}`);
      } else {
        // Fall back to rule-based suggestions
        console.log('[PaperFigures] LLM failed, using rule-based suggestions:', llmResult.error);
        suggestions = generateRuleBasedSuggestions(
          data.paperTitle || '',
          data.paperAbstract || '',
          data.sections || {},
          session
        );
      }
    } else {
      // Use rule-based suggestions
      suggestions = generateRuleBasedSuggestions(
        data.paperTitle || '',
        data.paperAbstract || '',
        data.sections || {},
        session
      );
    }

    return NextResponse.json({ 
      suggestions,
      meta: {
        usedLLM: !!llmMetadata.model,
        ...llmMetadata
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[PaperFigures] Suggest error:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestions' },
      { status: 500 }
    );
  }
}

/**
 * Generates exactly 5-6 figure suggestions based on paper content.
 * This is a rule-based fallback implementation when LLM is unavailable or disabled.
 */
function generateRuleBasedSuggestions(
  title: string,
  abstract: string,
  sections: Record<string, string>,
  session: any
): FigureSuggestion[] {
  const content = `${title} ${abstract} ${Object.values(sections).join(' ')}`.toLowerCase();
  
  // All possible suggestions with relevance scores
  const allSuggestions: Array<FigureSuggestion & { score: number }> = [];

  // === CORE SUGGESTIONS (Always highly relevant) ===
  
  // 1. Methodology flowchart - essential for any research paper
  allSuggestions.push({
    title: 'Research Methodology Flowchart',
    description: 'A flowchart illustrating your research methodology, including data collection, processing, and analysis steps.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'methodology',
    importance: 'recommended',
    score: 100 // Always highly relevant
  });

  // 2. Results comparison - very common need
  allSuggestions.push({
    title: 'Results Comparison Chart',
    description: 'A bar chart comparing key findings, performance metrics, or outcomes across different conditions or groups.',
    category: 'DATA_CHART',
    suggestedType: 'bar',
    relevantSection: 'results',
    importance: 'recommended',
    score: hasKeywords(content, ['result', 'compar', 'performance', 'metric', 'evaluat', 'outcome', 'finding']) ? 95 : 70
  });

  // === CONTEXT-SPECIFIC SUGGESTIONS ===

  // 3. System/Architecture diagram
  allSuggestions.push({
    title: 'System Architecture Diagram',
    description: 'A diagram showing the system components, modules, their relationships, and data flow between them.',
    category: 'DIAGRAM',
    suggestedType: 'architecture',
    relevantSection: 'methodology',
    importance: hasKeywords(content, ['system', 'architecture', 'framework', 'platform', 'module']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['system', 'architecture', 'framework', 'platform', 'module', 'component']) ? 90 : 50
  });

  // 4. Trend/Time series chart
  allSuggestions.push({
    title: 'Trend Analysis Line Chart',
    description: 'A line chart showing trends, changes over time, or progression of key variables across different time points.',
    category: 'DATA_CHART',
    suggestedType: 'line',
    relevantSection: 'results',
    importance: hasKeywords(content, ['trend', 'time', 'temporal', 'growth', 'progress']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['trend', 'over time', 'temporal', 'growth', 'change', 'progress', 'evolution']) ? 85 : 55
  });

  // 5. Distribution/Proportion chart
  allSuggestions.push({
    title: 'Distribution Pie Chart',
    description: 'A pie or doughnut chart showing the distribution, proportions, or breakdown of categories in your data.',
    category: 'DATA_CHART',
    suggestedType: 'pie',
    relevantSection: 'results',
    importance: 'optional',
    score: hasKeywords(content, ['distribution', 'proportion', 'percentage', 'breakdown', 'categor']) ? 80 : 45
  });

  // 6. Correlation/Scatter plot
  allSuggestions.push({
    title: 'Correlation Scatter Plot',
    description: 'A scatter plot visualizing the relationship and correlation between two key variables in your study.',
    category: 'DATA_CHART',
    suggestedType: 'scatter',
    relevantSection: 'results',
    importance: hasKeywords(content, ['correlation', 'relationship', 'regression']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['correlation', 'relationship', 'association', 'regression', 'variable']) ? 82 : 40
  });

  // 7. Process flow diagram
  allSuggestions.push({
    title: 'Process Flow Diagram',
    description: 'A flowchart depicting the step-by-step process, algorithm, or workflow used in your research.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'methodology',
    importance: hasKeywords(content, ['process', 'workflow', 'algorithm', 'step']) ? 'recommended' : 'optional',
    score: hasKeywords(content, ['process', 'workflow', 'step', 'procedure', 'algorithm', 'pipeline']) ? 78 : 48
  });

  // 8. Sequence diagram
  allSuggestions.push({
    title: 'Interaction Sequence Diagram',
    description: 'A sequence diagram showing the interactions, message flows, or protocol exchanges between system components.',
    category: 'DIAGRAM',
    suggestedType: 'sequence',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['interaction', 'sequence', 'protocol', 'message', 'communication', 'api']) ? 75 : 35
  });

  // 9. Comparison radar chart
  allSuggestions.push({
    title: 'Multi-Criteria Radar Chart',
    description: 'A radar chart comparing multiple criteria, dimensions, or factors across different items or methods.',
    category: 'DATA_CHART',
    suggestedType: 'radar',
    relevantSection: 'results',
    importance: 'optional',
    score: hasKeywords(content, ['criteria', 'dimension', 'factor', 'multi', 'aspect', 'attribute']) ? 72 : 30
  });

  // 10. Timeline/Gantt chart
  allSuggestions.push({
    title: 'Project Timeline Chart',
    description: 'A Gantt chart or timeline showing project phases, milestones, tasks, and their scheduling.',
    category: 'DIAGRAM',
    suggestedType: 'gantt',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['timeline', 'schedule', 'phase', 'milestone', 'task', 'plan']) ? 70 : 25
  });

  // 11. Entity-Relationship diagram
  allSuggestions.push({
    title: 'Data Model ER Diagram',
    description: 'An entity-relationship diagram showing the data structure, entities, and their relationships.',
    category: 'DIAGRAM',
    suggestedType: 'er',
    relevantSection: 'methodology',
    importance: 'optional',
    score: hasKeywords(content, ['database', 'entity', 'schema', 'data model', 'table', 'relation']) ? 68 : 20
  });

  // 12. Conceptual framework
  allSuggestions.push({
    title: 'Conceptual Framework Diagram',
    description: 'A diagram illustrating the theoretical framework, key concepts, and their relationships in your study.',
    category: 'DIAGRAM',
    suggestedType: 'flowchart',
    relevantSection: 'introduction',
    importance: 'optional',
    score: hasKeywords(content, ['concept', 'framework', 'theor', 'model', 'hypothesis']) ? 65 : 35
  });

  // Sort by score (highest first) and take top 6
  const topSuggestions = allSuggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ score, ...suggestion }) => suggestion); // Remove score from output

  // Ensure we always have at least 5 suggestions
  return topSuggestions;
}

/**
 * Helper to check if content contains any of the keywords
 */
function hasKeywords(content: string, keywords: string[]): boolean {
  return keywords.some(keyword => content.includes(keyword));
}

