const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixProPlan() {
  try {
    console.log('=== FIXING PRO PLAN - ADDING ALL FEATURES ===');

    // Get PRO plan
    const proPlan = await prisma.plan.findUnique({
      where: { code: 'PRO_PLAN' }
    });

    if (!proPlan) {
      console.log('PRO plan not found - creating it');
      const newPlan = await prisma.plan.create({
        data: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      });
      console.log('Created PRO plan:', newPlan.id);
      return;
    }

    console.log('Found PRO plan:', proPlan.id);

    // Get all features
    const allFeatures = await prisma.feature.findMany();
    console.log('All features in database:', allFeatures.map(f => `${f.code}: ${f.name}`));

    // Get current plan features
    const currentPlanFeatures = await prisma.planFeature.findMany({
      where: { planId: proPlan.id },
      include: { feature: true }
    });

    console.log('Current PRO plan features:', currentPlanFeatures.map(pf => pf.feature.code));

    // Add missing features
    for (const feature of allFeatures) {
      const exists = currentPlanFeatures.find(pf => pf.featureId === feature.id);

      if (!exists) {
        console.log(`Adding missing feature: ${feature.code}`);

        await prisma.planFeature.create({
          data: {
            planId: proPlan.id,
            featureId: feature.id,
            monthlyQuota: feature.code === 'IDEA_BANK' ? 50 : 1000,
            dailyQuota: feature.code === 'IDEA_BANK' ? 10 : 100
          }
        });

        console.log(`✅ Added ${feature.code} to PRO plan`);
      } else {
        console.log(`✓ ${feature.code} already exists in PRO plan`);
      }
    }

    console.log('\n=== FINAL VERIFICATION ===');

    // Final check
    const finalPlanFeatures = await prisma.planFeature.findMany({
      where: { planId: proPlan.id },
      include: { feature: true }
    });

    console.log('FINAL PRO PLAN FEATURES:');
    finalPlanFeatures.forEach(pf => {
      console.log(`- ${pf.feature.code}: ${pf.feature.name} (${pf.monthlyQuota}/month, ${pf.dailyQuota}/day)`);
    });

    console.log('\n=== TENANT ASSIGNMENT VERIFICATION ===');

    // Check tenant assignment
    const analyst = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' }
    });

    if (analyst && analyst.tenantId) {
      const tenantPlan = await prisma.tenantPlan.findFirst({
        where: { tenantId: analyst.tenantId },
        include: { plan: true }
      });

      console.log(`Analyst tenant has plan: ${tenantPlan?.plan.code}`);
    }

  } catch (error) {
    console.error('Error fixing PRO plan:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixProPlan();
