const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Tables that don't have 'id' as primary key - define their sort fields
const tableSortFields = {
  // Most tables use 'id'
  default: { id: 'asc' },

  // Tables with different primary keys or sort fields
  priorArtPatent: { publicationNumber: 'asc' },
  priorArtPatentDetail: { publicationNumber: 'asc' },
  priorArtScholarContent: { identifier: 'asc' },
  userCredit: { userId: 'asc' },
};

async function exportDatabase() {
  console.log('🚀 Starting improved database export...');

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

    let totalRecords = 0;
    const tablesWithData = [];

    for (const table of tables) {
      try {
        console.log(`📋 Exporting ${table}...`);

        // Use appropriate sort field for this table
        const sortField = tableSortFields[table] || tableSortFields.default;
        const data = await prisma[table].findMany({
          orderBy: sortField
        });

        exportData.tables[table] = data;
        totalRecords += data.length;

        if (data.length > 0) {
          tablesWithData.push({ table, count: data.length });
        }

        console.log(`✅ Exported ${data.length} records from ${table}`);

      } catch (error) {
        console.warn(`⚠️  Warning: Could not export ${table}:`, error.message);
        exportData.tables[table] = [];
      }
    }

    // Save to JSON file
    const exportPath = path.join(__dirname, 'database-export-improved.json');
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    console.log(`\n💾 Database export saved to: ${exportPath}`);

    // Generate SQL INSERT statements
    const sqlPath = path.join(__dirname, 'database-restore-improved.sql');
    let sqlContent = `-- Database Restore Script
-- Generated on ${new Date().toISOString()}
-- WARNING: This script will INSERT data. Make sure tables exist first!
-- Run this after applying all migrations: npx prisma migrate deploy

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

    // Generate summary
    console.log('\n📈 Export Summary:');
    if (tablesWithData.length > 0) {
      console.table(tablesWithData);
    }
    console.log(`\nTotal tables with data: ${tablesWithData.length}`);
    console.log(`Total records: ${totalRecords}`);

    if (totalRecords === 0) {
      console.log('\n⚠️  WARNING: Database appears to be empty!');
      console.log('This might be because:');
      console.log('1. You ran prisma db push --force-reset which cleared all data');
      console.log('2. You need to restore from a backup first');
      console.log('3. The database was never populated with data');
      console.log('\nTo restore data, you can:');
      console.log('1. Run your seed scripts: node prisma/seed.js');
      console.log('2. Import from a previous backup');
      console.log('3. Manually recreate test data');
    }

  } catch (error) {
    console.error('❌ Export failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the export
exportDatabase();
