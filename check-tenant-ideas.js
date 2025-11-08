const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTenants() {
  try {
    // Find the analyst user
    const user = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' },
      select: { id: true, email: true, tenantId: true }
    });

    console.log('User tenant:', user?.tenantId);

    // Check all ideas and their tenants
    const ideas = await prisma.ideaBankIdea.findMany({
      select: {
        id: true,
        title: true,
        tenantId: true,
        createdBy: true,
        status: true
      }
    });

    console.log('\nAll ideas:');
    ideas.forEach(idea => {
      console.log(`- ${idea.title}: tenant=${idea.tenantId}, createdBy=${idea.createdBy}, status=${idea.status}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTenants();
