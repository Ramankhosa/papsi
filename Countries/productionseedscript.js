/**
 * Production seed backup (admin + settings only).
 *
 * Backs up all production-critical configuration data while skipping
 * patents, drafting artifacts, and search result tables.
 *
 * Run with: node Countries/productionseedscript.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Tables to skip: user content and heavy artifacts we do not need for a reset
const EXCLUDED_TABLES = new Set([
  '_prisma_migrations',
  'patent',
  'annexureVersion',
  'annexureDraft',
  'applicantProfile',
  'project',
  'projectCollaborator',
  'job',
  'draftingSession',
  'draftingHistory',
  'userSectionInstruction',
  'featureMapCell',
  'featureMapOverride',
  'featureMappingCache',
  'priorArtSearchBundle',
  'priorArtSearchHistory',
  'priorArtQueryVariant',
  'priorArtQueryVariantExecution',
  'priorArtRun',
  'priorArtRawResult',
  'priorArtRawDetail',
  'priorArtVariantHit',
  'priorArtPatent',
  'priorArtPatentDetail',
  'priorArtScholarContent',
  'priorArtUnifiedResult',
  'noveltySearchRun',
  'noveltySearchLLMCall',
  'noveltyAssessmentRun',
  'noveltyAssessmentLLMCall',
  'localPatent',
  'relatedArtRun',
  'relatedArtSelection'
]);

// Admin/config tables we want to preserve for production redeploy
const TABLES_TO_EXPORT = [
  // Auth and tenant setup
  'tenant',
  'user',
  'aTIToken',
  'emailVerificationToken',
  'passwordResetToken',
  'userCredit',
  'tokenNotification',
  'auditLog',

  // Plans and quotas
  'plan',
  'feature',
  'task',
  'planFeature',
  'planLLMAccess',
  'policyRule',
  'tenantPlan',
  'lLMModelClass',
  'lLMModelPrice',
  'quotaAlert',
  'usageMeter',
  'usageReservation',
  'usageLog',

  // Country configuration
  'countryName',
  'countryProfile',
  'countrySectionMapping',
  'countrySectionPrompt',
  'countrySectionPromptHistory',

  // Style and documents
  'styleProfile',
  'styleTrainingJob',
  'document',
  'diagramSource',
  'figurePlan',

  // Idea Bank / internal content
  'ideaBankIdea',
  'ideaBankReservation',
  'ideaBankHistory',
  'ideaBankSuggestion',
  'ideaRecord',

  // Misc operational data
  'aggregationSnapshot'
].filter((table) => !EXCLUDED_TABLES.has(table));

// Preferred sort order for deterministic output
const TABLE_SORT_FIELDS = {
  default: { id: 'asc' },
  countryName: { code: 'asc' },
  countrySectionMapping: [{ countryCode: 'asc' }, { displayOrder: 'asc' }, { supersetCode: 'asc' }],
  countrySectionPrompt: [{ countryCode: 'asc' }, { sectionKey: 'asc' }],
  countrySectionPromptHistory: [{ countryCode: 'asc' }, { sectionKey: 'asc' }, { version: 'asc' }],
  planFeature: [{ planId: 'asc' }, { featureId: 'asc' }],
  planLLMAccess: [{ planId: 'asc' }, { taskCode: 'asc' }],
  tenantPlan: [{ tenantId: 'asc' }, { planId: 'asc' }, { effectiveFrom: 'asc' }],
  usageMeter: [{ tenantId: 'asc' }, { featureId: 'asc' }],
  usageReservation: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  usageLog: [{ createdAt: 'asc' }],
  quotaAlert: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  tokenNotification: [{ createdAt: 'asc' }],
  user: [{ createdAt: 'asc' }],
  aTIToken: [{ createdAt: 'asc' }],
  auditLog: [{ createdAt: 'asc' }]
};

function getOrderBy(table) {
  return TABLE_SORT_FIELDS[table] || TABLE_SORT_FIELDS.default;
}

const DB_TABLE_NAMES = {
  tenant: 'tenants',
  user: 'users',
  aTIToken: 'ati_tokens',
  emailVerificationToken: 'email_verification_tokens',
  passwordResetToken: 'password_reset_tokens',
  userCredit: 'user_credits',
  tokenNotification: 'token_notifications',
  auditLog: 'audit_logs',
  plan: 'plans',
  feature: 'features',
  task: 'tasks',
  planFeature: 'plan_features',
  planLLMAccess: 'plan_llm_access',
  policyRule: 'policy_rules',
  tenantPlan: 'tenant_plans',
  lLMModelClass: 'llm_model_classes',
  lLMModelPrice: 'llm_model_prices',
  quotaAlert: 'quota_alerts',
  usageMeter: 'usage_meters',
  usageReservation: 'usage_reservations',
  usageLog: 'usage_logs',
  countryName: 'country_names',
  countryProfile: 'country_profiles',
  countrySectionMapping: 'country_section_mappings',
  countrySectionPrompt: 'country_section_prompts',
  countrySectionPromptHistory: 'country_section_prompt_history',
  styleProfile: 'style_profiles',
  styleTrainingJob: 'style_training_jobs',
  document: 'documents',
  diagramSource: 'diagram_sources',
  figurePlan: 'figure_plans',
  ideaBankIdea: 'idea_bank_ideas',
  ideaBankReservation: 'idea_bank_reservations',
  ideaBankHistory: 'idea_bank_history',
  ideaBankSuggestion: 'idea_bank_suggestions',
  ideaRecord: 'idea_records',
  aggregationSnapshot: 'aggregation_snapshots'
};

function resolveDbTable(table) {
  const dbName = DB_TABLE_NAMES[table];
  if (!dbName) {
    throw new Error(`No database table mapping found for "${table}"`);
  }
  return dbName;
}

async function exportTable(table) {
  const delegate = prisma[table];
  if (!delegate) {
    throw new Error(`No Prisma delegate found for table "${table}"`);
  }

  const orderBy = getOrderBy(table);

  // First try via Prisma client (preferred if schema matches)
  try {
    return await delegate.findMany({ orderBy });
  } catch (ormError) {
    console.warn(`Prisma export failed for ${table}, falling back to raw query: ${ormError.message}`);
  }

  // Fallback: raw query to handle schema drift (missing columns, older DB)
  const dbTable = resolveDbTable(table);
  try {
    return await prisma.$queryRawUnsafe(`SELECT * FROM "${dbTable}"`);
  } catch (rawError) {
    throw new Error(`Raw export failed for ${table}: ${rawError.message}`);
  }
}

async function main() {
  console.log('Starting production seed backup (admin + settings)...');
  console.log(`Including ${TABLES_TO_EXPORT.length} tables, excluding ${EXCLUDED_TABLES.size}`);

  const exportPayload = {
    generatedAt: new Date().toISOString(),
    excludedTables: Array.from(EXCLUDED_TABLES).sort(),
    tables: {}
  };

  const summary = [];

  for (const table of TABLES_TO_EXPORT) {
    try {
      const records = await exportTable(table);
      exportPayload.tables[table] = records;
      summary.push({ table, count: records.length });
      console.log(`Exported ${records.length} rows from ${table}`);
    } catch (err) {
      console.error(`Failed to export ${table}: ${err.message}`);
      exportPayload.tables[table] = [];
      summary.push({ table, count: 0, error: err.message });
    }
  }

  const outputPath = path.join(__dirname, 'production-seed-backup.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportPayload, null, 2));

  console.log(`\nBackup written to ${outputPath}`);
  console.log('Summary:');
  console.table(summary);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Backup failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
