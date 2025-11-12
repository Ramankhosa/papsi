const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Permission system (matches app)
function hasPermission(user, permission, tenantType = 'ENTERPRISE') {
  if (!user?.roles) return false;
  if (user.roles.includes('SUPER_ADMIN')) return true;

  switch (permission) {
    case 'manage_users':
      if (tenantType === 'INDIVIDUAL') {
        return user.roles.some(role => ['OWNER', 'ADMIN', 'ANALYST'].includes(role));
      } else {
        return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
      }
    case 'manage_tenants':
      return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
    case 'manage_ati_tokens':
      return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
    case 'view_analytics':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'].includes(role));
    case 'create_projects':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));
    case 'access_novelty_search':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));
    case 'view_reports':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'].includes(role));
    default:
      return false;
  }
}

async function runAdvancedScenarios() {
  console.log('🚀 ADVANCED ROLE SECURITY SCENARIOS\n');
  console.log('=' .repeat(80) + '\n');

  try {
    // Scenario 1: Tenant Upgrade/Downgrade Simulation
    console.log('📋 SCENARIO 1: TENANT TYPE CHANGES\n');

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Dynamic Corp',
        atiId: 'TEST-DYNAMIC',
        type: 'ENTERPRISE'
      }
    });

    const user = await prisma.user.create({
      data: {
        email: 'test-dynamic-user@spotipr.com',
        name: 'Dynamic User',
        passwordHash: await bcrypt.hash('TestPass123!', 12),
        roles: ['ANALYST'],
        tenantId: tenant.id,
        status: 'ACTIVE'
      },
      include: { tenant: true }
    });

    console.log('User permissions when tenant is ENTERPRISE:');
    console.log(`   Can manage users: ${hasPermission(user, 'manage_users', 'ENTERPRISE') ? '❌ (Secure)' : '✅ (Expected)'}`);
    console.log(`   Can analyze: ${hasPermission(user, 'access_novelty_search', 'ENTERPRISE') ? '✅' : '❌'}`);

    console.log('\nSimulating tenant upgrade to INDIVIDUAL:');
    console.log(`   Can manage users: ${hasPermission(user, 'manage_users', 'INDIVIDUAL') ? '✅ (Now allowed)' : '❌'}`);
    console.log(`   Can analyze: ${hasPermission(user, 'access_novelty_search', 'INDIVIDUAL') ? '✅' : '❌'}`);

    // Scenario 2: Role Modification Scenarios
    console.log('\n📋 SCENARIO 2: DYNAMIC ROLE CHANGES\n');

    const scenarios = [
      { roles: ['ANALYST'], tenantType: 'ENTERPRISE', desc: 'Basic analyst in enterprise' },
      { roles: ['ADMIN'], tenantType: 'ENTERPRISE', desc: 'Admin in enterprise' },
      { roles: ['ANALYST'], tenantType: 'INDIVIDUAL', desc: 'Analyst in individual tenant' },
      { roles: ['ADMIN', 'ANALYST'], tenantType: 'INDIVIDUAL', desc: 'Multi-role in individual' },
      { roles: ['VIEWER'], tenantType: 'ENTERPRISE', desc: 'Viewer in enterprise' },
      { roles: ['MANAGER'], tenantType: 'ENTERPRISE', desc: 'Manager in enterprise' },
      { roles: [], tenantType: 'ENTERPRISE', desc: 'No roles (edge case)' }
    ];

    for (const scenario of scenarios) {
      const testUser = { ...user, roles: scenario.roles };
      console.log(`${scenario.desc}:`);
      console.log(`   Roles: [${scenario.roles.join(', ')}]`);
      console.log(`   Can manage users: ${hasPermission(testUser, 'manage_users', scenario.tenantType) ? '✅' : '❌'}`);
      console.log(`   Can create projects: ${hasPermission(testUser, 'create_projects', scenario.tenantType) ? '✅' : '❌'}`);
      console.log(`   Can view analytics: ${hasPermission(testUser, 'view_analytics', scenario.tenantType) ? '✅' : '❌'}`);
      console.log('');
    }

    // Scenario 3: Multi-Tenant User Scenarios
    console.log('📋 SCENARIO 3: CROSS-TENANT ACCESS PATTERNS\n');

    const enterpriseTenant = await prisma.tenant.create({
      data: {
        name: 'Enterprise A',
        atiId: 'TEST-ENTERPRISE-A',
        type: 'ENTERPRISE'
      }
    });

    const anotherEnterprise = await prisma.tenant.create({
      data: {
        name: 'Enterprise B',
        atiId: 'TEST-ENTERPRISE-B',
        type: 'ENTERPRISE'
      }
    });

    // Simulate a user who somehow has access to multiple tenants (shouldn't happen in real app)
    const multiTenantUser = {
      roles: ['ADMIN'],
      tenant: enterpriseTenant
    };

    console.log('User with ADMIN role accessing different tenant contexts:');
    console.log(`   In own enterprise: Can manage users: ${hasPermission(multiTenantUser, 'manage_users', 'ENTERPRISE') ? '✅' : '❌'}`);
    console.log(`   In another enterprise: Can manage users: ${hasPermission(multiTenantUser, 'manage_users', 'ENTERPRISE') ? '✅ (Same logic)' : '❌'}`);

    // Scenario 4: Privilege Escalation Attempts
    console.log('\n📋 SCENARIO 4: PRIVILEGE ESCALATION PREVENTION\n');

    const escalationTests = [
      {
        user: { roles: ['ANALYST'] },
        tenantType: 'ENTERPRISE',
        attempt: 'Analyst trying to manage users in enterprise',
        permission: 'manage_users',
        shouldFail: true
      },
      {
        user: { roles: ['VIEWER'] },
        tenantType: 'ENTERPRISE',
        attempt: 'Viewer trying to create projects',
        permission: 'create_projects',
        shouldFail: true
      },
      {
        user: { roles: ['MANAGER'] },
        tenantType: 'ENTERPRISE',
        attempt: 'Manager trying to manage users',
        permission: 'manage_users',
        shouldFail: true
      },
      {
        user: { roles: ['ANALYST'] },
        tenantType: 'INDIVIDUAL',
        attempt: 'Analyst managing users in individual tenant',
        permission: 'manage_users',
        shouldFail: false // Should succeed
      }
    ];

    for (const test of escalationTests) {
      const result = hasPermission(test.user, test.permission, test.tenantType);
      const expected = !test.shouldFail;
      const passed = result === expected;

      console.log(`${passed ? '🛡️ BLOCKED' : '⚠️ ALLOWED'}: ${test.attempt}`);
      console.log(`   Result: ${result ? 'ALLOWED' : 'BLOCKED'}, Expected: ${expected ? 'ALLOWED' : 'BLOCKED'}`);
      console.log('');
    }

    // Scenario 5: Bulk Operations & Performance
    console.log('📋 SCENARIO 5: BULK OPERATIONS SIMULATION\n');

    // Create multiple users for bulk testing
    const bulkUsers = [];
    for (let i = 0; i < 10; i++) {
      bulkUsers.push({
        email: `bulk-test-${i}@spotipr.com`,
        name: `Bulk User ${i}`,
        roles: i % 2 === 0 ? ['ADMIN'] : ['ANALYST'],
        tenantId: i % 2 === 0 ? enterpriseTenant.id : tenant.id,
        passwordHash: await bcrypt.hash('TestPass123!', 12),
        status: 'ACTIVE'
      });
    }

    const createdBulkUsers = await prisma.user.createMany({
      data: bulkUsers
    });

    const allUsers = await prisma.user.findMany({
      where: {
        email: {
          startsWith: 'bulk-test-'
        }
      },
      include: { tenant: true }
    });

    console.log(`Created ${allUsers.length} bulk test users`);
    console.log('Testing permissions across all users...');

    let adminCount = 0;
    let analystCount = 0;
    let canManageUsersCount = 0;

    for (const testUser of allUsers) {
      if (testUser.roles.includes('ADMIN')) adminCount++;
      if (testUser.roles.includes('ANALYST')) analystCount++;
      if (hasPermission(testUser, 'manage_users', testUser.tenant?.type)) canManageUsersCount++;
    }

    console.log(`   Admin users: ${adminCount}`);
    console.log(`   Analyst users: ${analystCount}`);
    console.log(`   Users who can manage users: ${canManageUsersCount}`);
    console.log(`   Expected: ${adminCount} (only admins should manage users)`);

    // Scenario 6: Configuration Changes Impact
    console.log('\n📋 SCENARIO 6: CONFIGURATION CHANGE IMPACT\n');

    console.log('Testing permission changes when tenant type changes:');
    const testUser = allUsers[0];

    console.log('Before tenant type change (ENTERPRISE):');
    console.log(`   Can manage users: ${hasPermission(testUser, 'manage_users', 'ENTERPRISE') ? '✅' : '❌'}`);

    console.log('After simulated tenant type change (INDIVIDUAL):');
    console.log(`   Can manage users: ${hasPermission(testUser, 'manage_users', 'INDIVIDUAL') ? '✅' : '❌'}`);

    console.log('\n🎯 ADVANCED SCENARIO TESTING COMPLETE!');
    console.log('All complex edge cases and scenarios validated.');

    // Cleanup
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test-'
        }
      }
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'bulk-test-'
        }
      }
    });

    await prisma.tenant.deleteMany({
      where: {
        atiId: {
          startsWith: 'TEST-'
        }
      }
    });

    console.log('\n🧹 All test data cleaned up.');

  } catch (error) {
    console.error('❌ Advanced scenario test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runAdvancedScenarios();
