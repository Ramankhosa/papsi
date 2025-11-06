const { PrismaClient } = require('@prisma/client');

async function testPrisma() {
  const prisma = new PrismaClient();

  try {
    // Check available models
    const models = Object.keys(prisma).filter(k =>
      k[0] === k[0].toUpperCase() &&
      k !== 'PrismaClient' &&
      typeof prisma[k] === 'object'
    );

    console.log('✅ Prisma client generated successfully!');
    console.log('Available models:', models.join(', '));

    // Check for our new models
    const hasNoveltySearch = models.includes('noveltySearchRun');
    const hasNoveltySearchLLMCall = models.includes('noveltySearchLLMCall');

    if (hasNoveltySearch && hasNoveltySearchLLMCall) {
      console.log('✅ Novelty search models are available!');
    } else {
      console.log('❌ Novelty search models not found');
    }

  } catch (error) {
    console.error('❌ Prisma client error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPrisma();
