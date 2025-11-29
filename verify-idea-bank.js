const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyIdeaBank() {
  try {
    const ideas = await prisma.ideaBankIdea.findMany({
      select: {
        id: true,
        title: true,
        status: true,
        createdBy: true,
        tenantId: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log('Idea Bank Ideas in database:');
    ideas.forEach(idea => {
      console.log(`- "${idea.title}" (${idea.status})`);
      console.log(`  ID: ${idea.id}`);
      console.log(`  Created by: ${idea.createdBy}`);
      console.log(`  Tenant: ${idea.tenantId || 'null'}`);
      console.log('');
    });

    console.log(`Total ideas: ${ideas.length}`);

  } catch (error) {
    console.error('Error verifying idea bank:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyIdeaBank();
