const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testIdeaBankAccess() {
  try {
    console.log('=== TESTING IDEA BANK ACCESS ===');

    // Get analyst user
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      select: { id: true, email: true, tenantId: true }
    });

    if (!analyst) {
      console.log('❌ Analyst user not found');
      return;
    }

    console.log('✅ Found analyst user:', analyst.email);

    // Check tenant plan
    if (analyst.tenantId) {
      const tenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: analyst.tenantId },
        include: { plan: true }
      });

      console.log('✅ Tenant plan:', tenantPlan?.plan.code || 'None');

      // Check plan features
      if (tenantPlan) {
        const planFeatures = await prisma.planFeature.findMany({
          where: { planId: tenantPlan.planId },
          include: { feature: true }
        });

        console.log('✅ Plan features:');
        planFeatures.forEach(pf => {
          console.log(`  - ${pf.feature.code}: ${pf.feature.name} (${pf.monthlyQuota} monthly, ${pf.dailyQuota} daily)`);
        });

        // Check specifically for IDEA_BANK
        const ideaBankFeature = planFeatures.find(pf => pf.feature.code === 'IDEA_BANK');
        if (ideaBankFeature) {
          console.log('✅ IDEA_BANK feature found in plan');
        } else {
          console.log('❌ IDEA_BANK feature NOT found in plan');
        }
      }
    }

    // Check ATI token
    const atiToken = await prisma.aTIToken.findFirst({
      where: {
        tenantId: analyst.tenantId,
        status: 'ISSUED'
      }
    });

    console.log('✅ ATI token plan tier:', atiToken?.planTier || 'None');

    // Check ideas count
    const ideasCount = await prisma.ideaBankIdea.count();
    console.log('✅ Total ideas in database:', ideasCount);

    console.log('\n=== ACCESS TEST COMPLETE ===');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testIdeaBankAccess();
