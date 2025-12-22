/**
 * Ideation Engine Service
 * 
 * Backend service for the mind-map patent ideation engine.
 * Handles session management, LLM calls, novelty searches, and idea generation.
 */

import { prisma } from '@/lib/prisma';
import { serpApiProvider } from '@/lib/serpapi-provider';
import {
  InputNormalizationSchema,
  ClassificationSchema,
  DimensionGraphSchema,
  IdeaFrameSchema,
  NoveltyGateSchema,
  safeParseJson,
  getSchemaDescription,
  TRIZ_OPERATORS,
  DIMENSION_FAMILIES,
  type InputNormalization,
  type Classification,
  type DimensionGraph,
  type DimensionNode,
  type IdeaFrame,
  type NoveltyGate,
  type CombineRecipe,
  type InventionClass,
  type TrizOperator,
  type DimensionFamily,
} from './schemas';
import type { 
  IdeationSession, 
  MindMapNode, 
  IdeaFrame as PrismaIdeaFrame,
  Prisma,
} from '@prisma/client';
import crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  seedText: string;
  seedGoal?: string;
  seedConstraints?: string[];
  budgetCap?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ExpandNodeInput {
  sessionId: string;
  nodeId: string;
  depth?: number;
  requestHeaders: Record<string, string>;
}

export interface GenerateIdeasInput {
  sessionId: string;
  recipe: CombineRecipe;
  requestHeaders: Record<string, string>;
}

export interface NoveltyCheckInput {
  sessionId: string;
  ideaFrameId: string;
  requestHeaders: Record<string, string>;
}

export interface ExportToIdeaBankInput {
  sessionId: string;
  ideaFrameIds: string[];
  userId: string;
  tenantId: string;
}

// Import the LLM Gateway for proper API key handling
import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'

// =============================================================================
// LLM INTEGRATION (Using existing LLM Gateway)
// =============================================================================

/**
 * Call LLM through the existing gateway infrastructure
 * This ensures proper API key handling, rate limiting, and cost tracking
 * 
 * Model Resolution:
 * The gateway uses stageCode to resolve the model configured by Super Admin
 * for each ideation stage (IDEATION_NORMALIZE, IDEATION_CLASSIFY, etc.)
 */
async function callLLM(
  prompt: string,
  taskCode: string,
  sessionId: string,
  requestHeaders: Record<string, string>,
): Promise<{ response: string; tokensUsed: number; model: string }> {
  try {
    // Use the existing LLM gateway which handles API keys properly
    // stageCode enables Super Admin to configure which model to use for each ideation stage
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders },
      {
        taskCode: taskCode as TaskCode,
        stageCode: taskCode, // Use taskCode as stageCode for model resolution (e.g., IDEATION_NORMALIZE)
        prompt,
        parameters: {
          temperature: 0.7,
        },
        idempotencyKey: `ideation-${sessionId}-${taskCode}-${Date.now()}`,
        metadata: {
          sessionId,
          module: 'ideation',
        }
      }
    );

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'LLM call failed');
    }

    const response = result.response.output;
    const tokensUsed = result.response.outputTokens || 0;
    const model = result.response.modelClass || 'unknown';

    // Log the LLM call - get session for userId
    const session = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    await prisma.ideationHistory.create({
      data: {
        sessionId,
        action: `LLM_CALL_${taskCode}`,
        stage: taskCode,
        inputJson: { prompt: prompt.slice(0, 1000) }, // Truncate for storage
        outputJson: { response: response.slice(0, 1000) },
        userId: session?.userId || 'unknown',
        tokensUsed,
        modelUsed: model,
      },
    });

    return { response, tokensUsed, model };
  } catch (error) {
    console.error(`LLM call failed for ${taskCode}:`, error);
    throw error;
  }
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Create a new ideation session
 */
export async function createSession(input: CreateSessionInput): Promise<IdeationSession> {
  const session = await prisma.ideationSession.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      seedText: input.seedText,
      seedGoal: input.seedGoal,
      seedConstraints: input.seedConstraints || [],
      budgetCap: input.budgetCap || 'MEDIUM',
      status: 'SEED_INPUT',
    },
  });

  // Create the seed node (positioned at left for left-to-right flow)
  await prisma.mindMapNode.create({
    data: {
      sessionId: session.id,
      nodeId: 'seed-root',
      type: 'SEED',
      title: input.seedText.slice(0, 100),
      description: input.seedText,
      state: 'EXPANDED',
      selectable: false,
      defaultExpanded: true,
      depth: 0,
      positionX: 50,
      positionY: 200,
    },
  });

  // Log session creation
  await prisma.ideationHistory.create({
    data: {
      sessionId: session.id,
      action: 'SESSION_CREATED',
      stage: 'SEED_INPUT',
      inputJson: { seedText: input.seedText },
      userId: input.userId,
    },
  });

  return session;
}

/**
 * Get session with all related data
 */
export async function getSession(sessionId: string) {
  return prisma.ideationSession.findUnique({
    where: { id: sessionId },
    include: {
      nodes: { orderBy: { createdAt: 'asc' } },
      edges: true,
      combineTray: true,
      ideaFrames: { orderBy: { createdAt: 'desc' } },
      evidenceResults: true,
    },
  });
}

/**
 * List sessions for a user
 */
export async function listSessions(userId: string, tenantId: string) {
  return prisma.ideationSession.findMany({
    where: { userId, tenantId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: { ideaFrames: true, nodes: true },
      },
    },
  });
}

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize the seed input using LLM
 * @param sessionId - The ideation session ID
 * @param requestHeaders - HTTP headers from the API request (must include Authorization)
 */
export async function normalizeSeed(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<InputNormalization> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const prompt = `You are a patent ideation assistant. Analyze the following invention idea and extract structured information.

INPUT IDEA:
"""
${session.seedText}
"""

${session.seedGoal ? `STATED GOAL: ${session.seedGoal}` : ''}
${session.seedConstraints.length > 0 ? `USER CONSTRAINTS: ${session.seedConstraints.join(', ')}` : ''}

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('InputNormalization')}

Rules:
- coreEntity: The main physical or conceptual thing being invented
- intentGoal: What the user wants to achieve or solve
- constraints: Hard limits mentioned (cost, size, no electronics, etc.)
- negativeConstraints: Things explicitly forbidden
- unknownsToAsk: Questions that would help clarify the invention (max 3)
- Do NOT invent facts; if unsure, add to unknownsToAsk`;

  const { response, tokensUsed, model } = await callLLM(
    prompt,
    'IDEATION_NORMALIZE',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, InputNormalizationSchema);
  
  if (!parsed.success) {
    throw new Error(`Normalization failed: ${parsed.error}`);
  }

  // Update session with normalization
  // Ensure all required fields have defaults
  const normalizedData: InputNormalization = {
    coreEntity: parsed.data.coreEntity,
    intentGoal: parsed.data.intentGoal,
    constraints: parsed.data.constraints ?? [],
    assumptions: parsed.data.assumptions ?? [],
    negativeConstraints: parsed.data.negativeConstraints ?? [],
    knownComponents: parsed.data.knownComponents ?? [],
    unknownsToAsk: parsed.data.unknownsToAsk ?? [],
    context: parsed.data.context,
  };

  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      normalizationJson: normalizedData as any,
      status: normalizedData.unknownsToAsk.length > 0 ? 'CLARIFYING' : 'CLASSIFYING',
    },
  });

  return normalizedData;
}

// =============================================================================
// CLASSIFICATION
// =============================================================================

/**
 * Classify the normalized invention
 * @param sessionId - The ideation session ID
 * @param requestHeaders - HTTP headers from the API request (must include Authorization)
 */
export async function classifyInvention(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<Classification> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must be normalized before classification');
  }

  const normalization = session.normalizationJson as InputNormalization;

  const prompt = `You are a patent classification expert. Classify the following invention into appropriate categories.

INVENTION:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Components: ${normalization.knownComponents.join(', ') || 'Not specified'}
- Context: ${normalization.context || 'General'}
- Constraints: ${normalization.constraints.join(', ') || 'None'}

AVAILABLE CLASSES:
- PRODUCT_DEVICE: Physical objects (syringe, umbrella, shoe)
- SYSTEM: Multiple interacting components (often software + hardware)
- METHOD_PROCESS: Steps/procedures (manufacturing, operating, analysis)
- COMPOSITION: Chemical, materials, mixtures
- SOFTWARE_ALGORITHM: Pure logic/data processing
- BIOTECH_PHARMA: Biological materials, treatments
- MANUFACTURING: Process + tooling + QA
- SERVICE_WORKFLOW: Human-centered operational methods
- HYBRID: When multiple classes are equally strong

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('Classification')}

Rules:
- Assign weights that sum to ~1.0 across top labels
- If top-2 weights are within 0.15, set forkMode to "FORK"
- archetype should reflect the dominant technical domain`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_CLASSIFY',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ClassificationSchema);
  
  if (!parsed.success) {
    throw new Error(`Classification failed: ${parsed.error}`);
  }

  // Update session
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      classificationJson: parsed.data as any,
      status: 'EXPANDING',
      activeTracks: parsed.data.forkMode === 'FORK' 
        ? parsed.data.labels.slice(0, 2).map(l => l.class)
        : [parsed.data.dominantClass],
    },
  });

  return parsed.data;
}

// =============================================================================
// DIMENSION EXPANSION
// =============================================================================

/**
 * Get applicable dimension families based on classification
 */
export function getApplicableDimensions(classification: Classification): DimensionFamily[] {
  return DIMENSION_FAMILIES.filter(dim => 
    dim.applicableTo.length === 0 || 
    dim.applicableTo.includes(classification.dominantClass)
  );
}

/**
 * Get applicable TRIZ operators based on classification
 */
export function getApplicableOperators(classification: Classification): TrizOperator[] {
  return TRIZ_OPERATORS.filter(op =>
    op.applicableTo.length === 0 ||
    op.applicableTo.includes(classification.dominantClass)
  );
}

/**
 * Initialize dimension families in the mind map
 */
export async function initializeDimensions(sessionId: string): Promise<MindMapNode[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { nodes: true },
  });

  if (!session.classificationJson) {
    throw new Error('Session must be classified before dimension expansion');
  }

  const classification = session.classificationJson as Classification;
  const applicableDimensions = getApplicableDimensions(classification);
  const applicableOperators = getApplicableOperators(classification);

  const nodesToCreate: Prisma.MindMapNodeCreateManyInput[] = [];
  const edgesToCreate: Prisma.MindMapEdgeCreateManyInput[] = [];

  // Layout constants for left-to-right tree
  const LEVEL_WIDTH = 320;  // Horizontal spacing between levels
  const NODE_HEIGHT = 100;  // Vertical spacing between nodes (increased for descriptions)
  const START_X = 50;       // Starting X position (seed is at left)
  const START_Y = 80;       // Starting Y position

  // Calculate seed node Y position based on number of dimensions
  const seedY = START_Y + (applicableDimensions.length * NODE_HEIGHT) / 2;

  // Update existing seed node with normalized title and proper position
  await prisma.mindMapNode.update({
    where: {
      sessionId_nodeId: {
        sessionId,
        nodeId: 'seed-root',
      },
    },
    data: {
      title: (session.normalizationJson as any)?.coreEntity || 'Seed Idea',
      positionX: START_X,
      positionY: seedY,
    },
  });

  // Create dimension family nodes at level 1 (to the right of seed)
  const totalDimensions = applicableDimensions.length;
  applicableDimensions.forEach((dim, idx) => {
    const yPos = START_Y + (idx * NODE_HEIGHT);
    
    nodesToCreate.push({
      sessionId,
      nodeId: dim.id,
      type: 'DIMENSION_FAMILY',
      title: dim.name,
      description: dim.description,
      family: dim.name,
      state: 'COLLAPSED',
      selectable: false,
      defaultExpanded: false,
      depth: 1,
      parentNodeId: 'seed-root',
      positionX: START_X + LEVEL_WIDTH,
      positionY: yPos,
    });

    edgesToCreate.push({
      sessionId,
      fromNodeId: 'seed-root',
      toNodeId: dim.id,
      relation: 'has_dimension',
    });
  });

  // NOTE: Operators are NOT added to the mind map anymore
  // They are shown in the Combine Tray after user selects dimensions
  // Store applicable operators in session metadata for the tray
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      // Store operators as JSON for retrieval by the frontend
      classificationJson: {
        ...(session.classificationJson as object),
        applicableOperators: applicableOperators.map(op => ({
          id: op.id,
          name: op.name,
          description: op.description,
          examples: op.examples,
        })),
      },
    },
  });

  // Batch create with skipDuplicates to handle re-initialization
  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  // Update session status
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: { status: 'EXPLORING' },
  });

  return prisma.mindMapNode.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Expand a dimension family with specific options using LLM
 */
export async function expandDimensionNode(input: ExpandNodeInput): Promise<DimensionGraph> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true },
  });

  const node = session.nodes.find(n => n.nodeId === input.nodeId);
  if (!node) {
    throw new Error(`Node ${input.nodeId} not found`);
  }

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;

  const prompt = `You are a patent ideation expert. Generate dimension options for the following context.

INVENTION:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Archetype: ${classification.archetype}

DIMENSION TO EXPAND:
- Name: ${node.title}
- Description: ${node.description || 'No description'}
- Family: ${node.family || node.title}

Generate 5-7 specific options within this dimension that could be explored for this invention.
Each option should be a concrete variation or approach within the "${node.title}" dimension.

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('DimensionGraph')}

Rules:
- All nodes should have parentId set to "${input.nodeId}"
- Each node id should be unique and prefixed with "opt-${input.nodeId}-"
- type should be "DIMENSION_OPTION"
- Make options specific to the invention context, not generic
- IMPORTANT: descriptionShort MUST be exactly 4-5 words explaining the benefit/purpose (e.g., "Reduces cost by 50%", "Enables wireless connectivity", "Improves user grip strength")
- title should be 2-4 words (the option name)
- tags can include 2-3 relevant keywords`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_EXPAND',
    input.sessionId,
    input.requestHeaders,
  );

  const parsed = safeParseJson(response, DimensionGraphSchema);
  
  if (!parsed.success) {
    throw new Error(`Expansion failed: ${parsed.error}`);
  }

  // Create new nodes and edges
  const existingNodeIds = session.nodes.map(n => n.nodeId);
  const newNodes = parsed.data.nodes.filter(n => !existingNodeIds.includes(n.id));

  // Layout constants for tile-like horizontal layout
  const LEVEL_WIDTH = 280;   // Horizontal spacing between levels
  const NODE_WIDTH = 220;    // Width of each node (for horizontal arrangement)
  const NODE_HEIGHT = 80;    // Vertical spacing between rows
  const COLS = 2;            // Number of columns for grid-like layout

  // Calculate positions - children arranged in a grid to the right of parent
  const parentNode = node;
  const parentX = parentNode.positionX || 50;
  const parentY = parentNode.positionY || 200;
  const parentDepth = parentNode.depth || 0;
  
  // Arrange children in a 2-column grid layout (more horizontal/tile-like)
  const totalChildren = newNodes.length;
  const rows = Math.ceil(totalChildren / COLS);
  const totalHeight = (rows - 1) * NODE_HEIGHT;
  const startY = parentY - (totalHeight / 2);

  const nodesToCreate = newNodes.map((n, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    
    return {
      sessionId: input.sessionId,
      nodeId: n.id,
      type: n.type as any,
      title: n.title,
      description: n.descriptionShort || null,
      family: n.family || node.family,
      tags: n.tags || [],
      state: 'COLLAPSED' as const,
      selectable: n.selectable !== false, // Default to selectable for options
      defaultExpanded: n.defaultExpanded || false,
      depth: parentDepth + 1,
      parentNodeId: input.nodeId,
      positionX: parentX + LEVEL_WIDTH + (col * NODE_WIDTH),  // Stagger horizontally
      positionY: startY + (row * NODE_HEIGHT),  // Distribute in rows
    };
  });

  const edgesToCreate = newNodes.map(n => ({
    sessionId: input.sessionId,
    fromNodeId: input.nodeId,
    toNodeId: n.id,
    relation: 'contains',
  }));

  // Use skipDuplicates to handle cases where nodes might already exist
  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  // Update parent node state
  await prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state: 'EXPANDED' },
  });

  return parsed.data as DimensionGraph;
}

// =============================================================================
// COMBINE TRAY & IDEA GENERATION
// =============================================================================

/**
 * Update the combine tray with selected nodes
 */
export async function updateCombineTray(
  sessionId: string,
  components: string[],
  dimensions: string[],
  operators: string[],
  intent: string = 'DIVERGENT',
  count: number = 5
) {
  const recipe = {
    selectedComponents: components,
    selectedDimensions: dimensions,
    selectedOperators: operators,
    recipeIntent: intent,
    count,
  };

  return prisma.combineTray.upsert({
    where: { sessionId },
    create: {
      sessionId,
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
    update: {
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
  });
}

/**
 * Generate idea frames from the combine tray
 */
export async function generateIdeas(input: GenerateIdeasInput): Promise<IdeaFrame[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true, combineTray: true },
  });

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;

  // Get selected node details
  const selectedNodes = session.nodes.filter(n => 
    input.recipe.selectedComponents.includes(n.nodeId) ||
    input.recipe.selectedDimensions.includes(n.nodeId) ||
    input.recipe.selectedOperators.includes(n.nodeId)
  );

  const componentDetails = selectedNodes.filter(n => 
    input.recipe.selectedComponents.includes(n.nodeId)
  ).map(n => n.title);

  const dimensionDetails = selectedNodes.filter(n => 
    input.recipe.selectedDimensions.includes(n.nodeId)
  ).map(n => `${n.family}: ${n.title}`);

  const operatorDetails = selectedNodes.filter(n => 
    input.recipe.selectedOperators.includes(n.nodeId)
  ).map(n => `${n.title}: ${n.description}`);

  const prompt = `You are a patent invention generator. Create ${input.recipe.count} distinct invention ideas based on the following inputs.

INVENTION CONTEXT:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Archetype: ${classification.archetype}
- Constraints: ${normalization.constraints.join(', ') || 'None'}
- Forbidden: ${normalization.negativeConstraints.join(', ') || 'None'}

SELECTED COMPONENTS: ${componentDetails.join(', ') || 'Use your judgment'}

SELECTED DIMENSIONS: ${dimensionDetails.join('; ') || 'Explore broadly'}

SELECTED OPERATORS: ${operatorDetails.join('; ') || 'Apply appropriate operators'}

RECIPE INTENT: ${input.recipe.recipeIntent}
${input.recipe.recipeIntent === 'DIVERGENT' ? '(Generate diverse, creative ideas)' : ''}
${input.recipe.recipeIntent === 'CONVERGENT' ? '(Focus on practical, implementable ideas)' : ''}
${input.recipe.recipeIntent === 'RISK_REDUCTION' ? '(Focus on safety and reliability improvements)' : ''}
${input.recipe.recipeIntent === 'COST_REDUCTION' ? '(Focus on cost-effective solutions)' : ''}

Generate exactly ${input.recipe.count} invention ideas as a JSON array.
Each idea must follow this schema:
${getSchemaDescription('IdeaFrame')}

Rules:
- Each ideaId must be unique (use format: idea-1, idea-2, etc.)
- Ideas must be technically feasible
- Include 2-5 variants per idea showing alternative embodiments
- searchQueries should be specific enough for patent searches
- claimHooks should be phrases suitable for patent claims
- Be creative but realistic
- Do NOT repeat the same idea with minor variations

Return ONLY the JSON array of ideas (no other text):
[{idea1}, {idea2}, ...]`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_GENERATE',
    input.sessionId,
    input.requestHeaders,
  );

  // Parse the array of ideas
  let ideas: IdeaFrame[];
  try {
    const cleaned = response.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : cleaned;
    
    // Find array bounds
    const firstBracket = jsonStr.indexOf('[');
    const lastBracket = jsonStr.lastIndexOf(']');
    const arrayStr = jsonStr.slice(firstBracket, lastBracket + 1);
    
    const parsed = JSON.parse(arrayStr);
    ideas = parsed.map((idea: any) => IdeaFrameSchema.parse(idea));
  } catch (e) {
    console.error('Failed to parse ideas:', e);
    throw new Error('Failed to generate valid ideas');
  }

  // Store ideas in database
  const createdFrames = await Promise.all(
    ideas.map(async (idea) => {
      return prisma.ideaFrame.create({
        data: {
          sessionId: input.sessionId,
          ideaFrameJson: idea as any,
          title: idea.title,
          problem: idea.problem,
          principle: idea.principle,
          technicalEffect: idea.technicalEffect,
          classLabels: idea.classLabels,
          operatorsUsed: idea.operatorsUsed,
          dimensionsUsed: idea.dimensionsUsed,
          componentsUsed: idea.components,
          status: 'DRAFT',
        },
      });
    })
  );

  // Update session status
  await prisma.ideationSession.update({
    where: { id: input.sessionId },
    data: { status: 'REVIEWING' },
  });

  return ideas;
}

// =============================================================================
// NOVELTY SEARCH & PRESSURE GATE
// =============================================================================

/**
 * Generate cache key for search query
 */
function getSearchCacheKey(query: string, provider: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${provider}:${normalized}`).digest('hex');
}

/**
 * Check novelty for an idea frame
 */
export async function checkNovelty(input: NoveltyCheckInput): Promise<NoveltyGate> {
  const ideaFrame = await prisma.ideaFrame.findUniqueOrThrow({
    where: { id: input.ideaFrameId },
    include: { session: true },
  });

  const idea = ideaFrame.ideaFrameJson as IdeaFrame;
  const queries = idea.searchQueries.slice(0, 3); // Limit to 3 queries for cost

  // Check cache first
  const results: NoveltyGate['results'] = [];
  
  for (const query of queries) {
    const cacheKey = getSearchCacheKey(query, 'serpapi_patents');
    
    // Check cache
    const cached = await prisma.ideationSearchCache.findUnique({
      where: { cacheKey },
    });

    if (cached && new Date(cached.expiresAt) > new Date()) {
      // Use cached results
      const cachedResults = cached.resultJson as any[];
      results.push(...cachedResults.slice(0, 5).map((r: any) => ({
        source: 'Google Patents (cached)',
        title: r.title || 'Unknown',
        snippet: r.snippet,
        url: r.link,
        similarityScore: undefined,
        whyRelevant: 'Matched search query',
      })));
      
      // Update hit count
      await prisma.ideationSearchCache.update({
        where: { cacheKey },
        data: { hitCount: { increment: 1 } },
      });
    } else {
      // Perform search
      try {
        const searchResult = await serpApiProvider.searchPatents({
          q: query,
          num: 10,
        });

        if (searchResult.organic_results) {
          // Cache results
          await prisma.ideationSearchCache.upsert({
            where: { cacheKey },
            create: {
              cacheKey,
              provider: 'serpapi_patents',
              resultJson: searchResult.organic_results,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
            update: {
              resultJson: searchResult.organic_results,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });

          results.push(...searchResult.organic_results.slice(0, 5).map((r: any) => ({
            source: 'Google Patents',
            title: r.title || 'Unknown',
            snippet: r.snippet,
            url: r.link,
            similarityScore: undefined,
            whyRelevant: 'Matched search query',
          })));
        }

        // Store evidence
        await prisma.evidenceResult.create({
          data: {
            sessionId: input.sessionId,
            ideaFrameId: input.ideaFrameId,
            provider: 'serpapi_patents',
            query,
            queryHash: cacheKey,
            rawJson: searchResult as any,
            parsedJson: results as any,
            resultCount: results.length,
          },
        });
      } catch (e) {
        console.error('Search failed:', e);
      }
    }
  }

  // Use LLM to assess novelty
  const session = ideaFrame.session;
  const prompt = `You are a patent novelty assessor. Analyze the following invention idea against the search results.

INVENTION IDEA:
- Title: ${idea.title}
- Problem: ${idea.problem}
- Principle: ${idea.principle}
- Technical Effect: ${idea.technicalEffect}

SEARCH RESULTS (${results.length} found):
${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet || 'No snippet'}`).join('\n\n')}

Assess the novelty of this invention. Return ONLY valid JSON:
${getSchemaDescription('NoveltyGate')}

Guidelines:
- conceptSaturation: How crowded is the general problem space?
- solutionSaturation: How many similar solutions exist for this specific approach?
- noveltyScore: 0-100 (higher = more novel)
- recommendedAction:
  - KEEP: Novel enough to proceed
  - MUTATE_OPERATOR: Try a different transformation approach
  - MUTATE_DIMENSION: Explore a different dimension
  - NARROW_MICRO_PROBLEM: Focus on a more specific sub-problem
  - ASK_USER_QUESTION: Need more user input to differentiate`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_NOVELTY',
    session.id,
    input.requestHeaders,
  );

  const parsed = safeParseJson(response, NoveltyGateSchema);
  
  if (!parsed.success) {
    // Return default assessment
    return {
      query: queries.join(' | '),
      results: results,
      conceptSaturation: 'MEDIUM',
      solutionSaturation: results.length > 5 ? 'HIGH' : 'LOW',
      noveltyScore: results.length > 5 ? 40 : 70,
      recommendedAction: results.length > 5 ? 'MUTATE_OPERATOR' : 'KEEP',
      reasoning: 'Auto-assessed based on result count',
    };
  }

  // Update idea frame with novelty info
  await prisma.ideaFrame.update({
    where: { id: input.ideaFrameId },
    data: {
      noveltyScore: parsed.data.noveltyScore,
      noveltySummaryJson: parsed.data as any,
      conceptSaturation: parsed.data.conceptSaturation,
      solutionSaturation: parsed.data.solutionSaturation,
    },
  });

  return parsed.data as NoveltyGate;
}

// =============================================================================
// EXPORT TO IDEA BANK
// =============================================================================

/**
 * Export selected idea frames to the Idea Bank
 */
export async function exportToIdeaBank(input: ExportToIdeaBankInput): Promise<string[]> {
  const ideaFrames = await prisma.ideaFrame.findMany({
    where: {
      id: { in: input.ideaFrameIds },
      sessionId: { not: undefined },
    },
    include: { session: true },
  });

  const createdIds: string[] = [];

  for (const frame of ideaFrames) {
    const idea = frame.ideaFrameJson as IdeaFrame;

    // Create IdeaBankIdea
    const ideaBankIdea = await prisma.ideaBankIdea.create({
      data: {
        title: idea.title,
        description: `${idea.problem}\n\n${idea.principle}`,
        abstract: idea.technicalEffect,
        domainTags: idea.classLabels,
        technicalField: frame.classLabels[0] || 'General',
        noveltyScore: frame.noveltyScore ? frame.noveltyScore / 100 : null,
        status: 'PUBLIC',
        generatedBy: 'ideation-engine',
        keyFeatures: idea.components,
        potentialApplications: idea.variants.map(v => v.title),
        createdBy: input.userId,
        tenantId: input.tenantId,
        publishedAt: new Date(),
      },
    });

    createdIds.push(ideaBankIdea.id);

    // Update idea frame with export info
    await prisma.ideaFrame.update({
      where: { id: frame.id },
      data: {
        status: 'EXPORTED',
        exportedToIdeaId: ideaBankIdea.id,
        exportedAt: new Date(),
      },
    });
  }

  // Log export
  if (ideaFrames.length > 0) {
    await prisma.ideationHistory.create({
      data: {
        sessionId: ideaFrames[0].sessionId,
        action: 'EXPORTED_TO_IDEA_BANK',
        outputJson: { exportedIds: createdIds },
        userId: input.userId,
      },
    });
  }

  return createdIds;
}

// =============================================================================
// NODE OPERATIONS
// =============================================================================

/**
 * Update node state (expand/collapse/hide/select)
 */
export async function updateNodeState(
  sessionId: string,
  nodeId: string,
  state: 'EXPANDED' | 'COLLAPSED' | 'HIDDEN' | 'REMOVED' | 'SELECTED'
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state },
  });
}

/**
 * Update node position (for React Flow drag)
 */
export async function updateNodePosition(
  sessionId: string,
  nodeId: string,
  x: number,
  y: number
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { positionX: x, positionY: y },
  });
}

/**
 * Undo last hidden/removed nodes
 */
export async function undoNodeChanges(sessionId: string) {
  // Get recently hidden/removed nodes
  const hiddenNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId,
      state: { in: ['HIDDEN', 'REMOVED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  // Restore them to collapsed state
  await prisma.mindMapNode.updateMany({
    where: {
      id: { in: hiddenNodes.map(n => n.id) },
    },
    data: { state: 'COLLAPSED' },
  });

  return hiddenNodes.length;
}

// =============================================================================
// IDEA FRAME OPERATIONS
// =============================================================================

/**
 * Update idea frame status
 */
export async function updateIdeaStatus(
  ideaFrameId: string,
  status: 'DRAFT' | 'SHORTLISTED' | 'REJECTED' | 'ARCHIVED',
  notes?: string
) {
  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: {
      status,
      userNotes: notes,
    },
  });
}

/**
 * Rate an idea frame
 */
export async function rateIdea(ideaFrameId: string, rating: number) {
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: { userRating: rating },
  });
}

// =============================================================================
// SESSION CLEANUP
// =============================================================================

/**
 * Archive a session
 */
export async function archiveSession(sessionId: string) {
  return prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      status: 'ARCHIVED',
      completedAt: new Date(),
    },
  });
}

/**
 * Delete a session and all related data
 */
export async function deleteSession(sessionId: string) {
  // Cascade delete handles related records
  return prisma.ideationSession.delete({
    where: { id: sessionId },
  });
}

