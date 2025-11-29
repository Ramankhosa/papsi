const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Copy functions from the seed script
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

function hashATIToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createATIFingerprint(tokenHash) {
  return crypto.createHash('md5').update(tokenHash).digest('hex').toUpperCase();
}

async function fixATITokens() {
  try {
    console.log('🔧 Fixing ATI tokens for seeded users...\n');

    // Get tenants
    const platformTenant = await prisma.tenant.findFirst({
      where: { atiId: 'PLATFORM' }
    });

    const testTenant = await prisma.tenant.findFirst({
      where: { atiId: 'TESTTENANT' }
    });

    if (!platformTenant || !testTenant) {
      console.error('❌ Tenants not found');
      return;
    }

    // Fix Super Admin
    const superAdmin = await prisma.user.findFirst({
      where: { email: 'superadmin@spotipr.com' }
    });

    if (superAdmin) {
      const rawToken = generateATIToken();
      const tokenHash = hashATIToken(rawToken);
      const fingerprint = createATIFingerprint(tokenHash);

      // Delete existing tokens for this user
      await prisma.aTIToken.deleteMany({
        where: { tenantId: platformTenant.id }
      });

      const platformToken = await prisma.aTIToken.create({
        data: {
          tenantId: platformTenant.id,
          tokenHash,
          rawToken,
          rawTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          fingerprint,
          status: 'ISSUED',
          planTier: 'PLATFORM_ADMIN',
          notes: 'Super Admin Onboarding Token - Fixed',
          maxUses: 10
        }
      });

      // Update user with new token
      await prisma.user.update({
        where: { id: superAdmin.id },
        data: { signupAtiTokenId: platformToken.id }
      });

      console.log('✅ Super Admin: superadmin@spotipr.com');
      console.log(`🎫 ATI Token: ${rawToken}\n`);
    }

    // Fix Tenant Admin
    const tenantAdmin = await prisma.user.findFirst({
      where: { email: 'tenantadmin@spotipr.com' }
    });

    if (tenantAdmin) {
      const tenantRawToken = generateATIToken();
      const tenantTokenHash = hashATIToken(tenantRawToken);
      const tenantFingerprint = createATIFingerprint(tenantTokenHash);

      // Delete existing tokens for tenant admin
      await prisma.aTIToken.deleteMany({
        where: { tenantId: testTenant.id, notes: { contains: 'Tenant Admin' } }
      });

      const tenantToken = await prisma.aTIToken.create({
        data: {
          tenantId: testTenant.id,
          tokenHash: tenantTokenHash,
          rawToken: tenantRawToken,
          rawTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          fingerprint: tenantFingerprint,
          status: 'ISSUED',
          planTier: 'FREE_PLAN',
          notes: 'Tenant Admin Onboarding Token - Fixed',
          maxUses: 10
        }
      });

      // Update user with new token
      await prisma.user.update({
        where: { id: tenantAdmin.id },
        data: { signupAtiTokenId: tenantToken.id }
      });

      console.log('✅ Tenant Admin: tenantadmin@spotipr.com');
      console.log(`🎫 ATI Token: ${tenantRawToken}\n`);
    }

    // Fix Analyst
    const analyst = await prisma.user.findFirst({
      where: { email: 'analyst@spotipr.com' }
    });

    if (analyst) {
      const analystRawToken = generateATIToken();
      const analystTokenHash = hashATIToken(analystRawToken);
      const analystFingerprint = createATIFingerprint(analystTokenHash);

      // Delete existing tokens for analyst
      await prisma.aTIToken.deleteMany({
        where: { tenantId: testTenant.id, notes: { contains: 'Analyst' } }
      });

      const analystToken = await prisma.aTIToken.create({
        data: {
          tenantId: testTenant.id,
          tokenHash: analystTokenHash,
          rawToken: analystRawToken,
          rawTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          fingerprint: analystFingerprint,
          status: 'ISSUED',
          planTier: 'FREE_PLAN',
          notes: 'Analyst Onboarding Token - Fixed',
          maxUses: 20
        }
      });

      // Update user with new token
      await prisma.user.update({
        where: { id: analyst.id },
        data: { signupAtiTokenId: analystToken.id }
      });

      console.log('✅ Analyst: analyst@spotipr.com');
      console.log(`🎫 ATI Token: ${analystRawToken}\n`);
    }

    console.log('🎉 ATI tokens fixed successfully!');

  } catch (error) {
    console.error('❌ Error fixing ATI tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixATITokens();