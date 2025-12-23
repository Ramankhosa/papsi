-- CreateEnum: Ideation Session Status
CREATE TYPE "IdeationSessionStatus" AS ENUM ('SEED_INPUT', 'CLARIFYING', 'CLASSIFYING', 'EXPANDING', 'EXPLORING', 'GENERATING', 'NOVELTY_CHECK', 'REVIEWING', 'COMPLETED', 'ARCHIVED');

-- CreateEnum: Invention Class
CREATE TYPE "InventionClass" AS ENUM ('PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS', 'COMPOSITION', 'SOFTWARE_ALGORITHM', 'BIOTECH_PHARMA', 'MANUFACTURING', 'SERVICE_WORKFLOW', 'HYBRID');

-- CreateEnum: Archetype
CREATE TYPE "Archetype" AS ENUM ('MECH', 'ELEC', 'SOFT', 'CHEM', 'BIO', 'MIXED');

-- CreateEnum: Fork Mode
CREATE TYPE "ForkMode" AS ENUM ('SINGLE', 'FORK', 'MERGE');

-- CreateEnum: Mind Map Node Type
CREATE TYPE "MindMapNodeType" AS ENUM ('SEED', 'COMPONENT', 'DIMENSION_FAMILY', 'DIMENSION_OPTION', 'OPERATOR', 'CONSTRAINT', 'IDEA_FRAME', 'EVIDENCE_CLUSTER');

-- CreateEnum: Mind Map Node State
CREATE TYPE "MindMapNodeState" AS ENUM ('EXPANDED', 'COLLAPSED', 'HIDDEN', 'REMOVED', 'SELECTED');

-- CreateEnum: Idea Frame Status
CREATE TYPE "IdeaFrameStatus" AS ENUM ('DRAFT', 'SHORTLISTED', 'REJECTED', 'EXPORTED', 'ARCHIVED');

-- CreateEnum: Saturation Level
CREATE TYPE "SaturationLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum: Novelty Action
CREATE TYPE "NoveltyAction" AS ENUM ('KEEP', 'MUTATE_OPERATOR', 'MUTATE_DIMENSION', 'NARROW_MICRO_PROBLEM', 'ASK_USER_QUESTION');

-- CreateTable: Main Ideation Sessions
CREATE TABLE "ideation_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdeationSessionStatus" NOT NULL DEFAULT 'SEED_INPUT',
    "seedText" TEXT NOT NULL,
    "seedGoal" TEXT,
    "seedConstraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normalizationJson" JSONB,
    "classificationJson" JSONB,
    "settingsJson" JSONB,
    "budgetCap" TEXT NOT NULL DEFAULT 'MEDIUM',
    "activeTracks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ideation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mind Map Nodes
CREATE TABLE "mindmap_nodes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "type" "MindMapNodeType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "family" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" "MindMapNodeState" NOT NULL DEFAULT 'COLLAPSED',
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "defaultExpanded" BOOLEAN NOT NULL DEFAULT false,
    "parentNodeId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "payloadJson" JSONB,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "positionX" DOUBLE PRECISION,
    "positionY" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mindmap_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Mind Map Edges
CREATE TABLE "mindmap_edges" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "label" TEXT,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mindmap_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Combine Trays (User's selection for idea generation)
CREATE TABLE "combine_trays" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "selectedComponents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedDimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedOperators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipeIntent" TEXT NOT NULL DEFAULT 'divergent',
    "requestedCount" INTEGER NOT NULL DEFAULT 5,
    "recipeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combine_trays_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Idea Frames (Generated Ideas)
CREATE TABLE "idea_frames" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ideaFrameJson" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "principle" TEXT NOT NULL,
    "technicalEffect" TEXT,
    "classLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operatorsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dimensionsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "componentsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "IdeaFrameStatus" NOT NULL DEFAULT 'DRAFT',
    "noveltyScore" INTEGER,
    "noveltySummaryJson" JSONB,
    "conceptSaturation" "SaturationLevel",
    "solutionSaturation" "SaturationLevel",
    "userNotes" TEXT,
    "userRating" INTEGER,
    "exportedToIdeaId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_frames_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Evidence Results (Novelty search evidence)
CREATE TABLE "evidence_results" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ideaFrameId" TEXT,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "parsedJson" JSONB,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "relevanceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Ideation Search Cache (Cost control)
CREATE TABLE "ideation_search_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideation_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Ideation History (Audit trail)
CREATE TABLE "ideation_history" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "stage" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "userId" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "modelUsed" TEXT,
    "durationMs" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideation_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Ideation Sessions indexes
CREATE INDEX "ideation_sessions_tenantId_idx" ON "ideation_sessions"("tenantId");
CREATE INDEX "ideation_sessions_userId_idx" ON "ideation_sessions"("userId");
CREATE INDEX "ideation_sessions_status_idx" ON "ideation_sessions"("status");

-- CreateIndex: Mind Map Nodes indexes
CREATE UNIQUE INDEX "mindmap_nodes_sessionId_nodeId_key" ON "mindmap_nodes"("sessionId", "nodeId");
CREATE INDEX "mindmap_nodes_sessionId_idx" ON "mindmap_nodes"("sessionId");
CREATE INDEX "mindmap_nodes_sessionId_type_idx" ON "mindmap_nodes"("sessionId", "type");
CREATE INDEX "mindmap_nodes_sessionId_state_idx" ON "mindmap_nodes"("sessionId", "state");

-- CreateIndex: Mind Map Edges indexes
CREATE UNIQUE INDEX "mindmap_edges_sessionId_fromNodeId_toNodeId_key" ON "mindmap_edges"("sessionId", "fromNodeId", "toNodeId");
CREATE INDEX "mindmap_edges_sessionId_idx" ON "mindmap_edges"("sessionId");

-- CreateIndex: Combine Trays indexes
CREATE UNIQUE INDEX "combine_trays_sessionId_key" ON "combine_trays"("sessionId");

-- CreateIndex: Idea Frames indexes
CREATE INDEX "idea_frames_sessionId_idx" ON "idea_frames"("sessionId");
CREATE INDEX "idea_frames_sessionId_status_idx" ON "idea_frames"("sessionId", "status");

-- CreateIndex: Evidence Results indexes
CREATE INDEX "evidence_results_sessionId_idx" ON "evidence_results"("sessionId");
CREATE INDEX "evidence_results_queryHash_idx" ON "evidence_results"("queryHash");
CREATE INDEX "evidence_results_ideaFrameId_idx" ON "evidence_results"("ideaFrameId");

-- CreateIndex: Ideation Search Cache indexes
CREATE UNIQUE INDEX "ideation_search_cache_cacheKey_key" ON "ideation_search_cache"("cacheKey");
CREATE INDEX "ideation_search_cache_cacheKey_idx" ON "ideation_search_cache"("cacheKey");
CREATE INDEX "ideation_search_cache_expiresAt_idx" ON "ideation_search_cache"("expiresAt");

-- CreateIndex: Ideation History indexes
CREATE INDEX "ideation_history_sessionId_idx" ON "ideation_history"("sessionId");
CREATE INDEX "ideation_history_sessionId_action_idx" ON "ideation_history"("sessionId", "action");

-- AddForeignKey: Ideation Sessions
ALTER TABLE "ideation_sessions" ADD CONSTRAINT "ideation_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ideation_sessions" ADD CONSTRAINT "ideation_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Mind Map Nodes
ALTER TABLE "mindmap_nodes" ADD CONSTRAINT "mindmap_nodes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Mind Map Edges
ALTER TABLE "mindmap_edges" ADD CONSTRAINT "mindmap_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Combine Trays
ALTER TABLE "combine_trays" ADD CONSTRAINT "combine_trays_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Idea Frames
ALTER TABLE "idea_frames" ADD CONSTRAINT "idea_frames_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Evidence Results
ALTER TABLE "evidence_results" ADD CONSTRAINT "evidence_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_results" ADD CONSTRAINT "evidence_results_ideaFrameId_fkey" FOREIGN KEY ("ideaFrameId") REFERENCES "idea_frames"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Ideation History
ALTER TABLE "ideation_history" ADD CONSTRAINT "ideation_history_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ideation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

