#!/usr/bin/env node

/**
 * Fix Analyst Account and Create Individual Account
 *
 * 1. Fix analyst@spotipr.com account hierarchy issues
 * 2. Create individual@gmail.com as INDIVIDUAL tenant type
 */

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

// Replicate auth functions
function generateATIToken() {
  return crypto.randomBytes(32).toString('hex').toUpperCase()
}

function hashATIToken(token) {
  return bcrypt.hashSync(token, 12)
}

function createATIFingerprint(tokenHash) {
  return tokenHash.substring(tokenHash.length - 6).toUpperCase()
}

const prisma = new PrismaClient()

async function fixAnalystAndCreateIndividual() {
  try {
    console.log('🔧 Fixing analyst@spotipr account and creating individual account...\n')

    // === PHASE 1: FIX ANALYST ACCOUNT ===
    console.log('👤 PHASE 1: Fixing analyst@spotipr account')
    console.log('=' .repeat(50))

    const analystEmail = 'analyst@spotipr.com'

    // Find existing analyst user
    const existingAnalyst = await prisma.user.findUnique({
      where: { email: analystEmail },
      include: {
        tenant: true,
        signupAtiToken: true
      }
    })

    if (!existingAnalyst) {
      console.log('❌ Analyst user not found. Creating new one...')
    } else {
      console.log(`✅ Found existing analyst: ${existingAnalyst.email}`)
      console.log(`   Current roles: ${existingAnalyst.roles}`)
      console.log(`   Tenant: ${existingAnalyst.tenant?.name} (${existingAnalyst.tenant?.atiId})`)
      console.log(`   Tenant type: ${existingAnalyst.tenant?.type}`)
    }

    // Ensure we have a proper tenant for the analyst
    let analystTenant = existingAnalyst?.tenant

    if (!analystTenant || analystTenant.type !== 'ENTERPRISE') {
      console.log('🏢 Creating/updating enterprise tenant for analyst...')

      analystTenant = await prisma.tenant.upsert({
        where: { atiId: 'SPOTIPR_ENTERPRISE' },
        update: {
          name: 'Spotipr Enterprise',
          type: 'ENTERPRISE',
          status: 'ACTIVE'
        },
        create: {
          name: 'Spotipr Enterprise',
          atiId: 'SPOTIPR_ENTERPRISE',
          type: 'ENTERPRISE',
          status: 'ACTIVE'
        }
      })

      console.log(`✅ Enterprise tenant ready: ${analystTenant.name}`)
    }

    // Assign PRO_PLAN to tenant for LLM access
    const proPlan = await prisma.plan.findFirst({
      where: { code: 'PRO_PLAN' }
    }) || await prisma.plan.findFirst({
      where: { code: 'FREE_PLAN' }
    })

    if (proPlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: analystTenant.id,
            planId: proPlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: analystTenant.id,
          planId: proPlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log(`✅ Assigned ${proPlan.code} to analyst tenant`)
    }

    // Clean up old ATI tokens for this tenant and create fresh one
    await prisma.aTIToken.deleteMany({
      where: { tenantId: analystTenant.id }
    })

    const analystRawToken = generateATIToken()
    const analystTokenHash = hashATIToken(analystRawToken)
    const analystFingerprint = createATIFingerprint(analystTokenHash)

    const analystToken = await prisma.aTIToken.create({
      data: {
        tenantId: analystTenant.id,
        tokenHash: analystTokenHash,
        rawToken: analystRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        fingerprint: analystFingerprint,
        status: 'ISSUED',
        planTier: proPlan?.code || 'FREE_PLAN',
        notes: 'Fixed Analyst Token',
        maxUses: 10
      }
    })

    // Update or create analyst user
    const analystPassword = 'AnalystPass123!'
    const analystPasswordHash = await bcrypt.hash(analystPassword, 12)

    const analyst = await prisma.user.upsert({
      where: { email: analystEmail },
      update: {
        tenantId: analystTenant.id,
        passwordHash: analystPasswordHash,
        name: 'Test Analyst',
        roles: ['ANALYST'],
        status: 'ACTIVE',
        signupAtiTokenId: analystToken.id
      },
      create: {
        tenantId: analystTenant.id,
        email: analystEmail,
        passwordHash: analystPasswordHash,
        name: 'Test Analyst',
        roles: ['ANALYST'],
        status: 'ACTIVE',
        signupAtiTokenId: analystToken.id
      }
    })

    console.log('✅ Analyst account fixed!')
    console.log(`   📧 ${analystEmail}`)
    console.log(`   🔑 ${analystPassword}`)
    console.log(`   🎫 ATI Token: ${analystRawToken}`)
    console.log(`   🏢 Tenant: ${analystTenant.name} (${analystTenant.atiId})`)
    console.log(`   👤 Roles: ${analyst.roles}`)
    console.log()

    // === PHASE 2: CREATE INDIVIDUAL ACCOUNT ===
    console.log('👤 PHASE 2: Creating individual@gmail.com account')
    console.log('=' .repeat(50))

    const individualEmail = 'individual@gmail.com'
    const individualPassword = 'Individual123!'
    const individualName = 'Individual User'

    // Create individual tenant
    const individualTenant = await prisma.tenant.upsert({
      where: { atiId: 'INDIVIDUAL_USER' },
      update: {
        name: 'Individual Account',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      },
      create: {
        name: 'Individual Account',
        atiId: 'INDIVIDUAL_USER',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }
    })

    console.log(`✅ Individual tenant created: ${individualTenant.name} (${individualTenant.type})`)

    // Assign FREE_PLAN to individual tenant
    const freePlan = await prisma.plan.findFirst({
      where: { code: 'FREE_PLAN' }
    }) || proPlan

    if (freePlan) {
      await prisma.tenantPlan.upsert({
        where: {
          tenantId_planId_effectiveFrom: {
            tenantId: individualTenant.id,
            planId: freePlan.id,
            effectiveFrom: new Date()
          }
        },
        update: {},
        create: {
          tenantId: individualTenant.id,
          planId: freePlan.id,
          effectiveFrom: new Date(),
          status: 'ACTIVE'
        }
      })
      console.log(`✅ Assigned ${freePlan.code} to individual tenant`)
    }

    // Create ATI token for individual
    const individualRawToken = generateATIToken()
    const individualTokenHash = hashATIToken(individualRawToken)
    const individualFingerprint = createATIFingerprint(individualTokenHash)

    const individualToken = await prisma.aTIToken.create({
      data: {
        tenantId: individualTenant.id,
        tokenHash: individualTokenHash,
        rawToken: individualRawToken,
        rawTokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        fingerprint: individualFingerprint,
        status: 'ISSUED',
        planTier: freePlan?.code || 'FREE_PLAN',
        notes: 'Individual User Onboarding Token',
        maxUses: 5
      }
    })

    // Create individual user (OWNER role for individual accounts)
    const individualPasswordHash = await bcrypt.hash(individualPassword, 12)

    const individual = await prisma.user.upsert({
      where: { email: individualEmail },
      update: {
        tenantId: individualTenant.id,
        passwordHash: individualPasswordHash,
        name: individualName,
        roles: ['OWNER'], // OWNER for individual accounts
        status: 'ACTIVE',
        signupAtiTokenId: individualToken.id
      },
      create: {
        tenantId: individualTenant.id,
        email: individualEmail,
        passwordHash: individualPasswordHash,
        name: individualName,
        roles: ['OWNER'], // OWNER for individual accounts
        status: 'ACTIVE',
        signupAtiTokenId: individualToken.id
      }
    })

    console.log('✅ Individual account created!')
    console.log(`   📧 ${individualEmail}`)
    console.log(`   🔑 ${individualPassword}`)
    console.log(`   🎫 ATI Token: ${individualRawToken}`)
    console.log(`   🏠 Tenant: ${individualTenant.name} (${individualTenant.atiId})`)
    console.log(`   👤 Roles: ${individual.roles} (OWNER for individual accounts)`)
    console.log()

    // === FINAL SUMMARY ===
    console.log('🎉 HIERARCHY FIX COMPLETE!')
    console.log('=' .repeat(60))
    console.log()
    console.log('👤 FIXED ANALYST ACCOUNT:')
    console.log(`   Login: ${analystEmail} / ${analystPassword}`)
    console.log(`   ATI Token: ${analystRawToken}`)
    console.log(`   Tenant: ${analystTenant.name} (${analystTenant.atiId})`)
    console.log(`   Type: ${analystTenant.type}`)
    console.log()
    console.log('👤 NEW INDIVIDUAL ACCOUNT:')
    console.log(`   Login: ${individualEmail} / ${individualPassword}`)
    console.log(`   ATI Token: ${individualRawToken}`)
    console.log(`   Tenant: ${individualTenant.name} (${individualTenant.atiId})`)
    console.log(`   Type: ${individualTenant.type} (Personal account)`)
    console.log()
    console.log('🚀 TEST THE SYSTEM:')
    console.log('1. Start server: npm run dev')
    console.log('2. Login as analyst: analyst@spotipr.com / AnalystPass123!')
    console.log('3. Login as individual: individual@gmail.com / Individual123!')
    console.log('4. Test all features with both account types')
    console.log()
    console.log('💡 Analyst has enterprise tenant with PRO_PLAN')
    console.log('💡 Individual has personal tenant with FREE_PLAN')

  } catch (error) {
    console.error('❌ Error fixing hierarchy:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  fixAnalystAndCreateIndividual()
}
