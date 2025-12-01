/**
 * Jurisdiction Style Seeder
 * 
 * Seeds diagram configs, export configs, section validations, and cross-validations
 * from country JSON files into the database.
 * 
 * Usage:
 *   npx ts-node Seed/seed-jurisdiction-styles.ts
 *   npx ts-node Seed/seed-jurisdiction-styles.ts --country=IN
 *   npx ts-node Seed/seed-jurisdiction-styles.ts --dry-run
 *   npx ts-node Seed/seed-jurisdiction-styles.ts --export-only
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const prisma = new PrismaClient()

// Configuration
const COUNTRIES_DIR = path.join(__dirname, '..', 'Countries')
const SYSTEM_USER_ID = 'system-seeder'

// Parse command line args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const specificCountry = args.find(a => a.startsWith('--country='))?.split('=')[1]
const exportOnly = args.includes('--export-only')
const diagramOnly = args.includes('--diagram-only')
const validationOnly = args.includes('--validation-only')

interface ImportStats {
  countryCode: string
  diagramConfigs: { created: number; updated: number; skipped: number }
  diagramHints: { created: number; updated: number; skipped: number }
  exportConfigs: { created: number; updated: number; skipped: number }
  exportHeadings: { created: number; updated: number; skipped: number }
  sectionValidations: { created: number; updated: number; skipped: number }
  crossValidations: { created: number; updated: number; skipped: number }
  errors: string[]
}

function initStats(countryCode: string): ImportStats {
  return {
    countryCode,
    diagramConfigs: { created: 0, updated: 0, skipped: 0 },
    diagramHints: { created: 0, updated: 0, skipped: 0 },
    exportConfigs: { created: 0, updated: 0, skipped: 0 },
    exportHeadings: { created: 0, updated: 0, skipped: 0 },
    sectionValidations: { created: 0, updated: 0, skipped: 0 },
    crossValidations: { created: 0, updated: 0, skipped: 0 },
    errors: []
  }
}

/**
 * Load and parse a country JSON file
 */
function loadCountryJson(filename: string): any | null {
  const filepath = path.join(COUNTRIES_DIR, filename)
  try {
    const content = fs.readFileSync(filepath, 'utf-8')
    return JSON.parse(content)
  } catch (error: any) {
    console.error(`Error loading ${filename}: ${error.message}`)
    return null
  }
}

/**
 * Seed diagram configuration for a country
 */
async function seedDiagramConfig(countryCode: string, diagrams: any, rules: any, stats: ImportStats) {
  if (!diagrams) {
    console.log(`  [SKIP] No diagrams config for ${countryCode}`)
    stats.diagramConfigs.skipped++
    return null
  }

  const drawingRules = rules?.drawings || {}
  
  const configData = {
    countryCode,
    requiredWhenApplicable: diagrams.requiredWhenApplicable ?? true,
    supportedDiagramTypes: diagrams.supportedDiagramTypes || ['block', 'flowchart', 'schematic'],
    figureLabelFormat: diagrams.figureLabelFormat || 'Fig. {number}',
    autoGenerateReferenceTable: diagrams.autoGenerateReferenceTable ?? true,
    
    // Drawing rules
    paperSize: drawingRules.paperSize || 'A4',
    colorAllowed: drawingRules.colorAllowed ?? false,
    colorUsageNote: drawingRules.colorUsageNote || null,
    lineStyle: drawingRules.lineStyle || 'black_and_white_solid',
    referenceNumeralsMandatory: drawingRules.referenceNumeralsMandatoryWhenDrawings ?? true,
    minReferenceTextSizePt: drawingRules.minReferenceTextSizePt || 8,
    
    // Drawing margins
    drawingMarginTopCm: drawingRules.marginTopCm || 2.5,
    drawingMarginBottomCm: drawingRules.marginBottomCm || 1.0,
    drawingMarginLeftCm: drawingRules.marginLeftCm || 2.5,
    drawingMarginRightCm: drawingRules.marginRightCm || 1.5,
    
    // Defaults
    defaultDiagramCount: 4,
    maxDiagramsRecommended: 10,
    
    version: 1,
    status: 'ACTIVE' as const,
    createdBy: SYSTEM_USER_ID,
    updatedBy: SYSTEM_USER_ID
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] Would upsert DiagramConfig for ${countryCode}`)
    stats.diagramConfigs.created++
    return { id: 'dry-run-id' }
  }

  const existing = await prisma.countryDiagramConfig.findUnique({
    where: { countryCode }
  })

  const result = await prisma.countryDiagramConfig.upsert({
    where: { countryCode },
    create: configData,
    update: { 
      ...configData, 
      version: existing ? existing.version + 1 : 1 
    }
  })

  if (existing) {
    stats.diagramConfigs.updated++
    console.log(`  [UPDATE] DiagramConfig for ${countryCode}`)
  } else {
    stats.diagramConfigs.created++
    console.log(`  [CREATE] DiagramConfig for ${countryCode}`)
  }

  return result
}

/**
 * Seed diagram hints for a country
 */
async function seedDiagramHints(configId: string, countryCode: string, hints: Record<string, string>, stats: ImportStats) {
  if (!hints || Object.keys(hints).length === 0) {
    console.log(`  [SKIP] No diagram hints for ${countryCode}`)
    return
  }

  for (const [diagramType, hint] of Object.entries(hints)) {
    if (dryRun) {
      console.log(`  [DRY-RUN] Would upsert DiagramHint: ${countryCode}/${diagramType}`)
      stats.diagramHints.created++
      continue
    }

    const existing = await prisma.countryDiagramHint.findUnique({
      where: {
        configId_diagramType: { configId, diagramType }
      }
    })

    await prisma.countryDiagramHint.upsert({
      where: {
        configId_diagramType: { configId, diagramType }
      },
      create: {
        configId,
        diagramType,
        hint,
        preferredSyntax: 'plantuml',
        requireLabels: true
      },
      update: {
        hint
      }
    })

    if (existing) {
      stats.diagramHints.updated++
    } else {
      stats.diagramHints.created++
    }
  }

  console.log(`  [HINTS] ${Object.keys(hints).length} diagram hints processed for ${countryCode}`)
}

/**
 * Seed export configuration for a country
 */
async function seedExportConfig(countryCode: string, exportData: any, stats: ImportStats) {
  if (!exportData?.documentTypes || !Array.isArray(exportData.documentTypes)) {
    console.log(`  [SKIP] No export documentTypes for ${countryCode}`)
    stats.exportConfigs.skipped++
    return []
  }

  const results = []

  for (const docType of exportData.documentTypes) {
    const configData = {
      countryCode,
      documentTypeId: docType.id || 'spec_pdf',
      label: docType.label || `${countryCode} Specification`,
      description: docType.description || null,
      
      // Page layout
      pageSize: docType.pageSize || 'A4',
      marginTopCm: docType.marginTopCm || 2.5,
      marginBottomCm: docType.marginBottomCm || 2.0,
      marginLeftCm: docType.marginLeftCm || 2.5,
      marginRightCm: docType.marginRightCm || 2.0,
      
      // Typography
      fontFamily: docType.fontFamily || 'Times New Roman',
      fontSizePt: docType.fontSizePt || 12,
      lineSpacing: docType.lineSpacing || 1.5,
      
      // Document options
      addPageNumbers: docType.addPageNumbers ?? true,
      addParagraphNumbers: docType.addParagraphNumbers ?? false,
      pageNumberFormat: 'Page {page} of {total}',
      pageNumberPosition: 'header-right',
      
      // Sections
      includesSections: docType.includesSections || [],
      sectionOrder: [],
      
      version: 1,
      status: 'ACTIVE' as const,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Would upsert ExportConfig: ${countryCode}/${docType.id}`)
      stats.exportConfigs.created++
      results.push({ id: 'dry-run-id', documentTypeId: docType.id })
      continue
    }

    const existing = await prisma.countryExportConfig.findUnique({
      where: {
        countryCode_documentTypeId: { countryCode, documentTypeId: configData.documentTypeId }
      }
    })

    const result = await prisma.countryExportConfig.upsert({
      where: {
        countryCode_documentTypeId: { countryCode, documentTypeId: configData.documentTypeId }
      },
      create: configData,
      update: {
        ...configData,
        version: existing ? existing.version + 1 : 1
      }
    })

    if (existing) {
      stats.exportConfigs.updated++
    } else {
      stats.exportConfigs.created++
    }

    results.push(result)
  }

  console.log(`  [EXPORT] ${results.length} export configs processed for ${countryCode}`)
  return results
}

/**
 * Seed export section headings
 */
async function seedExportHeadings(
  exportConfigId: string, 
  countryCode: string, 
  headings: Record<string, string>, 
  stats: ImportStats
) {
  if (!headings || Object.keys(headings).length === 0) {
    return
  }

  for (const [sectionKey, heading] of Object.entries(headings)) {
    if (dryRun) {
      stats.exportHeadings.created++
      continue
    }

    const existing = await prisma.countryExportHeading.findUnique({
      where: {
        exportConfigId_sectionKey: { exportConfigId, sectionKey }
      }
    })

    await prisma.countryExportHeading.upsert({
      where: {
        exportConfigId_sectionKey: { exportConfigId, sectionKey }
      },
      create: {
        exportConfigId,
        sectionKey,
        heading,
        style: heading === heading.toUpperCase() ? 'uppercase' : 'titlecase'
      },
      update: {
        heading,
        style: heading === heading.toUpperCase() ? 'uppercase' : 'titlecase'
      }
    })

    if (existing) {
      stats.exportHeadings.updated++
    } else {
      stats.exportHeadings.created++
    }
  }

  console.log(`  [HEADINGS] ${Object.keys(headings).length} section headings for ${countryCode}`)
}

/**
 * Seed section validation rules
 */
async function seedSectionValidations(countryCode: string, validation: any, rules: any, stats: ImportStats) {
  if (!validation?.sectionChecks) {
    console.log(`  [SKIP] No sectionChecks for ${countryCode}`)
    return
  }

  const sectionChecks = validation.sectionChecks

  for (const [sectionKey, checks] of Object.entries(sectionChecks)) {
    if (!Array.isArray(checks) || checks.length === 0) continue

    // Aggregate all checks for this section
    const validationData: any = {
      countryCode,
      sectionKey,
      version: 1,
      status: 'ACTIVE',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
      additionalRules: {}
    }

    for (const check of checks as any[]) {
      switch (check.type) {
        case 'maxWords':
          validationData.maxWords = check.limit
          validationData.wordLimitSeverity = check.severity
          validationData.wordLimitMessage = check.message
          break
        case 'minWords':
          validationData.minWords = check.limit
          break
        case 'maxChars':
          validationData.maxChars = check.limit
          validationData.charLimitSeverity = check.severity
          validationData.charLimitMessage = check.message
          break
        case 'minChars':
          validationData.minChars = check.limit
          break
        case 'maxCount':
          validationData.maxCount = check.limit
          validationData.countLimitSeverity = check.severity
          validationData.countLimitMessage = check.message
          break
      }

      // Extract legal reference from message if present
      const legalMatch = check.message?.match(/(?:under|per|as per|pursuant to)\s+([^.]+)/i)
      if (legalMatch) {
        validationData.legalReference = legalMatch[1].trim()
      }
    }

    // Get additional rules from rules section
    const rulesSection = rules?.[sectionKey === 'abstract' ? 'abstract' : sectionKey === 'claims' ? 'claims' : 'description']
    if (rulesSection) {
      if (rulesSection.wordLimit) validationData.maxWords = validationData.maxWords || rulesSection.wordLimit
      if (rulesSection.maxIndependentClaimsBeforeExtraFee) {
        validationData.maxIndependent = rulesSection.maxIndependentClaimsBeforeExtraFee
        validationData.countBeforeExtraFee = rulesSection.maxTotalClaimsRecommended
      }
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Would upsert SectionValidation: ${countryCode}/${sectionKey}`)
      stats.sectionValidations.created++
      continue
    }

    const existing = await prisma.countrySectionValidation.findUnique({
      where: {
        countryCode_sectionKey: { countryCode, sectionKey }
      }
    })

    await prisma.countrySectionValidation.upsert({
      where: {
        countryCode_sectionKey: { countryCode, sectionKey }
      },
      create: validationData,
      update: {
        ...validationData,
        version: existing ? existing.version + 1 : 1
      }
    })

    if (existing) {
      stats.sectionValidations.updated++
    } else {
      stats.sectionValidations.created++
    }
  }

  console.log(`  [VALIDATION] ${Object.keys(sectionChecks).length} section validations for ${countryCode}`)
}

/**
 * Seed cross-section validation checks (for AI reviewer)
 */
async function seedCrossValidations(countryCode: string, validation: any, stats: ImportStats) {
  if (!validation?.crossSectionChecks || !Array.isArray(validation.crossSectionChecks)) {
    console.log(`  [SKIP] No crossSectionChecks for ${countryCode}`)
    return
  }

  for (const check of validation.crossSectionChecks) {
    const checkId = check.id || `${check.type}_${check.from}`
    
    // Determine target sections
    const toSections = check.mustBeSupportedBy || check.mustBeConsistentWith || check.mustBeShownIn || []

    const validationData = {
      countryCode,
      checkId,
      checkType: check.type, // "support", "consistency", etc.
      fromSection: check.from,
      toSections,
      severity: check.severity || 'warning',
      message: check.message,
      reviewPrompt: generateReviewPrompt(check),
      legalBasis: extractLegalBasis(check.message),
      checkParams: {},
      isEnabled: true,
      version: 1
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] Would upsert CrossValidation: ${countryCode}/${checkId}`)
      stats.crossValidations.created++
      continue
    }

    const existing = await prisma.countryCrossValidation.findUnique({
      where: {
        countryCode_checkId: { countryCode, checkId }
      }
    })

    await prisma.countryCrossValidation.upsert({
      where: {
        countryCode_checkId: { countryCode, checkId }
      },
      create: validationData,
      update: {
        ...validationData,
        version: existing ? existing.version + 1 : 1
      }
    })

    if (existing) {
      stats.crossValidations.updated++
    } else {
      stats.crossValidations.created++
    }
  }

  console.log(`  [CROSS-VAL] ${validation.crossSectionChecks.length} cross-validations for ${countryCode}`)
}

/**
 * Generate AI reviewer prompt from check definition
 */
function generateReviewPrompt(check: any): string {
  const type = check.type
  const from = check.from
  const to = check.mustBeSupportedBy || check.mustBeConsistentWith || []

  switch (type) {
    case 'support':
      return `Review whether all technical elements and features mentioned in the "${from}" section are adequately supported and described in the ${to.join(', ')} section(s). Flag any claim elements that lack corresponding description or enablement.`
    case 'consistency':
      return `Check for consistency between the "${from}" section and the ${to.join(', ')} section(s). Ensure terminology, feature descriptions, and scope are aligned and not contradictory.`
    case 'reference':
      return `Verify that all reference numerals and figure references in the "${from}" section are properly explained and defined in the ${to.join(', ')} section(s).`
    default:
      return `Review the relationship between "${from}" and ${to.join(', ')} sections for compliance.`
  }
}

/**
 * Extract legal basis from message
 */
function extractLegalBasis(message?: string): string | null {
  if (!message) return null
  
  const patterns = [
    /(?:under|per|as per|pursuant to|required by|as required by)\s+([^.]+)/i,
    /\b(Section\s+\d+(?:\([^)]+\))?[^.]*)/i,
    /\b(\d+\s+CFR\s+\d+\.\d+[^.]*)/i,
    /\b(Rule\s+\d+(?:\([^)]+\))?[^.]*)/i,
    /\b(Article\s+\d+[^.]*)/i
  ]

  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match) return match[1].trim()
  }

  return null
}

/**
 * Process a single country JSON file
 */
async function processCountry(filename: string): Promise<ImportStats | null> {
  const countryCode = path.basename(filename, '.json').toUpperCase()
  
  // Skip template and backup files
  if (filename.includes('TEMPLATE') || filename.includes('backup') || filename.includes('test')) {
    console.log(`Skipping ${filename} (template/test file)`)
    return null
  }

  console.log(`\nProcessing ${countryCode} from ${filename}...`)
  
  const json = loadCountryJson(filename)
  if (!json) {
    console.error(`  Failed to load ${filename}`)
    return null
  }

  // Validate it's a country profile
  if (!json.meta?.code) {
    console.log(`  [SKIP] ${filename} doesn't appear to be a valid country profile`)
    return null
  }

  const stats = initStats(countryCode)

  try {
    // Seed diagram config (unless export-only mode)
    if (!exportOnly && !validationOnly) {
      const diagramConfig = await seedDiagramConfig(countryCode, json.diagrams, json.rules, stats)
      if (diagramConfig && json.diagrams?.diagramGenerationHints) {
        await seedDiagramHints(diagramConfig.id, countryCode, json.diagrams.diagramGenerationHints, stats)
      }
    }

    // Seed export config (unless diagram-only or validation-only mode)
    if (!diagramOnly && !validationOnly) {
      const exportConfigs = await seedExportConfig(countryCode, json.export, stats)
      
      // Seed section headings for each export config
      if (json.export?.sectionHeadings && exportConfigs.length > 0) {
        for (const config of exportConfigs) {
          await seedExportHeadings(config.id, countryCode, json.export.sectionHeadings, stats)
        }
      }
    }

    // Seed validation rules (unless diagram-only or export-only mode)
    if (!diagramOnly && !exportOnly) {
      await seedSectionValidations(countryCode, json.validation, json.rules, stats)
      await seedCrossValidations(countryCode, json.validation, stats)
    }

  } catch (error: any) {
    stats.errors.push(error.message)
    console.error(`  [ERROR] ${error.message}`)
  }

  return stats
}

/**
 * Main seeder function
 */
async function main() {
  console.log('='.repeat(60))
  console.log('Jurisdiction Style Seeder')
  console.log('='.repeat(60))
  
  if (dryRun) {
    console.log('\n*** DRY RUN MODE - No changes will be made ***\n')
  }
  if (specificCountry) {
    console.log(`\n*** Processing only: ${specificCountry} ***\n`)
  }
  if (exportOnly) console.log('*** Export configs only ***')
  if (diagramOnly) console.log('*** Diagram configs only ***')
  if (validationOnly) console.log('*** Validation configs only ***')

  // Get list of country JSON files
  const files = fs.readdirSync(COUNTRIES_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !specificCountry || f.toLowerCase().includes(specificCountry.toLowerCase()))

  console.log(`\nFound ${files.length} country JSON files`)

  const allStats: ImportStats[] = []

  for (const file of files) {
    const stats = await processCountry(file)
    if (stats) allStats.push(stats)
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  
  let totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0

  for (const s of allStats) {
    const created = s.diagramConfigs.created + s.diagramHints.created + 
                   s.exportConfigs.created + s.exportHeadings.created +
                   s.sectionValidations.created + s.crossValidations.created
    const updated = s.diagramConfigs.updated + s.diagramHints.updated +
                   s.exportConfigs.updated + s.exportHeadings.updated +
                   s.sectionValidations.updated + s.crossValidations.updated
    const skipped = s.diagramConfigs.skipped + s.exportConfigs.skipped

    totalCreated += created
    totalUpdated += updated
    totalSkipped += skipped
    totalErrors += s.errors.length

    console.log(`${s.countryCode}: Created ${created}, Updated ${updated}, Skipped ${skipped}${s.errors.length ? `, Errors ${s.errors.length}` : ''}`)
  }

  console.log('-'.repeat(60))
  console.log(`TOTAL: Created ${totalCreated}, Updated ${totalUpdated}, Skipped ${totalSkipped}, Errors ${totalErrors}`)
  
  if (dryRun) {
    console.log('\n*** This was a DRY RUN - no actual changes were made ***')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

