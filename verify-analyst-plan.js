#!/usr/bin/env node

/**
 * Verify analyst@spotipr.com plan status
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function verifyAnalystPlan() {
  try {
    console.log('🔍 Verifying analyst@spotipr.com plan status...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: {
              where: { status: 'ACTIVE' },
              include: { plan: true }
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
    console.log(`   Tenant: ${user.tenant.name} (${user.tenant.type})`)
    console.log('   Active Plans:')

    if (user.tenant.tenantPlans.length === 0) {
      console.log('   - No active plans found')
    } else {
      user.tenant.tenantPlans.forEach(tp => {
        console.log(`   - ${tp.plan.code} (${tp.plan.name}) - Effective: ${tp.effectiveFrom}`)
      })
    }

  } catch (error) {
    console.error('❌ Error verifying plan:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  verifyAnalystPlan()
}
