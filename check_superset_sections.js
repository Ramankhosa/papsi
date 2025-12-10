const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkSupersetSections() {
  try {
    const count = await prisma.supersetSection.count();
    console.log('SupersetSection count:', count);

    const sections = await prisma.supersetSection.findMany({
      select: {
        sectionKey: true,
        requiresPriorArt: true,
        requiresFigures: true,
        requiresClaims: true,
        requiresComponents: true
      }
    });

    console.log('SupersetSection data:', JSON.stringify(sections, null, 2));

    // Also check CountrySectionMapping
    const mappingCount = await prisma.countrySectionMapping.count();
    console.log('\nCountrySectionMapping count:', mappingCount);

    const mappings = await prisma.countrySectionMapping.findMany({
      select: {
        countryCode: true,
        sectionKey: true,
        requiresPriorArtOverride: true,
        requiresFiguresOverride: true,
        requiresClaimsOverride: true,
        requiresComponentsOverride: true
      },
      take: 10
    });

    console.log('CountrySectionMapping sample:', JSON.stringify(mappings, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSupersetSections();
