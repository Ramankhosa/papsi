/**
 * Seed PCT Section Mappings
 * 
 * Creates CountrySectionMapping entries for PCT based on pct.json structure.
 * Run with: node Seed/seed-pct-mappings.js
 */

const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

// Map PCT section IDs to canonical superset keys
const PCT_TO_CANONICAL = {
  'title': 'title',
  'cross_reference': 'crossReference',
  'field': 'fieldOfInvention',
  'background': 'background',
  'summary': 'summary',
  'brief_drawings': 'briefDescriptionOfDrawings',
  'detailed_description': 'detailedDescription',
  'claims': 'claims',
  'abstract': 'abstract'
}

async function seedPCTMappings() {
  console.log('=== Seeding PCT Section Mappings ===\n')
  
  // Load PCT.json
  const pctPath = path.join(__dirname, '..', 'Countries', 'pct.json')
  const pctConfig = JSON.parse(fs.readFileSync(pctPath, 'utf-8'))
  
  // Get sections from structure
  const variant = pctConfig.structure?.variants?.[0]
  if (!variant?.sections) {
    console.log('No sections found in PCT.json')
    return
  }
  
  console.log(`Found ${variant.sections.length} sections in pct.json\n`)
  
  // Get export headings for labels
  const headings = pctConfig.export?.sectionHeadings || {}
  
  let created = 0
  let updated = 0
  let skipped = 0
  
  for (const section of variant.sections) {
    const pctId = section.id
    const canonical = PCT_TO_CANONICAL[pctId] || pctId
    const heading = headings[pctId] || section.label || canonical
    
    console.log(`Processing: ${pctId} → ${canonical}`)
    
    // Check if mapping exists
    const existing = await prisma.countrySectionMapping.findFirst({
      where: {
        countryCode: 'PCT',
        sectionKey: canonical
      }
    })
    
    if (existing) {
      // Update if needed
      if (existing.heading !== heading || existing.displayOrder !== section.order) {
        await prisma.countrySectionMapping.update({
          where: { id: existing.id },
          data: {
            heading,
            displayOrder: section.order,
            isRequired: section.required,
            isEnabled: true
          }
        })
        console.log(`  [UPDATE] ${canonical}: "${heading}" (order: ${section.order})`)
        updated++
      } else {
        console.log(`  [SKIP] ${canonical}: Already exists with correct data`)
        skipped++
      }
    } else {
      // Create new mapping
      await prisma.countrySectionMapping.create({
        data: {
          countryCode: 'PCT',
          supersetCode: `${String(section.order).padStart(2, '0')}. ${section.label}`,
          sectionKey: canonical,
          heading,
          displayOrder: section.order,
          isRequired: section.required,
          isEnabled: true
        }
      })
      console.log(`  [CREATE] ${canonical}: "${heading}" (order: ${section.order})`)
      created++
    }
  }
  
  console.log(`\n=== Summary ===`)
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
  
  // Verify
  const mappings = await prisma.countrySectionMapping.findMany({
    where: { countryCode: 'PCT' },
    orderBy: { displayOrder: 'asc' }
  })
  
  console.log(`\nPCT mappings (${mappings.length}):`)
  mappings.forEach(m => console.log(`  ${m.displayOrder}. ${m.sectionKey}: "${m.heading}"`))
  
  await prisma.$disconnect()
}

seedPCTMappings().catch(console.error)

