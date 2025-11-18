const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function restoreFromSeed() {
  console.log('🔄 Starting database restore from seed data (fixed version)...');

  try {
    // Load seed data
    const seedDataPath = path.join(__dirname, 'prisma', 'seed-data.json');
    const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

    console.log(`📄 Loaded seed data from ${seedData.exportedAt}`);

    // Map seed data keys to actual Prisma table names
    const tableMapping = {
      'tenants': 'tenant',
      'users': 'user',
      'plans': 'plan',
      'features': 'feature',
      'planFeatures': 'planFeature',
      'tenantPlans': 'tenantPlan',
      'planLLMAccess': 'planLLMAccess',
      'aTITokens': 'aTIToken',
      'projects': 'project',
      'patent': 'patent',
      'projectCollaborators': 'projectCollaborator',
      'applicantProfiles': 'applicantProfile'
    };

    // Tables to restore in dependency order (parents first)
    const restoreOrder = [
      'tenants',      // tenant
      'plans',        // plan
      'features',     // feature
      'users',        // user (depends on tenant)
      'planFeatures', // planFeature (depends on plan, feature)
      'tenantPlans',  // tenantPlan (depends on tenant, plan)
      'planLLMAccess', // planLLMAccess (depends on plan)
      'aTITokens',    // aTIToken
      'projects',     // project (depends on tenant, user)
      'patent',       // patent
      'projectCollaborators', // projectCollaborator
      'applicantProfiles'     // applicantProfile
    ];

    let totalRecords = 0;

    for (const seedKey of restoreOrder) {
      const tableName = tableMapping[seedKey];
      const records = seedData.tables[seedKey];

      if (!records || records.length === 0) {
        console.log(`⏭️  Skipping ${seedKey} → ${tableName} (no data)`);
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
          // Continue with other records
        }
      }

      totalRecords += records.length;
      console.log(`✅ Restored ${records.length} records to ${tableName}`);
    }

    console.log(`\n🎉 Database restore completed!`);
    console.log(`📊 Total records restored: ${totalRecords}`);

    // Verify some key data
    console.log('\n🔍 Verification:');
    try {
      const tenantCount = await prisma.tenant.count();
      const userCount = await prisma.user.count();
      const projectCount = await prisma.project.count();

      console.log(`   Tenants: ${tenantCount}`);
      console.log(`   Users: ${userCount}`);
      console.log(`   Projects: ${projectCount}`);
    } catch (error) {
      console.warn('Could not verify counts:', error.message);
    }

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
