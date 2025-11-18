const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function checkAndCreateATIToken() {
  console.log('🔍 Checking ATI tokens...');

  try {
    // Get all ATI tokens with tenant info
    const tokens = await prisma.aTIToken.findMany({
      include: {
        tenant: {
          select: {
            name: true,
            atiId: true,
            type: true
          }
        }
      }
    });

    console.log('\n📋 EXISTING ATI TOKENS:');
    console.table(tokens.map(t => ({
      'Token ID': t.id.slice(0, 8) + '...',
      'Tenant': t.tenant?.name || 'null',
      'ATI ID': t.tenant?.atiId || 'null',
      'Status': t.status,
      'Plan Tier': t.planTier || 'null'
    })));

    // Find Raman's tenant
    const ramanTenant = await prisma.tenant.findFirst({
      where: { atiId: 'RAMAN_TEST' }
    });

    if (!ramanTenant) {
      console.log('❌ Raman test tenant not found');
      return;
    }

    console.log('\n🎯 Found Raman tenant:', ramanTenant.name);

    // Check if token already exists for this tenant
    const existingToken = tokens.find(t => t.tenantId === ramanTenant.id);

    if (existingToken) {
      console.log('✅ ATI token already exists for Raman tenant');
      return;
    }

    // Generate new ATI token
    const rawToken = 'RAMAN_' + Math.random().toString(36).substring(2, 15).toUpperCase();
    const tokenHash = await bcrypt.hash(rawToken, 12);
    const fingerprint = 'raman_test_' + Date.now();

    const newToken = await prisma.aTIToken.create({
      data: {
        tenantId: ramanTenant.id,
        tokenHash,
        rawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        fingerprint,
        status: 'ACTIVE',
        planTier: 'FREE_PLAN',
        notes: 'Raman Test Account Token',
        maxUses: 100
      }
    });

    console.log('\n🎉 CREATED NEW ATI TOKEN:');
    console.log('🔑 Raw Token:', rawToken);
    console.log('🆔 Token ID:', newToken.id);
    console.log('🏢 Tenant:', ramanTenant.name);
    console.log('📊 Status: ACTIVE');

    console.log('\n💡 Use this token for signup testing if needed');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndCreateATIToken();
