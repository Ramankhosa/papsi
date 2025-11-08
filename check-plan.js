const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPlan() {
  try {
    // Find the analyst user
    const user = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' }
    });

    if (!user) {
      console.log('User not found');
      return;
    }

    console.log('User:', user.email, 'Tenant:', user.tenantId);

    // Check ATI token for the tenant
    const atiToken = await prisma.aTIToken.findFirst({
      where: {
        tenantId: user.tenantId || 'default-tenant',
        status: 'ISSUED'
      }
    });

    if (!atiToken) {
      console.log('No ATI token found');
      return;
    }

    console.log('Plan tier:', atiToken.planTier);

    // Check if plan includes IDEA_BANK feature
    const planFeature = await prisma.planFeature.findFirst({
      where: {
        plan: {
          code: atiToken.planTier,
          status: 'ACTIVE'
        },
        feature: {
          code: 'IDEA_BANK'
        }
      }
    });

    if (planFeature) {
      console.log('✅ IDEA_BANK feature is enabled for this plan');
    } else {
      console.log('❌ IDEA_BANK feature is NOT enabled for this plan');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlan();
