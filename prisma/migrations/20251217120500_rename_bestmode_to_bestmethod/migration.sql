-- Normalize canonical drafting section key:
-- Historically some records used "bestMode"; canonical is now "bestMethod".

-- Superset sections (unique by section_key)
DELETE FROM "superset_sections"
WHERE "section_key" = 'bestMode'
  AND EXISTS (SELECT 1 FROM "superset_sections" WHERE "section_key" = 'bestMethod');
UPDATE "superset_sections" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';

-- Country mappings (unique by country_code + section_key)
DELETE FROM "country_section_mappings" c
WHERE c."section_key" = 'bestMode'
  AND EXISTS (
    SELECT 1 FROM "country_section_mappings" c2
    WHERE c2."country_code" = c."country_code" AND c2."section_key" = 'bestMethod'
  );
UPDATE "country_section_mappings" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';

-- Country top-up prompts (unique by country_code + section_key)
DELETE FROM "country_section_prompts" p
WHERE p."section_key" = 'bestMode'
  AND EXISTS (
    SELECT 1 FROM "country_section_prompts" p2
    WHERE p2."country_code" = p."country_code" AND p2."section_key" = 'bestMethod'
  );
UPDATE "country_section_prompts" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';
UPDATE "country_section_prompt_history" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';

-- User-level instructions and overrides
UPDATE "user_section_instructions" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';
UPDATE "user_validation_overrides" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';

-- Validation rules
UPDATE "country_section_validations" SET "section_key" = 'bestMethod' WHERE "section_key" = 'bestMode';

-- Export config arrays (best-effort; may not exist in older schemas)
UPDATE "country_export_configs"
SET "includes_sections" = array_replace("includes_sections", 'bestMode', 'bestMethod')
WHERE 'bestMode' = ANY("includes_sections");
UPDATE "country_export_configs"
SET "section_order" = array_replace("section_order", 'bestMode', 'bestMethod')
WHERE 'bestMode' = ANY("section_order");
