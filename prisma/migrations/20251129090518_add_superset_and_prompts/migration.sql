/*
  Warnings:

  - The `status` column on the `country_section_prompts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[country_code,section_key]` on the table `country_section_prompts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CountrySectionPromptStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- AlterTable
ALTER TABLE "country_names" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "country_section_mappings" ADD COLUMN     "display_order" INTEGER,
ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_required" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "country_section_prompts" DROP COLUMN "status",
ADD COLUMN     "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "superset_sections" (
    "id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "instruction" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '[]',
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "superset_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "superset_sections_section_key_key" ON "superset_sections"("section_key");

-- CreateIndex
CREATE INDEX "superset_sections_display_order_idx" ON "superset_sections"("display_order");

-- CreateIndex
CREATE INDEX "superset_sections_is_active_idx" ON "superset_sections"("is_active");

-- CreateIndex
CREATE INDEX "country_section_mappings_country_code_idx" ON "country_section_mappings"("country_code");

-- CreateIndex
CREATE INDEX "country_section_mappings_section_key_idx" ON "country_section_mappings"("section_key");

-- CreateIndex
CREATE INDEX "country_section_prompts_status_idx" ON "country_section_prompts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "country_section_prompts_country_code_section_key_key" ON "country_section_prompts"("country_code", "section_key");

-- AddForeignKey
ALTER TABLE "country_section_prompt_history" ADD CONSTRAINT "country_section_prompt_history_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "country_section_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "country_section_mappings_country_section_key" RENAME TO "country_section_mappings_country_code_section_key_key";

-- RenameIndex
ALTER INDEX "country_section_prompt_history_country_section_idx" RENAME TO "country_section_prompt_history_country_code_section_key_idx";

-- RenameIndex
ALTER INDEX "user_section_instructions_session_section_unique" RENAME TO "user_section_instructions_session_id_section_key_key";
