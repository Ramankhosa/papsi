/**
 * Prompt Merger Service
 * 
 * Merges base superset prompts with country-specific top-up prompts
 * to create jurisdiction-compliant patent drafting instructions.
 * 
 * Architecture:
 * 1. SUPERSET_PROMPTS - Base generic prompts (country-neutral)
 * 2. CountrySectionMapping (DB) - Maps superset codes to country section keys
 * 3. Country JSON (IN.json, US.json) - Seed source only; not used as runtime fallback
 * 
 * Flow: sectionId → resolve canonical key → get base prompt → merge with top-up
 */

import { prisma } from './prisma'
import { getCountryProfile, getSectionRules, getBaseStyle } from './country-profile-service'
import { getSectionPrompt as getDbSectionPrompt } from './section-prompt-service'
import { getUserInstruction, buildUserInstructionBlock, type UserInstructionContext } from './user-instruction-service'

// Import superset prompts dynamically to avoid circular imports
let SUPERSET_PROMPTS: Record<string, { instruction: string; constraints: string[] }> | null = null

async function getSupersetPrompts() {
  if (!SUPERSET_PROMPTS) {
    const { SUPERSET_PROMPTS: prompts } = await import('./drafting-service')
    SUPERSET_PROMPTS = prompts
  }
  return SUPERSET_PROMPTS
}

// ============================================================================
// Types
// ============================================================================

export interface MergedPrompt {
  /** Combined instruction: base + country-specific + user */
  instruction: string
  /** Combined constraints from base and country top-up */
  constraints: string[]
  /** Country-specific instruction only (for debugging/transparency) */
  topUpInstruction?: string
  /** User-provided instruction (highest priority) */
  userInstruction?: UserInstructionContext
  /** User instruction block formatted for LLM */
  userInstructionBlock?: string
  /** Localized section heading for this jurisdiction */
  sectionLabel: string
  /** Canonical superset key (e.g., "background", "claims") */
  sectionKey: string
  /** Country-specific rules from JSON */
  countryRules?: any
  /** Base style from country profile */
  baseStyle?: {
    tone: string
    voice: string
    avoid: string[]
  }
  /** Merge strategy used */
  mergeStrategy: 'append' | 'prepend' | 'replace'
  /** When true, bypass LLM and import figure titles directly (for Brief Description of Drawings) */
  importFiguresDirectly?: boolean
  
  // Debug info for B+T+U panel
  /** Debug: Has base superset prompt */
  hasBase: boolean
  /** Debug: Has country-specific top-up prompt */
  hasTopUp: boolean
  /** Debug: Has user instruction */
  hasUser: boolean
  /** Debug: Source of top-up (db or json) */
  topUpSource?: 'db' | 'json' | null
  /** Debug: Base prompt preview (first 100 chars) */
  basePreview?: string
  /** Debug: TopUp prompt preview (first 100 chars) */
  topUpPreview?: string
}

export interface SectionLookup {
  supersetCode: string      // "01. Title", "05. Background"
  sectionKey: string        // "title", "background"
  countryHeading: string    // Country-specific heading
  jsonSectionId: string     // Key in prompts.sections
  isRequired: boolean
  isApplicable: boolean     // false if "(N/A)" or "(Implicit)"
}

export type MergeStrategy = 'append' | 'prepend' | 'replace'

// ============================================================================
// Section Key Resolution
// ============================================================================

/**
 * Mapping from common aliases to canonical superset keys
 */
const SECTION_KEY_ALIASES: Record<string, string> = {
  // Title variants
  'title': 'title',
  'title_of_invention': 'title',
  
  // Field variants
  'field': 'fieldOfInvention',
  'field_of_invention': 'fieldOfInvention',
  'technical_field': 'fieldOfInvention',
  'fieldofinvention': 'fieldOfInvention',
  
  // Background variants
  'background': 'background',
  'background_art': 'background',
  'background_of_invention': 'background',
  
  // Summary variants
  'summary': 'summary',
  'summary_of_invention': 'summary',
  'brief_summary': 'summary',
  
  // Detailed description variants
  'detailed_description': 'detailedDescription',
  'detaileddescription': 'detailedDescription',
  'description': 'detailedDescription',
  'detailed_desc': 'detailedDescription',
  
  // Claims variants
  'claims': 'claims',
  
  // Abstract variants
  'abstract': 'abstract',
  'abstract_of_disclosure': 'abstract',
  
  // Drawings variants
  'brief_drawings': 'briefDescriptionOfDrawings',
  'brief_description_of_drawings': 'briefDescriptionOfDrawings',
  'briefdescriptionofdrawings': 'briefDescriptionOfDrawings',
  'drawings': 'briefDescriptionOfDrawings',
  
  // Preamble
  'preamble': 'preamble',
  
  // Cross-reference
  'cross_reference': 'crossReference',
  'crossreference': 'crossReference',
  'cross_ref': 'crossReference',
  
  // Objects - maps to 'objectsOfInvention' which is the internal key used by sectionKeyMap
  'objects': 'objectsOfInvention',
  'objects_of_invention': 'objectsOfInvention',
  'objectsofinvention': 'objectsOfInvention',
  'objectsOfInvention': 'objectsOfInvention',
  'object_of_the_invention': 'objectsOfInvention',
  
  // Technical problem/solution (Asian jurisdictions)
  'technical_problem': 'technicalProblem',
  'technicalproblem': 'technicalProblem',
  'technical_solution': 'technicalSolution',
  'technicalsolution': 'technicalSolution',
  'advantageous_effects': 'advantageousEffects',
  'advantageouseffects': 'advantageousEffects',
  
  // Best mode
  'best_mode': 'bestMethod',
  'best_method': 'bestMethod',
  'bestmethod': 'bestMethod',
  
  // Industrial applicability
  'industrial_applicability': 'industrialApplicability',
  'industrialapplicability': 'industrialApplicability',
  'utility': 'industrialApplicability'
}

/**
 * Resolves any section identifier to its canonical superset key
 * 
 * Resolution order:
 * 1. Direct match in SUPERSET_PROMPTS
 * 2. Alias lookup
 * 3. Database mapping (CountrySectionMapping)
 * 4. Country profile canonicalKeys
 */
export async function resolveSectionKey(
  countryCode: string,
  inputSectionId: string
): Promise<string | null> {
  const supersetPrompts = await getSupersetPrompts()
  const normalizedInput = inputSectionId.toLowerCase().replace(/[^a-z0-9]/g, '')
  
  // 1. Direct match in SUPERSET_PROMPTS
  if (supersetPrompts[inputSectionId]) {
    return inputSectionId
  }
  
  // 2. Try alias lookup
  const aliasKey = SECTION_KEY_ALIASES[normalizedInput] || SECTION_KEY_ALIASES[inputSectionId.toLowerCase()]
  if (aliasKey && supersetPrompts[aliasKey]) {
    return aliasKey
  }
  
  // 3. Try database mapping
  try {
    const mapping = await prisma.countrySectionMapping.findFirst({
      where: {
        countryCode: countryCode.toUpperCase(),
        OR: [
          { sectionKey: inputSectionId },
          { sectionKey: { equals: normalizedInput, mode: 'insensitive' } },
          { supersetCode: { contains: inputSectionId, mode: 'insensitive' } }
        ]
      }
    })
    
    if (mapping?.sectionKey && supersetPrompts[mapping.sectionKey]) {
      return mapping.sectionKey
    }
  } catch (error) {
    console.warn('Error looking up section mapping:', error)
  }
  
  // 4. Try country profile canonicalKeys
  try {
    const profile = await getCountryProfile(countryCode)
    if (profile) {
      const variant = profile.profileData?.structure?.variants?.find(
        (v: any) => v.id === profile.profileData?.structure?.defaultVariant
      ) || profile.profileData?.structure?.variants?.[0]
      
      if (variant?.sections) {
        for (const section of variant.sections) {
          // Check if input matches section id or any canonical key
          if (section.id === inputSectionId || 
              section.id?.toLowerCase() === normalizedInput ||
              section.canonicalKeys?.some((k: string) => 
                k.toLowerCase() === normalizedInput || k === inputSectionId
              )) {
            // Return first canonicalKey that maps to superset
            for (const key of section.canonicalKeys || []) {
              const normalized = SECTION_KEY_ALIASES[key.toLowerCase().replace(/[^a-z0-9]/g, '')]
              if (normalized && supersetPrompts[normalized]) {
                return normalized
              }
              if (supersetPrompts[key]) {
                return key
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Error looking up country profile:', error)
  }
  
  return null
}

// ============================================================================
// Prompt Merging
// ============================================================================

/**
 * Get merged prompt combining base superset + country top-up + user instructions
 * 
 * This is the main entry point for getting jurisdiction-aware prompts.
 * 
 * Hierarchy (lowest to highest priority):
 * 1. SUPERSET_PROMPTS - Base universal prompts
 * 2. Country top-up - Database or JSON country-specific guidance
 * 3. User instructions - Per-session user customizations (HIGHEST)
 * 
 * @param countryCode - ISO country code (e.g., "IN", "US")
 * @param sectionId - Section identifier
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getMergedPrompt(
  countryCode: string,
  sectionId: string,
  sessionId?: string
): Promise<MergedPrompt | null> {
  const jurisdiction = countryCode.toUpperCase()
  const supersetPrompts = await getSupersetPrompts()
  
  // Step 1: Resolve to canonical section key
  const canonicalKey = await resolveSectionKey(jurisdiction, sectionId)
  if (!canonicalKey) {
    console.warn(`[PromptMerger] No canonical key found for "${sectionId}" in ${jurisdiction}`)
    return null
  }
  
  // Step 2: Get base superset prompt
  const basePrompt = supersetPrompts[canonicalKey]
  if (!basePrompt) {
    console.warn(`[PromptMerger] No superset prompt for key: ${canonicalKey}`)
    return null
  }
  
  // Step 3: Get country profile
  const profile = await getCountryProfile(jurisdiction)
  
  // Step 4: Determine merge strategy
  const mergeStrategy: MergeStrategy = 
    profile?.profileData?.meta?.promptMergeStrategy || 'append'
  
  // Step 5: Get country-specific section prompt (top-up) from DB only (no JSON fallback)
  let topUp: { instruction?: string; constraints?: string[]; additions?: string[]; importFiguresDirectly?: boolean } | null = null
  let topUpSource: 'db' | 'json' | null = null
  let importFiguresDirectly = false
  
  // Try database first
  const dbTopUp = await getDbSectionPrompt(jurisdiction, canonicalKey)
  if (dbTopUp) {
    topUp = dbTopUp
    topUpSource = 'db'
    importFiguresDirectly = dbTopUp.importFiguresDirectly || false
  }
  
  // Step 6: Get localized heading from DB mapping
  let sectionLabel = getDefaultLabel(canonicalKey)
  try {
    const mapping = await prisma.countrySectionMapping.findFirst({
      where: {
        countryCode: jurisdiction,
        sectionKey: canonicalKey
      }
    })
    if (mapping?.heading && 
        mapping.heading !== '(N/A)' && 
        mapping.heading !== '(Implicit)' &&
        mapping.heading !== '(Recommended/NA)' &&
        mapping.heading !== '(Include in Detailed Desc)') {
      sectionLabel = mapping.heading
    }
  } catch (error) {
    console.warn('Error getting section mapping:', error)
  }
  
  // Step 7: Get country-specific rules
  const countryRules = await getCountryRulesForSection(jurisdiction, canonicalKey, profile)
  
  // Step 8: Get base style
  const baseStyle = await getBaseStyle(jurisdiction)
  
  // Step 9: Get user instructions (HIGHEST PRIORITY) if sessionId provided
  // Looks for jurisdiction-specific instruction first, then falls back to wildcard
  let userInstr: UserInstructionContext | null = null
  let userInstructionBlock = ''
  if (sessionId) {
    try {
      userInstr = await getUserInstruction(sessionId, canonicalKey, jurisdiction)
      if (userInstr) {
        userInstructionBlock = buildUserInstructionBlock(userInstr)
      }
    } catch (error) {
      console.warn('Error getting user instruction:', error)
    }
  }
  
  // Step 10: MERGE prompts based on strategy
  const hasUser = !!userInstr
  let mergedInstruction = mergeInstructions(
    basePrompt.instruction,
    topUp?.instruction,
    mergeStrategy,
    jurisdiction,
    sectionLabel,
    hasUser
  )
  
  // Append user instructions at the end (highest priority)
  if (userInstructionBlock) {
    mergedInstruction += userInstructionBlock
  }
  
  const mergedConstraints = mergeConstraints(
    basePrompt.constraints || [],
    topUp?.constraints || [],
    topUp?.additions || [],
    jurisdiction
  )
  
  // Build debug info
  const hasBase = !!basePrompt?.instruction
  const hasTopUp = !!topUp?.instruction
  
  return {
    instruction: mergedInstruction,
    constraints: mergedConstraints,
    topUpInstruction: topUp?.instruction,
    userInstruction: userInstr || undefined,
    userInstructionBlock: userInstructionBlock || undefined,
    sectionLabel,
    sectionKey: canonicalKey,
    countryRules,
    baseStyle: baseStyle ? {
      tone: baseStyle.tone || 'technical, neutral, precise',
      voice: baseStyle.voice || 'impersonal_third_person',
      avoid: baseStyle.avoid || []
    } : undefined,
    mergeStrategy,
    importFiguresDirectly, // Special mode: bypass LLM and import figure titles directly
    // Debug fields for B+T+U panel
    hasBase,
    hasTopUp,
    hasUser,
    topUpSource,
    basePreview: basePrompt?.instruction?.substring(0, 100) + (basePrompt?.instruction?.length > 100 ? '...' : ''),
    topUpPreview: topUp?.instruction?.substring(0, 100) + (topUp?.instruction && topUp.instruction.length > 100 ? '...' : '')
  }
}

/**
 * Build the priority hierarchy header for LLM prompt
 * This helps the LLM understand which instructions take precedence in case of conflicts
 */
function buildPriorityHierarchyHeader(
  jurisdiction: string,
  hasBase: boolean,
  hasTopUp: boolean,
  hasUser: boolean
): string {
  const activeLayers: string[] = []
  if (hasBase) activeLayers.push('BASE (universal)')
  if (hasTopUp) activeLayers.push(`COUNTRY-SPECIFIC (${jurisdiction})`)
  if (hasUser) activeLayers.push('USER CUSTOM (session)')
  
  return `
┌─────────────────────────────────────────────────────────────────────────────┐
│  INSTRUCTION PRIORITY HIERARCHY (follow in case of conflicts)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Priority 1 (LOWEST):  BASE PROMPT - Universal patent drafting guidelines   │
│  Priority 2 (MEDIUM):  COUNTRY TOP-UP - ${jurisdiction.padEnd(3, ' ')} jurisdiction-specific rules      │
│  Priority 3 (HIGHEST): USER INSTRUCTIONS - Custom session instructions      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Active instruction layers: ${activeLayers.join(' → ').padEnd(44, ' ')} │
│  If instructions conflict, ALWAYS follow the HIGHER priority instruction.  │
└─────────────────────────────────────────────────────────────────────────────┘

`
}

/**
 * Merge base instruction with country-specific top-up
 */
function mergeInstructions(
  baseInstruction: string,
  topUpInstruction?: string,
  strategy: MergeStrategy = 'append',
  jurisdiction?: string,
  sectionLabel?: string,
  hasUser?: boolean
): string {
  const hasBase = !!baseInstruction
  const hasTopUp = !!topUpInstruction
  
  // Add priority hierarchy header
  const priorityHeader = buildPriorityHierarchyHeader(
    jurisdiction || 'UNIVERSAL',
    hasBase,
    hasTopUp,
    hasUser || false
  )
  
  if (!topUpInstruction) {
    return priorityHeader + `**[PRIORITY 1 - BASE PROMPT]:**\n${baseInstruction}`
  }
  
  const baseLabel = '**[PRIORITY 1 - BASE PROMPT]:**\n'
  const topUpLabel = `**[PRIORITY 2 - ${jurisdiction} COUNTRY TOP-UP]:**\n`
  
  switch (strategy) {
    case 'replace':
      // Country completely overrides base (still show hierarchy)
      return priorityHeader + `${topUpLabel}${topUpInstruction}\n\n(Note: Country prompt replaces base prompt for this section)`
      
    case 'prepend':
      // Country guidance comes first
      return priorityHeader + `${topUpLabel}${topUpInstruction}\n\n${baseLabel}${baseInstruction}`
      
    case 'append':
    default:
      // Base first, then country additions
      return priorityHeader + `${baseLabel}${baseInstruction}\n\n${topUpLabel}${topUpInstruction}`
  }
}

/**
 * Merge constraints arrays intelligently
 * - Deduplicates similar constraints
 * - Tags country-specific constraints
 * - Preserves order (base first, then country)
 */
function mergeConstraints(
  baseConstraints: string[],
  topUpConstraints: string[],
  additions: string[] = [],
  jurisdiction?: string
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  
  // Normalize for deduplication
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50)
  
  // Add base constraints first
  for (const c of baseConstraints) {
    const normalized = normalize(c)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      merged.push(c)
    }
  }
  
  // Add country-specific constraints with jurisdiction tag
  const countryConstraints = [...topUpConstraints, ...additions]
  for (const c of countryConstraints) {
    const normalized = normalize(c)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      // Tag with jurisdiction for transparency
      merged.push(jurisdiction ? `[${jurisdiction}] ${c}` : c)
    }
  }
  
  return merged
}

/**
 * Get country-specific rules for a section from profile
 */
async function getCountryRulesForSection(
  countryCode: string,
  sectionKey: string,
  profile: any
): Promise<any> {
  if (!profile?.profileData?.rules) return null
  
  const rules = profile.profileData.rules
  
  // Map section keys to rule blocks
  const ruleMap: Record<string, string[]> = {
    'title': ['title', 'global'],
    'abstract': ['abstract', 'global'],
    'claims': ['claims'],
    'detailedDescription': ['description', 'detailed_description'],
    'briefDescriptionOfDrawings': ['drawings'],
    'background': ['description'],
    'summary': ['description'],
    'industrialApplicability': ['procedural'],
    'bestMethod': ['description'],
    'preamble': ['global'],
    'crossReference': ['procedural']
  }
  
  const ruleKeys = ruleMap[sectionKey] || [sectionKey]
  
  // Collect all applicable rules
  const collectedRules: any = {}
  for (const key of ruleKeys) {
    if (rules[key]) {
      Object.assign(collectedRules, rules[key])
    }
  }
  
  return Object.keys(collectedRules).length > 0 ? collectedRules : null
}

// ============================================================================
// Section Lookup Utilities
// ============================================================================

/**
 * Get complete section lookup for a country
 * Returns all sections with their mapping and applicability status
 */
export async function getSectionLookup(
  countryCode: string
): Promise<SectionLookup[]> {
  const jurisdiction = countryCode.toUpperCase()
  
  try {
    // IMPORTANT: Order by displayOrder - this is the ONLY source of truth for section sequence
    const mappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: jurisdiction },
      orderBy: { displayOrder: 'asc' }
    })
    
    return mappings.map(m => ({
      supersetCode: m.supersetCode,
      sectionKey: m.sectionKey,
      countryHeading: m.heading,
      jsonSectionId: m.sectionKey, // Default to sectionKey
      isRequired: isRequiredSection(m.sectionKey),
      isApplicable: isApplicableHeading(m.heading)
    }))
  } catch (error) {
    console.error('Error getting section lookup:', error)
    return []
  }
}

/**
 * Get list of applicable section keys for a country
 * Filters out (N/A) and (Implicit) sections
 */
export async function getApplicableSectionsForCountry(
  countryCode: string
): Promise<string[]> {
  const lookup = await getSectionLookup(countryCode)
  return lookup
    .filter(s => s.isApplicable)
    .map(s => s.sectionKey)
}

/**
 * Get required section keys for a country
 */
export async function getRequiredSectionsForCountry(
  countryCode: string
): Promise<string[]> {
  const lookup = await getSectionLookup(countryCode)
  return lookup
    .filter(s => s.isApplicable && s.isRequired)
    .map(s => s.sectionKey)
}

// ============================================================================
// Helper Functions
// ============================================================================

function isRequiredSection(sectionKey: string): boolean {
  const optionalSections = [
    'preamble',
    'objectsOfInvention',
    'crossReference',
    'technicalProblem',
    'technicalSolution',
    'advantageousEffects',
    'bestMethod',
    'industrialApplicability'
  ]
  return !optionalSections.includes(sectionKey)
}

function isApplicableHeading(heading: string): boolean {
  if (!heading) return false
  const lowerHeading = heading.toLowerCase().trim()
  return lowerHeading !== '(n/a)' && 
         lowerHeading !== '(implicit)' && 
         lowerHeading !== 'n/a' &&
         heading.trim() !== ''
}

function getDefaultLabel(sectionKey: string): string {
  const labels: Record<string, string> = {
    title: 'Title of Invention',
    preamble: 'Preamble',
    crossReference: 'Cross-Reference to Related Applications',
    fieldOfInvention: 'Technical Field',
    background: 'Background',
    objectsOfInvention: 'Objects of the Invention',
    summary: 'Summary of the Invention',
    technicalProblem: 'Technical Problem',
    technicalSolution: 'Technical Solution',
    advantageousEffects: 'Advantageous Effects',
    briefDescriptionOfDrawings: 'Brief Description of the Drawings',
    detailedDescription: 'Detailed Description',
    bestMethod: 'Best Mode',
    industrialApplicability: 'Industrial Applicability',
    claims: 'Claims',
    abstract: 'Abstract'
  }
  return labels[sectionKey] || sectionKey
}

// ============================================================================
// Batch Operations (for drafting multiple sections efficiently)
// ============================================================================

/**
 * Get merged prompts for multiple sections at once
 * More efficient than calling getMergedPrompt multiple times
 * 
 * @param countryCode - ISO country code
 * @param sectionIds - Array of section identifiers
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getMergedPromptsForSections(
  countryCode: string,
  sectionIds: string[],
  sessionId?: string
): Promise<Map<string, MergedPrompt>> {
  const results = new Map<string, MergedPrompt>()
  
  // Process in parallel
  const promises = sectionIds.map(async (sectionId) => {
    const merged = await getMergedPrompt(countryCode, sectionId, sessionId)
    if (merged) {
      results.set(sectionId, merged)
    }
  })
  
  await Promise.all(promises)
  return results
}

/**
 * Get all applicable merged prompts for a country
 * 
 * @param countryCode - ISO country code
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getAllMergedPromptsForCountry(
  countryCode: string,
  sessionId?: string
): Promise<Map<string, MergedPrompt>> {
  const applicableSections = await getApplicableSectionsForCountry(countryCode)
  return getMergedPromptsForSections(countryCode, applicableSections, sessionId)
}
