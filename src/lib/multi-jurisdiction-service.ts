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
// ============================================================================

export const SUPERSET_SECTIONS = [
  'title',
  'field',
  'background',
  'technicalProblem',
  'objectsOfInvention',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'industrialApplicability',
  'claims',
  'abstract'
]

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
  const mapping: Record<string, string> = {
    'Title': 'title',
    'Field of Invention': 'field',
    'Field': 'field',
    'Background': 'background',
    'Background of Invention': 'background',
    'Technical Problem': 'technicalProblem',
    'Objects of Invention': 'objectsOfInvention',
    'Summary': 'summary',
    'Summary of Invention': 'summary',
    'Brief Description of Drawings': 'briefDescriptionOfDrawings',
    'Detailed Description': 'detailedDescription',
    'Best Method': 'bestMethod',
    'Industrial Applicability': 'industrialApplicability',
    'Claims': 'claims',
    'Abstract': 'abstract'
  }
  return mapping[label] || label.toLowerCase().replace(/\s+/g, '')
}

function normalizeToSuperset(key: string): string {
  const aliases: Record<string, string> = {
    'fieldOfInvention': 'field',
    'backgroundOfInvention': 'background',
    'technicalProblemSolved': 'technicalProblem',
    'summaryOfInvention': 'summary',
    'bestMode': 'bestMethod',
    'industrialApplication': 'industrialApplicability'
  }
  return aliases[key] || key
}

function getDefaultHeading(key: string): string {
  const headings: Record<string, string> = {
    'title': 'Title',
    'field': 'Field of Invention',
    'background': 'Background',
    'technicalProblem': 'Technical Problem',
    'objectsOfInvention': 'Objects of Invention',
    'summary': 'Summary',
    'briefDescriptionOfDrawings': 'Brief Description of Drawings',
    'detailedDescription': 'Detailed Description',
    'bestMethod': 'Best Method',
    'industrialApplicability': 'Industrial Applicability',
    'claims': 'Claims',
    'abstract': 'Abstract'
  }
  return headings[key] || key
}

// ============================================================================
// Reference Draft Generation
// ============================================================================

/**
 * Generate reference draft with ALL superset sections
 * This is the country-neutral source of truth
 */
export async function generateReferenceDraft(
  session: any,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<ReferenceDraftResult> {
  try {
    const idea = session.ideaRecord || {}
    const referenceMap = session.referenceMap || { components: [] }
    const figures = Array.isArray(session.figurePlans) ? session.figurePlans : []
    const components = Array.isArray(referenceMap.components) ? referenceMap.components : []

    // Build comprehensive prompt for ALL superset sections
    const sectionList = SUPERSET_SECTIONS.map((key, idx) => 
      `${idx + 1}. ${getDefaultHeading(key)} (key: "${key}")`
    ).join('\n')

    const prompt = `You are generating a REFERENCE PATENT DRAFT that will be translated to multiple jurisdictions.

This draft must be COUNTRY-NEUTRAL and contain ALL standard patent sections.

INVENTION CONTEXT:
Title: ${idea.title || 'Untitled'}
Problem: ${idea.problem || 'Not specified'}
Objectives: ${idea.objectives || 'Not specified'}
Components: ${components.map((c: any) => `${c.name} (${c.numeral})`).join(', ') || 'Not specified'}
Logic/Working: ${idea.logic || 'Not specified'}
${figures.length > 0 ? `Figures: ${figures.map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}

REQUIRED SECTIONS (generate ALL):
${sectionList}

OUTPUT FORMAT:
- Return ONLY a JSON object with these exact keys: ${SUPERSET_SECTIONS.map(k => `"${k}"`).join(', ')}
- Each value should be the complete section content
- Do not include markdown code fences or explanations
- Write in clear, technical English suitable for international filing

QUALITY REQUIREMENTS:
- Title: Concise, descriptive, no marketing language
- Field: 1-2 sentences identifying the technical domain
- Background: Prior art context and limitations (3-5 paragraphs)
- Technical Problem: Clear statement of the problem solved
- Objects: Bullet points of what the invention achieves
- Summary: Complete technical overview (2-4 paragraphs)
- Brief Description: One sentence per figure
- Detailed Description: Comprehensive technical disclosure with reference numerals
- Best Method: Preferred embodiment details
- Industrial Applicability: How the invention can be made/used
- Claims: Independent and dependent claims with proper numbering
- Abstract: 150-word summary of the invention`

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      parameters: { tenantId, purpose: 'reference_draft' },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId: session.patentId,
        sessionId: session.id,
        purpose: 'reference_draft_generation'
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Reference draft generation failed'
      }
    }

    // Parse response
    const draft = parseReferenceDraftResponse(result.response.output)
    
    if (!draft) {
      return {
        success: false,
        error: 'Failed to parse reference draft response'
      }
    }

    return {
      success: true,
      draft,
      tokensUsed: result.response.outputTokens
    }
  } catch (error) {
    console.error('Reference draft generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Reference draft generation failed'
    }
  }
}

function parseReferenceDraftResponse(output: string): Record<string, string> | null {
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
    if (start === -1 || end === -1) return null
    
    text = text.slice(start, end + 1)
    text = text.replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
    
    const parsed = JSON.parse(text)
    
    if (typeof parsed !== 'object' || parsed === null) return null
    
    // Validate all superset sections exist
    const draft: Record<string, string> = {}
    for (const key of SUPERSET_SECTIONS) {
      draft[key] = typeof parsed[key] === 'string' ? parsed[key].trim() : ''
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
 */
export async function translateSection(
  referenceContent: string,
  referenceSectionKey: string,
  targetJurisdiction: string,
  targetSectionKey: string,
  targetHeading: string,
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

    const prompt = `You are translating a patent section from a Reference Draft to ${code} jurisdiction format.

TASK: Pure translation/adaptation - do NOT add new technical content.

SOURCE SECTION: ${referenceSectionKey}
SOURCE CONTENT:
${referenceContent}

TARGET SECTION: ${targetSectionKey}
TARGET HEADING: "${targetHeading}"
TARGET JURISDICTION: ${code}
${constraintText}

RULES:
1. Do NOT add new technical information not in the source
2. Do NOT re-interpret or expand on the invention
3. ONLY adapt format, structure, and phrasing to ${code} requirements
4. Maintain exact technical meaning and terminology
5. Use heading format appropriate for ${code}
6. If the source content is empty, return an empty string

OUTPUT: Return ONLY the translated section content. No explanations or markdown.`

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      parameters: { 
        tenantId, 
        jurisdiction: code,
        temperature: 0, // Deterministic for translation
        purpose: 'section_translation'
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        purpose: 'section_translation',
        sourceSection: referenceSectionKey,
        targetSection: targetSectionKey,
        jurisdiction: code
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
 * Translate entire reference draft to a target jurisdiction
 */
export async function translateReferenceDraft(
  referenceDraft: Record<string, string>,
  targetJurisdiction: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<{ success: boolean; draft?: Record<string, string>; errors?: string[] }> {
  const code = targetJurisdiction.toUpperCase()
  const mappings = await getSectionMapping(code)
  
  const translatedDraft: Record<string, string> = {}
  const errors: string[] = []

  for (const mapping of mappings) {
    if (!mapping.isApplicable) {
      // Section not applicable for this jurisdiction
      translatedDraft[mapping.countryKey] = ''
      continue
    }

    const referenceContent = referenceDraft[mapping.supersetKey] || ''
    
    if (!referenceContent) {
      translatedDraft[mapping.countryKey] = ''
      continue
    }

    const result = await translateSection(
      referenceContent,
      mapping.supersetKey,
      code,
      mapping.countryKey,
      mapping.countryHeading,
      tenantId,
      requestHeaders
    )

    if (result.success && result.translatedContent) {
      translatedDraft[mapping.countryKey] = result.translatedContent
    } else {
      errors.push(`Failed to translate ${mapping.supersetKey} → ${mapping.countryKey}: ${result.error}`)
      // Use reference content as fallback
      translatedDraft[mapping.countryKey] = referenceContent
    }
  }

  return {
    success: errors.length === 0,
    draft: translatedDraft,
    errors: errors.length > 0 ? errors : undefined
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

