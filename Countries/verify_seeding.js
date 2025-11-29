const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifySeeding() {
  try {
    console.log('Verifying seeded data with special characters...\n');

    // Check Brazilian (Portuguese) records
    const brRecords = await prisma.countrySectionMapping.findMany({
      where: { countryCode: 'BR' },
      orderBy: { supersetCode: 'asc' }
    });

    console.log('Brazil (BR) - Portuguese terms:');
    brRecords.forEach(record => {
      console.log(`  ${record.supersetCode}: ${record.heading}`);
    });

    console.log('\n' + '='.repeat(50) + '\n');

    // Check Mexican (Spanish) records
    const mxRecords = await prisma.countrySectionMapping.findMany({
      where: { countryCode: 'MX' },
      orderBy: { supersetCode: 'asc' }
    });

    console.log('Mexico (MX) - Spanish terms:');
    mxRecords.forEach(record => {
      console.log(`  ${record.supersetCode}: ${record.heading}`);
    });

    console.log('\nVerification completed successfully!');

  } catch (error) {
    console.error('Error verifying seeding:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifySeeding();

