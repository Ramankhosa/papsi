-- CreateTable: CountrySectionPrompt for storing top-up prompts in database
CREATE TABLE "country_section_prompts" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "additions" JSONB DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_section_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint for active prompt per country/section
CREATE UNIQUE INDEX "country_section_prompts_country_section_active" 
    ON "country_section_prompts"("country_code", "section_key") 
    WHERE "status" = 'ACTIVE';

-- CreateIndex: Fast lookup by country
CREATE INDEX "country_section_prompts_country_code_idx" ON "country_section_prompts"("country_code");

-- CreateIndex: Fast lookup by section
CREATE INDEX "country_section_prompts_section_key_idx" ON "country_section_prompts"("section_key");

-- CreateTable: Prompt version history for audit trail
CREATE TABLE "country_section_prompt_history" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "additions" JSONB DEFAULT '[]',
    "version" INTEGER NOT NULL,
    "change_type" TEXT NOT NULL,
    "change_reason" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_section_prompt_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "country_section_prompt_history_prompt_id_idx" ON "country_section_prompt_history"("prompt_id");
CREATE INDEX "country_section_prompt_history_country_section_idx" ON "country_section_prompt_history"("country_code", "section_key");

-- CreateTable: User section instructions per drafting session
CREATE TABLE "user_section_instructions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "emphasis" TEXT,
    "avoid" TEXT,
    "style" TEXT,
    "word_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_section_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint for user instruction per session/section
CREATE UNIQUE INDEX "user_section_instructions_session_section_unique" 
    ON "user_section_instructions"("session_id", "section_key");

-- CreateIndex: Fast lookups
CREATE INDEX "user_section_instructions_session_id_idx" ON "user_section_instructions"("session_id");
CREATE INDEX "user_section_instructions_section_key_idx" ON "user_section_instructions"("section_key");

-- AddForeignKey
ALTER TABLE "user_section_instructions" ADD CONSTRAINT "user_section_instructions_session_id_fkey" 
    FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

