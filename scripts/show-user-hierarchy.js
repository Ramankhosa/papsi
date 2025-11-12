const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function showUserHierarchy() {
  console.log('👥 USER HIERARCHY & CREDENTIALS');
  console.log('================================\n');

  try {
    // Get all users with their tenant information
    const users = await prisma.user.findMany({
      include: {
        tenant: {
          include: {
            tenantPlans: {
              include: {
                plan: true
              },
              where: { status: 'ACTIVE' }
            }
          }
        }
      },
        orderBy: [
          { email: 'asc' }
        ]
    });

    console.log(`📊 Found ${users.length} users in the system:\n`);

    // Display users with their roles
    console.log('Users and their roles:');
    console.log('──────────────────────────────────────────────────');

    users.forEach(user => {
      const rolesStr = user.roles?.join(', ') || 'No roles';
      console.log(`   👤 ${user.name}`);
      console.log(`      Email: ${user.email}`);
      console.log(`      User ID: ${user.id}`);
      console.log(`      Roles: ${rolesStr}`);
      console.log(`      Tenant: ${user.tenant?.name} (${user.tenant?.atiId})`);
      console.log(`      Plan: ${user.tenant?.tenantPlans?.[0]?.plan?.name || 'No plan assigned'}`);
      console.log(`      Status: ${user.status}`);
      console.log('');
    });

    console.log('🔐 LOGIN CREDENTIALS');
    console.log('===================\n');

    console.log('Copy these credentials for testing:\n');

    users.forEach(user => {
      let password = '';
      if (user.email === 'superadmin@spotipr.com') password = 'SuperAdmin123!';
      else if (user.email === 'tenantadmin@spotipr.com') password = 'TenantAdmin123!';
      else if (user.email === 'analyst@spotipr.com') password = 'Analyst123!';

      console.log(`${user.email} / ${password} (${user.role})`);
    });

    console.log('\n🎯 PLAN ASSIGNMENTS SUMMARY');
    console.log('===========================\n');

    const planSummary = {};
    users.forEach(user => {
      const planName = user.tenant?.tenantPlans?.[0]?.plan?.name || 'No Plan';
      if (!planSummary[planName]) planSummary[planName] = [];
      planSummary[planName].push(user.role);
    });

    Object.entries(planSummary).forEach(([plan, roles]) => {
      const uniqueRoles = [...new Set(roles)];
      console.log(`${plan}: ${uniqueRoles.join(', ')}`);
    });

    console.log('\n✅ User hierarchy display complete!');

  } catch (error) {
    console.error('❌ Error fetching user hierarchy:', error);
  } finally {
    await prisma.$disconnect();
  }
}

showUserHierarchy();
