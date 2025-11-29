const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Map old user IDs to new user IDs
const USER_ID_MAPPING = {
  'cmiis24rp000dlkp317etfktl': 'cmik2dn39000difmfldqi8wsb' // Map to analyst user
};

// Map old tenant IDs to new tenant IDs
const TENANT_ID_MAPPING = {
  'cmiis23ac0005lkp389gt5g1u': 'cmik2dlfh0005ifmfak2qgkyz' // Map to Test Company Inc.
};

async function restoreIdeaBankIdeas() {
  try {
    console.log('=== RESTORING IDEA BANK IDEAS FROM BACKUP ===');

    // Read the backup file
    const backupPath = path.join(__dirname, 'database-backup', 'ideaBankIdea.json');
    const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

    console.log(`Found ${backupData.length} ideas in backup`);

    let restoredCount = 0;
    let skippedCount = 0;

    for (const idea of backupData) {
      try {
        // Check if idea already exists by ID
        const existingIdea = await prisma.ideaBankIdea.findUnique({
          where: { id: idea.id }
        });

        if (existingIdea) {
          console.log(`Skipping existing idea: ${idea.title} (ID: ${idea.id})`);
          skippedCount++;
          continue;
        }

        // Map the createdBy user ID and tenant ID if needed
        const mappedCreatedBy = USER_ID_MAPPING[idea.createdBy] || idea.createdBy;
        const mappedTenantId = idea.tenantId ? (TENANT_ID_MAPPING[idea.tenantId] || idea.tenantId) : null;

        // Create the idea
        const createdIdea = await prisma.ideaBankIdea.create({
          data: {
            id: idea.id,
            title: idea.title,
            description: idea.description,
            abstract: idea.abstract,
            domainTags: idea.domainTags,
            technicalField: idea.technicalField,
            noveltyScore: idea.noveltyScore,
            status: idea.status,
            generatedBy: idea.generatedBy,
            sourceBatchId: idea.sourceBatchId,
            derivedFromIdeaId: idea.derivedFromIdeaId,
            keyFeatures: idea.keyFeatures,
            potentialApplications: idea.potentialApplications,
            priorArtSummary: idea.priorArtSummary,
            createdBy: mappedCreatedBy,
            tenantId: mappedTenantId,
            reservedCount: idea.reservedCount,
            createdAt: new Date(idea.createdAt),
            updatedAt: new Date(idea.updatedAt),
            publishedAt: idea.publishedAt ? new Date(idea.publishedAt) : null
          }
        });

        console.log(`Restored idea: ${createdIdea.title}`);
        restoredCount++;

      } catch (error) {
        console.error(`Failed to restore idea "${idea.title}":`, error.message);
      }
    }

    console.log(`\n=== RESTORATION COMPLETE ===`);
    console.log(`Restored: ${restoredCount} ideas`);
    console.log(`Skipped (already exist): ${skippedCount} ideas`);
    console.log(`Total processed: ${backupData.length} ideas`);

  } catch (error) {
    console.error('Error restoring idea bank ideas:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the restoration
restoreIdeaBankIdeas()
  .then(() => {
    console.log('Idea bank restoration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Idea bank restoration failed:', error);
    process.exit(1);
  });
