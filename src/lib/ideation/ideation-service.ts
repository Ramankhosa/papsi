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
  ContradictionMappingSchema,
  ObviousnessFilterSchema,
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
  type ContradictionMapping,
  type ObviousnessFilter,
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

  const prompt = `You are a patent ideation assistant specializing in extracting INVENTIVE problems. Analyze the following invention idea and extract structured information, focusing on underlying CONTRADICTIONS that drive innovation.

INPUT IDEA:
"""
${session.seedText}
"""

${session.seedGoal ? `STATED GOAL: ${session.seedGoal}` : ''}
${session.seedConstraints.length > 0 ? `USER CONSTRAINTS: ${session.seedConstraints.join(', ')}` : ''}

Return ONLY valid JSON matching this schema (no other text):
${getSchemaDescription('InputNormalization')}

CRITICAL RULES:
- coreEntity: The main physical or conceptual thing being invented
- intentGoal: What the user wants to achieve or solve
- constraints: Hard limits mentioned (cost, size, no electronics, etc.)
- negativeConstraints: Things explicitly forbidden
- unknownsToAsk: Questions that would help clarify the invention (max 3)

CONTRADICTION EXTRACTION (Most Important):
- technicalContradictions: Identify 1-3 underlying tradeoffs where improving one parameter worsens another
  * Example: "lightweight" vs "durable" - making it lighter makes it weaker
  * If not explicit, INFER from goal vs constraint conflict
- unstatedAssumptions: Hidden assumptions in the problem that could be challenged (e.g., "must be single-piece")
- secondOrderGoals: Goals that emerge from solving the primary goal
- patentableProblemStatement: Reframe the problem in inventive terms (focus on the CONTRADICTION, not just the wish)

Example contradiction format:
{
  "parameterToImprove": "comfort (soft material)",
  "parameterThatWorsens": "safety (rigidity)",
  "conflictDescription": "Softer materials increase comfort but reduce protective capability"
}

Do NOT invent facts; derive contradictions from the stated context.`;

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
    // NEW: Contradiction extraction fields
    technicalContradictions: parsed.data.technicalContradictions ?? [],
    unstatedAssumptions: parsed.data.unstatedAssumptions ?? [],
    secondOrderGoals: parsed.data.secondOrderGoals ?? [],
    patentableProblemStatement: parsed.data.patentableProblemStatement,
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
// STAGE 2.5: CONTRADICTION MAPPING (NEW)
// =============================================================================

/**
 * Map contradictions to TRIZ principles and resolution strategies
 * This makes contradictions first-class citizens in the ideation process
 */
export async function mapContradictions(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<ContradictionMapping> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must be normalized before contradiction mapping');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const existingContradictions = normalization.technicalContradictions || [];

  const prompt = `You are a TRIZ expert and patent strategist. Analyze the contradictions in this invention and map them to resolution strategies.

INVENTION CONTEXT:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Constraints: ${normalization.constraints.join(', ') || 'None'}
- Forbidden: ${normalization.negativeConstraints.join(', ') || 'None'}

IDENTIFIED CONTRADICTIONS:
${existingContradictions.length > 0 
  ? existingContradictions.map((c, i) => `${i + 1}. Improve "${c.parameterToImprove}" → Worsens "${c.parameterThatWorsens}": ${c.conflictDescription}`).join('\n')
  : 'None explicitly identified - you must infer them from the goal vs constraints'
}

Return ONLY valid JSON:
${getSchemaDescription('ContradictionMapping')}

RULES:
1. If no contradictions were identified, INFER them from goal vs constraint conflicts
2. For each contradiction, explain WHY it's hard to solve (not just what it is)
3. Map to TRIZ inventive principles that could resolve each contradiction
4. Suggest resolution strategies:
   - SEPARATION_IN_TIME: Do X at time T1, Y at time T2
   - SEPARATION_IN_SPACE: X happens in region A, Y in region B
   - SEPARATION_ON_CONDITION: X when condition C, Y when not C
   - SEPARATION_BETWEEN_PARTS: Part A does X, Part B does Y
   - INVERSION: Instead of X, do opposite of X
   - SUBSTANCE_FIELD_SHIFT: Change the field/energy type
   - DYNAMIZATION: Make static parts dynamic
5. Identify second-order effects (solving contradiction A may create B)

Example inventive principles: Segmentation, Extraction, Local Quality, Asymmetry, Merging, Universality, Nesting, Anti-weight, Prior Counteraction, Prior Action, Cushion in Advance, Equipotentiality, Inversion, Spheroidality, Dynamics, Partial/Excessive Action`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_CONTRADICTION_MAPPING',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ContradictionMappingSchema);
  
  if (!parsed.success) {
    // Return minimal valid structure on parse failure
    const fallback: ContradictionMapping = {
      contradictions: existingContradictions.map(c => ({
        parameterToImprove: c.parameterToImprove,
        parameterThatWorsens: c.parameterThatWorsens,
        whyThisIsHard: 'Auto-derived from normalization',
      })),
      secondOrderEffects: [],
      inventivePrinciples: [],
      resolutionStrategies: [],
    };
    return fallback;
  }

  // Ensure all fields have proper defaults
  const result: ContradictionMapping = {
    contradictions: parsed.data.contradictions,
    secondOrderEffects: parsed.data.secondOrderEffects ?? [],
    inventivePrinciples: parsed.data.inventivePrinciples ?? [],
    resolutionStrategies: parsed.data.resolutionStrategies ?? [],
  };

  // Store contradiction mapping in session
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      normalizationJson: {
        ...(session.normalizationJson as object),
        contradictionMapping: result,
      },
    },
  });

  return result;
}

// =============================================================================
// STAGE 3.5: OBVIOUSNESS FILTER (NEW)
// =============================================================================

/**
 * Score selected dimensions for novelty BEFORE idea generation
 * Prevents wasting LLM calls on obvious combinations
 */
export async function checkObviousness(
  sessionId: string,
  selectedDimensions: string[],
  requestHeaders: Record<string, string>
): Promise<ObviousnessFilter> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { nodes: true },
  });

  if (!session.normalizationJson || !session.classificationJson) {
    throw new Error('Session must be normalized and classified');
  }

  const normalization = session.normalizationJson as InputNormalization;
  const classification = session.classificationJson as Classification;
  
  // Get dimension details
  const dimensionNodes = session.nodes.filter(n => selectedDimensions.includes(n.nodeId));
  const dimensionDetails = dimensionNodes.map(n => `${n.family}: ${n.title} (${n.description || 'no desc'})`);

  const prompt = `You are a patent examiner assessing obviousness. Would a person having ordinary skill in the art (PHOSITA) find this combination obvious?

INVENTION:
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Domain: ${classification.archetype}

SELECTED DIMENSIONS FOR COMBINATION:
${dimensionDetails.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY valid JSON:
${getSchemaDescription('ObviousnessFilter')}

ASSESSMENT CRITERIA:
1. combinationNovelty (0-100):
   - 0-30: Obvious - known combination in the field
   - 31-50: Marginal - somewhat predictable
   - 51-70: Non-obvious - unexpected combination
   - 71-100: Highly inventive - cross-domain leap

2. obviousnessFlags - mark ALL that apply:
   - COMBINATIONAL: Just adding known elements (A + B)
   - SAME_DOMAIN: All elements from same technical field
   - PARAMETER_TWEAK: Only changing values, not structure
   - OBVIOUS_SUBSTITUTION: Well-known material/component swap
   - PREDICTABLE_RESULT: Expected outcome from this combo

3. If combinationNovelty < 40:
   - Suggest a "wildCardSuggestion" - an unexpected dimension from a DISTANT domain
   - Example: For mechanical problem, suggest biological analogy

4. dimensionQualityScores: Rate each dimension's novelty contribution
   - KEEP: Contributes to novelty
   - REPLACE: Too obvious, suggest replacement
   - INVERT: Try the opposite approach

5. suggestedAnalogySources: List 2-3 distant domains to draw from
   - Should be 2+ conceptual hops away from ${classification.archetype}`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_OBVIOUSNESS_FILTER',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, ObviousnessFilterSchema);
  
  if (!parsed.success) {
    // Return default moderate score on failure
    const fallback: ObviousnessFilter = {
      combinationNovelty: 50,
      obviousnessFlags: [],
      dimensionQualityScores: [],
      suggestedAnalogySources: [],
    };
    return fallback;
  }

  return parsed.data as ObviousnessFilter;
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

  // Layout constants for left-to-right tree with generous spacing
  const LEVEL_WIDTH = 400;  // Horizontal spacing between levels
  const NODE_HEIGHT = 180;  // Generous vertical spacing between nodes
  const START_X = 100;      // Starting X position (seed is at left)
  const START_Y = 100;      // Starting Y position

  // Calculate seed node Y position based on number of dimensions (centered)
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

Generate 3-5 specific options within this dimension that could be explored for this invention.
Each option should be a concrete variation or approach within the "${node.title}" dimension.
Keep it focused - quality over quantity.

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

  // Layout constants - SINGLE COLUMN for clarity, generous spacing
  const LEVEL_WIDTH = 400;   // Horizontal gap between parent and children
  const NODE_HEIGHT = 180;   // Generous vertical spacing between nodes
  
  // Calculate positions - children in a SINGLE COLUMN to the right of parent
  const parentNode = node;
  const parentX = parentNode.positionX || 50;
  const parentY = parentNode.positionY || 200;
  const parentDepth = parentNode.depth || 0;
  
  // Single column layout - stack children vertically, centered around parent Y
  const totalChildren = newNodes.length;
  const totalHeight = (totalChildren - 1) * NODE_HEIGHT;
  const startY = parentY - (totalHeight / 2);

  const nodesToCreate = newNodes.map((n, i) => {
    return {
      sessionId: input.sessionId,
      nodeId: n.id,
      type: n.type as any,
      title: n.title,
      description: n.descriptionShort || null,
      family: n.family || node.family,
      tags: n.tags || [],
      state: 'COLLAPSED' as const,
      selectable: n.selectable !== false,
      defaultExpanded: n.defaultExpanded || false,
      depth: parentDepth + 1,
      parentNodeId: input.nodeId,
      positionX: parentX + LEVEL_WIDTH,  // All children at same X (single column)
      positionY: startY + (i * NODE_HEIGHT),  // Stack vertically with generous spacing
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

  // Fetch the newly created nodes from database to get actual positions and parentNodeId
  const createdNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId: input.sessionId,
      nodeId: { in: newNodes.map(n => n.id) },
    },
  });

  const createdEdges = await prisma.mindMapEdge.findMany({
    where: {
      sessionId: input.sessionId,
      fromNodeId: input.nodeId,
    },
  });

  // Return the actual database records with proper positions and parent references
  return {
    nodes: createdNodes.map(n => ({
      id: n.nodeId,
      type: n.type,
      title: n.title,
      descriptionShort: n.description || undefined,
      family: n.family || undefined,
      selectable: n.selectable,
      defaultExpanded: n.defaultExpanded,
      tags: n.tags,
      parentId: n.parentNodeId || undefined,
      // Include position data for frontend
      positionX: n.positionX,
      positionY: n.positionY,
      state: n.state,
      depth: n.depth,
    })),
    edges: createdEdges.map(e => ({
      from: e.fromNodeId,
      to: e.toNodeId,
      relation: e.relation || 'contains',
    })),
  } as any;
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

  // Extract contradiction info if available
  const contradictionMapping = (normalization as any).contradictionMapping;
  const contradictions = normalization.technicalContradictions || [];
  const inventivePrinciples = contradictionMapping?.inventivePrinciples || [];
  const resolutionStrategies = contradictionMapping?.resolutionStrategies || [];

  const prompt = `You are a PATENT INVENTION GENERATOR. Your task is to create ${input.recipe.count} PATENT-WORTHY inventions that are NON-OBVIOUS and resolve technical contradictions.

═══════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════
- Core Entity: ${normalization.coreEntity}
- Goal: ${normalization.intentGoal}
- Class: ${classification.dominantClass}
- Archetype: ${classification.archetype}
- Constraints: ${normalization.constraints.join(', ') || 'None'}
- Forbidden: ${normalization.negativeConstraints.join(', ') || 'None'}
${normalization.patentableProblemStatement ? `- Patentable Problem: ${normalization.patentableProblemStatement}` : ''}

═══════════════════════════════════════════════════════════════
TECHNICAL CONTRADICTIONS TO RESOLVE
═══════════════════════════════════════════════════════════════
${contradictions.length > 0 
  ? contradictions.map((c, i) => `${i + 1}. "${c.parameterToImprove}" ↔ "${c.parameterThatWorsens}": ${c.conflictDescription}`).join('\n')
  : 'None identified - YOU must find the underlying tradeoff'
}

${inventivePrinciples.length > 0 ? `SUGGESTED TRIZ PRINCIPLES: ${inventivePrinciples.join(', ')}` : ''}
${resolutionStrategies.length > 0 ? `RESOLUTION STRATEGIES: ${resolutionStrategies.map((s: { strategy: string }) => s.strategy).join(', ')}` : ''}

═══════════════════════════════════════════════════════════════
SELECTED BUILDING BLOCKS
═══════════════════════════════════════════════════════════════
COMPONENTS: ${componentDetails.join(', ') || 'Use your judgment'}
DIMENSIONS: ${dimensionDetails.join('; ') || 'Explore broadly'}
OPERATORS: ${operatorDetails.join('; ') || 'Apply appropriate operators'}

═══════════════════════════════════════════════════════════════
GENERATION INTENT: ${input.recipe.recipeIntent}
═══════════════════════════════════════════════════════════════
${input.recipe.recipeIntent === 'DIVERGENT' ? '→ Generate diverse, creative ideas with cross-domain analogies' : ''}
${input.recipe.recipeIntent === 'CONVERGENT' ? '→ Focus on practical, implementable ideas' : ''}
${input.recipe.recipeIntent === 'RISK_REDUCTION' ? '→ Focus on safety and reliability improvements' : ''}
${input.recipe.recipeIntent === 'COST_REDUCTION' ? '→ Focus on cost-effective solutions' : ''}

═══════════════════════════════════════════════════════════════
MANDATORY REQUIREMENTS FOR PATENT-WORTHY IDEAS
═══════════════════════════════════════════════════════════════
Each idea MUST include:

1. inventiveLeap: The non-obvious insight (what would surprise an expert)
2. whyNotObvious: Why a skilled person would NOT arrive at this solution
3. analogySource: A DISTANT domain this draws from (2+ conceptual hops)
   - Bad: "using steel instead of aluminum" (same domain)
   - Good: "using biological cell division patterns for manufacturing"
4. eliminatedComponent: What traditional element is REMOVED or INVERTED
5. contradictionResolved: Which tradeoff this solves
6. resolutionStrategy: HOW the contradiction is resolved (separation, inversion, etc.)

═══════════════════════════════════════════════════════════════
FORBIDDEN PATTERNS (Ideas with these will be rejected)
═══════════════════════════════════════════════════════════════
❌ ADDITIVE COMBINATIONS: "Add sensor + AI + cloud" (just stacking)
❌ PARAMETER TWEAKS: "Make it bigger/smaller/faster" (no structure change)
❌ OBVIOUS SUBSTITUTIONS: "Use plastic instead of metal" (known swap)
❌ SAME-DOMAIN COMBINATIONS: All elements from one field
❌ PREDICTABLE OUTCOMES: Results anyone would expect

═══════════════════════════════════════════════════════════════
CLAIM HOOK FORMAT
═══════════════════════════════════════════════════════════════
✅ USE: "configured to [function] by [unexpected mechanism]"
✅ USE: "wherein [component] achieves [result] through [novel approach]"
❌ AVOID: "includes A and B" (just listing elements)
❌ AVOID: "comprises" without functional language

Generate exactly ${input.recipe.count} invention ideas as a JSON array.
Schema: ${getSchemaDescription('IdeaFrame')}

Return ONLY the JSON array (no other text):
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

  // Use LLM to assess novelty with enhanced feedback loop
  const session = ideaFrame.session;
  const prompt = `You are a PATENT EXAMINER conducting a novelty and non-obviousness assessment. Your goal is to determine if this invention would survive USPTO examination.

═══════════════════════════════════════════════════════════════
INVENTION UNDER REVIEW
═══════════════════════════════════════════════════════════════
- Title: ${idea.title}
- Problem: ${idea.problem}
- Principle: ${idea.principle}
- Technical Effect: ${idea.technicalEffect}
${idea.inventiveLeap ? `- Claimed Inventive Leap: ${idea.inventiveLeap}` : ''}
${idea.whyNotObvious ? `- Why Not Obvious: ${idea.whyNotObvious}` : ''}
${idea.analogySource ? `- Analogy Source: ${idea.analogySource}` : ''}
${idea.eliminatedComponent ? `- Eliminated Component: ${idea.eliminatedComponent}` : ''}

═══════════════════════════════════════════════════════════════
PRIOR ART SEARCH RESULTS (${results.length} found)
═══════════════════════════════════════════════════════════════
${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet || 'No snippet'}`).join('\n\n')}

Return ONLY valid JSON:
${getSchemaDescription('NoveltyGate')}

═══════════════════════════════════════════════════════════════
ASSESSMENT CRITERIA
═══════════════════════════════════════════════════════════════

1. noveltyScore (0-100):
   - 0-30: OBVIOUS - A PHOSITA would arrive at this with routine experimentation
   - 31-50: MARGINAL - Some prior art teaches this, needs differentiation
   - 51-70: NON-OBVIOUS - Unexpected combination or result
   - 71-100: HIGHLY INVENTIVE - Clear inventive leap, distant analogy

2. obviousnessFlags - Mark ALL that apply:
   - COMBINATIONAL: Just adding known elements without synergy
   - SAME_DOMAIN: All prior art from same technical field
   - PARAMETER_TWEAK: Only changing values, not structure
   - OBVIOUS_SUBSTITUTION: Well-known material/component swap
   - PREDICTABLE_RESULT: Expected outcome from this combination

3. phositaTest: Write a sentence explaining why a Person Having Ordinary Skill In The Art would or would NOT find this obvious
   - Example: "A mechanical engineer in 2024 would NOT think to use origami folding for crash absorption because..."

4. IF noveltyScore < 60, MUST provide mutationInstructions:
   - action: What type of change to make (MUTATE_DIMENSION, ADD_ANALOGY, INVERT_APPROACH, etc.)
   - specifics: Detailed instruction (e.g., "Replace material dimension with quantum superposition analogy")
   - retainElements: What's worth keeping from the original idea
   - suggestedAnalogy: A DISTANT domain to draw from (biology, economics, game theory, etc.)

5. suggestedIterations: List 2-3 specific ways to increase novelty:
   - "Invert the [X] to achieve opposite effect"
   - "Apply [biological process] analogy to [mechanism]"
   - "Eliminate [traditional component] entirely"

═══════════════════════════════════════════════════════════════
RECOMMENDED ACTIONS
═══════════════════════════════════════════════════════════════
- KEEP: noveltyScore ≥ 60, proceed to patent drafting
- MUTATE_OPERATOR: Try different TRIZ operator
- MUTATE_DIMENSION: Explore different dimension family
- NARROW_MICRO_PROBLEM: Focus on more specific sub-problem
- ASK_USER_QUESTION: Need clarification to differentiate`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_NOVELTY',
    session.id,
    input.requestHeaders,
  );

  const parsed = safeParseJson(response, NoveltyGateSchema);
  
  if (!parsed.success) {
    // Return default assessment with all required fields
    const fallback: NoveltyGate = {
      query: queries.join(' | '),
      results: results,
      conceptSaturation: 'MEDIUM',
      solutionSaturation: results.length > 5 ? 'HIGH' : 'LOW',
      noveltyScore: results.length > 5 ? 40 : 70,
      recommendedAction: results.length > 5 ? 'MUTATE_OPERATOR' : 'KEEP',
      reasoning: 'Auto-assessed based on result count',
      // NEW: Enhanced feedback loop fields
      obviousnessFlags: results.length > 5 ? ['SAME_DOMAIN'] : [],
      suggestedIterations: results.length > 5 
        ? ['Try a more distant analogy', 'Eliminate a traditional component', 'Invert the approach']
        : [],
    };
    return fallback;
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

