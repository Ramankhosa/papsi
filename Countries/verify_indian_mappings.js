/**
 * Verify and Update Indian Section Mappings
 * 
 * This script checks and updates the CountrySectionMapping table
 * to ensure proper section_key values for India (IN).
 * 
 * Run with: node Countries/verify_indian_mappings.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Correct mapping of superset codes to section keys for India
const INDIA_SECTION_MAPPING = {
  '01. Title': { sectionKey: 'title', heading: 'Title of Invention' },
  '02. Preamble': { sectionKey: 'preamble', heading: '"The following specification particularly describes..."' },
  '03. Cross-Ref/Fed': { sectionKey: 'crossReference', heading: '(N/A)' },
  '04. Tech Field': { sectionKey: 'fieldOfInvention', heading: 'Field of Invention' },
  '05. Background': { sectionKey: 'background', heading: 'Background of the Invention' },
  '06. Objects': { sectionKey: 'objectsOfInvention', heading: 'Object(s) of the Invention' },
  '07. Summary (Gen)': { sectionKey: 'summary', heading: 'Summary of the Invention' },
  '07a. Tech Problem': { sectionKey: 'technicalProblem', heading: '(Implicit)' },
  '07b. Tech Solution': { sectionKey: 'technicalSolution', heading: '(Implicit)' },
  '07c. Effects': { sectionKey: 'advantageousEffects', heading: '(Implicit)' },
  '08. Drawings': { sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Accompanying Drawings' },
  '09. Detailed Desc': { sectionKey: 'detailedDescription', heading: 'Detailed Description of the Invention' },
  '10. Best Mode': { sectionKey: 'bestMethod', heading: '(Include in Detailed Desc)' },
  '11. Ind. Applicability': { sectionKey: 'industrialApplicability', heading: '(N/A)' },
  '12. Claims': { sectionKey: 'claims', heading: 'Claims' },
  '13. Abstract': { sectionKey: 'abstract', heading: 'Abstract' }
};

async function verifyAndUpdateIndiaMappings() {
  console.log('=== Verifying Indian Section Mappings ===\n');

  try {
    // Get current mappings for India
    const currentMappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: 'IN' },
      orderBy: { supersetCode: 'asc' }
    });

    console.log(`Found ${currentMappings.length} existing mappings for India\n`);

    // Display current mappings
    console.log('Current Mappings:');
    console.log('-'.repeat(100));
    console.log('Superset Code'.padEnd(25) + 'Section Key'.padEnd(30) + 'Heading');
    console.log('-'.repeat(100));
    
    for (const mapping of currentMappings) {
      console.log(
        mapping.supersetCode.padEnd(25) + 
        (mapping.sectionKey || '(missing)').padEnd(30) + 
        mapping.heading.substring(0, 45)
      );
    }

    console.log('\n=== Checking for Corrections ===\n');

    let updatesNeeded = [];
    let insertionsNeeded = [];

    // Check each expected mapping
    for (const [supersetCode, expected] of Object.entries(INDIA_SECTION_MAPPING)) {
      const existing = currentMappings.find(m => m.supersetCode === supersetCode);

      if (!existing) {
        console.log(`[MISSING] ${supersetCode} - will insert`);
        insertionsNeeded.push({
          countryCode: 'IN',
          supersetCode,
          sectionKey: expected.sectionKey,
          heading: expected.heading
        });
      } else if (existing.sectionKey !== expected.sectionKey) {
        console.log(`[UPDATE] ${supersetCode}: "${existing.sectionKey}" → "${expected.sectionKey}"`);
        updatesNeeded.push({
          id: existing.id,
          supersetCode,
          oldSectionKey: existing.sectionKey,
          newSectionKey: expected.sectionKey,
          heading: expected.heading
        });
      } else {
        console.log(`[OK] ${supersetCode}: ${existing.sectionKey}`);
      }
    }

    // Check for extra mappings that shouldn't exist
    for (const mapping of currentMappings) {
      if (!INDIA_SECTION_MAPPING[mapping.supersetCode]) {
        console.log(`[EXTRA] ${mapping.supersetCode} - unexpected mapping`);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Updates needed: ${updatesNeeded.length}`);
    console.log(`Insertions needed: ${insertionsNeeded.length}`);

    if (updatesNeeded.length > 0 || insertionsNeeded.length > 0) {
      console.log('\n=== Applying Changes ===\n');

      // Apply updates
      for (const update of updatesNeeded) {
        await prisma.countrySectionMapping.update({
          where: { id: update.id },
          data: { 
            sectionKey: update.newSectionKey,
            heading: update.heading
          }
        });
        console.log(`Updated ${update.supersetCode}: ${update.oldSectionKey} → ${update.newSectionKey}`);
      }

      // Apply insertions
      for (const insertion of insertionsNeeded) {
        await prisma.countrySectionMapping.create({
          data: insertion
        });
        console.log(`Inserted ${insertion.supersetCode}: ${insertion.sectionKey}`);
      }

      console.log('\n=== Changes Applied Successfully ===');
    } else {
      console.log('\nAll mappings are correct. No changes needed.');
    }

    // Final verification
    console.log('\n=== Final Verification ===\n');
    const finalMappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: 'IN' },
      orderBy: { supersetCode: 'asc' }
    });

    console.log('Final Mappings:');
    console.log('-'.repeat(100));
    console.log('Superset Code'.padEnd(25) + 'Section Key'.padEnd(30) + 'Heading');
    console.log('-'.repeat(100));
    
    for (const mapping of finalMappings) {
      const status = INDIA_SECTION_MAPPING[mapping.supersetCode]?.sectionKey === mapping.sectionKey ? '✓' : '✗';
      console.log(
        `${status} ${mapping.supersetCode.padEnd(23)} ${(mapping.sectionKey || '(missing)').padEnd(30)} ${mapping.heading.substring(0, 40)}`
      );
    }

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the verification
if (require.main === module) {
  verifyAndUpdateIndiaMappings()
    .then(() => {
      console.log('\n=== Verification Complete ===');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyAndUpdateIndiaMappings, INDIA_SECTION_MAPPING };

