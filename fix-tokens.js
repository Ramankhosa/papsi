const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// Replicate auth functions
function generateATIToken() {
  return require('crypto').randomBytes(32).toString('hex').toUpperCase();
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12);
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase();
}

async function fixTokens() {
  const prisma = new PrismaClient();

  try {
    console.log('🔧 Fixing ATI tokens for seeded users...\n');

    // Get all users
    const users = await prisma.user.findMany({
      include: { tenant: true }
    });

    console.log(`Found ${users.length} users`);

    for (const user of users) {
      console.log(`\n👤 Processing: ${user.email} (${user.roles.join(', ')})`);

      // Check if user already has a token
      if (user.signupAtiTokenId) {
        const existingToken = await prisma.aTIToken.findUnique({
          where: { id: user.signupAtiTokenId }
        });

        if (existingToken) {
          console.log(`  ✅ Already has valid token: ${existingToken.rawToken?.substring(0, 20)}...`);
          continue;
        } else {
          console.log(`  ⚠️  Token reference exists but token not found - cleaning up`);
          await prisma.user.update({
            where: { id: user.id },
            data: { signupAtiTokenId: null }
          });
        }
      }

      // Create new token for user
      console.log(`  🆕 Creating new ATI token...`);

      const rawToken = generateATIToken();
      const tokenHash = hashATIToken(rawToken);
      const fingerprint = createATIFingerprint(tokenHash);

      const token = await prisma.aTIToken.create({
        data: {
          tenantId: user.tenantId,
          tokenHash,
          rawToken,
          rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          fingerprint,
          status: 'ISSUED',
          planTier: user.roles.includes('SUPER_ADMIN') ? 'PLATFORM_ADMIN' :
                   user.roles.includes('ADMIN') ? 'PRO_PLAN' : 'FREE_PLAN',
          notes: `${user.roles.join('/')} Onboarding Token`,
          maxUses: user.roles.includes('SUPER_ADMIN') ? 5 :
                  user.roles.includes('ADMIN') ? 5 : 10
        }
      });

      // Link token to user
      await prisma.user.update({
        where: { id: user.id },
        data: { signupAtiTokenId: token.id }
      });

      console.log(`  ✅ Created token: ${rawToken}`);
    }

    // Final verification
    console.log('\n🎯 Final Verification:');
    const finalUsers = await prisma.user.findMany({
      select: {
        email: true,
        roles: true,
        signupAtiToken: {
          select: { rawToken: true, status: true }
        }
      }
    });

    finalUsers.forEach(user => {
      const token = user.signupAtiToken;
      console.log(`  ${user.email}: ${token ? '✅ ' + token.rawToken?.substring(0, 20) + '...' : '❌ NO_TOKEN'}`);
    });

  } catch (error) {
    console.error('❌ Error fixing tokens:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

fixTokens();
