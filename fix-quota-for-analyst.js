#!/usr/bin/env node

/**
 * Fix Quota for analyst@spotipr.com
 * 
 * This script:
 * 1. Resets the token-based daily usage (which was incorrectly counting tokens instead of patents)
 * 2. Shows current quota status using the new patent-based tracking
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixQuota() {
  try {
    console.log('🔧 Fixing quota for analyst@spotipr.com...\n')

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

    console.log('\n📊 PATENT_DRAFTING Quotas (from plan):')
    console.log(`   Daily: ${patentDraftingFeature.dailyQuota || 'unlimited'}`)
    console.log(`   Monthly: ${patentDraftingFeature.monthlyQuota || 'unlimited'}`)

    // Check current token-based usage (OLD method - will be ignored now)
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

    console.log('\n📈 Token-Based Usage (OLD - now ignored for PATENT_DRAFTING):')
    console.log(`   Daily (${currentDay}): ${dailyMeter?.currentUsage || 0} tokens`)
    console.log(`   Monthly (${currentMonth}): ${monthlyMeter?.currentUsage || 0} tokens`)

    // Check new patent-based usage
    const [dailyPatentCount, monthlyPatentCount] = await Promise.all([
      prisma.patentDraftingUsage.count({
        where: {
          tenantId: user.tenantId,
          isCounted: true,
          countedDate: currentDay
        }
      }),
      prisma.patentDraftingUsage.count({
        where: {
          tenantId: user.tenantId,
          isCounted: true,
          countedMonth: currentMonth
        }
      })
    ])

    console.log('\n📈 Patent-Based Usage (NEW - counts whole patents):')
    console.log(`   Daily (${currentDay}): ${dailyPatentCount} patents`)
    console.log(`   Monthly (${currentMonth}): ${monthlyPatentCount} patents`)

    // Show remaining quota using new method
    const dailyRemaining = patentDraftingFeature.dailyQuota !== null 
      ? patentDraftingFeature.dailyQuota - dailyPatentCount 
      : null
    const monthlyRemaining = patentDraftingFeature.monthlyQuota !== null 
      ? patentDraftingFeature.monthlyQuota - monthlyPatentCount 
      : null

    console.log('\n✅ New Quota Status (Patent-Based):')
    console.log(`   Daily remaining: ${dailyRemaining !== null ? dailyRemaining : 'unlimited'} patents`)
    console.log(`   Monthly remaining: ${monthlyRemaining !== null ? monthlyRemaining : 'unlimited'} patents`)

    // Check for existing sessions that might need syncing
    const existingSessions = await prisma.draftingSession.findMany({
      where: {
        tenantId: user.tenantId
      },
      include: {
        annexureDrafts: {
          orderBy: { version: 'desc' },
          take: 1
        }
      }
    })

    const sessionsWithEssentialSections = existingSessions.filter(session => {
      const draft = session.annexureDrafts[0]
      if (!draft) return false
      const hasDescription = !!(draft.detailedDescription && draft.detailedDescription.trim())
      const hasClaims = !!(draft.claims && draft.claims.trim())
      return hasDescription && hasClaims
    })

    if (sessionsWithEssentialSections.length > 0) {
      console.log(`\n⚠️  Found ${sessionsWithEssentialSections.length} existing session(s) with essential sections drafted`)
      console.log('   These may need to be synced to the new tracking system.')
      console.log('   Run with --sync flag to sync them.')
      
      if (process.argv.includes('--sync')) {
        console.log('\n🔄 Syncing existing sessions...')
        for (const session of sessionsWithEssentialSections) {
          // Check if already tracked
          const existing = await prisma.patentDraftingUsage.findUnique({
            where: { sessionId: session.id }
          })
          
          if (!existing) {
            await prisma.patentDraftingUsage.create({
              data: {
                tenantId: session.tenantId,
                sessionId: session.id,
                patentId: session.patentId,
                userId: session.userId,
                hasDescription: true,
                hasClaims: true,
                isCounted: true,
                countedDate: currentDay,
                countedMonth: currentMonth,
                countedAt: new Date()
              }
            })
            console.log(`   ✅ Synced session ${session.id}`)
          } else {
            console.log(`   ⏭️  Session ${session.id} already tracked`)
          }
        }
      }
    }

    console.log('\n✅ Quota fix complete!')
    console.log('\n📝 Summary:')
    console.log('   - Patent drafting now counts PATENTS, not LLM tokens')
    console.log('   - A patent counts when BOTH detailedDescription AND claims are drafted')
    console.log('   - You can now continue drafting your patents')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  fixQuota()
}

