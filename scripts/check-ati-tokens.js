const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkTokens() {
  try {
    console.log('🔍 Checking ATI Tokens and User Associations...\n');

    // Check ATI tokens
    const tokens = await prisma.aTIToken.findMany();
    console.log('📋 Available ATI Tokens:');
    tokens.forEach(token => {
      console.log(`   ${token.id}: ${token.planTier} (${token.status}) - ${token.atiId}`);
    });

    // Check users and their ATI token associations
    const users = await prisma.user.findMany({
      include: {
        signupAtiToken: true,
        tenant: true
      }
    });

    console.log('\n👥 Users and their ATI tokens:');
    users.forEach(user => {
      const hasToken = user.signupAtiTokenId ? '✅ Has token' : '❌ No token';
      const planTier = user.signupAtiToken?.planTier || 'N/A';
      const tenantName = user.tenant?.name || 'No tenant';
      console.log(`   ${user.email}: ${hasToken} (${planTier}) - Tenant: ${tenantName}`);
    });

    // Check tenants
    const tenants = await prisma.tenant.findMany();
    console.log('\n🏢 Tenants:');
    tenants.forEach(tenant => {
      console.log(`   ${tenant.name} (${tenant.atiId}) - ID: ${tenant.id}`);
    });

  } catch (error) {
    console.error('❌ Error checking tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();
