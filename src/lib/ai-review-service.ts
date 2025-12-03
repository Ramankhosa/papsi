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
  jurisdiction: string
  inventionTitle?: string
  components?: Array<{ name: string; numeral: string }>
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
    const { draft, figures, jurisdiction, inventionTitle, components } = context
    
    // Build comprehensive review prompt
    const prompt = buildReviewPrompt(draft, figures, jurisdiction, inventionTitle, components)
    
    // Use LLM for review (using drafting task code)
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders || {} },
      {
        taskCode: 'LLM2_DRAFT', // Using drafting task code for review operations
        prompt,
        parameters: {
          tenantId,
          purpose: 'ai_draft_review',
          temperature: 0.3 // Low temperature for consistent, analytical responses
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
          overallScore: 0,
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
        overallScore: 0,
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
  components?: Array<{ name: string; numeral: string }>
): string {
  // Build sections text
  const sectionsText = Object.entries(draft)
    .filter(([_, content]) => content && content.trim().length > 0)
    .map(([key, content]) => `### ${SECTION_LABELS[key] || key}\n${content.substring(0, 3000)}${content.length > 3000 ? '...[truncated]' : ''}`)
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
${isReferenceDraft ? `
6. **REFERENCE DRAFT - TRANSLATION READINESS** (CRITICAL for multi-jurisdiction)
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
    "overallScore": 75,
    "recommendation": "Brief overall assessment and next steps"
  }
}

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
- If the draft is good, return fewer issues with high score
- Return valid JSON only, no markdown fences or explanations`
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseReviewResponse(output: string): {
  issues: AIReviewIssue[]
  summary: AIReviewResult['summary']
} {
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
      throw new Error('No JSON object found')
    }
    
    text = text.slice(start, end + 1)
    text = text.replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
    
    const parsed = JSON.parse(text)
    
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
      overallScore: typeof parsed.summary?.overallScore === 'number' 
        ? Math.min(100, Math.max(0, parsed.summary.overallScore)) 
        : calculateScore(issues),
      recommendation: parsed.summary?.recommendation || getDefaultRecommendation(errors, warnings)
    }
    
    return { issues, summary }
  } catch (error) {
    console.error('Failed to parse AI review response:', error)
    return {
      issues: [],
      summary: {
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        suggestions: 0,
        overallScore: 50,
        recommendation: 'Review completed but response parsing failed. Manual review recommended.'
      }
    }
  }
}

function calculateScore(issues: AIReviewIssue[]): number {
  if (issues.length === 0) return 95
  
  let deduction = 0
  for (const issue of issues) {
    if (issue.type === 'error') deduction += issue.severity * 5
    else if (issue.type === 'warning') deduction += issue.severity * 2
    else deduction += issue.severity * 0.5
  }
  
  return Math.max(0, Math.min(100, 100 - deduction))
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

  return `You are a patent text editor. Your task is to revise a specific section to fix an identified issue.

═══════════════════════════════════════════════════════════════════════════════
FIX INSTRUCTION (Follow this precisely)
═══════════════════════════════════════════════════════════════════════════════
${issue.fixPrompt}

═══════════════════════════════════════════════════════════════════════════════
ADDITIONAL CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Issue Category: ${issue.category}
Issue Title: ${issue.title}
${contextBlock}

═══════════════════════════════════════════════════════════════════════════════
CURRENT SECTION CONTENT (to be revised)
═══════════════════════════════════════════════════════════════════════════════
${originalContent}

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
1. Apply ONLY the fix described above
2. Preserve all other content that is not related to the issue
3. Maintain the same writing style and format
4. Keep reference numerals consistent with the declared components
5. Output ONLY the revised section text - no explanations, no prefixes

OUTPUT THE REVISED SECTION TEXT BELOW:`
}

