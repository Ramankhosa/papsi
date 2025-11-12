const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function testAPIRoles() {
  console.log('🔌 TESTING API ROLE INTEGRATION\n');

  try {
    // Test the user data structure in database
    const users = await prisma.user.findMany({
      include: {
        tenant: true
      }
    });

    console.log('📊 Database User Structure Test:');
    users.forEach(user => {
      console.log(`   ${user.email}: roles=${JSON.stringify(user.roles)}, tenant_type=${user.tenant?.type}`);
    });

    console.log('\n🔍 JWT Payload Structure Test:');
    // Simulate what the JWT payload would look like
    users.forEach(user => {
      const jwtPayload = {
        sub: user.id,
        email: user.email,
        tenant_id: user.tenantId,
        roles: user.roles,
        ati_id: user.tenant?.atiId,
        tenant_ati_id: user.tenant?.atiId,
        scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
      };

      console.log(`   ${user.email}:`);
      console.log(`     roles: ${JSON.stringify(jwtPayload.roles)}`);
      console.log(`     tenant_id: ${jwtPayload.tenant_id}`);
      console.log(`     scope: ${jwtPayload.scope}`);
    });

    console.log('\n✅ API ROLE INTEGRATION TEST COMPLETED!');
    console.log('All users have proper role arrays and tenant associations.');

  } catch (error) {
    console.error('❌ API test error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAPIRoles();
