/**
 * Multi-Jurisdiction Filing Service
 * 
 * Handles:
 * 1. Reference Draft generation (superset sections)
 * 2. Section-by-section translation to target jurisdictions
 * 3. Diagram compatibility across jurisdictions
 * 4. Validation per jurisdiction
 */

import { prisma } from '@/lib/prisma'
import { llmGateway } from '@/lib/metering'
import { getCountryProfile } from '@/lib/country-profile-service'
import crypto from 'crypto'

// ============================================================================
// Types
// ============================================================================

export interface ReferenceDraftResult {
  success: boolean
  draft?: Record<string, string>
  error?: string
  tokensUsed?: number
}

export interface TranslationResult {
  success: boolean
  translatedContent?: string
  error?: string
  tokensUsed?: number
}

export interface DiagramCompatibilityResult {
  mostRestrictiveRules: {
    colorAllowed: boolean
    paperSize: string
    lineStyle: string
    minReferenceTextSizePt: number
  }
  compatibilityNotes: string[]
}

export interface SectionMapping {
  supersetKey: string
  countryKey: string
  countryHeading: string
  isApplicable: boolean
}

// ============================================================================
// Superset Section Keys (Reference Draft uses these)
// All 15 core sections that form the universal superset for multi-jurisdiction filing
// Country-specific sections are mapped FROM these via CountrySectionMapping
// ============================================================================

export const SUPERSET_SECTIONS = [
  'title',              // 1. Title of the Invention
  'preamble',           // 2. Preamble (IN, PK, BD, ZA, NZ - country specific)
  'fieldOfInvention',   // 3. Field of the Invention / Technical Field
  'background',         // 4. Background of the Invention / Prior Art
  'objectsOfInvention', // 5. Objects of the Invention (some jurisdictions)
  'summary',            // 6. Summary of the Invention
  'technicalProblem',   // 7. Technical Problem Solved (EP, JP style)
  'technicalSolution',  // 8. Technical Solution (EP, JP style)
  'advantageousEffects',// 9. Advantageous Effects (JP, CN style)
  'briefDescriptionOfDrawings', // 10. Brief Description of Drawings
  'detailedDescription',// 11. Detailed Description of the Invention
  'bestMode',           // 12. Best Mode / Best Method (US requirement)
  'industrialApplicability', // 13. Industrial Applicability (PCT, non-US)
  'claims',             // 14. Claims
  'abstract'            // 15. Abstract
]

// Additional optional sections that may be included in some drafts
export const OPTIONAL_SUPERSET_SECTIONS = [
  'listOfNumerals',     // List of Reference Numerals (EP, DE)
  'crossReference'      // Cross-Reference to Related Applications
]

// Combined full superset (for comprehensive reference drafts)
export const FULL_SUPERSET_SECTIONS = [...SUPERSET_SECTIONS, ...OPTIONAL_SUPERSET_SECTIONS]

// Alias mapping for backward compatibility and flexible key resolution
export const SUPERSET_KEY_ALIASES: Record<string, string> = {
  'field': 'fieldOfInvention',
  'technicalField': 'fieldOfInvention',
  'technical_field': 'fieldOfInvention',
  'field_of_invention': 'fieldOfInvention',
  'backgroundOfInvention': 'background',
  'background_of_invention': 'background',
  'priorArt': 'background',
  'prior_art': 'background',
  'objects': 'objectsOfInvention',
  'objects_of_invention': 'objectsOfInvention',
  'summaryOfInvention': 'summary',
  'summary_of_invention': 'summary',
  'disclosureOfInvention': 'summary',
  'technical_problem': 'technicalProblem',
  'technical_solution': 'technicalSolution',
  'advantageous_effects': 'advantageousEffects',
  'brief_description_of_drawings': 'briefDescriptionOfDrawings',
  'brief_drawings': 'briefDescriptionOfDrawings',
  'drawings': 'briefDescriptionOfDrawings',
  'detailed_description': 'detailedDescription',
  'detailedDescriptionOfInvention': 'detailedDescription',
  'bestMethod': 'bestMode',
  'best_method': 'bestMode',
  'best_mode': 'bestMode',
  'industrial_applicability': 'industrialApplicability',
  'utility': 'industrialApplicability',
  'list_of_numerals': 'listOfNumerals',
  'referenceNumerals': 'listOfNumerals',
  'reference_numerals': 'listOfNumerals',
  'cross_reference': 'crossReference',
  'relatedApplications': 'crossReference'
}

/**
 * Normalize a section key to its canonical superset key
 */
export function normalizeToSupersetKey(key: string): string {
  if (!key) return key
  const normalized = key.trim()
  // Check if it's already a valid superset key
  if (FULL_SUPERSET_SECTIONS.includes(normalized)) {
    return normalized
  }
  // Check aliases
  return SUPERSET_KEY_ALIASES[normalized] || normalized
}

// ============================================================================
// Diagram Compatibility
// ============================================================================

/**
 * Get the most restrictive diagram rules across all selected jurisdictions
 * Used when generating diagrams for multi-jurisdiction filing
 */
export async function getDiagramCompatibility(
  jurisdictions: string[]
): Promise<DiagramCompatibilityResult> {
  const notes: string[] = []
  
  // Default most restrictive values
  let colorAllowed = true
  let paperSize = 'A4'
  let lineStyle = 'black_and_white_solid'
  let minReferenceTextSizePt = 8

  for (const code of jurisdictions) {
    try {
      // Try database first
      const dbConfig = await prisma.countryDiagramConfig.findUnique({
        where: { countryCode: code.toUpperCase() }
      })

      if (dbConfig) {
        // Color: if ANY jurisdiction disallows color, no color
        if (!dbConfig.colorAllowed) {
          colorAllowed = false
          notes.push(`${code} requires black & white diagrams`)
        }
        
        // Paper size: prefer A4 as more universal
        if (dbConfig.paperSize === 'LETTER' && paperSize === 'A4') {
          // Keep A4 as it's more universally accepted
        }
        
        // Min text size: use the largest minimum
        if (dbConfig.minReferenceTextSizePt > minReferenceTextSizePt) {
          minReferenceTextSizePt = dbConfig.minReferenceTextSizePt
          notes.push(`${code} requires minimum ${dbConfig.minReferenceTextSizePt}pt text`)
        }
        
        continue
      }

      // Fallback to JSON profile
      const profile = await getCountryProfile(code)
      const drawings = profile?.profileData?.rules?.drawings
      
      if (drawings) {
        if (drawings.colorAllowed === false) {
          colorAllowed = false
          notes.push(`${code} requires black & white diagrams`)
        }
        if (drawings.minReferenceTextSizePt && drawings.minReferenceTextSizePt > minReferenceTextSizePt) {
          minReferenceTextSizePt = drawings.minReferenceTextSizePt
        }
      }
    } catch (err) {
      console.warn(`Failed to get diagram rules for ${code}:`, err)
    }
  }

  return {
    mostRestrictiveRules: {
      colorAllowed,
      paperSize,
      lineStyle,
      minReferenceTextSizePt
    },
    compatibilityNotes: notes
  }
}

/**
 * Build diagram generation prompt that respects all jurisdiction rules
 */
export function buildMultiJurisdictionDiagramPrompt(
  basePrompt: string,
  jurisdictions: string[],
  compatibility: DiagramCompatibilityResult
): string {
  const rules = compatibility.mostRestrictiveRules
  
  const jurisdictionList = jurisdictions.join(', ')
  const colorRule = rules.colorAllowed 
    ? 'Color may be used where helpful' 
    : 'MUST be BLACK AND WHITE ONLY - no colors, grayscale, or shading'
  
  return `${basePrompt}

MULTI-JURISDICTION COMPATIBILITY REQUIREMENTS:
This patent will be filed in: ${jurisdictionList}

DIAGRAM RULES (most restrictive across all jurisdictions):
- Color: ${colorRule}
- Paper size: ${rules.paperSize}
- Minimum reference text size: ${rules.minReferenceTextSizePt}pt
- Line style: Solid black lines only

${compatibility.compatibilityNotes.length > 0 ? `
SPECIFIC NOTES:
${compatibility.compatibilityNotes.map(n => `- ${n}`).join('\n')}
` : ''}

Generate diagrams that comply with ALL jurisdiction requirements.`
}

// ============================================================================
// Dynamic Superset Computation
// ============================================================================

/**
 * Compute the dynamic superset of sections needed for the selected jurisdictions
 * This optimizes reference draft generation by only including sections that are
 * actually used by at least one of the selected countries.
 * 
 * @param jurisdictions - Array of country codes (e.g., ['US', 'EP', 'JP'])
 * @returns Object containing the dynamic sections array and per-jurisdiction mappings
 */
export async function computeDynamicSuperset(
  jurisdictions: string[]
): Promise<{
  sections: string[]
  sectionDetails: Record<string, { label: string; requiredBy: string[] }>
  jurisdictionMappings: Record<string, SectionMapping[]>
}> {
  const uniqueSections = new Set<string>()
  const sectionDetails: Record<string, { label: string; requiredBy: string[] }> = {}
  const jurisdictionMappings: Record<string, SectionMapping[]> = {}

  // Always include essential sections that are universally required
  const essentialSections = ['title', 'abstract', 'claims', 'detailedDescription']
  for (const key of essentialSections) {
    uniqueSections.add(key)
    sectionDetails[key] = { label: getDefaultHeading(key), requiredBy: ['ALL'] }
  }

  // Get mappings for each jurisdiction and collect unique superset keys
  for (const jurisdiction of jurisdictions) {
    const code = jurisdiction.toUpperCase()
    if (code === 'REFERENCE') continue // Skip the reference pseudo-jurisdiction
    
    try {
      const mappings = await getSectionMapping(code)
      jurisdictionMappings[code] = mappings

      for (const mapping of mappings) {
        if (!mapping.isApplicable) continue // Skip N/A sections
        
        const supersetKey = normalizeToSupersetKey(mapping.supersetKey)
        uniqueSections.add(supersetKey)
        
        if (!sectionDetails[supersetKey]) {
          sectionDetails[supersetKey] = {
            label: getDefaultHeading(supersetKey),
            requiredBy: []
          }
        }
        if (!sectionDetails[supersetKey].requiredBy.includes(code)) {
          sectionDetails[supersetKey].requiredBy.push(code)
        }
      }
    } catch (err) {
      console.error(`[computeDynamicSuperset] Failed to get mappings for ${code}:`, err)
    }
  }

  // Sort sections by the canonical order defined in SUPERSET_SECTIONS
  const orderedSections = SUPERSET_SECTIONS.filter(key => uniqueSections.has(key))
  
  // Add any additional sections that were found but not in the main superset
  const uniqueSectionsArray = Array.from(uniqueSections)
  for (const key of uniqueSectionsArray) {
    if (!orderedSections.includes(key)) {
      orderedSections.push(key)
    }
  }

  console.log(`[computeDynamicSuperset] Computed ${orderedSections.length} sections for ${jurisdictions.length} jurisdictions:`, orderedSections)

  return {
    sections: orderedSections,
    sectionDetails,
    jurisdictionMappings
  }
}

/**
 * Get a human-readable summary of which sections are needed and why
 */
export function formatDynamicSupersetSummary(
  sectionDetails: Record<string, { label: string; requiredBy: string[] }>
): string {
  const lines: string[] = []
  for (const [key, detail] of Object.entries(sectionDetails)) {
    const countries = detail.requiredBy.join(', ')
    lines.push(`- ${detail.label} (${key}): Required by ${countries}`)
  }
  return lines.join('\n')
}

// ============================================================================
// Section Mapping
// ============================================================================

/**
 * Get section mapping from superset to country-specific sections
 */
export async function getSectionMapping(
  countryCode: string
): Promise<SectionMapping[]> {
  const mappings: SectionMapping[] = []
  const code = countryCode.toUpperCase()

  try {
    // Get from database
    const dbMappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: code, isEnabled: true },
      orderBy: { displayOrder: 'asc' }
    })

    if (dbMappings.length > 0) {
      for (const m of dbMappings) {
        // Extract superset key from supersetCode (e.g., "01. Title" -> "title")
        const supersetKey = extractSupersetKey(m.supersetCode)
        mappings.push({
          supersetKey,
          countryKey: m.sectionKey,
          countryHeading: m.heading || m.sectionKey,
          isApplicable: m.heading !== '(N/A)' && m.heading !== '(Implicit)'
        })
      }
      return mappings
    }

    // Fallback to JSON profile
    const profile = await getCountryProfile(code)
    const variant = profile?.profileData?.structure?.variants?.find(
      (v: any) => v.id === profile?.profileData?.structure?.defaultVariant
    ) || profile?.profileData?.structure?.variants?.[0]

    if (variant?.sections) {
      for (const section of variant.sections) {
        const supersetKey = section.canonicalKeys?.[0] || section.id
        mappings.push({
          supersetKey: normalizeToSuperset(supersetKey),
          countryKey: section.id,
          countryHeading: section.label || section.id,
          isApplicable: true
        })
      }
    }
  } catch (err) {
    console.error(`Failed to get section mapping for ${code}:`, err)
  }

  // If no mappings found, return 1:1 mapping for superset sections
  if (mappings.length === 0) {
    return SUPERSET_SECTIONS.map(key => ({
      supersetKey: key,
      countryKey: key,
      countryHeading: getDefaultHeading(key),
      isApplicable: true
    }))
  }

  return mappings
}

function extractSupersetKey(supersetCode: string): string {
  // "01. Title" -> "title"
  // "02. Field of Invention" -> "field"
  const match = supersetCode.match(/^\d+\.\s*(.+)$/)
  const label = match ? match[1].trim() : supersetCode
  return labelToKey(label)
}

function labelToKey(label: string): string {
  // Map display labels to canonical superset keys
  const mapping: Record<string, string> = {
    'Title': 'title',
    'Title of the Invention': 'title',
    'Preamble': 'preamble',
    'Field of Invention': 'fieldOfInvention',
    'Field of the Invention': 'fieldOfInvention',
    'Technical Field': 'fieldOfInvention',
    'Field': 'fieldOfInvention',
    'Background': 'background',
    'Background of the Invention': 'background',
    'Background of Invention': 'background',
    'Prior Art': 'background',
    'Objects of Invention': 'objectsOfInvention',
    'Objects of the Invention': 'objectsOfInvention',
    'Technical Problem': 'technicalProblem',
    'Technical Problem Solved': 'technicalProblem',
    'Technical Solution': 'technicalSolution',
    'Advantageous Effects': 'advantageousEffects',
    'Summary': 'summary',
    'Summary of Invention': 'summary',
    'Summary of the Invention': 'summary',
    'Disclosure of Invention': 'summary',
    'Brief Description of Drawings': 'briefDescriptionOfDrawings',
    'Brief Description of the Drawings': 'briefDescriptionOfDrawings',
    'Detailed Description': 'detailedDescription',
    'Detailed Description of the Invention': 'detailedDescription',
    'Best Mode': 'bestMode',
    'Best Method': 'bestMode',
    'Best Method of Performing the Invention': 'bestMode',
    'Industrial Applicability': 'industrialApplicability',
    'Industrial Application': 'industrialApplicability',
    'Utility': 'industrialApplicability',
    'Claims': 'claims',
    'Abstract': 'abstract',
    'List of Reference Numerals': 'listOfNumerals',
    'Reference Signs': 'listOfNumerals',
    'Cross-Reference': 'crossReference',
    'Cross-Reference to Related Applications': 'crossReference'
  }
  return mapping[label] || normalizeToSupersetKey(label.toLowerCase().replace(/\s+/g, ''))
}

function normalizeToSuperset(key: string): string {
  // Use the canonical normalization function
  return normalizeToSupersetKey(key)
}

function getDefaultHeading(key: string): string {
  // Map canonical superset keys to display headings
  const headings: Record<string, string> = {
    'title': 'Title of the Invention',
    'preamble': 'Preamble',
    'fieldOfInvention': 'Field of the Invention',
    'background': 'Background of the Invention',
    'objectsOfInvention': 'Objects of the Invention',
    'summary': 'Summary of the Invention',
    'technicalProblem': 'Technical Problem',
    'technicalSolution': 'Technical Solution',
    'advantageousEffects': 'Advantageous Effects',
    'briefDescriptionOfDrawings': 'Brief Description of the Drawings',
    'detailedDescription': 'Detailed Description of the Invention',
    'bestMode': 'Best Mode',
    'industrialApplicability': 'Industrial Applicability',
    'claims': 'Claims',
    'abstract': 'Abstract',
    'listOfNumerals': 'List of Reference Numerals',
    'crossReference': 'Cross-Reference to Related Applications'
  }
  return headings[key] || headings[normalizeToSupersetKey(key)] || key
}

// ============================================================================
// Reference Draft Generation
// ============================================================================

// Fallback quality guidelines (used only when DB prompts not available)
const FALLBACK_SECTION_GUIDELINES: Record<string, string> = {
  title: 'Concise, descriptive, max 15 words, no marketing language or banned words (Novel, Improved, Smart, etc.)',
  preamble: 'Jurisdiction-specific preamble - generate only if required by target jurisdictions',
  fieldOfInvention: '1-3 sentences identifying the technical domain, start with "The present invention relates to..."',
  background: 'Prior art context and limitations (3-5 paragraphs), objective language, no mention of present solution',
  objectsOfInvention: '3-7 specific technical objectives using "It is an object of..." format',
  summary: 'Complete technical overview (2-4 paragraphs), align with broadest claim, use flexible language',
  technicalProblem: 'Clear statement of the objective technical problem solved (1-2 paragraphs) - EP/JP style',
  technicalSolution: 'How the invention solves the technical problem (2-4 paragraphs) - EP/JP style',
  advantageousEffects: 'Specific, measurable technical advantages (3-6 bullet points) - JP/CN style',
  briefDescriptionOfDrawings: 'One sentence per figure in format "FIG. X is a [view type] showing [description]"',
  detailedDescription: 'Comprehensive technical disclosure with reference numerals, multiple embodiments',
  bestMode: 'Preferred embodiment details with specific parameters - US requirement',
  industrialApplicability: 'How the invention can be made/used in industry (1-2 paragraphs) - PCT requirement',
  claims: 'Complete claim set with independent claims (apparatus + method) and dependent claims (10-20 total)',
  abstract: '150-word summary of the invention, single paragraph, reference key figure',
  listOfNumerals: 'List of all reference numerals with their component names in numerical order',
  crossReference: 'References to related applications, priority claims if applicable'
}

/**
 * Fetch BASE PROMPTS (country-neutral) from SUPERSET_PROMPTS in drafting-service.ts
 * These are the authoritative source for country-neutral patent section generation.
 * 
 * Priority order:
 * 1. SUPERSET_PROMPTS from drafting-service.ts (the canonical base prompts)
 * 2. SupersetSection database table (for customizations)
 * 3. Fallback guidelines
 */
async function getSupersetSectionPrompts(sectionKeys: string[]): Promise<Record<string, {
  instruction: string
  constraints: string[]
  label: string
  description?: string
}>> {
  const prompts: Record<string, any> = {}
  
  // Import the canonical SUPERSET_PROMPTS (Country-Neutral Base Prompts)
  const { SUPERSET_PROMPTS } = await import('./drafting-service')
  
  // Map our canonical superset keys to SUPERSET_PROMPTS keys
  // SUPERSET_PROMPTS uses underscore_case: 'field', 'objects', 'brief_drawings', etc.
  const supersetKeyToPromptKey: Record<string, string> = {
    'title': 'title',
    'preamble': 'preamble',
    'fieldOfInvention': 'field',
    'background': 'background',
    'objectsOfInvention': 'objects',
    'summary': 'summary',
    'technicalProblem': 'technical_problem',      // May not exist in SUPERSET_PROMPTS
    'technicalSolution': 'technical_solution',    // May not exist in SUPERSET_PROMPTS
    'advantageousEffects': 'advantageous_effects',// May not exist in SUPERSET_PROMPTS
    'briefDescriptionOfDrawings': 'brief_drawings',
    'detailedDescription': 'detailed_description',
    'bestMode': 'best_mode',
    'industrialApplicability': 'industrial_applicability',
    'claims': 'claims',
    'abstract': 'abstract',
    'listOfNumerals': 'reference_numerals',       // May not exist in SUPERSET_PROMPTS
    'crossReference': 'cross_reference'
  }

  // First, load from the authoritative SUPERSET_PROMPTS (Country-Neutral Base Prompts)
  for (const key of sectionKeys) {
    // Map our canonical key to SUPERSET_PROMPTS key
    const promptKey = supersetKeyToPromptKey[key] || key
    
    // Try mapped key
    let basePrompt = SUPERSET_PROMPTS[promptKey]
    
    // Try direct key if mapped didn't work
    if (!basePrompt) {
      basePrompt = SUPERSET_PROMPTS[key]
    }
    
    // Try underscore version
    if (!basePrompt) {
      const underscoreKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      basePrompt = SUPERSET_PROMPTS[underscoreKey]
    }
    
    if (basePrompt) {
      prompts[key] = {
        instruction: basePrompt.instruction,
        constraints: basePrompt.constraints || [],
        label: getDefaultHeading(key),
        description: undefined
      }
    }
  }

  console.log(`[getSupersetSectionPrompts] Loaded ${Object.keys(prompts).length}/${sectionKeys.length} prompts from SUPERSET_PROMPTS (Base Prompts)`)

  // For any missing sections, try to fetch from database as backup
  const missingKeys = sectionKeys.filter(k => !prompts[k])
  if (missingKeys.length > 0) {
    try {
      const dbSections = await prisma.supersetSection.findMany({
        where: {
          sectionKey: { in: missingKeys },
          isActive: true
        },
        select: {
          sectionKey: true,
          instruction: true,
          constraints: true,
          label: true,
          description: true
        }
      })

      for (const section of dbSections) {
        prompts[section.sectionKey] = {
          instruction: section.instruction,
          constraints: Array.isArray(section.constraints) ? section.constraints : [],
          label: section.label,
          description: section.description || undefined
        }
      }

      if (dbSections.length > 0) {
        console.log(`[getSupersetSectionPrompts] Loaded ${dbSections.length} additional prompts from DB`)
      }
    } catch (err) {
      console.warn('[getSupersetSectionPrompts] Failed to fetch from DB:', err)
    }
  }

  // Fill in any still-missing sections with fallback guidelines
  for (const key of sectionKeys) {
    if (!prompts[key]) {
      console.warn(`[getSupersetSectionPrompts] Using fallback for section: ${key}`)
      prompts[key] = {
        instruction: FALLBACK_SECTION_GUIDELINES[key] || 'Generate appropriate content for this section.',
        constraints: [],
        label: getDefaultHeading(key),
        description: undefined
      }
    }
  }

  return prompts
}

/**
 * Extended result type that includes dynamic superset info
 */
export interface ReferenceDraftResultExtended extends ReferenceDraftResult {
  dynamicSections?: string[]
  sectionDetails?: Record<string, { label: string; requiredBy: string[] }>
  jurisdictionMappings?: Record<string, SectionMapping[]>
}

/**
 * Generate reference draft with ONLY the sections needed by selected jurisdictions
 * Uses database-based prompts from SupersetSection table for consistency.
 * This optimizes cost and time by not generating unused sections.
 * 
 * @param session - The drafting session with ideaRecord, referenceMap, figurePlans
 * @param jurisdictions - Array of selected jurisdiction codes (e.g., ['US', 'EP', 'JP'])
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 */
export async function generateReferenceDraft(
  session: any,
  jurisdictions?: string[],
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<ReferenceDraftResultExtended> {
  try {
    const idea = session.ideaRecord || {}
    const referenceMap = session.referenceMap || { components: [] }
    const figures = Array.isArray(session.figurePlans) ? session.figurePlans : []
    const components = Array.isArray(referenceMap.components) ? referenceMap.components : []

    // Determine the dynamic superset based on selected jurisdictions
    const selectedJurisdictions = jurisdictions?.length 
      ? jurisdictions 
      : (session.draftingJurisdictions || ['US']) // Fallback to session jurisdictions or US
    
    const { sections: dynamicSections, sectionDetails, jurisdictionMappings } = 
      await computeDynamicSuperset(selectedJurisdictions)

    console.log(`[generateReferenceDraft] Generating ${dynamicSections.length} sections for jurisdictions: ${selectedJurisdictions.join(', ')}`)

    // Fetch database-based prompts for the dynamic sections
    const sectionPrompts = await getSupersetSectionPrompts(dynamicSections)
    console.log(`[generateReferenceDraft] Loaded ${Object.keys(sectionPrompts).length} section prompts from database`)

    // Build section instructions using database prompts
    const sectionInstructions = dynamicSections.map((key, idx) => {
      const prompt = sectionPrompts[key]
      const requiredBy = sectionDetails[key]?.requiredBy.join(', ') || 'General'
      const constraints = prompt.constraints.length > 0 
        ? `\n   Constraints: ${prompt.constraints.join('; ')}`
        : ''
      
      return `═══════════════════════════════════════════════════════════════
SECTION ${idx + 1}: ${prompt.label} (key: "${key}")
Required by: ${requiredBy}
═══════════════════════════════════════════════════════════════
${prompt.instruction}${constraints}`
    }).join('\n\n')

    const prompt = `You are generating a REFERENCE PATENT DRAFT that will be translated to these specific jurisdictions: ${selectedJurisdictions.join(', ')}.

This draft must be COUNTRY-NEUTRAL and contain ONLY the ${dynamicSections.length} sections required by the selected jurisdictions.
The reference draft serves as the master source from which jurisdiction-specific drafts will be derived.

══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
══════════════════════════════════════════════════════════════════════════════
Title: ${idea.title || 'Untitled'}
Problem Statement: ${idea.problem || 'Not specified'}
Objectives: ${idea.objectives || 'Not specified'}
Key Components: ${components.map((c: any) => `${c.name} (${c.numeral})`).join(', ') || 'Not specified'}
Working Principle: ${idea.logic || 'Not specified'}
${figures.length > 0 ? `Figures: ${figures.map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}

══════════════════════════════════════════════════════════════════════════════
SECTION-BY-SECTION INSTRUCTIONS (generate EXACTLY these ${dynamicSections.length} sections)
══════════════════════════════════════════════════════════════════════════════

${sectionInstructions}

══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════════════════════════════════════════
- Return ONLY a JSON object with these exact keys: ${dynamicSections.map(k => `"${k}"`).join(', ')}
- Each value should be the complete section content following the instructions above
- Do not include markdown code fences or explanations
- Write in clear, technical English suitable for international filing
- Do NOT generate sections not listed above`

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      parameters: { tenantId, purpose: 'reference_draft' },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId: session.patentId,
        sessionId: session.id,
        purpose: 'reference_draft_generation',
        jurisdictions: selectedJurisdictions,
        sectionCount: dynamicSections.length
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Reference draft generation failed'
      }
    }

    // Parse response using dynamic sections
    const draft = parseReferenceDraftResponse(result.response.output, dynamicSections)
    
    if (!draft) {
      return {
        success: false,
        error: 'Failed to parse reference draft response'
      }
    }

    // Validate completeness - warn about missing sections
    const missingSections = dynamicSections.filter(key => !draft[key] || draft[key].trim() === '')
    if (missingSections.length > 0) {
      console.warn(`[generateReferenceDraft] Missing or empty sections: ${missingSections.join(', ')}`)
    }

    return {
      success: true,
      draft,
      tokensUsed: result.response.outputTokens,
      dynamicSections,
      sectionDetails,
      jurisdictionMappings
    }
  } catch (error) {
    console.error('Reference draft generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Reference draft generation failed'
    }
  }
}

/**
 * Parse LLM response into a draft object
 * @param output - Raw LLM output string
 * @param expectedSections - Optional array of section keys to extract (defaults to full SUPERSET_SECTIONS)
 */
function parseReferenceDraftResponse(
  output: string, 
  expectedSections?: string[]
): Record<string, string> | null {
  try {
    let text = (output || '').trim()
    
    // Extract JSON from code fence if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      text = fenceMatch[1].trim()
    }
    
    // Find JSON object
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      console.error('[parseReferenceDraftResponse] No JSON object found in output')
      return null
    }
    
    text = text.slice(start, end + 1)
    text = text.replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
    
    const parsed = JSON.parse(text)
    
    if (typeof parsed !== 'object' || parsed === null) {
      console.error('[parseReferenceDraftResponse] Parsed result is not an object')
      return null
    }
    
    // Use provided sections or default to full superset
    const sectionsToExtract = expectedSections || SUPERSET_SECTIONS
    
    // Extract sections, trying aliases if direct key not found
    const draft: Record<string, string> = {}
    for (const key of sectionsToExtract) {
      // Try direct key first
      if (typeof parsed[key] === 'string') {
        draft[key] = parsed[key].trim()
        continue
      }
      
      // Try to find via alias
      let found = false
      for (const [alias, canonical] of Object.entries(SUPERSET_KEY_ALIASES)) {
        if (canonical === key && typeof parsed[alias] === 'string') {
          draft[key] = parsed[alias].trim()
          found = true
          break
        }
      }
      
      if (!found) {
        // Section not found - log warning and set empty
        console.warn(`[parseReferenceDraftResponse] Section '${key}' not found in LLM output`)
        draft[key] = ''
      }
    }
    
    return draft
  } catch (err) {
    console.error('Failed to parse reference draft:', err)
    return null
  }
}

// ============================================================================
// Section Translation
// ============================================================================

/**
 * Translate a single section from reference draft to target jurisdiction
 * Uses temperature=0 for deterministic output
 * 
 * @param referenceContent - The content from the reference draft
 * @param referenceSectionKey - The superset section key (e.g., 'fieldOfInvention')
 * @param targetJurisdiction - The target country code (e.g., 'DE', 'JP')
 * @param targetSectionKey - The country-specific section key
 * @param targetHeading - The country-specific heading for the section
 * @param targetLanguage - The target language for translation (e.g., 'German', 'Japanese')
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 */
export async function translateSection(
  referenceContent: string,
  referenceSectionKey: string,
  targetJurisdiction: string,
  targetSectionKey: string,
  targetHeading: string,
  targetLanguage?: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<TranslationResult> {
  try {
    const code = targetJurisdiction.toUpperCase()
    
    // Get jurisdiction-specific rules
    const profile = await getCountryProfile(code)
    const validation = await prisma.countrySectionValidation.findUnique({
      where: { countryCode_sectionKey: { countryCode: code, sectionKey: targetSectionKey } }
    })

    // Resolve target language - use provided language or fall back to country profile
    const availableLanguages: string[] = Array.isArray(profile?.profileData?.meta?.languages)
      ? profile.profileData.meta.languages
      : ['English']
    const resolvedLanguage = targetLanguage && availableLanguages.includes(targetLanguage)
      ? targetLanguage
      : availableLanguages[0] || 'English'
    const requiresTranslation = resolvedLanguage.toLowerCase() !== 'english'

    // Build constraints from validation rules
    const constraints: string[] = []
    if (validation?.maxWords) {
      constraints.push(`Maximum ${validation.maxWords} words`)
    }
    if (validation?.maxChars) {
      constraints.push(`Maximum ${validation.maxChars} characters`)
    }
    if (validation?.legalReference) {
      constraints.push(`Per ${validation.legalReference}`)
    }

    const constraintText = constraints.length > 0 
      ? `\n\nCONSTRAINTS FOR ${code}:\n${constraints.map(c => `- ${c}`).join('\n')}`
      : ''

    // Build language instruction
    const languageInstruction = requiresTranslation
      ? `\n\nLANGUAGE REQUIREMENT:\n- Output MUST be in ${resolvedLanguage}\n- Translate all content from English to ${resolvedLanguage}\n- Use proper ${resolvedLanguage} legal/patent terminology\n- Maintain technical accuracy in translation`
      : ''

    const prompt = `You are translating a patent section from a Reference Draft to ${code} jurisdiction format.

TASK: ${requiresTranslation ? `Translate to ${resolvedLanguage} AND adapt` : 'Adapt'} to ${code} jurisdiction requirements - do NOT add new technical content.

SOURCE SECTION: ${referenceSectionKey}
SOURCE CONTENT:
${referenceContent}

TARGET SECTION: ${targetSectionKey}
TARGET HEADING: "${targetHeading}"
TARGET JURISDICTION: ${code}
TARGET LANGUAGE: ${resolvedLanguage}
${constraintText}${languageInstruction}

RULES:
1. Do NOT add new technical information not in the source
2. Do NOT re-interpret or expand on the invention
3. ONLY adapt format, structure, and phrasing to ${code} requirements
4. Maintain exact technical meaning and terminology
5. Use heading format appropriate for ${code}
6. If the source content is empty, return an empty string
${requiresTranslation ? `7. ALL output must be in ${resolvedLanguage} - no English unless quoting technical terms` : ''}

OUTPUT: Return ONLY the ${requiresTranslation ? `${resolvedLanguage} ` : ''}translated section content. No explanations or markdown.`

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      parameters: { 
        tenantId, 
        jurisdiction: code,
        language: resolvedLanguage,
        temperature: 0, // Deterministic for translation
        purpose: 'section_translation'
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        purpose: 'section_translation',
        sourceSection: referenceSectionKey,
        targetSection: targetSectionKey,
        jurisdiction: code,
        targetLanguage: resolvedLanguage
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Translation failed'
      }
    }

    // Clean up response (remove any accidental markdown)
    let content = (result.response.output || '').trim()
    content = content.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '')

    return {
      success: true,
      translatedContent: content,
      tokensUsed: result.response.outputTokens
    }
  } catch (error) {
    console.error('Section translation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Translation failed'
    }
  }
}

/**
 * BATCH Translation Mode - Translates ALL sections in a SINGLE LLM call
 * This is the most token-efficient approach, reducing overhead significantly.
 * 
 * @param sectionsToTranslate - Array of sections with content and mapping info
 * @param targetJurisdiction - Target country code
 * @param targetLanguage - Target language
 * @param tenantId - Optional tenant ID
 * @param requestHeaders - Optional headers
 */
async function translateSectionsBatch(
  sectionsToTranslate: Array<{
    supersetKey: string
    countryKey: string
    countryHeading: string
    content: string
  }>,
  targetJurisdiction: string,
  targetLanguage: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<{
  success: boolean
  translations?: Record<string, string>
  error?: string
  tokensUsed?: number
}> {
  if (sectionsToTranslate.length === 0) {
    return { success: true, translations: {} }
  }

  const code = targetJurisdiction.toUpperCase()
  const requiresTranslation = targetLanguage.toLowerCase() !== 'english'

  // Build the batch input - all sections in one structured format
  const sectionsInput = sectionsToTranslate.map((s, idx) => 
    `### SECTION ${idx + 1}: ${s.supersetKey} → ${s.countryKey}
TARGET HEADING: "${s.countryHeading}"
SOURCE CONTENT:
${s.content}
---`
  ).join('\n\n')

  // Build expected output keys
  const outputKeys = sectionsToTranslate.map(s => s.countryKey)

  const languageInstruction = requiresTranslation
    ? `\n\nLANGUAGE REQUIREMENT:
- ALL output MUST be in ${targetLanguage}
- Translate all content from English to ${targetLanguage}
- Use proper ${targetLanguage} legal/patent terminology
- Maintain technical accuracy in translation`
    : ''

  const prompt = `You are translating a patent from Reference Draft to ${code} jurisdiction format.
${requiresTranslation ? `ALL OUTPUT MUST BE IN ${targetLanguage.toUpperCase()}.` : ''}

TASK: ${requiresTranslation ? `Translate to ${targetLanguage} AND adapt` : 'Adapt'} ALL sections below to ${code} jurisdiction requirements.

TARGET JURISDICTION: ${code}
TARGET LANGUAGE: ${targetLanguage}
NUMBER OF SECTIONS: ${sectionsToTranslate.length}
${languageInstruction}

SECTIONS TO TRANSLATE:
${sectionsInput}

RULES:
1. Do NOT add new technical information not in the source
2. Do NOT re-interpret or expand on the invention
3. ONLY adapt format, structure, and phrasing to ${code} requirements
4. Maintain exact technical meaning and terminology
5. Use heading format appropriate for ${code}
6. If source content is empty, return empty string for that section

OUTPUT FORMAT:
Return a JSON object with these exact keys: ${outputKeys.map(k => `"${k}"`).join(', ')}
Each value should be the translated section content.
Do NOT include markdown code fences or explanations.
Return ONLY the JSON object.`

  try {
    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      parameters: { 
        tenantId, 
        jurisdiction: code,
        language: targetLanguage,
        temperature: 0,
        purpose: 'batch_translation'
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        purpose: 'batch_section_translation',
        jurisdiction: code,
        targetLanguage,
        sectionCount: sectionsToTranslate.length,
        sections: outputKeys
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Batch translation failed'
      }
    }

    // Parse the JSON response
    let text = (result.response.output || '').trim()
    
    // Extract JSON from code fence if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      text = fenceMatch[1].trim()
    }
    
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) {
      return {
        success: false,
        error: 'Failed to parse batch translation response - no JSON object found'
      }
    }
    
    text = text.slice(start, end + 1)
    text = text.replace(/,(\s*[}\]])/g, '$1')
    
    const parsed = JSON.parse(text)
    
    // Extract translations
    const translations: Record<string, string> = {}
    for (const key of outputKeys) {
      translations[key] = typeof parsed[key] === 'string' ? parsed[key].trim() : ''
    }

    return {
      success: true,
      translations,
      tokensUsed: result.response.outputTokens
    }
  } catch (error) {
    console.error('[translateSectionsBatch] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Batch translation failed'
    }
  }
}

// Interface for section translation tasks
interface SectionToTranslate {
  supersetKey: string
  countryKey: string
  countryHeading: string
  content: string
}

/**
 * Translate entire reference draft to a target jurisdiction
 * 
 * OPTIMIZATION: Uses BATCH MODE to translate all sections in a SINGLE LLM call,
 * significantly reducing token costs by avoiding repeated system prompts and instructions.
 * 
 * Token Savings Example:
 * - Individual calls (8 sections): ~8,000 input tokens (1000 per section with overhead)
 * - Batch call (8 sections): ~3,500 input tokens (one-time overhead + content)
 * - Savings: ~56% reduction in input tokens
 * 
 * @param referenceDraft - The reference draft with superset sections (may be dynamic subset)
 * @param targetJurisdiction - The target country code (e.g., 'DE', 'JP', 'CN')
 * @param targetLanguage - The target language for translation (optional, derived from jurisdiction if not provided)
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 * @param useBatchMode - Whether to use batch mode (default: true for token savings)
 */
export async function translateReferenceDraft(
  referenceDraft: Record<string, string>,
  targetJurisdiction: string,
  targetLanguage?: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>,
  useBatchMode: boolean = true
): Promise<{ 
  success: boolean
  draft?: Record<string, string>
  errors?: string[]
  language?: string
  stats?: { translated: number; skipped: number; failed: number; batchMode: boolean; tokensUsed?: number }
}> {
  const code = targetJurisdiction.toUpperCase()
  const mappings = await getSectionMapping(code)
  
  // Resolve the target language
  const profile = await getCountryProfile(code)
  const availableLanguages: string[] = Array.isArray(profile?.profileData?.meta?.languages)
    ? profile.profileData.meta.languages
    : ['English']
  const resolvedLanguage = targetLanguage && availableLanguages.includes(targetLanguage)
    ? targetLanguage
    : availableLanguages[0] || 'English'
  
  // Warn if requested language is not available
  if (targetLanguage && !availableLanguages.includes(targetLanguage)) {
    console.warn(`[translateReferenceDraft] Requested language '${targetLanguage}' not available for ${code}. Using '${resolvedLanguage}' instead. Available: ${availableLanguages.join(', ')}`)
  }

  const translatedDraft: Record<string, string> = {}
  const errors: string[] = []
  let skippedCount = 0
  let translatedCount = 0
  let totalTokensUsed = 0

  // Log the translation mapping for debugging
  console.log(`[translateReferenceDraft] Translating to ${code} (${resolvedLanguage}) - Batch Mode: ${useBatchMode}`)
  console.log(`[translateReferenceDraft] Section mappings: ${mappings.length}, Reference sections: ${Object.keys(referenceDraft).length}`)

  // Collect sections that need translation
  const sectionsToTranslate: SectionToTranslate[] = []
  
  for (const mapping of mappings) {
    if (!mapping.isApplicable) {
      // Section not applicable for this jurisdiction - skip silently
      translatedDraft[mapping.countryKey] = ''
      skippedCount++
      continue
    }

    // Try to get content from reference draft using the superset key
    // Also check for aliased keys for backward compatibility
    let referenceContent = referenceDraft[mapping.supersetKey]
    if (!referenceContent) {
      // Try to find content using aliases
      const normalizedKey = normalizeToSupersetKey(mapping.supersetKey)
      referenceContent = referenceDraft[normalizedKey] || ''
    }
    
    if (!referenceContent || !referenceContent.trim()) {
      // Section exists in mapping but not in reference draft (dynamic superset optimization)
      console.log(`[translateReferenceDraft] Section ${mapping.supersetKey} -> ${mapping.countryKey}: Not in reference draft (skipped)`)
      translatedDraft[mapping.countryKey] = ''
      skippedCount++
      continue
    }

    sectionsToTranslate.push({
      supersetKey: mapping.supersetKey,
      countryKey: mapping.countryKey,
      countryHeading: mapping.countryHeading,
      content: referenceContent
    })
  }

  console.log(`[translateReferenceDraft] ${sectionsToTranslate.length} sections to translate, Batch Mode: ${useBatchMode}`)

  // Use BATCH MODE (single LLM call) for token efficiency
  if (useBatchMode && sectionsToTranslate.length > 0) {
    console.log(`[translateReferenceDraft] Using BATCH MODE - single LLM call for all ${sectionsToTranslate.length} sections (token-efficient)`)
    
    const batchResult = await translateSectionsBatch(
      sectionsToTranslate,
      code,
      resolvedLanguage,
      tenantId,
      requestHeaders
    )

    if (batchResult.success && batchResult.translations) {
      // Apply batch translations
      for (const section of sectionsToTranslate) {
        const translated = batchResult.translations[section.countryKey]
        if (translated && translated.trim()) {
          translatedDraft[section.countryKey] = translated
          translatedCount++
        } else {
          // Fallback to reference content if translation is empty
          translatedDraft[section.countryKey] = section.content
          errors.push(`Empty translation for ${section.supersetKey} → ${section.countryKey}`)
        }
      }
      totalTokensUsed = batchResult.tokensUsed || 0
    } else {
      // Batch failed - fall back to individual translations
      console.warn(`[translateReferenceDraft] Batch mode failed: ${batchResult.error}. Falling back to individual translations.`)
      errors.push(`Batch translation failed: ${batchResult.error}`)
      
      // Fallback: use reference content for all sections
      for (const section of sectionsToTranslate) {
        translatedDraft[section.countryKey] = section.content
      }
    }
  } 
  // INDIVIDUAL MODE - separate LLM call per section (parallel execution for speed)
  else if (sectionsToTranslate.length > 0) {
    console.log(`[translateReferenceDraft] Using INDIVIDUAL MODE - parallel execution (${sectionsToTranslate.length} LLM calls)`)
    
    // Execute translations in parallel batches of 3 for rate limiting
    const PARALLEL_BATCH_SIZE = 3
    for (let i = 0; i < sectionsToTranslate.length; i += PARALLEL_BATCH_SIZE) {
      const batch = sectionsToTranslate.slice(i, i + PARALLEL_BATCH_SIZE)
      
      const results = await Promise.all(
        batch.map(async (section) => {
          try {
            const result = await translateSection(
              section.content,
              section.supersetKey,
              code,
              section.countryKey,
              section.countryHeading,
              resolvedLanguage,
              tenantId,
              requestHeaders
            )
            return { section, result }
          } catch (err) {
            console.error(`[translateReferenceDraft] Error translating ${section.supersetKey}:`, err)
            return { 
              section, 
              result: { 
                success: false, 
                error: err instanceof Error ? err.message : 'Unknown error' 
              } 
            }
          }
        })
      )

      // Process results
      for (const { section, result } of results) {
        if (result.success && result.translatedContent) {
          translatedDraft[section.countryKey] = result.translatedContent
          translatedCount++
          totalTokensUsed += result.tokensUsed || 0
        } else {
          errors.push(`Failed to translate ${section.supersetKey} → ${section.countryKey}: ${result.error || 'Unknown error'}`)
          translatedDraft[section.countryKey] = section.content
        }
      }
    }
  }

  const stats = {
    translated: translatedCount,
    skipped: skippedCount,
    failed: errors.length,
    batchMode: useBatchMode,
    tokensUsed: totalTokensUsed
  }

  console.log(`[translateReferenceDraft] Complete. Translated: ${stats.translated}, Skipped: ${stats.skipped}, Failed: ${stats.failed}, Tokens: ${stats.tokensUsed}`)

  return {
    success: errors.length === 0,
    draft: translatedDraft,
    errors: errors.length > 0 ? errors : undefined,
    language: resolvedLanguage,
    stats
  }
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationIssue {
  sectionKey: string
  type: 'error' | 'warning' | 'info'
  rule: string
  message: string
  actual?: number
  limit?: number
}

/**
 * Validate a draft against jurisdiction-specific rules
 */
export async function validateDraft(
  draft: Record<string, string>,
  jurisdiction: string
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  const code = jurisdiction.toUpperCase()

  // Get validation rules from database
  const validations = await prisma.countrySectionValidation.findMany({
    where: { countryCode: code, status: 'ACTIVE' }
  })

  for (const v of validations) {
    const content = draft[v.sectionKey] || ''
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
    const charCount = content.length

    // Word limit checks
    if (v.maxWords && wordCount > v.maxWords) {
      issues.push({
        sectionKey: v.sectionKey,
        type: (v.wordLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
        rule: 'maxWords',
        message: v.wordLimitMessage || `Exceeds ${v.maxWords} word limit`,
        actual: wordCount,
        limit: v.maxWords
      })
    }

    if (v.minWords && wordCount < v.minWords) {
      issues.push({
        sectionKey: v.sectionKey,
        type: 'warning',
        rule: 'minWords',
        message: `Below recommended ${v.minWords} word minimum`,
        actual: wordCount,
        limit: v.minWords
      })
    }

    // Character limit checks
    if (v.maxChars && charCount > v.maxChars) {
      issues.push({
        sectionKey: v.sectionKey,
        type: (v.charLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
        rule: 'maxChars',
        message: v.charLimitMessage || `Exceeds ${v.maxChars} character limit`,
        actual: charCount,
        limit: v.maxChars
      })
    }

    // Claim count checks
    if (v.sectionKey === 'claims' && v.maxCount) {
      const claimCount = (content.match(/^\s*\d+\./gm) || []).length
      if (claimCount > v.maxCount) {
        issues.push({
          sectionKey: v.sectionKey,
          type: (v.countLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
          rule: 'maxCount',
          message: v.countLimitMessage || `Exceeds ${v.maxCount} claims`,
          actual: claimCount,
          limit: v.maxCount
        })
      }
    }
  }

  return issues
}

// ============================================================================
// Session Helpers
// ============================================================================

/**
 * Check if reference draft is required (multi-jurisdiction mode)
 */
export function isReferenceDraftRequired(session: any): boolean {
  return session?.isMultiJurisdiction === true
}

/**
 * Check if reference draft is complete
 */
export function isReferenceDraftComplete(session: any): boolean {
  return session?.referenceDraftComplete === true
}

/**
 * Check if a jurisdiction draft can be generated
 */
export function canGenerateJurisdictionDraft(session: any, jurisdiction: string): boolean {
  // If single jurisdiction mode, always allowed
  if (!session?.isMultiJurisdiction) {
    return true
  }
  
  // If multi-jurisdiction, reference draft must be complete first
  // Unless this IS the reference draft
  if (jurisdiction.toUpperCase() === 'REFERENCE') {
    return true
  }
  
  return session?.referenceDraftComplete === true
}

