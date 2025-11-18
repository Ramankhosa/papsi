const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function restoreFromSeed() {
  console.log('🔄 Starting database restore from seed data...');

  try {
    // Load seed data
    const seedDataPath = path.join(__dirname, 'prisma', 'seed-data.json');
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

    console.log(`📄 Loaded seed data from ${seedData.exportedAt}`);

    // Tables to restore in dependency order
    const restoreOrder = [
      'tenants',
      'users',
      'plans',
      'features',
      'planFeatures',
      'tenantPlans',
      'planLLMAccess',
      'aTITokens',
      'projects',
      'patent',
      'projectCollaborators',
      'applicantProfiles',
      // Add more tables as needed based on your dependencies
    ];

    let totalRecords = 0;

    for (const tableKey of restoreOrder) {
      const tableName = tableKey; // Adjust if table names differ from seed data keys
      const records = seedData.tables[tableKey];

      if (!records || records.length === 0) {
        console.log(`⏭️  Skipping ${tableKey} (no data)`);
        continue;
      }

      console.log(`📝 Restoring ${records.length} records to ${tableName}...`);

      for (const record of records) {
        try {
          // Convert date strings back to Date objects
          const processedRecord = { ...record };
          Object.keys(processedRecord).forEach(key => {
            if (typeof processedRecord[key] === 'string' &&
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(processedRecord[key])) {
              processedRecord[key] = new Date(processedRecord[key]);
            }
          });

          await prisma[tableName].upsert({
            where: { id: record.id },
            update: processedRecord,
            create: processedRecord
          });
        } catch (error) {
          console.warn(`⚠️  Failed to restore record in ${tableName}:`, error.message);
        }
      }

      totalRecords += records.length;
      console.log(`✅ Restored ${records.length} records to ${tableName}`);
    }

    console.log(`\n🎉 Database restore completed!`);
    console.log(`📊 Total records restored: ${totalRecords}`);

    console.log('\n💡 Next steps:');
    console.log('1. Verify data: npx prisma studio');
    console.log('2. Run your application');
    console.log('3. Test key functionality');

  } catch (error) {
    console.error('❌ Restore failed:', error);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure migrations are applied: npx prisma migrate deploy');
    console.log('2. Check database connection');
    console.log('3. Verify seed data integrity');
  } finally {
    await prisma.$disconnect();
  }
}

// Run the restore
restoreFromSeed();
