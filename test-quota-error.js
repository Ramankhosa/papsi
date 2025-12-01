#!/usr/bin/env node

/**
 * Test script to simulate quota exceeded error display
 * This temporarily increases the usage counter to trigger quota exceeded
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testQuotaError() {
  try {
    console.log('🔄 Testing quota error display...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: { tenant: true }
    })

    if (!user) {
      console.log('❌ User not found')
      return
    }

    const currentDay = new Date().toISOString().substring(0, 10)

    // Temporarily set usage to exceed quota (1000+)
    await prisma.usageMeter.upsert({
      where: {
        tenantId_featureId_taskCode_periodType_periodKey: {
          tenantId: user.tenantId,
          featureId: null, // PATENT_DRAFTING feature
          taskCode: 'LLM2_DRAFT',
          periodType: 'DAILY',
          periodKey: currentDay
        }
      },
      update: {
        currentUsage: 1500, // Exceed the 1000 daily quota
        lastUpdated: new Date()
      },
      create: {
        tenantId: user.tenantId,
        featureId: null, // PATENT_DRAFTING feature
        taskCode: 'LLM2_DRAFT',
        periodType: 'DAILY',
        periodKey: currentDay,
        currentUsage: 1500,
        lastUpdated: new Date()
      }
    })

    console.log('✅ Temporarily set daily usage to 1500 (exceeds 1000 quota)')
    console.log('📋 Now try to navigate to the next stage in patent drafting')
    console.log('   You should see a user-friendly quota error message instead of "Service access denied"')
    console.log('\n🔄 To reset: run "node reset-daily-usage.js"')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  testQuotaError()
}
