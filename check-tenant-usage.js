#!/usr/bin/env node

/**
 * Check current tenant usage and quotas for analyst@spotipr.com
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkTenantUsage() {
  try {
    console.log('🔍 Checking tenant usage for analyst@spotipr.com...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: {
              where: { status: 'ACTIVE' },
              include: {
                plan: {
                  include: {
                    planFeatures: {
                      include: { feature: true }
                    }
                  }
                }
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
    console.log(`   Tenant: ${user.tenant.name} (${user.tenant.id})`)

    const activePlan = user.tenant.tenantPlans[0]
    if (!activePlan) {
      console.log('❌ No active plan found')
      return
    }

    console.log(`   Plan: ${activePlan.plan.name} (${activePlan.plan.code})`)

    // Get patent drafting feature quota
    const patentDraftingFeature = activePlan.plan.planFeatures.find(pf => pf.feature.code === 'PATENT_DRAFTING')
    if (!patentDraftingFeature) {
      console.log('❌ PATENT_DRAFTING feature not found in plan')
      return
    }

    console.log('\n📊 PATENT_DRAFTING Quotas:')
    console.log(`   Daily: ${patentDraftingFeature.dailyQuota || 'unlimited'}`)
    console.log(`   Monthly: ${patentDraftingFeature.monthlyQuota || 'unlimited'}`)

    // Check current usage meters
    const currentDay = new Date().toISOString().substring(0, 10)
    const currentMonth = new Date().toISOString().substring(0, 7)

    const [dailyMeter, monthlyMeter] = await Promise.all([
      prisma.usageMeter.findFirst({
        where: {
          tenantId: user.tenantId,
          taskCode: 'LLM2_DRAFT',
          periodType: 'DAILY',
          periodKey: currentDay
        }
      }),
      prisma.usageMeter.findFirst({
        where: {
          tenantId: user.tenantId,
          taskCode: 'LLM2_DRAFT',
          periodType: 'MONTHLY',
          periodKey: currentMonth
        }
      })
    ])

    console.log('\n📈 Current Usage:')
    console.log(`   Daily (${currentDay}): ${dailyMeter?.currentUsage || 0}`)
    console.log(`   Monthly (${currentMonth}): ${monthlyMeter?.currentUsage || 0}`)

    // Check if quota exceeded
    const dailyUsage = dailyMeter?.currentUsage || 0
    const monthlyUsage = monthlyMeter?.currentUsage || 0

    const dailyExceeded = patentDraftingFeature.dailyQuota !== null && dailyUsage >= patentDraftingFeature.dailyQuota
    const monthlyExceeded = patentDraftingFeature.monthlyQuota !== null && monthlyUsage >= patentDraftingFeature.monthlyQuota

    console.log('\n⚠️  Quota Status:')
    console.log(`   Daily exceeded: ${dailyExceeded ? 'YES' : 'NO'}`)
    console.log(`   Monthly exceeded: ${monthlyExceeded ? 'YES' : 'NO'}`)

    if (dailyExceeded) {
      console.log('\n🔧 Recommendation: Reset daily usage or increase daily quota')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkTenantUsage()
}
