const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifySetup() {
  try {
    console.log('=== VERIFYING IDEA BANK SETUP ===');

    // Check PRO plan
    const proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' },
      include: {
        planFeatures: {
          include: { feature: true }
        }
      }
    });

    if (proPlan) {
      console.log('\nPRO Plan Features:');
      proPlan.planFeatures.forEach(pf => {
        console.log(`- ${pf.feature.code}: ${pf.feature.name}`);
      });
    } else {
      console.log('PRO plan not found');
    }

    // Check analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    });

    if (analyst) {
      console.log('\nAnalyst User:', {
        email: analyst.email,
        tenantId: analyst.tenantId,
        tenantName: analyst.tenant?.name
      });

      // Check tenant plan
      if (analyst.tenantId) {
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: { tenantId: analyst.tenantId },
          include: { plan: true }
        });
        console.log('Tenant Plan:', tenantPlan?.plan.code);
      }
    } else {
      console.log('Analyst user not found');
    }

    // Check ideas
    const ideas = await prisma.ideaBankIdea.findMany();
    console.log('\nIdea Bank Ideas:', ideas.length);
    ideas.forEach(idea => {
      console.log(`- ${idea.title} (${idea.status})`);
    });

  } catch (error) {
    console.error('Error verifying setup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifySetup();
