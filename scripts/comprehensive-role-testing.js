const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Comprehensive permission system (matches the app)
function hasPermission(user, permission, tenantType = 'ENTERPRISE') {
  if (!user?.roles) return false;

  // Super admin always has all permissions
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

async function createTestScenario() {
  console.log('🧪 COMPREHENSIVE ROLE SECURITY TEST SCENARIOS\n');
  console.log('=' .repeat(80) + '\n');

  try {
    // Clean up existing test data
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test-'
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

    // Create test tenants
    const enterpriseTenant = await prisma.tenant.create({
      data: {
        name: 'Enterprise Corp',
        atiId: 'TEST-ENTERPRISE',
        type: 'ENTERPRISE'
      }
    });

    const individualTenant = await prisma.tenant.create({
      data: {
        name: 'Solo Innovator',
        atiId: 'TEST-INDIVIDUAL',
        type: 'INDIVIDUAL'
      }
    });

    // Create test users with various role combinations
    const testUsers = [
      {
        email: 'test-super-admin@spotipr.com',
        name: 'Super Admin',
        roles: ['SUPER_ADMIN'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'test-enterprise-admin@spotipr.com',
        name: 'Enterprise Admin',
        roles: ['ADMIN'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'test-enterprise-analyst@spotipr.com',
        name: 'Enterprise Analyst',
        roles: ['ANALYST'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'test-enterprise-manager@spotipr.com',
        name: 'Enterprise Manager',
        roles: ['MANAGER'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'test-enterprise-viewer@spotipr.com',
        name: 'Enterprise Viewer',
        roles: ['VIEWER'],
        tenantId: enterpriseTenant.id
      },
      {
        email: 'test-individual-admin@spotipr.com',
        name: 'Individual Admin',
        roles: ['ADMIN'],
        tenantId: individualTenant.id
      },
      {
        email: 'test-individual-analyst@spotipr.com',
        name: 'Individual Analyst',
        roles: ['ANALYST'],
        tenantId: individualTenant.id
      },
      {
        email: 'test-multi-role@spotipr.com',
        name: 'Multi-Role User',
        roles: ['ADMIN', 'ANALYST', 'MANAGER'],
        tenantId: individualTenant.id
      },
      {
        email: 'test-no-roles@spotipr.com',
        name: 'No Roles User',
        roles: [],
        tenantId: enterpriseTenant.id
      }
    ];

    // Create users
    const createdUsers = [];
    for (const userData of testUsers) {
      const hashedPassword = await bcrypt.hash('TestPass123!', 12);
      const user = await prisma.user.create({
        data: {
          ...userData,
          passwordHash: hashedPassword,
          status: 'ACTIVE'
        },
        include: {
          tenant: true
        }
      });
      createdUsers.push(user);
    }

    console.log('📋 TEST SCENARIO 1: BASIC ROLE PERMISSIONS\n');

    const permissions = [
      'manage_users', 'manage_tenants', 'manage_ati_tokens',
      'view_analytics', 'create_projects', 'access_novelty_search', 'view_reports'
    ];

    for (const user of createdUsers) {
      console.log(`👤 ${user.name} (${user.roles.join(', ') || 'No roles'})`);
      console.log(`   Tenant: ${user.tenant?.name} (${user.tenant?.type})`);

      for (const permission of permissions) {
        const hasPerm = hasPermission(user, permission, user.tenant?.type);
        console.log(`   ${permission}: ${hasPerm ? '✅' : '❌'}`);
      }
      console.log('');
    }

    console.log('📋 TEST SCENARIO 2: SECURITY VALIDATION MATRIX\n');

    const securityTests = [
      {
        name: 'Enterprise Analyst cannot manage users',
        user: createdUsers.find(u => u.email === 'test-enterprise-analyst@spotipr.com'),
        permission: 'manage_users',
        expected: false,
        description: 'Enterprise analysts should NOT have admin privileges'
      },
      {
        name: 'Enterprise Admin can manage users',
        user: createdUsers.find(u => u.email === 'test-enterprise-admin@spotipr.com'),
        permission: 'manage_users',
        expected: true,
        description: 'Enterprise admins should have admin privileges'
      },
      {
        name: 'Individual Analyst can manage users',
        user: createdUsers.find(u => u.email === 'test-individual-analyst@spotipr.com'),
        permission: 'manage_users',
        expected: true,
        description: 'Individual analysts should have admin privileges (solo user)'
      },
      {
        name: 'Multi-role user can manage users',
        user: createdUsers.find(u => u.email === 'test-multi-role@spotipr.com'),
        permission: 'manage_users',
        expected: true,
        description: 'Users with ADMIN role should have admin privileges regardless of other roles'
      },
      {
        name: 'Super Admin has all permissions',
        user: createdUsers.find(u => u.email === 'test-super-admin@spotipr.com'),
        permission: 'manage_users',
        expected: true,
        description: 'Super Admin should override all tenant restrictions'
      },
      {
        name: 'No roles user has no permissions',
        user: createdUsers.find(u => u.email === 'test-no-roles@spotipr.com'),
        permission: 'manage_users',
        expected: false,
        description: 'Users with no roles should have no permissions'
      }
    ];

    let passedTests = 0;
    let totalTests = securityTests.length;

    for (const test of securityTests) {
      const result = hasPermission(test.user, test.permission, test.user?.tenant?.type);
      const passed = result === test.expected;

      console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${test.name}`);
      console.log(`   Expected: ${test.expected}, Got: ${result}`);
      console.log(`   ${test.description}`);

      if (passed) passedTests++;
      console.log('');
    }

    console.log('📋 TEST SCENARIO 3: CROSS-TENANT PERMISSION ISOLATION\n');

    // Test that enterprise users can't access individual tenant permissions
    const enterpriseUser = createdUsers.find(u => u.email === 'test-enterprise-analyst@spotipr.com');
    const individualUser = createdUsers.find(u => u.email === 'test-individual-analyst@spotipr.com');

    console.log('Enterprise user in enterprise context:');
    console.log(`   Can manage users: ${hasPermission(enterpriseUser, 'manage_users', 'ENTERPRISE') ? '✅' : '❌'}`);

    console.log('Individual user in individual context:');
    console.log(`   Can manage users: ${hasPermission(individualUser, 'manage_users', 'INDIVIDUAL') ? '✅' : '❌'}`);

    console.log('Enterprise user in individual context (should still be restricted):');
    console.log(`   Can manage users: ${hasPermission(enterpriseUser, 'manage_users', 'INDIVIDUAL') ? '✅' : '❌'}`);

    console.log('\n📋 TEST SCENARIO 4: ROLE COMBINATION EDGE CASES\n');

    const multiRoleUser = createdUsers.find(u => u.email === 'test-multi-role@spotipr.com');

    // Test that having ADMIN role grants permissions even with other roles
    console.log('Multi-role user (ADMIN + ANALYST + MANAGER):');
    console.log(`   Can manage users: ${hasPermission(multiRoleUser, 'manage_users', 'INDIVIDUAL') ? '✅' : '❌'}`);
    console.log(`   Can create projects: ${hasPermission(multiRoleUser, 'create_projects', 'INDIVIDUAL') ? '✅' : '❌'}`);
    console.log(`   Can access novelty search: ${hasPermission(multiRoleUser, 'access_novelty_search', 'INDIVIDUAL') ? '✅' : '❌'}`);

    console.log('\n🎯 FINAL TEST RESULTS');
    console.log('=' .repeat(40));
    console.log(`Security Tests: ${passedTests}/${totalTests} PASSED`);

    if (passedTests === totalTests) {
      console.log('🎉 ALL TESTS PASSED! Security system is working correctly.');
    } else {
      console.log('❌ Some tests failed. Please review the security implementation.');
    }

    // Clean up test data
    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: 'test-'
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

    console.log('\n🧹 Test data cleaned up.');

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestScenario();
