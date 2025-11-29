/**
 * Master Seed Script - Run All Seeds in Correct Order
 * 
 * This script runs all seed scripts in the required order for production deployment.
 * 
 * Run with: node Seed/seed-all.js
 * 
 * Options:
 *   --force     Overwrite all existing data
 *   --dry-run   Show what would be done without making changes
 */

const { execSync } = require('child_process')
const path = require('path')

// Parse command line arguments
const args = process.argv.slice(2)
const force = args.includes('--force') ? '--force' : ''
const dryRun = args.includes('--dry-run') ? '--dry-run' : ''

const options = [force, dryRun].filter(Boolean).join(' ')

console.log('╔════════════════════════════════════════════════════════════════╗')
console.log('║           🌱 PRODUCTION SEED SCRIPT                            ║')
console.log('║     Multi-Country Patent Filing System Database Setup          ║')
console.log('╚════════════════════════════════════════════════════════════════╝')
console.log('')
console.log(`Options: ${options || '(none)'}`)
console.log('')

const seedDir = __dirname

// Seed scripts in execution order
const seedScripts = [
  {
    name: '1. Superset Sections',
    desc: 'Foundation patent sections (15 universal sections)',
    script: 'seed-superset-sections.js'
  },
  {
    name: '2. Country Profiles',
    desc: 'Country configurations from JSON files',
    script: 'seed-country-profiles.js'
  },
  {
    name: '3. Section Prompts',
    desc: 'Country-specific top-up prompts',
    script: 'seed-section-prompts.js'
  }
]

function runSeed(scriptPath, name) {
  console.log('─'.repeat(70))
  console.log(`▶ Running: ${name}`)
  console.log('─'.repeat(70))
  
  try {
    execSync(`node "${scriptPath}" ${options}`, { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    })
    console.log(`✅ ${name} completed successfully\n`)
    return true
  } catch (error) {
    console.error(`❌ ${name} failed: ${error.message}\n`)
    return false
  }
}

async function main() {
  let success = true
  const results = []

  for (const { name, desc, script } of seedScripts) {
    console.log(`\n📦 ${name}`)
    console.log(`   ${desc}`)
    
    const scriptPath = path.join(seedDir, script)
    const passed = runSeed(scriptPath, name)
    results.push({ name, passed })
    
    if (!passed) {
      success = false
      console.log('⚠️  Continuing with remaining seeds...')
    }
  }

  // Final Summary
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║                    🏁 SEEDING SUMMARY                          ║')
  console.log('╠════════════════════════════════════════════════════════════════╣')
  
  for (const { name, passed } of results) {
    const status = passed ? '✅ PASS' : '❌ FAIL'
    console.log(`║  ${status}  ${name.padEnd(50)} ║`)
  }
  
  console.log('╚════════════════════════════════════════════════════════════════╝')
  console.log('')

  if (success) {
    console.log('🎉 All seeds completed successfully!')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Start the server: npm run dev')
    console.log('  2. Login as superadmin@spotipr.com / SuperSecure123!')
    console.log('  3. Visit /super-admin/jurisdiction-config to verify data')
    console.log('')
  } else {
    console.log('⚠️  Some seeds failed. Check the errors above.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

