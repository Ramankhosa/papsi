/**
 * Section Polish Service (Pass 2)
 *
 * Takes evidence-grounded Pass 1 content (with [CITE:key] anchors intact)
 * and produces publication-ready prose while strictly preserving:
 *   - every [CITE:key] anchor from Pass 1
 *   - all numbers, percentages, and quantitative claims
 *   - uncertainty / hedging language
 *
 * The polished output still uses [CITE:key] markers — downstream formatting
 * (DraftingService.formatContent) converts them to styled citations.
 */

import { llmGateway, type TenantContext } from '../metering';
import { polishDraftMarkdown, stripInlineMarkdownStyling } from '../markdown-draft-formatter';
import { sectionTemplateService } from './section-template-service';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface DimensionCitationExpectation {
  dimensionKey: string;
  dimensionLabel: string;
  expectedCitationKeys: string[];
}

export interface PolishInput {
  sectionKey: string;
  displayName: string;
  baseContent: string;
  sessionId: string;
  paperTypeCode: string;
  tenantContext?: TenantContext | null;
  dimensionCitations?: DimensionCitationExpectation[];
}

export interface DimensionCoverageEntry {
  dimensionKey: string;
  dimensionLabel: string;
  expectedCitationKeys: string[];
  presentCitationKeys: string[];
  missingCitationKeys: string[];
  covered: boolean;
}

export interface DriftReport {
  passed: boolean;
  citationParity: {
    passed: boolean;
    baseCiteKeys: string[];
    polishedCiteKeys: string[];
    missing: string[];
    added: string[];
  };
  numberPreservation: {
    passed: boolean;
    baseNumbers: string[];
    polishedNumbers: string[];
    missing: string[];
    added: string[];
  };
  dimensionCoverage?: {
    passed: boolean;
    dimensions: DimensionCoverageEntry[];
    uncoveredDimensions: string[];
  };
}

export interface PolishResult {
  success: boolean;
  polishedContent?: string;
  driftReport?: DriftReport;
  promptUsed?: string;
  tokensUsed?: number;
  error?: string;
}

// ============================================================================
// Drift Guard Helpers
// ============================================================================

const CITE_PATTERN = /\[CITE:([^\]]+)\]/g;

function extractCiteKeys(text: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CITE_PATTERN.source, 'g');
  while ((m = re.exec(text)) !== null) {
    keys.push(m[1].trim());
  }
  return keys;
}

/**
 * Extract meaningful numbers from text — integers, decimals, percentages,
 * and scientific notation. Ignores citation anchors and markdown syntax.
 */
function extractNumbers(text: string): string[] {
  const cleaned = text
    .replace(CITE_PATTERN, '')            // strip citation anchors
    .replace(/#{1,6}\s/g, '')             // strip heading markers
    .replace(/\[(?:CITATION_NEEDED)[^\]]*\]/g, '');

  const numberPattern = /(?<![a-zA-Z])(\d[\d,]*\.?\d*%?(?:\s*[×x]\s*10\^?\d+)?)/g;
  const nums: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberPattern.exec(cleaned)) !== null) {
    const n = m[1].replace(/,/g, '').trim();
    if (n.length > 0 && n !== '0') nums.push(n);
  }
  return Array.from(new Set(nums));
}

function buildDriftReport(
  baseContent: string,
  polishedContent: string,
  dimensionCitations?: DimensionCitationExpectation[]
): DriftReport {
  const baseCites = extractCiteKeys(baseContent);
  const polishedCites = extractCiteKeys(polishedContent);

  const baseSet = new Set(baseCites);
  const polishedSet = new Set(polishedCites);
  const missingCites = baseCites.filter(k => !polishedSet.has(k));
  const addedCites = polishedCites.filter(k => !baseSet.has(k));

  const baseNums = extractNumbers(baseContent);
  const polishedNums = extractNumbers(polishedContent);
  const baseNumSet = new Set(baseNums);
  const polishedNumSet = new Set(polishedNums);
  const missingNums = baseNums.filter(n => !polishedNumSet.has(n));
  const addedNums = polishedNums.filter(n => !baseNumSet.has(n));

  const citationParity = {
    passed: missingCites.length === 0 && addedCites.length === 0,
    baseCiteKeys: baseCites,
    polishedCiteKeys: polishedCites,
    missing: missingCites,
    added: addedCites,
  };

  const numberPreservation = {
    passed: missingNums.length === 0 && addedNums.length === 0,
    baseNumbers: baseNums,
    polishedNumbers: polishedNums,
    missing: missingNums,
    added: addedNums,
  };

  let dimensionCoverage: DriftReport['dimensionCoverage'];
  if (dimensionCitations && dimensionCitations.length > 0) {
    const dimensions: DimensionCoverageEntry[] = dimensionCitations.map(dim => {
      const presentKeys = dim.expectedCitationKeys.filter(k => polishedSet.has(k));
      const missingKeys = dim.expectedCitationKeys.filter(k => !polishedSet.has(k));
      return {
        dimensionKey: dim.dimensionKey,
        dimensionLabel: dim.dimensionLabel,
        expectedCitationKeys: dim.expectedCitationKeys,
        presentCitationKeys: presentKeys,
        missingCitationKeys: missingKeys,
        covered: dim.expectedCitationKeys.length === 0 || presentKeys.length > 0,
      };
    });
    const uncoveredDimensions = dimensions
      .filter(d => !d.covered)
      .map(d => d.dimensionLabel);
    dimensionCoverage = {
      passed: uncoveredDimensions.length === 0,
      dimensions,
      uncoveredDimensions,
    };
  }

  return {
    passed: citationParity.passed && numberPreservation.passed,
    citationParity,
    numberPreservation,
    dimensionCoverage,
  };
}

// ============================================================================
// Polish Prompt Builder — DB-driven paper-type guidance + system guardrails
// ============================================================================

/**
 * Build the Pass 2 polish prompt by composing:
 *   1. System guardrails (citation/number preservation, factual fidelity)
 *   2. Paper-type-specific publication guidance from the database
 *   3. The Pass 1 draft to polish
 *
 * The paper-type prompt (PaperTypeSectionPrompt.instruction) carries the
 * publication-type-specific guidance — how a journal article reads vs a
 * conference paper, etc. If no override exists for this combination, only
 * the system guardrails are applied.
 */
async function buildPolishPrompt(
  input: PolishInput,
  isRetry: boolean,
  previousReport?: DriftReport
): Promise<string> {
  const retryBlock = isRetry && previousReport ? `
═══════════════════════════════════════════════════════════════════════════════
⚠️  RETRY — PREVIOUS ATTEMPT FAILED VALIDATION
═══════════════════════════════════════════════════════════════════════════════
Your previous polish attempt failed drift validation. Fix THESE SPECIFIC issues:
${previousReport.citationParity.missing.length > 0 ? `• MISSING CITATIONS (must restore): ${previousReport.citationParity.missing.map(k => `[CITE:${k}]`).join(', ')}` : ''}
${previousReport.citationParity.added.length > 0 ? `• ADDED CITATIONS (must remove): ${previousReport.citationParity.added.map(k => `[CITE:${k}]`).join(', ')}` : ''}
${previousReport.numberPreservation.missing.length > 0 ? `• MISSING NUMBERS (must restore): ${previousReport.numberPreservation.missing.join(', ')}` : ''}
${previousReport.numberPreservation.added.length > 0 ? `• FABRICATED NUMBERS (must remove): ${previousReport.numberPreservation.added.join(', ')}` : ''}
Pay extreme attention to citation anchors. Every [CITE:key] from the input MUST appear in your output.
` : '';

  // Fetch paper-type-specific guidance from the database
  let publicationTypeBlock = '';
  try {
    const typePrompt = await sectionTemplateService.getPass2TypePrompt(
      input.sectionKey,
      input.paperTypeCode
    );
    if (typePrompt) {
      const parts: string[] = [typePrompt.instruction];

      if (typePrompt.additions.length > 0) {
        parts.push(typePrompt.additions.join('\n'));
      }

      const constraintNotes: string[] = [];
      if (typePrompt.constraints.wordLimit) {
        constraintNotes.push(`Target length: ~${typePrompt.constraints.wordLimit} words`);
      }
      if (typePrompt.constraints.styleRequirements?.length) {
        constraintNotes.push(`Style: ${typePrompt.constraints.styleRequirements.join(', ')}`);
      }
      if (typePrompt.constraints.tenseRequirements?.length) {
        constraintNotes.push(`Tense: ${typePrompt.constraints.tenseRequirements.join(', ')}`);
      }
      if (constraintNotes.length > 0) {
        parts.push(constraintNotes.join('\n'));
      }

      publicationTypeBlock = `
═══════════════════════════════════════════════════════════════════════════════
PUBLICATION TYPE GUIDANCE (${input.paperTypeCode.replace(/_/g, ' ')})
═══════════════════════════════════════════════════════════════════════════════
${parts.join('\n\n')}
`;
    }
  } catch (err) {
    console.warn(`[SectionPolish] Could not load paper-type prompt for ${input.paperTypeCode}/${input.sectionKey}:`, err);
  }

  return `
═══════════════════════════════════════════════════════════════════════════════
TASK: PUBLICATION POLISH — ${input.displayName.toUpperCase()}
═══════════════════════════════════════════════════════════════════════════════

You are a senior academic editor. Rewrite the draft below into polished,
publication-ready prose. The draft already contains all the correct facts,
evidence, and citation anchors — your job is ONLY to improve readability,
flow, and academic tone.
${retryBlock}
═══════════════════════════════════════════════════════════════════════════════
STRICT RULES — VIOLATIONS CAUSE AUTOMATIC REJECTION
═══════════════════════════════════════════════════════════════════════════════

1. CITATION ANCHORS — MANDATORY PRESERVATION
   • Every [CITE:key] marker in the draft MUST appear in your output.
   • Do NOT drop, rename, merge, or invent any [CITE:key] anchor.
   • You may reposition a citation within the same sentence or adjacent
     sentence if it improves flow, but the anchor string must be identical.
   • Citation format is ALWAYS: [CITE:ExactKey] — do not change the key text.

2. FACTUAL FIDELITY
   • Do NOT add new claims, statistics, entities, or findings.
   • Do NOT remove or soften existing claims.
   • Preserve all numbers, percentages, p-values, and quantitative data verbatim.
   • If the draft says "may" or "suggests", keep that hedging — do not upgrade
     to "proves" or "demonstrates" unless the draft already uses those words.

3. STRUCTURAL PRESERVATION
   • Keep the same subsection headings (### level).
   • Maintain the same logical order of arguments.
   • You may split or merge paragraphs for readability.
   • Keep bullet points if they serve clarity.

4. WHAT YOU SHOULD IMPROVE
   • Sentence flow and transitions between paragraphs.
   • Eliminate awkward phrasing, redundancy, and filler.
   • Ensure consistent academic register throughout.
   • Strengthen topic sentences and paragraph cohesion.
   • Smooth transitions between subsections.

5. HEDGING AND SCOPE GUARD
   • Downgrade "demonstrates/proves" to "suggests/indicates" for single-study findings.
   • Preserve scope conditions and boundary notes.
   • Do not generalize beyond stated scope.
   • If noveltyType = TRANSLATIONAL, replace innovation verbs with validation/adaptation verbs where necessary.

6. RHYTHM PRESERVATION
   • Preserve contrast paragraphs.
   • Avoid flattening argumentative tension.
   • If 3+ paragraphs share structure, vary one.
   • Maintain varied sentence lengths.
${publicationTypeBlock}
═══════════════════════════════════════════════════════════════════════════════
DRAFT TO POLISH
═══════════════════════════════════════════════════════════════════════════════
${input.baseContent}

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════
Return ONLY the polished section content in Markdown. No JSON wrapping,
no code fences, no preamble. Start directly with the content.
Every [CITE:key] from the draft above MUST appear in your output.`;
}

// ============================================================================
// Service
// ============================================================================

class SectionPolishService {

  async polish(input: PolishInput): Promise<PolishResult> {
    return this.runPolishPass(input, false);
  }

  async polishWithRetry(input: PolishInput): Promise<PolishResult> {
    const firstAttempt = await this.runPolishPass(input, false);

    if (firstAttempt.success && firstAttempt.driftReport?.passed) {
      return firstAttempt;
    }

    if (!firstAttempt.success) {
      return firstAttempt;
    }

    console.warn(
      `[SectionPolish] Drift detected for ${input.sectionKey}, retrying.`,
      `Missing cites: ${firstAttempt.driftReport?.citationParity.missing.join(', ') || 'none'}`,
      `Missing nums: ${firstAttempt.driftReport?.numberPreservation.missing.join(', ') || 'none'}`
    );

    const retryResult = await this.runPolishPass(input, true, firstAttempt.driftReport);

    if (retryResult.success && retryResult.driftReport?.passed) {
      return retryResult;
    }

    // Retry also failed — return error, never expose Pass 1 as final
    return {
      success: false,
      driftReport: retryResult.driftReport || firstAttempt.driftReport,
      error: `Polish validation failed after retry. `
        + `Missing citations: ${retryResult.driftReport?.citationParity.missing.join(', ') || 'none'}. `
        + `Missing numbers: ${retryResult.driftReport?.numberPreservation.missing.join(', ') || 'none'}.`,
    };
  }

  private async runPolishPass(
    input: PolishInput,
    isRetry: boolean,
    previousReport?: DriftReport
  ): Promise<PolishResult> {
    const prompt = await buildPolishPrompt(input, isRetry, previousReport);

    try {
      const result = await llmGateway.executeLLMOperation(
        input.tenantContext ? { tenantContext: input.tenantContext } : { headers: {} },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'PAPER_SECTION_GEN',
          prompt,
          parameters: {
            purpose: 'section_polish_pass2',
            temperature: 0.3,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId: input.sessionId,
            sectionKey: input.sectionKey,
            purpose: 'section_polish_pass2',
            isRetry,
          },
        }
      );

      if (!result.success || !result.response) {
        return {
          success: false,
          promptUsed: prompt,
          error: result.error?.message || 'LLM call failed during polish pass',
        };
      }

      let polished = (result.response.output || '').trim();

      // Strip code fences if model wraps output
      const fenceMatch = polished.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        polished = fenceMatch[1].trim();
      }

      polished = stripInlineMarkdownStyling(polishDraftMarkdown(polished));

      const driftReport = buildDriftReport(input.baseContent, polished, input.dimensionCitations);

      return {
        success: true,
        polishedContent: polished,
        driftReport,
        promptUsed: prompt,
        tokensUsed: result.response.outputTokens,
      };
    } catch (error) {
      return {
        success: false,
        promptUsed: prompt,
        error: error instanceof Error ? error.message : 'Unknown polish error',
      };
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export const sectionPolishService = new SectionPolishService();
export { extractCiteKeys, extractNumbers, buildDriftReport };
