#!/usr/bin/env node

/**
 * Check what features are available in PRO_PLAN
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkPlanFeatures() {
  try {
    console.log('🔍 Checking PRO_PLAN features...\n')

    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' }
    })

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found')
      return
    }

    console.log(`✅ Found PRO_PLAN: ${proPlan.name} (${proPlan.id})`)

    const features = await prisma.planFeature.findMany({
      where: { planId: proPlan.id },
      include: { feature: true }
    })

    console.log('\n📋 PRO_PLAN Features:')
    if (features.length === 0) {
      console.log('   - No features linked')
    } else {
      features.forEach(f => {
        console.log(`   - ${f.feature.code}: ${f.monthlyQuota} monthly, ${f.dailyQuota} daily`)
      })
    }

    // Check specifically for DIAGRAM_GENERATION
    const diagramFeature = features.find(f => f.feature.code === 'DIAGRAM_GENERATION')
    if (diagramFeature) {
      console.log('\n✅ DIAGRAM_GENERATION is available in PRO_PLAN')
    } else {
      console.log('\n❌ DIAGRAM_GENERATION is NOT available in PRO_PLAN')
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkPlanFeatures()
}
