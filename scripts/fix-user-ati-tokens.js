const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixUserATITokens() {
  console.log('🔧 Fixing User ATI Token Associations...\n');

  try {
    // Get all tenants
    const tenants = await prisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants`);

    // Create ATI tokens for each tenant if they don't exist
    for (const tenant of tenants) {
      // Check if ATI token already exists for this tenant
      let existingToken = await prisma.aTIToken.findFirst({
        where: { tenantId: tenant.id }
      });

      if (!existingToken) {
        // Determine plan tier based on tenant
        let planTier = 'FREE_PLAN';
        if (tenant.atiId === 'PLATFORM') {
          planTier = 'ENTERPRISE_PLAN';
        } else {
          planTier = 'PRO_PLAN'; // Default for regular tenants
        }

        // Generate a token hash and fingerprint
        const crypto = require('crypto');
        const rawToken = `ATI-${tenant.atiId}-${Date.now()}`;
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const fingerprint = crypto.createHash('md5').update(rawToken).digest('hex');

        existingToken = await prisma.aTIToken.create({
          data: {
            tenant: {
              connect: { id: tenant.id }
            },
            tokenHash: tokenHash,
            rawToken: rawToken, // In production, this should be encrypted
            fingerprint: fingerprint,
            planTier: planTier,
            status: 'ACTIVE',
            notes: `Auto-generated ATI token for ${tenant.name} (${planTier})`,
            maxUses: null, // Unlimited uses
            expiresAt: null // No expiration
          }
        });

        console.log(`✅ Created ATI token for ${tenant.name}: ${planTier}`);
      } else {
        console.log(`✓ ATI token exists for ${tenant.name}: ${existingToken.planTier}`);
      }
    }

    // Now associate users with appropriate ATI tokens
    const users = await prisma.user.findMany({
      include: { tenant: true }
    });

    for (const user of users) {
      if (!user.signupAtiTokenId) {
        // Find the ATI token for this user's tenant
        const tenantToken = await prisma.aTIToken.findFirst({
          where: { tenantId: user.tenantId }
        });

        if (tenantToken) {
          // Update user with ATI token association
          await prisma.user.update({
            where: { id: user.id },
            data: {
              signupAtiTokenId: tenantToken.id
            }
          });

          console.log(`✅ Associated ${user.email} with ATI token (${tenantToken.planTier})`);
        } else {
          console.log(`❌ No ATI token found for user ${user.email}'s tenant`);
        }
      } else {
        console.log(`✓ ${user.email} already has ATI token association`);
      }
    }

    // Verify the fix
    console.log('\n🔍 Verification:');
    const updatedUsers = await prisma.user.findMany({
      include: {
        signupAtiToken: true,
        tenant: true
      }
    });

    console.log('\n📋 Final User ATI Token Status:');
    updatedUsers.forEach(user => {
      const status = user.signupAtiTokenId ? '✅ Connected' : '❌ Missing';
      const planTier = user.signupAtiToken?.planTier || 'N/A';
      console.log(`   ${user.email}: ${status} (${planTier})`);
    });

    console.log('\n🎉 ATI token associations fixed!');
    console.log('Users should now be able to authenticate properly.');

  } catch (error) {
    console.error('❌ Error fixing ATI tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixUserATITokens();
