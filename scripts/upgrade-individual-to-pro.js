#!/usr/bin/env node

/**
 * Upgrade individual@gmail.com account to PRO_PLAN
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function upgradeIndividualToPro() {
  try {
    console.log('🔄 Upgrading individual@gmail.com to PRO_PLAN...\n')

    // Find the individual user
    const individualUser = await prisma.user.findUnique({
      where: { email: 'individual@gmail.com' },
      include: {
        tenant: {
          include: {
            tenantPlans: true
          }
        }
      }
    })

    if (!individualUser) {
      console.log('❌ Individual user not found')
      return
    }

    console.log(`✅ Found user: ${individualUser.email}`)
    console.log(`   Tenant: ${individualUser.tenant.name} (${individualUser.tenant.type})`)

    // Get PRO_PLAN
    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' }
    })

    if (!proPlan) {
      console.log('❌ PRO_PLAN not found in database')
      return
    }

    console.log(`✅ Found PRO_PLAN: ${proPlan.name}`)

    // Update tenant plan to PRO_PLAN
    const updatedTenantPlan = await prisma.tenantPlan.upsert({
      where: {
        tenantId_planId_effectiveFrom: {
          tenantId: individualUser.tenantId,
          planId: proPlan.id,
          effectiveFrom: new Date()
        }
      },
      update: {
        status: 'ACTIVE'
      },
      create: {
        tenantId: individualUser.tenantId,
        planId: proPlan.id,
        effectiveFrom: new Date(),
        status: 'ACTIVE'
      }
    })

    console.log('✅ Successfully upgraded to PRO_PLAN!')
    console.log(`   User: ${individualUser.email}`)
    console.log(`   Tenant: ${individualUser.tenant.name}`)
    console.log(`   New Plan: ${proPlan.code} (${proPlan.name})`)
    console.log(`   Effective From: ${updatedTenantPlan.effectiveFrom}`)

  } catch (error) {
    console.error('❌ Error upgrading individual account:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  upgradeIndividualToPro()
}
