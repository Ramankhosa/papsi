/**
 * Seed Country Profiles to Database
 * 
 * This script populates the CountryProfile table from JSON files in Countries/.
 * Each country profile contains metadata, structure, validation rules, and export config.
 * 
 * Run with: node Seed/seed-country-profiles.js
 * 
 * Options:
 *   --country=IN    Seed specific country only
 *   --force         Overwrite existing profiles
 *   --dry-run       Show what would be done without making changes
 */

const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  country: null,
  force: false,
  dryRun: false
}

for (const arg of args) {
  if (arg.startsWith('--country=')) {
    options.country = arg.split('=')[1].toUpperCase()
  } else if (arg === '--force') {
    options.force = true
  } else if (arg === '--dry-run') {
    options.dryRun = true
  }
}

// Countries directory (relative to project root)
const countriesDir = path.join(__dirname, '..', 'Countries')

// System user ID for seeding
async function getSystemUserId() {
  const superAdmin = await prisma.user.findFirst({
    where: { roles: { has: 'SUPER_ADMIN' } }
  })
  
  if (superAdmin) return superAdmin.id
  
  const anyUser = await prisma.user.findFirst()
  if (anyUser) return anyUser.id
  
  console.log('⚠️  No users found in database. Using placeholder for createdBy.')
  return 'system-seed-user'
}

async function seedCountryProfiles() {
  console.log('=== Seeding Country Profiles to Database ===\n')
  console.log('Options:', options)
  console.log('Countries dir:', countriesDir)
  console.log('')

  try {
    const systemUserId = await getSystemUserId()
    console.log(`Using system user ID: ${systemUserId}\n`)

    // Get list of JSON files
    const files = fs.readdirSync(countriesDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && f !== 'sample.json')

    let totalCreated = 0
    let totalSkipped = 0
    let totalUpdated = 0
    const errors = []

    for (const file of files) {
      // Extract country code from filename
      let countryCode = file.replace('.json', '').toUpperCase()
      
      // Handle special cases
      if (countryCode === 'CANADA') countryCode = 'CA'
      
      // Skip if specific country requested and this isn't it
      if (options.country && options.country !== countryCode) {
        continue
      }

      console.log(`Processing ${file} as ${countryCode}...`)

      const filePath = path.join(countriesDir, file)
      let profileData
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        profileData = JSON.parse(content)
      } catch (err) {
        console.log(`  [ERROR] Failed to parse ${file}: ${err.message}`)
        errors.push({ country: countryCode, error: err.message })
        continue
      }

      // Extract name from profile data
      const name = profileData.meta?.name || countryCode

      // Check if profile already exists
      const existing = await prisma.countryProfile.findUnique({
        where: { countryCode }
      })

      if (existing && !options.force) {
        console.log(`  [SKIP] ${countryCode}: Already exists (use --force to overwrite)`)
        totalSkipped++
        continue
      }

      if (options.dryRun) {
        console.log(`  [DRY-RUN] Would ${existing ? 'update' : 'create'} ${countryCode}: ${name}`)
        if (existing) {
          totalUpdated++
        } else {
          totalCreated++
        }
        continue
      }

      try {
        if (existing) {
          // Update existing
          await prisma.countryProfile.update({
            where: { countryCode },
            data: {
              name,
              profileData,
              version: existing.version + 1,
              status: 'ACTIVE',
              updatedBy: systemUserId
            }
          })
          console.log(`  [UPDATE] ${countryCode}: ${name} (v${existing.version + 1})`)
          totalUpdated++
        } else {
          // Create new
          await prisma.countryProfile.create({
            data: {
              countryCode,
              name,
              profileData,
              version: 1,
              status: 'ACTIVE',
              createdBy: systemUserId
            }
          })
          console.log(`  [CREATE] ${countryCode}: ${name} (v1)`)
          totalCreated++
        }

        // Also upsert country name
        await prisma.countryName.upsert({
          where: { code: countryCode },
          create: {
            code: countryCode,
            name: name,
            continent: profileData.meta?.continent || 'Unknown'
          },
          update: {
            name: name,
            continent: profileData.meta?.continent || 'Unknown'
          }
        })

      } catch (err) {
        console.log(`  [ERROR] ${countryCode}: ${err.message}`)
        errors.push({ country: countryCode, error: err.message })
      }
    }

    // Summary
    console.log('\n=== Summary ===')
    console.log(`Created: ${totalCreated}`)
    console.log(`Updated: ${totalUpdated}`)
    console.log(`Skipped: ${totalSkipped}`)
    console.log(`Errors: ${errors.length}`)

    if (errors.length > 0) {
      console.log('\nErrors:')
      for (const err of errors) {
        console.log(`  - ${err.country}: ${err.error}`)
      }
    }

    if (options.dryRun) {
      console.log('\n[DRY-RUN] No changes were made to the database.')
    }

  } catch (error) {
    console.error('Fatal error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Verification function
async function verifyCountryProfiles() {
  console.log('\n=== Verifying Country Profiles ===\n')

  const profiles = await prisma.countryProfile.findMany({
    orderBy: { countryCode: 'asc' }
  })

  console.log('Code'.padEnd(8) + 'Name'.padEnd(25) + 'Version'.padEnd(10) + 'Status'.padEnd(10) + 'Sections')
  console.log('-'.repeat(80))

  for (const profile of profiles) {
    const sections = profile.profileData?.structure?.variants?.[0]?.sections?.length || 0
    console.log(
      profile.countryCode.padEnd(8) +
      (profile.name || 'N/A').substring(0, 23).padEnd(25) +
      `v${profile.version}`.padEnd(10) +
      profile.status.padEnd(10) +
      sections
    )
  }

  console.log(`\nTotal: ${profiles.length} profiles`)
}

// Run
if (require.main === module) {
  seedCountryProfiles()
    .then(async () => {
      await verifyCountryProfiles()
      console.log('\n=== Seeding Complete ===')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seeding failed:', error)
      process.exit(1)
    })
}

module.exports = { seedCountryProfiles, verifyCountryProfiles }

