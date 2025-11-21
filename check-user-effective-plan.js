#!/usr/bin/env node

/**
 * Check what the effective plan is for analyst@spotipr.com
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkEffectivePlan() {
  try {
    console.log('🔍 Checking effective plan for analyst@spotipr.com...\n')

    const user = await prisma.user.findUnique({
      where: { email: 'analyst@spotipr.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: {
              include: {
                plan: true
              },
              orderBy: {
                effectiveFrom: 'desc'
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
    console.log('\n📋 All Tenant Plans (newest first):')

    user.tenant.tenantPlans.forEach(tp => {
      console.log(`   - ${tp.plan.code} (${tp.plan.name})`)
      console.log(`     Status: ${tp.status}`)
      console.log(`     Effective From: ${tp.effectiveFrom}`)
      console.log(`     Expires: ${tp.expiresAt || 'Never'}`)
      console.log()
    })

    // Find the most recent ACTIVE plan
    const activePlans = user.tenant.tenantPlans.filter(tp => tp.status === 'ACTIVE')
    if (activePlans.length === 0) {
      console.log('❌ No active plans found!')
      return
    }

    const latestActivePlan = activePlans[0] // Already ordered by effectiveFrom desc
    console.log(`🎯 Latest Active Plan: ${latestActivePlan.plan.code} (${latestActivePlan.plan.name})`)
    console.log(`   Effective: ${latestActivePlan.effectiveFrom}`)

    // Check if DIAGRAM_GENERATION is available in this plan
    const diagramFeature = await prisma.planFeature.findFirst({
      where: {
        planId: latestActivePlan.planId,
        feature: { code: 'DIAGRAM_GENERATION' }
      },
      include: { feature: true }
    })

    if (diagramFeature) {
      console.log('✅ DIAGRAM_GENERATION available in current plan')
    } else {
      console.log('❌ DIAGRAM_GENERATION NOT available in current plan')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkEffectivePlan()
}
