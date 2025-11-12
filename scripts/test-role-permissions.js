const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Test permission functions (same logic as in the app)
function hasPermission(user, permission, tenantType) {
  if (!user?.roles) return false;

  // Super admin always has all permissions
  if (user.roles.includes('SUPER_ADMIN')) return true;

  switch (permission) {
    case 'manage_users':
      if (tenantType === 'INDIVIDUAL') {
        // In individual tenants, analysts can manage users (since they are the only user)
        return user.roles.some(role => ['OWNER', 'ADMIN', 'ANALYST'].includes(role));
      } else {
        // In enterprise tenants, only admins can manage users
        return user.roles.some(role => ['OWNER', 'ADMIN'].includes(role));
      }

    case 'create_projects':
    case 'access_novelty_search':
      return user.roles.some(role => ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST'].includes(role));

    default:
      return false;
  }
}

async function testRolePermissions() {
  console.log('🧪 TESTING ROLE-BASED PERMISSIONS\n');

  try {
    // Get all users with their tenant info
    const users = await prisma.user.findMany({
      include: {
        tenant: true
      }
    });

    console.log('📊 Testing permissions for each user:\n');

    for (const user of users) {
      const tenantType = user.tenant?.type || 'ENTERPRISE';

      console.log(`👤 ${user.name} (${user.email})`);
      console.log(`   Roles: ${user.roles.join(', ')}`);
      console.log(`   Tenant: ${user.tenant?.name} (${tenantType})`);
      console.log(`   Can manage users: ${hasPermission(user, 'manage_users', tenantType) ? '✅ YES' : '❌ NO'}`);
      console.log(`   Can create projects: ${hasPermission(user, 'create_projects', tenantType) ? '✅ YES' : '❌ NO'}`);
      console.log(`   Can access novelty search: ${hasPermission(user, 'access_novelty_search', tenantType) ? '✅ YES' : '❌ NO'}`);
      console.log('');
    }

    // Test specific scenarios
    console.log('🎯 SPECIFIC SCENARIO TESTS:\n');

    const enterpriseAnalyst = users.find(u => u.email === 'analyst@spotipr.com');
    const individualUser = users.find(u => u.email === 'solouser@spotipr.com');
    const enterpriseAdmin = users.find(u => u.email === 'tenantadmin@spotipr.com');

    if (enterpriseAnalyst) {
      console.log('🔒 Enterprise Analyst Security Test:');
      const canManageUsers = hasPermission(enterpriseAnalyst, 'manage_users', 'ENTERPRISE');
      console.log(`   analyst@spotipr.com can manage users: ${canManageUsers ? '❌ FAIL (Security Risk!)' : '✅ PASS (Secure)'}`);
    }

    if (individualUser) {
      console.log('🔓 Individual User Flexibility Test:');
      const canManageUsers = hasPermission(individualUser, 'manage_users', 'INDIVIDUAL');
      const canDoAnalysis = hasPermission(individualUser, 'access_novelty_search', 'INDIVIDUAL');
      console.log(`   solouser@spotipr.com can manage users: ${canManageUsers ? '✅ PASS (Flexible)' : '❌ FAIL'}`);
      console.log(`   solouser@spotipr.com can do analysis: ${canDoAnalysis ? '✅ PASS (Flexible)' : '❌ FAIL'}`);
    }

    if (enterpriseAdmin) {
      console.log('👑 Enterprise Admin Control Test:');
      const canManageUsers = hasPermission(enterpriseAdmin, 'manage_users', 'ENTERPRISE');
      const canDoAnalysis = hasPermission(enterpriseAdmin, 'access_novelty_search', 'ENTERPRISE');
      console.log(`   tenantadmin@spotipr.com can manage users: ${canManageUsers ? '✅ PASS (Admin)' : '❌ FAIL'}`);
      console.log(`   tenantadmin@spotipr.com can do analysis: ${canDoAnalysis ? '✅ PASS (Admin)' : '❌ FAIL'}`);
    }

    console.log('\n🎉 PERMISSION TESTS COMPLETED!');

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testRolePermissions();
