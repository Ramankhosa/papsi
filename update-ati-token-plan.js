#!/usr/bin/env node

/**
 * Update ATI token planTier for analyst@spotipr.com to PRO_PLAN
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function updateATITokenPlan() {
  try {
    console.log('🔄 Updating ATI token planTier for analyst@spotipr.com to PRO_PLAN...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: true
      }
    })

    if (!user) {
      console.log('❌ User not found')
      return
    }

    console.log(`✅ Found user: ${user.email}`)
    console.log(`   Tenant: ${user.tenant.name} (${user.tenant.id})`)

    // Update all ISSUED ATI tokens for this tenant to PRO_PLAN
    const updateResult = await prisma.aTIToken.updateMany({
      where: {
        tenantId: user.tenantId,
        status: 'ISSUED'
      },
      data: {
        planTier: 'PRO_PLAN'
      }
    })

    console.log(`✅ Updated ${updateResult.count} ATI tokens to PRO_PLAN`)

    // Verify the update
    const updatedTokens = await prisma.aTIToken.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ISSUED'
      },
      select: {
        id: true,
        planTier: true,
        status: true
      }
    })

    console.log('\n📋 Updated ATI Tokens:')
    updatedTokens.forEach(token => {
      console.log(`   - ${token.id}: ${token.planTier} (${token.status})`)
    })

  } catch (error) {
    console.error('❌ Error updating ATI tokens:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  updateATITokenPlan()
}
