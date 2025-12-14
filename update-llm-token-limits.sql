-- Update LLM Token Limits - Add 5000 to input and 10000 to output
-- Execute this script on production database to increase token limits for all LLM operations

-- Connect to production database
-- \c spotipr;

-- Update all existing plan_stage_model_configs records to increase token limits
UPDATE plan_stage_model_configs
SET
  "maxTokensIn" = COALESCE("maxTokensIn", 0) + 5000,
  "maxTokensOut" = COALESCE("maxTokensOut", 0) + 10000,
  "updatedAt" = NOW()
WHERE "isActive" = true;

-- Verify the updates
SELECT
  COUNT(*) as "Total Configs Updated",
  MIN("maxTokensIn") as "Min Input Tokens",
  MAX("maxTokensIn") as "Max Input Tokens",
  MIN("maxTokensOut") as "Min Output Tokens",
  MAX("maxTokensOut") as "Max Output Tokens"
FROM plan_stage_model_configs
WHERE "isActive" = true;

-- Show sample of updated records
SELECT
  p.code as "Plan Code",
  ws."displayName" as "Stage Name",
  llm."displayName" as "Model Name",
  psmc."maxTokensIn" as "Input Tokens",
  psmc."maxTokensOut" as "Output Tokens"
FROM plan_stage_model_configs psmc
JOIN plans p ON psmc."planId" = p.id
JOIN workflow_stages ws ON psmc."stageId" = ws.id
JOIN llm_models llm ON psmc."modelId" = llm.id
WHERE psmc."isActive" = true
ORDER BY p.code, ws."sortOrder"
LIMIT 10;
