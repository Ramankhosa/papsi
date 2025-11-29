/**
 * Seed Section Prompts to Database
 * 
 * This script migrates top-up prompts from JSON files to the database.
 * Run with: node Countries/seed_section_prompts.js
 * 
 * Options:
 *   --country=IN    Seed specific country only
 *   --force         Overwrite existing prompts
 *   --dry-run       Show what would be done without making changes
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  country: null,
  force: false,
  dryRun: false
};

for (const arg of args) {
  if (arg.startsWith('--country=')) {
    options.country = arg.split('=')[1].toUpperCase();
  } else if (arg === '--force') {
    options.force = true;
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
}

// Countries directory
const countriesDir = path.join(__dirname);

async function seedSectionPrompts() {
  console.log('=== Seeding Section Prompts to Database ===\n');
  console.log('Options:', options);
  console.log('');

  try {
    // Get list of JSON files
    const files = fs.readdirSync(countriesDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('TEMPLATE') && f !== 'sample.json');

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalUpdated = 0;
    const errors = [];

    for (const file of files) {
      const countryCode = file.replace('.json', '').toUpperCase();
      
      // Skip if specific country requested and this isn't it
      if (options.country && options.country !== countryCode) {
        continue;
      }

      console.log(`\nProcessing ${countryCode}...`);

      const filePath = path.join(countriesDir, file);
      let profile;
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        profile = JSON.parse(content);
      } catch (err) {
        console.log(`  [ERROR] Failed to parse ${file}: ${err.message}`);
        errors.push({ country: countryCode, error: err.message });
        continue;
      }

      const sections = profile.prompts?.sections || {};
      
      for (const [sectionKey, config] of Object.entries(sections)) {
        // Extract topUp or legacy format
        const topUp = config.topUp || config;
        
        if (!topUp?.instruction) {
          console.log(`  [SKIP] ${sectionKey}: No instruction found`);
          totalSkipped++;
          continue;
        }

        // Check if prompt already exists
        const existing = await prisma.countrySectionPrompt.findFirst({
          where: {
            countryCode: countryCode,
            sectionKey: sectionKey
          }
        });

        if (existing && !options.force) {
          console.log(`  [SKIP] ${sectionKey}: Already exists (use --force to overwrite)`);
          totalSkipped++;
          continue;
        }

        const promptData = {
          countryCode: countryCode,
          sectionKey: sectionKey,
          instruction: topUp.instruction,
          constraints: topUp.constraints || [],
          additions: topUp.additions || [],
          version: existing ? existing.version + 1 : 1,
          status: 'ACTIVE',
          createdBy: 'system:seed',
          updatedBy: existing ? 'system:seed' : null
        };

        if (options.dryRun) {
          console.log(`  [DRY-RUN] Would ${existing ? 'update' : 'create'} ${sectionKey}`);
          if (existing) {
            totalUpdated++;
          } else {
            totalCreated++;
          }
          continue;
        }

        try {
          if (existing) {
            // Update existing
            await prisma.countrySectionPrompt.update({
              where: { id: existing.id },
              data: promptData
            });

            // Create history entry
            await prisma.countrySectionPromptHistory.create({
              data: {
                promptId: existing.id,
                countryCode: countryCode,
                sectionKey: sectionKey,
                instruction: promptData.instruction,
                constraints: promptData.constraints,
                additions: promptData.additions,
                version: promptData.version,
                changeType: 'UPDATE',
                changeReason: 'Seed from JSON file',
                changedBy: 'system:seed'
              }
            });

            console.log(`  [UPDATE] ${sectionKey}: v${promptData.version}`);
            totalUpdated++;
          } else {
            // Create new
            const created = await prisma.countrySectionPrompt.create({
              data: promptData
            });

            // Create history entry
            await prisma.countrySectionPromptHistory.create({
              data: {
                promptId: created.id,
                countryCode: countryCode,
                sectionKey: sectionKey,
                instruction: promptData.instruction,
                constraints: promptData.constraints,
                additions: promptData.additions,
                version: 1,
                changeType: 'CREATE',
                changeReason: 'Initial seed from JSON file',
                changedBy: 'system:seed'
              }
            });

            console.log(`  [CREATE] ${sectionKey}: v1`);
            totalCreated++;
          }
        } catch (err) {
          console.log(`  [ERROR] ${sectionKey}: ${err.message}`);
          errors.push({ country: countryCode, section: sectionKey, error: err.message });
        }
      }
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Created: ${totalCreated}`);
    console.log(`Updated: ${totalUpdated}`);
    console.log(`Skipped: ${totalSkipped}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      for (const err of errors) {
        console.log(`  - ${err.country}${err.section ? '/' + err.section : ''}: ${err.error}`);
      }
    }

    if (options.dryRun) {
      console.log('\n[DRY-RUN] No changes were made to the database.');
    }

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Verification function
async function verifySectionPrompts(countryCode) {
  console.log(`\n=== Verifying ${countryCode} Section Prompts ===\n`);

  const prompts = await prisma.countrySectionPrompt.findMany({
    where: { countryCode: countryCode },
    orderBy: { sectionKey: 'asc' }
  });

  console.log('Section Key'.padEnd(30) + 'Version'.padEnd(10) + 'Status'.padEnd(10) + 'Instruction (preview)');
  console.log('-'.repeat(100));

  for (const prompt of prompts) {
    const preview = prompt.instruction.substring(0, 40).replace(/\n/g, ' ') + '...';
    console.log(
      prompt.sectionKey.padEnd(30) +
      `v${prompt.version}`.padEnd(10) +
      prompt.status.padEnd(10) +
      preview
    );
  }

  console.log(`\nTotal: ${prompts.length} prompts`);
}

// Run
if (require.main === module) {
  seedSectionPrompts()
    .then(async () => {
      if (options.country) {
        await verifySectionPrompts(options.country);
      }
      console.log('\n=== Seeding Complete ===');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedSectionPrompts, verifySectionPrompts };

