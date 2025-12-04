#!/usr/bin/env node

/**
 * Complete Database Restoration from Backup
 *
 * This script restores all data from the complete backup directory
 * database-backup-complete-2025-12-03_13-37-42/
 *
 * Usage: node restore-from-backup.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const BACKUP_DIR = 'database-backup-complete-2025-12-03_13-37-42';

// Table restoration order (respecting foreign key constraints)
const RESTORE_ORDER = [
  // Core system data
  { table: 'tenant', file: 'tenant.json' },
  { table: 'user', file: 'user.json' },
  { table: 'aTIToken', file: 'aTIToken.json' },
  { table: 'auditLog', file: 'auditLog.json' },

  // Country data (referenced by many tables)
  { table: 'countryName', file: 'countryName.json' },

  // Plans and features
  { table: 'plan', file: 'plan.json' },
  { table: 'feature', file: 'feature.json' },
  { table: 'task', file: 'task.json' },
  { table: 'lLMModelClass', file: 'lLMModelClass.json' },
  { table: 'planFeature', file: 'planFeature.json' },
  { table: 'planLLMAccess', file: 'planLLMAccess.json' },
  { table: 'policyRule', file: 'policyRule.json' },
  { table: 'tenantPlan', file: 'tenantPlan.json' },

  // Usage and metering
  { table: 'usageReservation', file: 'usageReservation.json' },
  { table: 'usageMeter', file: 'usageMeter.json' },
  { table: 'usageLog', file: 'usageLog.json' },
  { table: 'quotaAlert', file: 'quotaAlert.json' },

  // Projects and patents
  { table: 'project', file: 'project.json' },
  { table: 'applicantProfile', file: 'applicantProfile.json' },
  { table: 'projectCollaborator', file: 'projectCollaborator.json' },
  { table: 'patent', file: 'patent.json' },

  // Country-specific data
  { table: 'countryProfile', file: 'countryProfile.json' },
  { table: 'countrySectionMapping', file: 'countrySectionMapping.json' },
  { table: 'countrySectionPrompt', file: 'countrySectionPrompt.json' },
  { table: 'countrySectionPromptHistory', file: 'countrySectionPromptHistory.json' },

  // Drafting sessions
  { table: 'draftingSession', file: 'draftingSession.json' },
  { table: 'draftingHistory', file: 'draftingHistory.json' },
  { table: 'userSectionInstruction', file: 'userSectionInstructions.json' },

  // Idea bank
  { table: 'ideaRecord', file: 'ideaRecord.json' },
  { table: 'ideaBankIdea', file: 'ideaBankIdea.json' },
  { table: 'ideaBankReservation', file: 'ideaBankReservation.json' },
  { table: 'ideaBankHistory', file: 'ideaBankHistory.json' },
  { table: 'ideaBankSuggestion', file: 'ideaBankSuggestion.json' },

  // Diagrams and figures
  { table: 'figurePlan', file: 'figurePlan.json' },
  { table: 'diagramSource', file: 'diagramSource.json' },

  // Annexures and documents
  { table: 'annexureDraft', file: 'annexureDraft.json' },
  { table: 'annexureVersion', file: 'annexureVersion.json' },
  { table: 'document', file: 'document.json' },

  // Prior art search
  { table: 'priorArtSearchBundle', file: 'priorArtSearchBundle.json' },
  { table: 'priorArtSearchHistory', file: 'priorArtSearchHistory.json' },
  { table: 'priorArtQueryVariant', file: 'priorArtQueryVariant.json' },
  { table: 'priorArtRun', file: 'priorArtRun.json' },
  { table: 'priorArtQueryVariantExecution', file: 'priorArtQueryVariantExecution.json' },
  { table: 'priorArtRawResult', file: 'priorArtRawResult.json' },
  { table: 'priorArtRawDetail', file: 'priorArtRawDetail.json' },
  { table: 'priorArtPatent', file: 'priorArtPatent.json' },
  { table: 'priorArtVariantHit', file: 'priorArtVariantHit.json' },
  { table: 'priorArtPatentDetail', file: 'priorArtPatentDetail.json' },
  { table: 'priorArtUnifiedResult', file: 'priorArtUnifiedResult.json' },
  { table: 'priorArtScholarContent', file: 'priorArtScholarContent.json' },

  // Novelty assessment
  { table: 'noveltyAssessmentRun', file: 'noveltyAssessmentRun.json' },
  { table: 'noveltyAssessmentLLMCall', file: 'noveltyAssessmentLLMCall.json' },
  { table: 'noveltySearchRun', file: 'noveltySearchRun.json' },
  { table: 'noveltySearchLLMCall', file: 'noveltySearchLLMCall.json' },

  // Feature mapping
  { table: 'featureMapCell', file: 'featureMapCell.json' },
  { table: 'featureMapOverride', file: 'featureMapOverride.json' },
  { table: 'featureMappingCache', file: 'featureMappingCache.json' },
  { table: 'aggregationSnapshot', file: 'aggregationSnapshot.json' },

  // Local patents and related art
  { table: 'localPatent', file: 'localPatent.json' },
  { table: 'relatedArtRun', file: 'relatedArtRun.json' },
  { table: 'relatedArtSelection', file: 'relatedArtSelection.json' },

  // User credits and notifications
  { table: 'userCredit', file: 'userCredit.json' },
  { table: 'tokenNotification', file: 'tokenNotification.json' },

  // Style profiles and training
  { table: 'styleProfile', file: 'styleProfile.json' },
  { table: 'styleTrainingJob', file: 'styleTrainingJob.json' },

  // Authentication tokens
  { table: 'emailVerificationToken', file: 'emailVerificationToken.json' },
  { table: 'passwordResetToken', file: 'passwordResetToken.json' },

  // Jobs and processing
  { table: 'job', file: 'job.json' },

  // Reference maps
  { table: 'referenceMap', file: 'referenceMap.json' }
];

async function restoreTableData(tableName, modelName, data) {
  if (!data || data.length === 0) {
    console.log(`⏭️  Skipping ${tableName} - no data to restore`);
    return 0;
  }

  console.log(`📥 Restoring ${tableName} (${data.length} records)...`);

  try {
    // Clear existing data first (be careful with this in production)
    console.log(`  🧹 Clearing existing data in ${tableName}...`);
    await prisma[modelName].deleteMany({});

    // Insert data in batches to avoid memory issues
    const batchSize = 50; // Smaller batch size for safety
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      try {
        await prisma[modelName].createMany({
          data: batch,
          skipDuplicates: false // We cleared data, so no duplicates expected
        });
        processed += batch.length;
        console.log(`  ✅ Processed ${processed}/${data.length} records for ${tableName}`);
      } catch (batchError) {
        console.error(`  ❌ Error in batch ${Math.floor(i/batchSize) + 1} for ${tableName}:`, batchError.message);
        errors++;

        // Try individual inserts for problematic batches
        console.log(`  🔄 Attempting individual inserts for failed batch...`);
        for (const item of batch) {
          try {
            await prisma[modelName].create({ data: item });
            processed++;
          } catch (itemError) {
            console.error(`    ❌ Failed to insert item:`, itemError.message);
            errors++;
          }
        }
      }
    }

    console.log(`  📊 ${tableName}: ${processed} records restored, ${errors} errors`);
    return processed;

  } catch (error) {
    console.error(`❌ Critical error restoring ${tableName}:`, error.message);
    return 0;
  }
}

async function restoreFromBackup() {
  console.log('🚀 Starting complete database restoration from backup...\n');
  console.log(`📂 Backup directory: ${BACKUP_DIR}`);
  console.log('⚠️  WARNING: This will clear and restore all data in the database!\n');

  // Check if backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`❌ Backup directory not found: ${BACKUP_DIR}`);
    console.log('Make sure the backup directory exists and contains the data files.');
    process.exit(1);
  }

  try {
    let totalRecords = 0;
    let totalTables = 0;

    // Restore data in the correct order
    for (const { table, file } of RESTORE_ORDER) {
      const filePath = path.join(BACKUP_DIR, file);

      if (!fs.existsSync(filePath)) {
        console.log(`⏭️  Skipping ${table} - file not found: ${file}`);
        continue;
      }

      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        const recordsRestored = await restoreTableData(table, table, data);
        totalRecords += recordsRestored;
        totalTables++;

        // Small delay between tables to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ DATABASE RESTORATION COMPLETED!');
    console.log('='.repeat(60));
    console.log(`📊 Summary:`);
    console.log(`   • Tables processed: ${totalTables}`);
    console.log(`   • Total records restored: ${totalRecords}`);
    console.log(`   • Backup source: ${BACKUP_DIR}`);
    console.log(`   • Restoration completed at: ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    console.log('\n🎯 Next Steps:');
    console.log('   1. Verify data integrity: npm run test');
    console.log('   2. Test application functionality');
    console.log('   3. Check user access and permissions');
    console.log('   4. Validate critical workflows (patent drafting, etc.)');

  } catch (error) {
    console.error('❌ Critical error during restoration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute restoration
if (require.main === module) {
  console.log('🛑 SAFETY CHECK: This will REPLACE all data in your database!');
  console.log('🛑 Make sure you have additional backups before proceeding.');
  console.log('🛑 Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

  setTimeout(() => {
    restoreFromBackup().catch(console.error);
  }, 5000);
}


