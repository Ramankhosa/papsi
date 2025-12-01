/**
 * Seed Country Section Mappings
 * 
 * This script populates the CountrySectionMapping table with jurisdiction-specific
 * section configurations. Each jurisdiction may have different sections enabled,
 * different headings, and different display orders.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Section mappings by country
// Based on patent office requirements for each jurisdiction
const COUNTRY_MAPPINGS = {
  // Indian Patent Office
  IN: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of the Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Field of the Invention', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Objects of Invention', sectionKey: 'objectsOfInvention', heading: 'Object(s) of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of the Invention', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 9, isRequired: true }
  ],
  
  // United States Patent and Trademark Office (USPTO)
  US: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Cross-Reference', sectionKey: 'crossReference', heading: 'Cross-Reference to Related Applications', displayOrder: 2, isRequired: false },
    { supersetCode: '03. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of Preferred Embodiments', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Abstract', sectionKey: 'abstract', heading: 'Abstract of the Disclosure', displayOrder: 9, isRequired: true }
  ],
  
  // European Patent Office (EPO)
  EP: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Technical Problem', sectionKey: 'technicalProblem', heading: 'Technical Problem', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Technical Solution', sectionKey: 'technicalSolution', heading: 'Technical Solution', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Advantageous Effects', sectionKey: 'advantageousEffects', heading: 'Advantageous Effects', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 7, isRequired: false },
    { supersetCode: '08. Detailed Description', sectionKey: 'detailedDescription', heading: 'Description of Embodiments', displayOrder: 8, isRequired: true },
    { supersetCode: '09. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 9, isRequired: true },
    { supersetCode: '10. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 10, isRequired: true }
  ],
  
  // PCT (International Application)
  PCT: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title of Invention', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Technical Problem', sectionKey: 'technicalProblem', heading: 'Technical Problem', displayOrder: 4, isRequired: false },
    { supersetCode: '05. Summary', sectionKey: 'summary', heading: 'Summary of Invention', displayOrder: 5, isRequired: true },
    { supersetCode: '06. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 6, isRequired: false },
    { supersetCode: '07. Detailed Description', sectionKey: 'detailedDescription', heading: 'Description of Embodiments', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Industrial Applicability', sectionKey: 'industrialApplicability', heading: 'Industrial Applicability', displayOrder: 8, isRequired: false },
    { supersetCode: '09. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 9, isRequired: true },
    { supersetCode: '10. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 10, isRequired: true }
  ],
  
  // Canadian Intellectual Property Office (CIPO)
  CA: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Field of the Invention', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background of the Invention', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Summary', sectionKey: 'summary', heading: 'Summary of the Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of the Drawings', displayOrder: 5, isRequired: false },
    { supersetCode: '06. Detailed Description', sectionKey: 'detailedDescription', heading: 'Detailed Description of the Preferred Embodiments', displayOrder: 6, isRequired: true },
    { supersetCode: '07. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 8, isRequired: true }
  ],
  
  // IP Australia
  AU: [
    { supersetCode: '01. Title', sectionKey: 'title', heading: 'Title', displayOrder: 1, isRequired: true },
    { supersetCode: '02. Field of Invention', sectionKey: 'fieldOfInvention', heading: 'Technical Field', displayOrder: 2, isRequired: true },
    { supersetCode: '03. Background', sectionKey: 'background', heading: 'Background Art', displayOrder: 3, isRequired: true },
    { supersetCode: '04. Summary', sectionKey: 'summary', heading: 'Summary of Invention', displayOrder: 4, isRequired: true },
    { supersetCode: '05. Brief Description of Drawings', sectionKey: 'briefDescriptionOfDrawings', heading: 'Brief Description of Drawings', displayOrder: 5, isRequired: false },
    { supersetCode: '06. Best Method', sectionKey: 'bestMethod', heading: 'Best Method of Performing the Invention', displayOrder: 6, isRequired: true },
    { supersetCode: '07. Claims', sectionKey: 'claims', heading: 'Claims', displayOrder: 7, isRequired: true },
    { supersetCode: '08. Abstract', sectionKey: 'abstract', heading: 'Abstract', displayOrder: 8, isRequired: true }
  ]
};

async function seedCountrySectionMappings() {
  console.log('🌍 Seeding Country Section Mappings...\n');
  
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  
  for (const [countryCode, sections] of Object.entries(COUNTRY_MAPPINGS)) {
    console.log(`📋 Processing ${countryCode}...`);
    
    for (const section of sections) {
      try {
        // Check if mapping already exists
        const existing = await prisma.countrySectionMapping.findUnique({
          where: {
            countryCode_sectionKey: {
              countryCode,
              sectionKey: section.sectionKey
            }
          }
        });
        
        if (existing) {
          // Update existing
          await prisma.countrySectionMapping.update({
            where: { id: existing.id },
            data: {
              supersetCode: section.supersetCode,
              heading: section.heading,
              displayOrder: section.displayOrder,
              isRequired: section.isRequired,
              isEnabled: true
            }
          });
          totalUpdated++;
          console.log(`   ✏️  Updated: ${section.sectionKey} -> ${section.heading}`);
        } else {
          // Create new
          await prisma.countrySectionMapping.create({
            data: {
              countryCode,
              supersetCode: section.supersetCode,
              sectionKey: section.sectionKey,
              heading: section.heading,
              displayOrder: section.displayOrder,
              isRequired: section.isRequired,
              isEnabled: true
            }
          });
          totalCreated++;
          console.log(`   ✅ Created: ${section.sectionKey} -> ${section.heading}`);
        }
      } catch (error) {
        console.log(`   ⚠️  Skipped ${section.sectionKey}: ${error.message}`);
        totalSkipped++;
      }
    }
    console.log('');
  }
  
  console.log('═══════════════════════════════════════════════════');
  console.log(`✅ Created: ${totalCreated}`);
  console.log(`✏️  Updated: ${totalUpdated}`);
  console.log(`⚠️  Skipped: ${totalSkipped}`);
  console.log('═══════════════════════════════════════════════════');
}

async function main() {
  try {
    await seedCountrySectionMappings();
    console.log('\n🎉 Country section mappings seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding country section mappings:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();

