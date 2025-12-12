/**
 * AI Review Service
 * 
 * Uses Gemini for comprehensive patent draft review:
 * - Cross-section consistency (claims vs description)
 * - Diagram-description alignment (PlantUML analysis)
 * - Missing features detection
 * - Section-wise recommendations
 */

import { llmGateway } from '@/lib/metering'
import crypto from 'crypto'

// ============================================================================
// Types
// ============================================================================

export interface AIReviewIssue {
  id: string
  sectionKey: string
  sectionLabel: string
  type: 'error' | 'warning' | 'suggestion'
  category: 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity' | 'translation'
  title: string
  description: string
  suggestion: string
  fixPrompt: string // Prompt to pass to section regeneration
  relatedSections?: string[]
  severity: number // 1-5, 5 being most severe
}

export interface AIReviewResult {
  success: boolean
  issues: AIReviewIssue[]
  summary: {
    totalIssues: number
    errors: number
    warnings: number
    suggestions: number
    overallScore: number // 0-100
    recommendation: string
  }
  reviewedAt: string
  tokensUsed?: number
  error?: string
}

export interface ReviewContext {
  draft: Record<string, string>
  figures: Array<{
    figureNo: number
    title: string
    plantuml: string
  }>
  /** Sketches from figure planner - include description to prevent false "missing figure" errors */
  sketches?: Array<{
    figureNo: number
    title: string
    description: string
    isIncluded: boolean // Whether it's in the final figure sequence
  }>
  jurisdiction: string
  inventionTitle?: string
  components?: Array<{ name: string; numeral: string }>
  /** Section validation limits from CountrySectionValidation table */
  sectionLimits?: Array<{
    sectionKey: string
    maxWords?: number
    minWords?: number
    recommendedWords?: number
    maxChars?: number
    maxCount?: number
    maxIndependent?: number
    wordLimitMessage?: string
    charLimitMessage?: string
    legalReference?: string
  }>
  /** Cross-section validation rules from CountryCrossValidation table */
  crossValidations?: Array<{
    ruleKey: string
    sourceSection: string
    targetSection: string
    ruleName: string
    description: string
    severity: string
    validationLogic?: string
  }>
}

// ============================================================================
// Section Labels for Display
// ============================================================================

const SECTION_LABELS: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  field: 'Field of Invention',
  fieldOfInvention: 'Field of Invention',
  background: 'Background',
  technicalProblem: 'Technical Problem',
  objectsOfInvention: 'Objects of Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method / Mode',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals'
}

// ============================================================================
// Main Review Function
// ============================================================================

/**
 * Run comprehensive AI review on a patent draft
 * Uses Gemini 3 for critical analysis
 */
export async function runAIReview(
  context: ReviewContext,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<AIReviewResult> {
  try {
    const { draft, figures, jurisdiction, inventionTitle, components, sketches, sectionLimits, crossValidations } = context
    
    // Build comprehensive review prompt with all context
    const prompt = buildReviewPrompt(
      draft, 
      figures, 
      jurisdiction, 
      inventionTitle, 
      components,
      sketches,
      sectionLimits,
      crossValidations
    )
    
    // Use LLM for review - uses admin-configured model via DRAFT_REVIEW stage
    // The review task requires strong reasoning and structured JSON output
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'DRAFT_REVIEW', // Use stage config for admin-configured model/limits
        prompt,
        parameters: {
          tenantId,
          purpose: 'ai_draft_review',
          temperature: 0.3, // Low temperature for consistent, analytical responses
          maxOutputTokens: 8000 // Higher limit for comprehensive review output
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          purpose: 'ai_draft_review',
          jurisdiction,
          sectionsReviewed: Object.keys(draft).length,
          figuresReviewed: figures.length
        }
      }
    )

    if (!result.success || !result.response) {
      return {
        success: false,
        issues: [],
        summary: {
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          overallScore: 75, // Minimum baseline even on failure
          recommendation: 'Review failed - please try again'
        },
        reviewedAt: new Date().toISOString(),
        error: result.error?.message || 'AI review failed'
      }
    }

    // Parse the review response
    const reviewData = parseReviewResponse(result.response.output)
    
    return {
      success: true,
      issues: reviewData.issues,
      summary: reviewData.summary,
      reviewedAt: new Date().toISOString(),
      tokensUsed: result.response.outputTokens
    }
  } catch (error) {
    console.error('AI Review error:', error)
    return {
      success: false,
      issues: [],
      summary: {
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        suggestions: 0,
        overallScore: 75, // Minimum baseline even on failure
        recommendation: 'Review failed due to an error'
      },
      reviewedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildReviewPrompt(
  draft: Record<string, string>,
  figures: Array<{ figureNo: number; title: string; plantuml: string }>,
  jurisdiction: string,
  inventionTitle?: string,
  components?: Array<{ name: string; numeral: string }>,
  sketches?: Array<{ figureNo: number; title: string; description: string; isIncluded: boolean }>,
  sectionLimits?: Array<{ sectionKey: string; maxWords?: number; minWords?: number; recommendedWords?: number; maxChars?: number; maxCount?: number; maxIndependent?: number; wordLimitMessage?: string; charLimitMessage?: string; legalReference?: string }>,
  crossValidations?: Array<{ ruleKey: string; sourceSection: string; targetSection: string; ruleName: string; description: string; severity: string; validationLogic?: string }>
): string {
  // Build sections text - increased limit to 15000 chars per section for comprehensive review
  // Critical sections like claims and detailedDescription need full content for proper analysis
  const sectionsText = Object.entries(draft)
    .filter(([_, content]) => content && content.trim().length > 0)
    .map(([key, content]) => {
      const maxLen = ['claims', 'detailedDescription', 'summary'].includes(key) ? 20000 : 10000
      const truncated = content.length > maxLen
      return `### ${SECTION_LABELS[key] || key}\n${content.substring(0, maxLen)}${truncated ? `\n\n[Note: Section continues for ${content.length - maxLen} more characters. Review the portion shown above.]` : ''}`
    })
    .join('\n\n')

  // Build comprehensive figures text with PlantUML and extracted elements
  let figuresText = 'No figures provided'
  if (figures.length > 0) {
    const figureDetails = figures.map(f => {
      // Extract components and arrows from PlantUML
      const componentMatches = f.plantuml.match(/(?:rectangle|component|node|database|actor|usecase|storage|cloud|folder|frame|package)\s+["']?([^"'\[\]{}]+)["']?\s*(?:as\s+(\w+))?/gi) || []
      const arrowMatches = f.plantuml.match(/(\w+)\s*(?:-->|->|<--|<-|--|\.\.>|\.\.)\s*(\w+)/gi) || []
      const numeralMatches = f.plantuml.match(/\((\d{2,3})\)/g) || []
      
      return `### Figure ${f.figureNo}: ${f.title}

**PlantUML Source Code:**
\`\`\`plantuml
${f.plantuml}
\`\`\`

**Extracted Elements from Diagram:**
- Components/Blocks: ${componentMatches.length > 0 ? componentMatches.join(', ') : 'None detected'}
- Connections/Flows: ${arrowMatches.length > 0 ? arrowMatches.slice(0, 10).join(', ') : 'None detected'}
- Reference Numerals: ${numeralMatches.length > 0 ? Array.from(new Set(numeralMatches)).join(', ') : 'None detected'}`
    }).join('\n\n')

    figuresText = `**IMPORTANT:** These diagrams are provided as PlantUML source code, NOT as rendered images.
The PlantUML code defines the structure, components, and relationships in each figure.
Analyze the code to understand what each diagram depicts.

${figureDetails}`
  }

  // Build sketches text - these are conceptual drawings, not missing figures
  let sketchesText = ''
  if (sketches && sketches.length > 0) {
    const sketchDetails = sketches.map(s => 
      `- Figure ${s.figureNo}: "${s.title}" - ${s.description}${s.isIncluded ? ' [INCLUDED IN FINAL]' : ' [SKETCH ONLY - not in final figures]'}`
    ).join('\n')
    sketchesText = `

═══════════════════════════════════════════════════════════════════════════════
SKETCHES (Conceptual Drawings - Reference Only)
═══════════════════════════════════════════════════════════════════════════════
**NOTE:** These are conceptual sketches planned for the patent. They may not all be in the final figure set.
Do NOT flag these as "missing figures" - they are additional visual aids, not gaps in the specification.

${sketchDetails}`
  }

  // Build section limits text for jurisdiction-specific validation
  let sectionLimitsText = ''
  if (sectionLimits && sectionLimits.length > 0) {
    const limitsDetails = sectionLimits.map(l => {
      const limits: string[] = []
      if (l.maxWords) limits.push(`max ${l.maxWords} words`)
      if (l.minWords) limits.push(`min ${l.minWords} words`)
      if (l.recommendedWords) limits.push(`recommended ${l.recommendedWords} words`)
      if (l.maxChars) limits.push(`max ${l.maxChars} characters`)
      if (l.maxCount) limits.push(`max ${l.maxCount} claims`)
      if (l.maxIndependent) limits.push(`max ${l.maxIndependent} independent claims`)
      const message = l.wordLimitMessage || l.charLimitMessage || ''
      const ref = l.legalReference ? ` (${l.legalReference})` : ''
      return `- ${SECTION_LABELS[l.sectionKey] || l.sectionKey}: ${limits.join(', ')}${message ? ` - ${message}` : ''}${ref}`
    }).join('\n')
    sectionLimitsText = `

═══════════════════════════════════════════════════════════════════════════════
SECTION LIMITS (${jurisdiction} Jurisdiction Requirements)
═══════════════════════════════════════════════════════════════════════════════
Check if sections exceed these official limits:

${limitsDetails}

⚠️ Flag any sections that exceed their limits as errors with specific counts.`
  }

  // Build cross-validation rules text
  let crossValidationsText = ''
  if (crossValidations && crossValidations.length > 0) {
    const validationDetails = crossValidations.map(cv => 
      `- [${cv.severity.toUpperCase()}] ${cv.ruleName}: ${cv.description} (${cv.sourceSection} → ${cv.targetSection})`
    ).join('\n')
    crossValidationsText = `

═══════════════════════════════════════════════════════════════════════════════
CROSS-SECTION VALIDATION RULES (${jurisdiction} Jurisdiction)
═══════════════════════════════════════════════════════════════════════════════
These are jurisdiction-specific consistency checks:

${validationDetails}

⚠️ Check each rule and flag violations. For consistency issues (e.g., claim feature missing in description),
set sectionKey to the SECTION THAT NEEDS THE FIX (usually description), not the source section (claims).`
  }

  // Build components reference with grouping
  let componentsText = 'No components defined'
  if (components && components.length > 0) {
    const sorted = [...components].sort((a, b) => parseInt(a.numeral) - parseInt(b.numeral))
    componentsText = sorted.map(c => `- ${c.name} (${c.numeral})`).join('\n')
  }

  // Special handling for REFERENCE (multi-jurisdiction base draft)
  const isReferenceDraft = jurisdiction.toUpperCase() === 'REFERENCE'
  const jurisdictionContext = isReferenceDraft
    ? `REFERENCE (Multi-Jurisdiction Base Draft)

**SPECIAL CONTEXT:** This is a REFERENCE draft - a country-neutral master document that will be translated/adapted for multiple specific jurisdictions. Review it with extra scrutiny for:
- Universal clarity that translates well across languages
- No country-specific legal language that wouldn't apply universally
- Complete technical disclosure that serves as source for all country versions
- Consistent reference numeral usage for translation accuracy
- Clear, unambiguous language that avoids idioms or region-specific terms`
    : jurisdiction

  return `You are a senior patent examiner and technical reviewer. Perform a comprehensive review of this patent draft for ${jurisdictionContext} jurisdiction.

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Title: ${inventionTitle || 'Not specified'}
Jurisdiction: ${isReferenceDraft ? 'REFERENCE (Multi-Jurisdiction Base)' : jurisdiction}

DECLARED COMPONENTS WITH REFERENCE NUMERALS:
${componentsText}

═══════════════════════════════════════════════════════════════════════════════
DRAFT SECTIONS
═══════════════════════════════════════════════════════════════════════════════
${sectionsText}

═══════════════════════════════════════════════════════════════════════════════
FIGURES & DIAGRAMS (PlantUML Source Code - Not Images)
═══════════════════════════════════════════════════════════════════════════════
${figuresText}
${sketchesText}
${sectionLimitsText}
${crossValidationsText}

═══════════════════════════════════════════════════════════════════════════════
REVIEW INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════

Analyze the draft for the following issues:

1. **CLAIMS vs DESCRIPTION CONSISTENCY**
   - Every feature in claims MUST be supported in detailed description
   - Check if claim limitations are properly disclosed
   - Identify any claim features missing from description

2. **DIAGRAM-DESCRIPTION ALIGNMENT** (Analyze PlantUML code to understand diagrams)
   - Compare PlantUML diagram structure with Brief Description of Drawings
   - Verify all reference numerals in PlantUML code appear in description text
   - Check if components shown in PlantUML match declared components above
   - Identify any diagram elements not explained in Detailed Description
   - Verify figure captions accurately describe what PlantUML shows

3. **COMPLETENESS CHECKS**
   - Are all declared components (above) mentioned and explained?
   - Does summary accurately reflect the claims?
   - Is the abstract within typical limits (150 words)?
   - Are reference numerals used consistently throughout?

4. **LEGAL/FORMAL ISSUES**
   - Claims properly numbered and dependent claims reference correctly
   - Independent claims are self-contained
   - No indefinite language without proper basis
   - Proper antecedent basis in claims

5. **CLARITY & QUALITY**
   - Ambiguous or unclear passages
   - Redundant content between sections
   - Technical accuracy concerns
${sectionLimits && sectionLimits.length > 0 ? `
6. **SECTION LENGTH LIMITS** (CRITICAL - Check against limits above)
   - Review each section against the jurisdiction-specific limits provided
   - Flag sections exceeding word/character/claim count limits as ERRORS
   - Note: For claims, check both total count AND independent claim count
` : ''}
${crossValidations && crossValidations.length > 0 ? `
7. **CROSS-SECTION CONSISTENCY** (Check rules above)
   - Apply each cross-validation rule listed above
   - For issues like "claim feature missing in description", set sectionKey to 'detailedDescription' (the fix target), NOT 'claims' (the source)
   - The fixPrompt should instruct how to add/modify the TARGET section
` : ''}
${isReferenceDraft ? `
8. **REFERENCE DRAFT - TRANSLATION READINESS** (CRITICAL for multi-jurisdiction)
   - **Language Neutrality:** Flag any country-specific legal phrases, idioms, or terms that won't translate well
   - **Universal Terminology:** Ensure technical terms are internationally recognized (not US/UK colloquialisms)
   - **Completeness for All Jurisdictions:** Check if all superset sections are properly populated
   - **Reference Numeral Consistency:** Extra strict checking - numerals must be 100% consistent for translation
   - **Unambiguous Antecedents:** No pronouns without clear antecedents (translation breaks with ambiguity)
   - **Sentence Structure:** Flag overly complex sentences that would translate poorly
   - **Cultural Neutrality:** No region-specific examples or analogies
` : ''}
═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT - CRITICAL
═══════════════════════════════════════════════════════════════════════════════

Return ONLY a JSON object with this exact structure:
{
  "issues": [
    {
      "sectionKey": "claims",
      "type": "error|warning|suggestion",
      "category": "consistency|diagram|completeness|legal|clarity|translation",
      "title": "Brief issue title (max 10 words)",
      "description": "Detailed explanation of the issue found",
      "suggestion": "Human-readable suggestion on how to fix",
      "fixPrompt": "<<CRITICAL: Write a COMPLETE, SELF-CONTAINED instruction that a SMALLER LLM can follow to rewrite the section. Include: (1) What text to look for, (2) What the problem is, (3) Exactly how to rewrite it, (4) Example of correct text if helpful. Do NOT reference 'the issue above' - the fixPrompt must be standalone.>>",
      "relatedSections": ["detailedDescription"],
      "severity": 4
    }
  ],
  "summary": {
    "overallScore": 85,
    "recommendation": "Brief overall assessment and next steps"
  }
}

═══════════════════════════════════════════════════════════════════════════════
SCORING RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

**MINIMUM SCORE: 75** - NEVER return a score below 75. The draft was generated by our 
professional system, so a baseline quality is guaranteed.

Score Range: 75-100
- 75 = Draft has issues that need attention (errors, warnings, suggestions present)
- 85 = Good draft with minor improvements needed
- 95 = Excellent draft with only polish suggestions
- 100 = Perfect draft with no issues

The remaining 25 points (from 75 to 100) are distributed based on issue count:
- Errors: Impact 70% of the 25 points (17.5 points max deduction)
- Warnings: Impact 20% of the 25 points (5 points max deduction)  
- Suggestions: Impact 10% of the 25 points (2.5 points max deduction)

Examples:
- No issues at all → Score: 100
- 2 errors, 1 warning, 1 suggestion → Score: ~82
- Only 3 suggestions → Score: ~97

═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES FOR fixPrompt FIELD
═══════════════════════════════════════════════════════════════════════════════

The fixPrompt will be passed to a lighter/smaller LLM that has NO context about this review.
It MUST be:
✓ Self-contained - Include ALL necessary context within the instruction
✓ Specific - Quote exact text that needs changing when possible
✓ Actionable - Give concrete steps, not vague guidance
✓ Complete - Include the correct replacement text or clear example

BAD fixPrompt: "Fix the antecedent basis issue mentioned above"
GOOD fixPrompt: "In Claim 2, change 'the processing unit' to 'a processing unit' since this is the first mention of this component. Then in Claim 3 which depends on Claim 2, you can use 'the processing unit' since antecedent basis is now established."

BAD fixPrompt: "Add missing component reference"
GOOD fixPrompt: "In the Detailed Description section, after the sentence ending '...data flow between modules.', add a new paragraph: 'The storage module (104) comprises a non-volatile memory configured to retain user preferences and cached data between sessions.' This introduces component 104 which is shown in Figure 1 but not currently described."

OTHER RULES:
- Severity 5 = critical (would cause rejection), 1 = minor polish
- Do NOT make up issues - only report actual problems found
- If the draft is good, return fewer issues with high score (95-100)
- Return valid JSON only, no markdown fences or explanations
- REMEMBER: Minimum score is 75, maximum is 100

═══════════════════════════════════════════════════════════════════════════════
JSON OUTPUT RULES (CRITICAL - MUST FOLLOW)
═══════════════════════════════════════════════════════════════════════════════
⚠️ DO NOT wrap output in \`\`\`json\`\`\` or any markdown - output RAW JSON only
⚠️ Start your response with { and end with }
⚠️ Ensure ALL strings are properly escaped (use \\n for newlines, \\" for quotes)
⚠️ Every array element MUST be separated by a comma
⚠️ NO trailing commas after the last element
⚠️ Keep fixPrompt values on a single line (escape newlines as \\n)
⚠️ Limit to 5-8 most important issues to ensure complete output
⚠️ Keep descriptions concise (under 200 chars each) to avoid truncation`
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Attempt to repair common JSON issues from LLM output
 */
function repairJSON(text: string): string {
  let repaired = text

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1')

  // Add missing commas between array elements (object followed by object)
  repaired = repaired.replace(/\}(\s*)\{/g, '},$1{')

  // Add missing commas between string and object in array
  repaired = repaired.replace(/"(\s*)\{/g, '",$1{')

  // Fix unescaped newlines inside strings (common in fixPrompt fields)
  // This is tricky - we need to find strings and escape newlines within them
  repaired = repaired.replace(/"([^"]*?)(\r?\n)([^"]*?)"/g, (match, before, nl, after) => {
    // Only fix if it looks like it's inside a value (not a complete string)
    if (before.includes(':') || after.includes(':')) {
      return match // Likely spans multiple fields, don't touch
    }
    return `"${before}\\n${after}"`
  })

  // Fix control characters that break JSON parsing
  repaired = repaired.replace(/[\x00-\x1F\x7F]/g, (char) => {
    if (char === '\n') return '\\n'
    if (char === '\r') return '\\r'
    if (char === '\t') return '\\t'
    return '' // Remove other control chars
  })

  return repaired
}

/**
 * Extract issues array even if top-level JSON is broken or truncated
 */
function extractIssuesFromPartialJSON(text: string): any[] {
  const issues: any[] = []

  // Strategy 1: Try to find complete issue objects using regex
  const completeIssuePattern = /\{[^{}]*"sectionKey"\s*:\s*"[^"]*"[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g
  const completeMatches = text.match(completeIssuePattern)

  if (completeMatches) {
    for (const match of completeMatches) {
      try {
        const issue = JSON.parse(match)
        if (issue.sectionKey || issue.title) {
          issues.push(issue)
        }
      } catch {
        // Skip unparseable issues
      }
    }
  }

  // Strategy 2: Try to find issues array and parse it more carefully
  if (issues.length === 0) {
    const issuesArrayMatch = text.match(/"issues"\s*:\s*\[([\s\S]*?)(?:\]|$)/)
    if (issuesArrayMatch) {
      const arrayContent = issuesArrayMatch[1]
      // Split by object boundaries and try to parse each
      const objectChunks = arrayContent.split(/\}\s*,?\s*\{/)
      for (let i = 0; i < objectChunks.length; i++) {
        let chunk = objectChunks[i].trim()
        // Add back braces if needed
        if (!chunk.startsWith('{')) chunk = '{' + chunk
        if (!chunk.endsWith('}')) {
          // Try to close the object - find the last complete key-value pair
          const lastQuoteIdx = chunk.lastIndexOf('"')
          if (lastQuoteIdx > 0) {
            // Find if we're in a value or key
            const beforeQuote = chunk.substring(0, lastQuoteIdx + 1)
            if (beforeQuote.match(/"[^"]*"\s*:\s*"[^"]*"$/)) {
              chunk = beforeQuote + '}'
            }
          }
        }
        try {
          const issue = JSON.parse(chunk)
          if (issue.sectionKey || issue.title || issue.type) {
            issues.push(issue)
          }
        } catch {
          // Try with repaired JSON
          try {
            const repairedChunk = repairJSON(chunk)
            const issue = JSON.parse(repairedChunk)
            if (issue.sectionKey || issue.title || issue.type) {
              issues.push(issue)
            }
          } catch {
            // Skip this chunk
          }
        }
      }
    }
  }

  // Strategy 3: Extract key fields individually from the text for partial recovery
  if (issues.length === 0) {
    // Look for patterns like "sectionKey": "claims" followed by other fields
    const sectionKeyPattern = /"sectionKey"\s*:\s*"([^"]+)"/g
    const typePattern = /"type"\s*:\s*"([^"]+)"/g
    const titlePattern = /"title"\s*:\s*"([^"]+)"/g

    const sectionKeyMatches: string[] = []
    const typeMatches: string[] = []
    const titleMatches: string[] = []

    let match: RegExpExecArray | null
    while ((match = sectionKeyPattern.exec(text)) !== null) {
      sectionKeyMatches.push(match[1])
    }
    while ((match = typePattern.exec(text)) !== null) {
      typeMatches.push(match[1])
    }
    while ((match = titlePattern.exec(text)) !== null) {
      titleMatches.push(match[1])
    }

    // If we have at least section keys and types, create minimal issues
    if (sectionKeyMatches.length > 0 && typeMatches.length > 0) {
      for (let i = 0; i < Math.min(sectionKeyMatches.length, typeMatches.length); i++) {
        issues.push({
          sectionKey: sectionKeyMatches[i] || 'general',
          type: typeMatches[i] || 'warning',
          title: titleMatches[i] || 'Issue detected (partial parse)',
          description: 'Details unavailable due to truncated response',
          suggestion: 'Please run the review again for full details'
        })
      }
    }
  }

  console.log(`[AIReview] Extracted ${issues.length} issues from partial JSON`)
  return issues
}

function parseReviewResponse(output: string): {
  issues: AIReviewIssue[]
  summary: AIReviewResult['summary']
} {
  try {
    let text = (output || '').trim()

    console.log(`[AIReview] Raw output length: ${text.length}, starts with: ${text.substring(0, 50)}`)

    // Handle code fences - both closed and unclosed
    // First try to extract from closed fence
    const closedFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (closedFenceMatch) {
      text = closedFenceMatch[1].trim()
      console.log('[AIReview] Extracted from closed code fence')
    } else {
      // Check for unclosed fence (truncated output) - just strip the opening
      const unclosedFenceMatch = text.match(/```(?:json)?\s*([\s\S]*)/)
      if (unclosedFenceMatch && text.startsWith('```')) {
        text = unclosedFenceMatch[1].trim()
        console.log('[AIReview] Stripped unclosed code fence opening')
      }
    }

    // Find JSON object
    const start = text.indexOf('{')
    let end = text.lastIndexOf('}')

    // Handle truncated JSON - if no closing brace, try to salvage
    if (start === -1) {
      console.error('[AIReview] No opening brace found in response')
      throw new Error('No JSON object found - output may not contain JSON')
    }

    if (end === -1 || end < start) {
      console.warn('[AIReview] No closing brace found - JSON appears truncated, attempting salvage')
      // Try to extract partial data from truncated JSON
      const partialIssues = extractIssuesFromPartialJSON(text)
      if (partialIssues.length > 0) {
        console.log(`[AIReview] Salvaged ${partialIssues.length} issues from truncated JSON`)
        return {
          issues: partialIssues.map((issue: any, idx: number) => ({
            id: `ai-${idx}-${Date.now()}`,
            sectionKey: issue.sectionKey || 'general',
            sectionLabel: SECTION_LABELS[issue.sectionKey] || issue.sectionKey || 'General',
            type: (['error', 'warning', 'suggestion'].includes(issue.type) ? issue.type : 'warning') as 'error' | 'warning' | 'suggestion',
            category: (['consistency', 'diagram', 'completeness', 'legal', 'clarity', 'translation'].includes(issue.category) ? issue.category : 'clarity') as AIReviewIssue['category'],
            title: issue.title || 'Issue detected',
            description: issue.description || '',
            suggestion: issue.suggestion || '',
            fixPrompt: issue.fixPrompt || issue.suggestion || '',
            relatedSections: Array.isArray(issue.relatedSections) ? issue.relatedSections : [],
            severity: typeof issue.severity === 'number' ? Math.min(5, Math.max(1, issue.severity)) : 3
          })),
          summary: {
            totalIssues: partialIssues.length,
            errors: partialIssues.filter((i: any) => i.type === 'error').length,
            warnings: partialIssues.filter((i: any) => i.type === 'warning').length,
            suggestions: partialIssues.filter((i: any) => i.type === 'suggestion').length,
            overallScore: 75, // Minimum baseline score for partial review
            recommendation: 'Review partially completed (output was truncated). Some issues were identified.'
          }
        }
      }
      throw new Error('No complete JSON object found - output truncated')
    }

    text = text.slice(start, end + 1)

    // Try parsing with progressive repairs
    let parsed: any = null
    const parseAttempts = [
      () => JSON.parse(text), // Try raw first
      () => JSON.parse(repairJSON(text)), // Try with repairs
      () => {
        // Last resort: extract what we can
        const issues = extractIssuesFromPartialJSON(text)
        const scoreMatch = text.match(/"overallScore"\s*:\s*(\d+)/)
        const recMatch = text.match(/"recommendation"\s*:\s*"([^"]+)"/)
        return {
          issues,
          summary: {
            overallScore: scoreMatch ? parseInt(scoreMatch[1]) : undefined,
            recommendation: recMatch ? recMatch[1] : undefined
          }
        }
      }
    ]

    for (let i = 0; i < parseAttempts.length; i++) {
      try {
        parsed = parseAttempts[i]()
        if (parsed && (parsed.issues || parsed.summary)) {
          if (i > 0) {
            console.log(`[AIReview] JSON parsed successfully on attempt ${i + 1}`)
          }
          break
        }
      } catch (e) {
        if (i === parseAttempts.length - 1) {
          console.error('All JSON parse attempts failed:', e)
          throw e
        }
      }
    }

    if (!parsed) {
      throw new Error('Could not parse response')
    }

    // Process issues
    const issues: AIReviewIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: any, idx: number) => ({
          id: `ai-${idx}-${Date.now()}`,
          sectionKey: issue.sectionKey || 'general',
          sectionLabel: SECTION_LABELS[issue.sectionKey] || issue.sectionKey || 'General',
          type: (['error', 'warning', 'suggestion'].includes(issue.type) ? issue.type : 'warning') as 'error' | 'warning' | 'suggestion',
          category: (['consistency', 'diagram', 'completeness', 'legal', 'clarity', 'translation'].includes(issue.category) ? issue.category : 'clarity') as AIReviewIssue['category'],
          title: issue.title || 'Issue detected',
          description: issue.description || '',
          suggestion: issue.suggestion || '',
          fixPrompt: issue.fixPrompt || issue.suggestion || '',
          relatedSections: Array.isArray(issue.relatedSections) ? issue.relatedSections : [],
          severity: typeof issue.severity === 'number' ? Math.min(5, Math.max(1, issue.severity)) : 3
        }))
      : []

    // Count by type
    const errors = issues.filter(i => i.type === 'error').length
    const warnings = issues.filter(i => i.type === 'warning').length
    const suggestions = issues.filter(i => i.type === 'suggestion').length

    const summary = {
      totalIssues: issues.length,
      errors,
      warnings,
      suggestions,
      // Enforce minimum score of 75, use AI score if valid otherwise calculate
      overallScore: typeof parsed.summary?.overallScore === 'number'
        ? Math.min(100, Math.max(75, parsed.summary.overallScore)) // Min 75, max 100
        : calculateScore(errors, warnings, suggestions),
      recommendation: parsed.summary?.recommendation || getDefaultRecommendation(errors, warnings)
    }

    return { issues, summary }
  } catch (error) {
    console.error('Failed to parse AI review response:', error)
    // Log the raw output for debugging (first 500 chars)
    console.error('Raw output preview:', (output || '').substring(0, 500))
    return {
      issues: [],
      summary: {
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        suggestions: 0,
        overallScore: 75, // Minimum baseline score
        recommendation: 'Review completed but response parsing failed. Manual review recommended.'
      }
    }
  }
}

/**
 * Calculate score with minimum 75, max 100
 * Remaining 25 points distributed:
 * - Errors: 70% (17.5 points max deduction)
 * - Warnings: 20% (5 points max deduction)
 * - Suggestions: 10% (2.5 points max deduction)
 * 
 * As user fixes issues, score increases toward 100
 */
function calculateScore(errorCount: number, warningCount: number, suggestionCount: number): number {
  const BASE_SCORE = 75
  const REMAINING_POINTS = 25
  
  // No issues = perfect score
  if (errorCount === 0 && warningCount === 0 && suggestionCount === 0) {
    return 100
  }
  
  // Point allocations (from remaining 25)
  const ERROR_POOL = REMAINING_POINTS * 0.70     // 17.5 points
  const WARNING_POOL = REMAINING_POINTS * 0.20   // 5 points
  const SUGGESTION_POOL = REMAINING_POINTS * 0.10 // 2.5 points
  
  // Points per issue (diminishing returns for many issues)
  // First few issues have more impact, then it tapers off
  const errorDeduction = Math.min(ERROR_POOL, errorCount * 4)           // ~4 pts per error, max 17.5
  const warningDeduction = Math.min(WARNING_POOL, warningCount * 1.25)   // ~1.25 pts per warning, max 5
  const suggestionDeduction = Math.min(SUGGESTION_POOL, suggestionCount * 0.5) // ~0.5 pts per suggestion, max 2.5
  
  const totalDeduction = errorDeduction + warningDeduction + suggestionDeduction
  const score = BASE_SCORE + (REMAINING_POINTS - totalDeduction)
  
  // Ensure score is between 75 and 100
  return Math.round(Math.min(100, Math.max(BASE_SCORE, score)))
}

function getDefaultRecommendation(errors: number, warnings: number): string {
  if (errors === 0 && warnings === 0) {
    return 'Draft looks good! Ready for export.'
  } else if (errors === 0) {
    return `Found ${warnings} warning(s). Review recommended before export.`
  } else {
    return `Found ${errors} error(s) that should be fixed before filing.`
  }
}

// ============================================================================
// Fix Application
// ============================================================================

export interface FixContext {
  relatedContent?: Record<string, string>
  figures?: Array<{ figureNo: number; title: string; plantuml: string }>
  components?: Array<{ name: string; numeral: string }>
}

/**
 * Build a regeneration prompt that incorporates the fix instruction
 * Designed for a lighter LLM to apply targeted fixes
 */
export function buildFixPrompt(
  originalContent: string,
  issue: AIReviewIssue,
  context?: FixContext
): string {
  let contextBlock = ''
  
  // Add related sections if provided
  if (context?.relatedContent && Object.keys(context.relatedContent).length > 0) {
    contextBlock += '\n\n═══ RELATED SECTIONS FOR REFERENCE ═══\n' + 
      Object.entries(context.relatedContent)
        .map(([key, val]) => `### ${SECTION_LABELS[key] || key}\n${val.substring(0, 1500)}`)
        .join('\n\n')
  }

  // Add diagram context if issue is diagram-related
  if (issue.category === 'diagram' && context?.figures && context.figures.length > 0) {
    contextBlock += '\n\n═══ DIAGRAM INFORMATION (PlantUML Code) ═══\n'
    contextBlock += 'The following diagrams are part of the patent. They are provided as PlantUML code:\n\n'
    contextBlock += context.figures.map(f => 
      `Figure ${f.figureNo}: ${f.title}\n\`\`\`plantuml\n${f.plantuml.substring(0, 800)}\n\`\`\``
    ).join('\n\n')
  }

  // Add components reference if available
  if (context?.components && context.components.length > 0) {
    contextBlock += '\n\n═══ DECLARED COMPONENTS ═══\n'
    contextBlock += context.components
      .sort((a, b) => parseInt(a.numeral) - parseInt(b.numeral))
      .map(c => `- ${c.name} (${c.numeral})`)
      .join('\n')
  }

  return `You are a patent text editor performing SURGICAL, MINIMAL revisions. Your task is to fix ONE specific issue while keeping EVERYTHING ELSE exactly as-is.

═══════════════════════════════════════════════════════════════════════════════
⚠️ CRITICAL RULE: MINIMAL CHANGES ONLY
═══════════════════════════════════════════════════════════════════════════════
- Change ONLY the specific words/sentences needed to fix the issue
- Do NOT rewrite, rephrase, or "improve" any other text
- Do NOT change formatting, paragraph structure, or sentence order
- Do NOT add new content unless specifically required by the fix
- Do NOT remove content unless specifically required by the fix
- The output should be 95%+ identical to the original

═══════════════════════════════════════════════════════════════════════════════
FIX INSTRUCTION (Apply precisely, nothing more)
═══════════════════════════════════════════════════════════════════════════════
${issue.fixPrompt}

═══════════════════════════════════════════════════════════════════════════════
ADDITIONAL CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Issue Category: ${issue.category}
Issue Title: ${issue.title}
${contextBlock}

═══════════════════════════════════════════════════════════════════════════════
CURRENT SECTION CONTENT (to be revised - PRESERVE EVERYTHING NOT RELATED TO THE FIX)
═══════════════════════════════════════════════════════════════════════════════
${originalContent}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
1. Read the entire section carefully
2. Locate ONLY the specific text that relates to the issue
3. Make the MINIMUM change needed to fix the issue
4. Keep ALL other text EXACTLY as it appears (same words, punctuation, formatting)
5. Do NOT "clean up" or "improve" unrelated text
6. Output the FULL section with your minimal fix applied

═══════════════════════════════════════════════════════════════════════════════
VALIDATION CHECKLIST (Verify before output)
═══════════════════════════════════════════════════════════════════════════════
✓ Did I change ONLY what was necessary to fix the issue?
✓ Is all unrelated text EXACTLY the same as the original?
✓ Did I preserve the original formatting and paragraph structure?
✓ Is my change targeted and surgical, not a rewrite?

OUTPUT THE REVISED SECTION TEXT BELOW (full section with minimal fix applied):`
}

