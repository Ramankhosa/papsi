const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugATIToken() {
  console.log('🔍 Debugging ATI token for ramankhosa@gmail.com...');

  try {
    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: 'ramankhosa@gmail.com' },
      include: {
        tenant: true
      }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('\n👤 USER INFO:');
    console.log('Email:', user.email);
    console.log('User ID:', user.id);
    console.log('Tenant ID:', user.tenantId);
    console.log('Tenant Name:', user.tenant?.name);
    console.log('Tenant ATI ID:', user.tenant?.atiId);

    // Find ATI tokens for this tenant
    const tokens = await prisma.aTIToken.findMany({
      where: { tenantId: user.tenantId },
      select: {
        id: true,
        tokenHash: true,
        rawToken: true,
        status: true,
        planTier: true,
        expiresAt: true,
        maxUses: true,
        usageCount: true,
        tenantId: true
      }
    });

    console.log('\n🎫 ATI TOKENS FOR TENANT:');
    if (tokens.length === 0) {
      console.log('❌ No ATI tokens found for this tenant!');
    } else {
      tokens.forEach((token, index) => {
        console.log(`\nToken ${index + 1}:`);
        console.log('  ID:', token.id);
        console.log('  Status:', token.status);
        console.log('  Plan Tier:', token.planTier);
        console.log('  Raw Token:', token.rawToken);
        console.log('  Expires:', token.expiresAt);
        console.log('  Max Uses:', token.maxUses);
        console.log('  Usage Count:', token.usageCount);
        console.log('  Tenant ID matches:', token.tenantId === user.tenantId);
      });
    }

    // Check if there are any active tokens
    const activeTokens = tokens.filter(t => t.status === 'ACTIVE');
    console.log('\n📊 SUMMARY:');
    console.log('Total tokens for tenant:', tokens.length);
    console.log('Active tokens:', activeTokens.length);

    if (activeTokens.length === 0) {
      console.log('❌ No active ATI tokens found - this is why login fails!');
    } else {
      console.log('✅ Active ATI tokens found - login should work');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugATIToken();


