-- ============================================================================
-- ADD RESEARCH TOPIC MODEL
-- Replaces IdeaRecord for academic research paper writing context
-- ============================================================================

-- Create MethodologyType enum
CREATE TYPE "MethodologyType" AS ENUM ('QUALITATIVE', 'QUANTITATIVE', 'MIXED_METHODS', 'THEORETICAL', 'CASE_STUDY', 'ACTION_RESEARCH', 'EXPERIMENTAL', 'SURVEY', 'OTHER');

-- Create ContributionType enum
CREATE TYPE "ContributionType" AS ENUM ('THEORETICAL', 'EMPIRICAL', 'METHODOLOGICAL', 'APPLIED', 'REVIEW', 'CONCEPTUAL');

-- Create ResearchTopic table
CREATE TABLE "research_topics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "researchQuestion" TEXT NOT NULL,
    "hypothesis" TEXT,
    "keywords" TEXT[],
    "methodology" "MethodologyType" NOT NULL,
    "contributionType" "ContributionType" NOT NULL,
    "datasetDescription" TEXT,
    "abstractDraft" TEXT,
    "llmPromptUsed" TEXT,
    "llmResponse" TEXT,
    "llmTokensUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_topics_pkey" PRIMARY KEY ("id")
);

-- Create unique index on sessionId
CREATE UNIQUE INDEX "research_topics_sessionId_key" ON "research_topics"("sessionId");

-- Create indexes for performance
CREATE INDEX "research_topics_methodology_idx" ON "research_topics"("methodology");
CREATE INDEX "research_topics_contributionType_idx" ON "research_topics"("contributionType");

-- Add foreign key constraint to drafting_sessions
ALTER TABLE "research_topics" ADD CONSTRAINT "research_topics_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add researchTopic relation to drafting_sessions table
-- This adds the column for the new relation
ALTER TABLE "drafting_sessions" ADD COLUMN "researchTopicId" TEXT;

-- Add foreign key constraint
ALTER TABLE "drafting_sessions" ADD CONSTRAINT "drafting_sessions_researchTopicId_fkey"
FOREIGN KEY ("researchTopicId") REFERENCES "research_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for the new foreign key
CREATE INDEX "drafting_sessions_researchTopicId_idx" ON "drafting_sessions"("researchTopicId");
