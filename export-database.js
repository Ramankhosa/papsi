const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportDatabase() {
  console.log('🚀 Starting database export...');

  const exportData = {
    exportedAt: new Date().toISOString(),
    tables: {}
  };

  try {
    // List of all tables to export (based on your Prisma schema)
    const tables = [
      'tenant',
      'user',
      'emailVerificationToken',
      'passwordResetToken',
      'aTIToken',
      'auditLog',
      'project',
      'applicantProfile',
      'projectCollaborator',
      'patent',
      'annexureVersion',
      'job',
      'tokenNotification',
      'plan',
      'tenantPlan',
      'feature',
      'planFeature',
      'task',
      'lLMModelClass',
      'planLLMAccess',
      'policyRule',
      'usageReservation',
      'usageMeter',
      'usageLog',
      'quotaAlert',
      'priorArtSearchBundle',
      'priorArtSearchHistory',
      'priorArtQueryVariant',
      'priorArtRun',
      'priorArtQueryVariantExecution',
      'priorArtRawResult',
      'priorArtRawDetail',
      'priorArtPatent',
      'priorArtVariantHit',
      'priorArtPatentDetail',
      'priorArtUnifiedResult',
      'priorArtScholarContent',
      'localPatent',
      'noveltyAssessmentRun',
      'noveltyAssessmentLLMCall',
      'noveltySearchRun',
      'noveltySearchLLMCall',
      'featureMapCell',
      'aggregationSnapshot',
      'featureMapOverride',
      'featureMappingCache',
      'draftingSession',
      'ideaRecord',
      'referenceMap',
      'figurePlan',
      'diagramSource',
      'annexureDraft',
      'relatedArtRun',
      'relatedArtSelection',
      'ideaBankSuggestion',
      'draftingHistory',
      'userCredit',
      'ideaBankIdea',
      'ideaBankReservation',
      'ideaBankHistory',
      'styleProfile',
      'styleTrainingJob',
      'document'
    ];

    console.log(`📊 Exporting data from ${tables.length} tables...`);

    for (const table of tables) {
      try {
        console.log(`📋 Exporting ${table}...`);
        const data = await prisma[table].findMany({
          orderBy: { id: 'asc' }
        });

        exportData.tables[table] = data;
        console.log(`✅ Exported ${data.length} records from ${table}`);

      } catch (error) {
        console.warn(`⚠️  Warning: Could not export ${table}:`, error.message);
        exportData.tables[table] = [];
      }
    }

    // Save to JSON file
    const exportPath = path.join(__dirname, 'database-export.json');
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    console.log(`\n💾 Database export saved to: ${exportPath}`);

    // Generate SQL INSERT statements as well
    const sqlPath = path.join(__dirname, 'database-restore.sql');
    let sqlContent = `-- Database Restore Script
-- Generated on ${new Date().toISOString()}
-- WARNING: This script will INSERT data. Make sure tables exist first!

`;

    for (const [tableName, records] of Object.entries(exportData.tables)) {
      if (records.length === 0) continue;

      sqlContent += `\n-- Inserting ${records.length} records into ${tableName}\n`;

      for (const record of records) {
        const columns = Object.keys(record).filter(key => record[key] !== null);
        const values = columns.map(key => {
          const value = record[key];
          if (value === null) return 'NULL';
          if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
          if (value instanceof Date) return `'${value.toISOString()}'`;
          if (typeof value === 'boolean') return value ? 'true' : 'false';
          if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
          return value;
        });

        sqlContent += `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});\n`;
      }
    }

    fs.writeFileSync(sqlPath, sqlContent);
    console.log(`💾 SQL restore script saved to: ${sqlPath}`);

    // Generate statistics
    const stats = Object.entries(exportData.tables).map(([table, records]) => ({
      table,
      count: records.length
    })).filter(stat => stat.count > 0);

    console.log('\n📈 Export Summary:');
    console.table(stats);
    console.log(`\nTotal tables with data: ${stats.length}`);
    console.log(`Total records: ${stats.reduce((sum, stat) => sum + stat.count, 0)}`);

  } catch (error) {
    console.error('❌ Export failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the export
exportDatabase();
