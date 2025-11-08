const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setupProPlan() {
  try {
    console.log('=== SETTING UP PRO PLAN FOR ANALYST ===');

    // Check existing plans
    const existingPlans = await prisma.plan.findMany();
    console.log('Existing plans:', existingPlans.map(p => p.code));

    let proPlan = existingPlans.find(p => p.code === 'PRO_PLAN');

    if (!proPlan) {
      // Create PRO plan
      proPlan = await prisma.plan.create({
        data: {
          code: 'PRO_PLAN',
          name: 'Professional Plan',
          cycle: 'MONTHLY',
          status: 'ACTIVE'
        }
      });
      console.log('Created PRO plan:', proPlan);
    } else {
      console.log('PRO plan already exists:', proPlan);
    }

    // Get all features
    const allFeatures = await prisma.feature.findMany();
    console.log('All features:', allFeatures.map(f => f.code));

    // Add all features to PRO plan
    for (const feature of allFeatures) {
      const existingPlanFeature = await prisma.planFeature.findFirst({
        where: {
          planId: proPlan.id,
          featureId: feature.id
        }
      });

      if (!existingPlanFeature) {
        await prisma.planFeature.create({
          data: {
            planId: proPlan.id,
            featureId: feature.id,
            monthlyQuota: feature.code === 'IDEA_BANK' ? 50 : 1000,
            dailyQuota: feature.code === 'IDEA_BANK' ? 10 : 100
          }
        });
        console.log(`Added feature ${feature.code} to PRO plan`);
      }
    }

    // Find the analyst user
    const analystUser = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' }
    });

    if (!analystUser) {
      console.log('User analyst@spotipr.com not found');
      return;
    }

    console.log('Found analyst user:', analystUser);

    // Get or create tenant for the user
    let tenant;
    if (analystUser.tenantId) {
      tenant = await prisma.tenant.findUnique({
        where: { id: analystUser.tenantId }
      });
    } else {
      // Create a default tenant
      tenant = await prisma.tenant.create({
        data: {
          name: 'Spotipr Analyst Tenant',
          atiId: 'ANALYST_TENANT',
          status: 'ACTIVE'
        }
      });

      // Update user with tenant
      await prisma.user.update({
        where: { id: analystUser.id },
        data: { tenantId: tenant.id }
      });

      console.log('Created tenant for analyst:', tenant);
    }

    // Assign PRO plan to tenant
    const existingTenantPlan = await prisma.tenantPlan.findFirst({
      where: {
        tenantId: tenant.id,
        planId: proPlan.id
      }
    });

    if (!existingTenantPlan) {
      await prisma.tenantPlan.create({
        data: {
          tenantId: tenant.id,
          planId: proPlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      });
      console.log('Assigned PRO plan to analyst tenant');
    } else {
      console.log('PRO plan already assigned to analyst tenant');
    }

    // Create some sample ideas if they don't exist
    const existingIdeas = await prisma.ideaBankIdea.count();
    console.log('Existing ideas:', existingIdeas);

    if (existingIdeas === 0) {
      const sampleIdeas = [
        {
          title: 'AI-Powered Medical Diagnosis System',
          description: 'A machine learning system that analyzes medical images and patient data to provide early disease detection with 95% accuracy.',
          domainTags: ['AI/ML', 'Medical Devices'],
          status: 'PUBLIC',
          createdBy: analystUser.id
        },
        {
          title: 'Smart Grid Energy Optimization',
          description: 'An intelligent energy management system for power grids using predictive analytics.',
          domainTags: ['Energy', 'IoT'],
          status: 'PUBLIC',
          createdBy: analystUser.id
        },
        {
          title: 'Blockchain Supply Chain Tracking',
          description: 'A decentralized platform for transparent supply chain management.',
          domainTags: ['Blockchain', 'Supply Chain'],
          status: 'PUBLIC',
          createdBy: analystUser.id
        }
      ];

      for (const idea of sampleIdeas) {
        await prisma.ideaBankIdea.create({ data: idea });
      }
      console.log('Created sample ideas');
    }

    console.log('\n=== SETUP COMPLETE ===');
    console.log('analyst@spotipr.com now has access to all services including Idea Bank');

  } catch (error) {
    console.error('Error setting up PRO plan:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupProPlan();
