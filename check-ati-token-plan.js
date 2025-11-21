#!/usr/bin/env node

/**
 * Check what planTier is set on the ATI token for analyst@spotipr.com
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkATITokenPlan() {
  try {
    console.log('🔍 Checking ATI token planTier for analyst@spotipr.com...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: {
          include: {
            atiTokens: {
              where: { status: 'ISSUED' },
              select: {
                id: true,
                planTier: true,
                status: true,
                createdAt: true
              }
            }
          }
        }
      }
    })

    if (!user) {
      console.log('❌ User not found')
      return
    }

    console.log(`✅ User: ${user.email}`)
    console.log(`   Tenant: ${user.tenant.name}`)
    console.log('\n📋 ATI Tokens:')

    if (user.tenant.atiTokens.length === 0) {
      console.log('   - No ATI tokens found')
    } else {
      user.tenant.atiTokens.forEach(token => {
        console.log(`   - Token ID: ${token.id}`)
        console.log(`     Status: ${token.status}`)
        console.log(`     Plan Tier: ${token.planTier || 'NULL'}`)
        console.log(`     Created: ${token.createdAt}`)
        console.log()
      })
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkATITokenPlan()
}
