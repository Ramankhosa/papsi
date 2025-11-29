const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUsersAndTenants() {
  try {
    console.log('=== USERS ===');
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        tenantId: true
      }
    });

    console.log('Current users in database:');
    users.forEach(user => {
      const displayName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'no name';
      console.log(`- ${user.id}: ${user.email} (${displayName}) - Tenant: ${user.tenantId || 'null'}`);
    });

    console.log('\n=== TENANTS ===');
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        atiId: true
      }
    });

    console.log('Current tenants in database:');
    tenants.forEach(tenant => {
      console.log(`- ${tenant.id}: ${tenant.name} (${tenant.atiId})`);
    });

    if (users.length === 0) {
      console.log('No users found in database');
    }
    if (tenants.length === 0) {
      console.log('No tenants found in database');
    }

  } catch (error) {
    console.error('Error checking users and tenants:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsersAndTenants();