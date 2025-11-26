const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function showPlans() {
  try {
    console.log('🏗️  SPOTIPR PLAN ORGANIZATION\n');

    // Get all active plans
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      include: {
        planFeatures: { include: { feature: true } },
        planLLMAccess: {
          include: {
            task: true,
            defaultClass: true
          }
        }
      },
      orderBy: { code: 'asc' }
    });

    console.log(`📋 ACTIVE PLANS: ${plans.length}\n`);

    for (const plan of plans) {
      console.log(`🎯 ${plan.name} (${plan.code})`);
      console.log(`   Status: ${plan.status} | Cycle: ${plan.cycle}`);

      // Features
      console.log('\n   FEATURES:');
      plan.planFeatures.forEach(pf => {
        const monthly = pf.monthlyQuota ? `${pf.monthlyQuota}/month` : 'Unlimited';
        const daily = pf.dailyQuota ? `${pf.dailyQuota}/day` : 'Unlimited';
        console.log(`   • ${pf.feature.name}: ${monthly}, ${daily}`);
      });

      // LLM Access
      console.log('\n   LLM MODEL ACCESS:');
      plan.planLLMAccess.forEach(access => {
        const classes = JSON.parse(access.allowedClasses);
        console.log(`   • ${access.task.name}: [${classes.join(', ')}] (Default: ${access.defaultClass.name})`);
      });

      console.log('');
    }

    // Tenant assignments
    const tenantPlans = await prisma.tenantPlan.findMany({
      where: { status: 'ACTIVE' },
      include: {
        tenant: { select: { name: true, atiId: true } },
        plan: { select: { code: true } }
      }
    });

    console.log('🏢 TENANT ASSIGNMENTS:');
    const assignments = {};
    tenantPlans.forEach(tp => {
      if (!assignments[tp.plan.code]) assignments[tp.plan.code] = [];
      assignments[tp.plan.code].push(tp.tenant);
    });

    Object.entries(assignments).forEach(([planCode, tenants]) => {
      console.log(`${planCode}: ${tenants.length} tenants`);
      tenants.forEach(tenant => {
        console.log(`  • ${tenant.name} (${tenant.atiId})`);
      });
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

showPlans();




