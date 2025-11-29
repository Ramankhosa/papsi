const { PrismaClient } = require('@prisma/client');

async function checkDB() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Checking database state...\n');

    // Check users
    const users = await prisma.user.findMany({
      select: {
        email: true,
        roles: true,
        signupAtiTokenId: true,
        tenant: { select: { name: true } }
      }
    });

    console.log(`👥 Users (${users.length}):`);
    users.forEach(user => {
      console.log(`  - ${user.email}: ${user.roles.join(', ')} ${user.signupAtiTokenId ? '✓ HAS_TOKEN' : '✗ NO_TOKEN'}`);
      if (user.tenant) {
        console.log(`    Tenant: ${user.tenant.name}`);
      }
    });

    // Check ATI tokens
    const tokens = await prisma.aTIToken.findMany({
      select: {
        id: true,
        rawToken: true,
        status: true,
        tenant: { select: { name: true } }
      }
    });

    console.log(`\n🎫 ATI Tokens (${tokens.length}):`);
    tokens.forEach(token => {
      const tokenPreview = token.rawToken ? token.rawToken.substring(0, 20) + '...' : 'NO_RAW_TOKEN';
      console.log(`  - ${tokenPreview} (${token.status})`);
      if (token.tenant) {
        console.log(`    Tenant: ${token.tenant.name}`);
      }
    });

    // Check plans
    const plans = await prisma.plan.count();
    console.log(`\n📋 Plans: ${plans}`);

    // Check country data
    const countryNames = await prisma.countryName.count();
    const countryMappings = await prisma.countrySectionMapping.count();
    console.log(`\n🌍 Country Data:`);
    console.log(`  - Names: ${countryNames}`);
    console.log(`  - Mappings: ${countryMappings}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDB();
