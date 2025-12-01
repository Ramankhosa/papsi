#!/usr/bin/env node

/**
 * Reset daily usage counters for analyst@spotipr.com tenant
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function resetDailyUsage() {
  try {
    console.log('🔄 Resetting daily usage for analyst@spotipr.com...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    })

    if (!user) {
      console.log('❌ User not found')
      return
    }

    console.log(`✅ User: ${user.email}`)
    console.log(`   Tenant: ${user.tenant.name} (${user.tenantId})`)

    const currentDay = new Date().toISOString().substring(0, 10)

    // Reset daily usage meter for PATENT_DRAFTING (LLM2_DRAFT)
    const resetResult = await prisma.usageMeter.updateMany({
      where: {
        tenantId: user.tenantId,
        taskCode: 'LLM2_DRAFT',
        periodType: 'DAILY',
        periodKey: currentDay
      },
      data: {
        currentUsage: 0,
        lastUpdated: new Date()
      }
    })

    console.log(`✅ Reset ${resetResult.count} daily usage meter(s) for PATENT_DRAFTING`)

    // Also reset other related tasks if they exist
    const taskCodes = ['LLM1_PRIOR_ART', 'LLM3_DIAGRAM', 'LLM4_NOVELTY_SCREEN', 'IDEA_BANK_ACCESS']

    for (const taskCode of taskCodes) {
      const result = await prisma.usageMeter.updateMany({
        where: {
          tenantId: user.tenantId,
          taskCode,
          periodType: 'DAILY',
          periodKey: currentDay
        },
        data: {
          currentUsage: 0,
          lastUpdated: new Date()
        }
      })

      if (result.count > 0) {
        console.log(`✅ Reset ${result.count} daily usage meter(s) for ${taskCode}`)
      }
    }

    // Verify the reset
    console.log('\n🔍 Verifying reset...')
    const meters = await prisma.usageMeter.findMany({
      where: {
        tenantId: user.tenantId,
        periodType: 'DAILY',
        periodKey: currentDay
      },
      select: {
        taskCode: true,
        currentUsage: true
      }
    })

    console.log('\n📊 Current Daily Usage (after reset):')
    meters.forEach(meter => {
      console.log(`   ${meter.taskCode}: ${meter.currentUsage}`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  resetDailyUsage()
}
