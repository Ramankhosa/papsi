const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUsers() {
  console.log('🔍 Checking users and hierarchy in database...\n');

  try {
    // Get all users with their tenant info
    const users = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        roles: true,
        emailVerified: true,
        tenant: {
          select: {
            name: true,
            type: true
          }
        }
      },
      orderBy: { email: 'asc' }
    });

    console.log('👥 USERS:');
    console.table(users.map(u => ({
      Email: u.email,
      Name: u.name,
      Roles: u.roles.join(', '),
      'Email Verified': u.emailVerified,
      'Tenant Name': u.tenant?.name || 'N/A',
      'Tenant Type': u.tenant?.type || 'N/A'
    })));

    // Get all tenants
    const tenants = await prisma.tenant.findMany({
      select: {
        name: true,
        type: true,
        atiId: true,
        status: true
      },
      orderBy: { name: 'asc' }
    });

    console.log('\n🏢 TENANTS:');
    console.table(tenants);

    // Check plans
    const plans = await prisma.plan.findMany({
      select: {
        name: true,
        displayName: true
      }
    });

    console.log('\n📋 PLANS:');
    console.table(plans);

    // Check tenant plans
    const tenantPlans = await prisma.tenantPlan.findMany({
      include: {
        tenant: { select: { name: true } },
        plan: { select: { displayName: true } }
      }
    });

    console.log('\n🔗 TENANT-PLANS:');
    console.table(tenantPlans.map(tp => ({
      'Tenant Name': tp.tenant.name,
      'Plan Name': tp.plan.displayName
    })));

  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();





