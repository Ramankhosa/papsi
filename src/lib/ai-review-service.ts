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
  category: 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity'
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

  // Build figures text with PlantUML
  const figuresText = figures.length > 0
    ? figures.map(f => `### Figure ${f.figureNo}: ${f.title}\n\`\`\`plantuml\n${f.plantuml}\n\`\`\``).join('\n\n')
    : 'No figures provided'

  // Build components reference
  const componentsText = components && components.length > 0
    ? components.map(c => `- ${c.name} (${c.numeral})`).join('\n')
    : 'No components defined'

  return `You are a senior patent examiner and technical reviewer. Perform a comprehensive review of this patent draft for ${jurisdiction} jurisdiction.

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
Title: ${inventionTitle || 'Not specified'}
Jurisdiction: ${jurisdiction}

DEFINED COMPONENTS:
${componentsText}

═══════════════════════════════════════════════════════════════════════════════
DRAFT SECTIONS
═══════════════════════════════════════════════════════════════════════════════
${sectionsText}

═══════════════════════════════════════════════════════════════════════════════
FIGURES (PlantUML Source Code)
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

2. **DIAGRAM-DESCRIPTION ALIGNMENT**
   - Compare PlantUML diagrams with Brief Description of Drawings
   - Verify all reference numerals in diagrams appear in description
   - Check if figure descriptions match diagram content
   - Identify any components in diagrams not explained in text

3. **COMPLETENESS CHECKS**
   - Are all defined components (above) mentioned and explained?
   - Does summary accurately reflect the claims?
   - Is the abstract within typical limits (150 words)?
   - Are reference numerals used consistently?

4. **LEGAL/FORMAL ISSUES**
   - Claims properly numbered and dependent claims reference correctly
   - Independent claims are self-contained
   - No indefinite language ("about", "approximately") without basis
   - Proper antecedent basis in claims

5. **CLARITY & QUALITY**
   - Ambiguous or unclear passages
   - Redundant content between sections
   - Technical accuracy concerns

OUTPUT FORMAT:
Return ONLY a JSON object with this exact structure:
{
  "issues": [
    {
      "sectionKey": "claims",
      "type": "error|warning|suggestion",
      "category": "consistency|diagram|completeness|legal|clarity",
      "title": "Brief issue title",
      "description": "Detailed explanation of the issue",
      "suggestion": "How to fix this issue",
      "fixPrompt": "Specific instruction for LLM to fix this section. Be precise and actionable.",
      "relatedSections": ["detailedDescription"],
      "severity": 4
    }
  ],
  "summary": {
    "overallScore": 75,
    "recommendation": "Brief overall assessment and next steps"
  }
}

RULES:
- Be thorough but practical - focus on real issues that affect patentability
- Severity 5 = critical (would cause rejection), 1 = minor polish
- fixPrompt should be a clear instruction that can be passed to an LLM
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
          category: (['consistency', 'diagram', 'completeness', 'legal', 'clarity'].includes(issue.category) ? issue.category : 'clarity') as AIReviewIssue['category'],
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

/**
 * Build a regeneration prompt that incorporates the fix instruction
 */
export function buildFixPrompt(
  originalContent: string,
  issue: AIReviewIssue,
  relatedContent?: Record<string, string>
): string {
  let contextBlock = ''
  if (relatedContent && Object.keys(relatedContent).length > 0) {
    contextBlock = '\n\nRELATED SECTIONS FOR CONTEXT:\n' + 
      Object.entries(relatedContent)
        .map(([key, val]) => `### ${SECTION_LABELS[key] || key}\n${val.substring(0, 1500)}`)
        .join('\n\n')
  }

  return `You are revising a patent section to fix a specific issue.

ISSUE TO FIX:
- Title: ${issue.title}
- Category: ${issue.category}
- Description: ${issue.description}

FIX INSTRUCTION:
${issue.fixPrompt}
${contextBlock}

CURRENT SECTION CONTENT:
${originalContent}

TASK: Rewrite the section to address the issue while preserving all other correct content. Output ONLY the revised section text, no explanations.`
}

