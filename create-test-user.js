const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createTestUser() {
  console.log('🚀 Creating test user: ramankhosa@gmail.com');

  try {
    // Create individual tenant
    const tenant = await prisma.tenant.upsert({
      where: { atiId: 'RAMAN_TEST' },
      update: {
        name: 'Raman Test Account',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      },
      create: {
        name: 'Raman Test Account',
        atiId: 'RAMAN_TEST',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }
    });

    console.log('✅ Created/Updated tenant:', tenant.name);

    // Hash password
    const passwordHash = await bcrypt.hash('TestPass123!', 12);

    // Create user
    const user = await prisma.user.upsert({
      where: { email: 'ramankhosa@gmail.com' },
      update: {
        name: 'Raman Khosa',
        passwordHash,
        roles: ['ANALYST'],
        emailVerified: false, // Set to false so they can test email verification
        tenantId: tenant.id
      },
      create: {
        email: 'ramankhosa@gmail.com',
        name: 'Raman Khosa',
        passwordHash,
        roles: ['ANALYST'],
        emailVerified: false, // Set to false so they can test email verification
        tenantId: tenant.id
      }
    });

    console.log('✅ Created/Updated user:', user.email);

    // Assign BASIC (FREE_PLAN) plan to the tenant
    const freePlan = await prisma.plan.findFirst({
      where: { name: 'FREE_PLAN' }
    });

    if (freePlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId: {
            tenantId: tenant.id,
            planId: freePlan.id
          }
        },
        update: {},
        create: {
          tenantId: tenant.id,
          planId: freePlan.id
        }
      });
      console.log('✅ Assigned FREE_PLAN to tenant');
    }

    console.log('✅ User created successfully');

    // Display login info
    console.log('\n🎉 TEST ACCOUNT CREATED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 EMAIL: ramankhosa@gmail.com');
    console.log('🔑 PASSWORD: TestPass123!');
    console.log('🏢 TENANT: Raman Test Account (INDIVIDUAL)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n🧪 TEST SCENARIOS READY:');
    console.log('1. ✅ Login: ramankhosa@gmail.com / TestPass123!');
    console.log('2. ✅ Test password reset flow');
    console.log('3. ✅ Test email verification process (emailVerified: false)');

  } catch (error) {
    console.error('❌ Error creating test user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser();
