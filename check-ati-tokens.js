const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTokens() {
  try {
    const tokens = await prisma.aTIToken.findMany({
      where: {
        OR: [
          { tenant: { atiId: 'PLATFORM' } },
          { tenant: { atiId: 'TESTTENANT' } }
        ]
      },
      include: { tenant: true }
    });

    console.log('ATI Tokens:');
    tokens.forEach(token => {
      const expiry = token.rawTokenExpiry ? new Date(token.rawTokenExpiry) : null;
      const isExpired = expiry && expiry < new Date();
      console.log(`- ${token.tenant.atiId}: ${token.status} (expires: ${expiry || 'never'}) ${isExpired ? '[EXPIRED]' : ''}`);
    });

    // Check users
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: ['superadmin@spotipr.com', 'tenantadmin@spotipr.com', 'analyst@spotipr.com']
        }
      },
      include: { tenant: true }
    });

    console.log('\nUsers:');
    users.forEach(user => {
      console.log(`- ${user.email}: ${user.status} (tenant: ${user.tenant.atiId})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();