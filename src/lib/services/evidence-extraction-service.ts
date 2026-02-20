import crypto from 'crypto';
import { z } from 'zod';
import { llmGateway, type TenantContext } from '../metering';
import {
  extractionCardSchema,
  EVIDENCE_CLAIM_TYPES,
  EVIDENCE_CONFIDENCE_LEVELS,
  type ExtractedEvidenceCard,
  type PreparedPaperText,
  type DeepAnalysisLabel,
  type ReferenceArchetype,
  DEFAULT_CARD_TARGETS,
} from './deep-analysis-types';

const SINGLE_CALL_TOKEN_LIMIT = 25_000;
const LLM_MAX_RETRIES = 1;
const LLM_RETRY_DELAY_MS = 2_000;

const SYSTEM_PROMPT_BASE = `You are a research evidence extractor.
Read the paper text and return structured evidence cards for academic drafting.

CRITICAL RULES:
1. Every card must include sourceFragment as an exact verbatim quote (1-3 sentences).
2. Quantitative claims must include exact numbers from the text (metrics, n, p-values, CI where present).
3. For FINDING and METHOD cards, doesNotSupport is mandatory.
4. Set confidence strictly from evidence strength in the text:
   - HIGH: clear quantitative evidence with strong methodological support
   - MEDIUM: evidence present but partial detail or narrower scope
   - LOW: weak, indirect, or uncertain evidence
5. Output valid JSON only. No markdown, no explanations.

OUTPUT FORMAT:
Return a JSON array of objects with fields:
claim, claimType, quantitativeDetail, conditions, comparableMetrics,
doesNotSupport, scopeCondition, studyDesign, rigorIndicators,
sourceFragment, pageHint, confidence, sourceSection.`;

const ARCHETYPE_INSTRUCTIONS: Record<ReferenceArchetype, string> = {
  SYSTEM_ALGO_EVALUATION: `Focus on metrics, baselines, datasets, architecture decisions, and ablations.
Use studyDesign values like benchmark evaluation, ablation study, user study, simulation.`,
  CONTROLLED_EXPERIMENTAL_STUDY: `Focus on intervention/control details, effect sizes, confidence intervals, p-values,
randomization/blinding, and group sizes.`,
  EMPIRICAL_OBSERVATIONAL_STUDY: `Focus on associations/predictors with coefficients, AUC, OR, R2, and confounders.
Always note that causation is not established in doesNotSupport when applicable.`,
  MIXED_METHODS_APPLIED_STUDY: `Extract both quantitative and qualitative findings. Prefix claim with [QUANT] or [QUAL].
Capture triangulation and divergence between components.`,
  SYNTHESIS_REVIEW: `Focus on pooled estimates, heterogeneity, number of studies, search strategy scope,
quality/risk of bias, and explicit research gaps.`,
  POSITION_CONCEPTUAL: `Focus on definitions, frameworks, and conceptual arguments.
Use doesNotSupport to state these are theoretical claims, not empirical proof.`,
};

const DEPTH_INSTRUCTIONS: Record<Exclude<DeepAnalysisLabel, 'LIT_ONLY'>, string> = {
  DEEP_ANCHOR: `Extract 8-15 cards across all sections, balancing grounded findings, synthesis-ready metrics,
methodological rigor, boundaries, and verbatim accuracy.`,
  DEEP_SUPPORT: `Extract 3-6 focused cards mainly from methods/results. Prioritize grounded findings and methodology details.`,
  DEEP_STRESS_TEST: `Extract 4-8 cards from methods/results/discussion/limitations.
Prioritize boundaries, contrasts, and methodological caveats.`,
};

function normalizeArchetype(value: string | null | undefined): ReferenceArchetype {
  const upper = String(value || '').trim().toUpperCase();
  if ((Object.keys(ARCHETYPE_INSTRUCTIONS) as ReferenceArchetype[]).includes(upper as ReferenceArchetype)) {
    return upper as ReferenceArchetype;
  }
  return 'SYSTEM_ALGO_EVALUATION';
}

function normalizeDepth(value: string | null | undefined): Exclude<DeepAnalysisLabel, 'LIT_ONLY'> {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'DEEP_ANCHOR' || upper === 'DEEP_SUPPORT' || upper === 'DEEP_STRESS_TEST') {
    return upper;
  }
  return 'DEEP_SUPPORT';
}

interface ExtractionPrompt {
  system: string;
  user: string;
}

function buildExtractionPrompt(
  archetype: ReferenceArchetype,
  depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
  preparedText: PreparedPaperText,
  blueprintDimensions: string[]
): ExtractionPrompt {
  const system = [
    SYSTEM_PROMPT_BASE,
    ARCHETYPE_INSTRUCTIONS[archetype],
    DEPTH_INSTRUCTIONS[depthLabel],
    `Output format: JSON array of cards with fields:
claim, claimType, quantitativeDetail, conditions, comparableMetrics,
doesNotSupport, scopeCondition, studyDesign, rigorIndicators,
sourceFragment, pageHint, confidence, sourceSection`,
  ].join('\n\n');

  const dimensionContext = blueprintDimensions.length > 0
    ? `Blueprint context dimensions (for relevance only):\n${blueprintDimensions.map(d => `- ${d}`).join('\n')}`
    : '';

  const user = [
    '=== PAPER TEXT ===',
    preparedText.fullText,
    dimensionContext,
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

function stripJsonFences(value: string): string {
  const trimmed = String(value || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}

function recoverJsonArray(raw: string): { parsed: unknown; recovered: boolean } {
  const candidate = String(raw || '').trim();
  if (!candidate) {
    throw new Error('Empty response');
  }

  try {
    return {
      parsed: JSON.parse(candidate),
      recovered: false,
    };
  } catch {
    // Fall through to recovery attempts.
  }

  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start !== -1 && end > start) {
    return {
      parsed: JSON.parse(candidate.slice(start, end + 1)),
      recovered: true,
    };
  }

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    return {
      parsed: [JSON.parse(candidate.slice(objectStart, objectEnd + 1))],
      recovered: true,
    };
  }

  throw new Error('Unable to recover JSON');
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function downgradeConfidence(confidence: ExtractedEvidenceCard['confidence']): ExtractedEvidenceCard['confidence'] {
  if (confidence === 'HIGH') return 'MEDIUM';
  if (confidence === 'MEDIUM') return 'LOW';
  return 'LOW';
}

function enforceCardRules(card: ExtractedEvidenceCard, index: number, warnings: string[]): ExtractedEvidenceCard {
  let next = { ...card };

  if ((next.claimType === 'FINDING' || next.claimType === 'METHOD') && !hasNonEmptyText(next.doesNotSupport)) {
    warnings.push(`Card ${index}: doesNotSupport missing for ${next.claimType}, confidence downgraded`);
    next.doesNotSupport = 'Not explicitly stated in source text.';
    next.confidence = downgradeConfidence(next.confidence);
  }

  if (hasNonEmptyText(next.quantitativeDetail) && !next.comparableMetrics) {
    warnings.push(`Card ${index}: quantitativeDetail present without comparableMetrics, confidence downgraded`);
    next.confidence = downgradeConfidence(next.confidence);
  }

  return next;
}

const CLAIM_TYPE_SET = new Set<string>(EVIDENCE_CLAIM_TYPES);
const CONFIDENCE_SET = new Set<string>(EVIDENCE_CONFIDENCE_LEVELS);

const CLAIM_TYPE_ALIASES: Record<string, string> = {
  FINDINGS: 'FINDING',
  RESULT: 'FINDING',
  RESULTS: 'FINDING',
  OBSERVATION: 'FINDING',
  EVIDENCE: 'FINDING',
  OUTCOME: 'FINDING',
  PERFORMANCE: 'FINDING',
  COMPARISON: 'FINDING',
  METHODOLOGY: 'METHOD',
  METHODS: 'METHOD',
  APPROACH: 'METHOD',
  TECHNIQUE: 'METHOD',
  PROCEDURE: 'METHOD',
  ALGORITHM: 'METHOD',
  IMPLEMENTATION: 'METHOD',
  DESIGN: 'METHOD',
  SETUP: 'METHOD',
  DATASET: 'METHOD',
  DATA: 'METHOD',
  EXPERIMENT: 'METHOD',
  EVALUATION: 'METHOD',
  BENCHMARK: 'METHOD',
  METRIC: 'METHOD',
  BOUNDARY: 'LIMITATION',
  CONSTRAINT: 'LIMITATION',
  WEAKNESS: 'LIMITATION',
  THREAT: 'LIMITATION',
  CAVEAT: 'LIMITATION',
  BIAS: 'LIMITATION',
  RESEARCH_GAP: 'GAP',
  FUTURE_WORK: 'GAP',
  OPEN_PROBLEM: 'GAP',
  CONCEPT: 'DEFINITION',
  TERM: 'DEFINITION',
  THEORY: 'FRAMEWORK',
  MODEL: 'FRAMEWORK',
  ARCHITECTURE: 'FRAMEWORK',
  PARADIGM: 'FRAMEWORK',
  CONTEXT: 'FINDING',
  BACKGROUND: 'FINDING',
  CONTRIBUTION: 'FINDING',
};

function coerceToStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const joined = value.map(item => String(item ?? '')).filter(Boolean).join('; ');
    return joined || null;
  }
  return String(value);
}

function normalizeCardBeforeParse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const result = { ...obj };

  if (typeof result.claimType === 'string') {
    const upper = result.claimType.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (CLAIM_TYPE_SET.has(upper)) {
      result.claimType = upper;
    } else if (CLAIM_TYPE_ALIASES[upper]) {
      result.claimType = CLAIM_TYPE_ALIASES[upper];
    } else {
      result.claimType = 'FINDING';
    }
  }

  if (typeof result.confidence === 'string') {
    const upper = result.confidence.trim().toUpperCase();
    result.confidence = CONFIDENCE_SET.has(upper) ? upper : 'MEDIUM';
  }

  if (typeof result.claim_type === 'string' && !result.claimType) {
    const upper = String(result.claim_type).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (CLAIM_TYPE_SET.has(upper)) {
      result.claimType = upper;
    } else if (CLAIM_TYPE_ALIASES[upper]) {
      result.claimType = CLAIM_TYPE_ALIASES[upper];
    } else {
      result.claimType = 'FINDING';
    }
    delete result.claim_type;
  }
  if (result.source_fragment !== undefined && !result.sourceFragment) {
    result.sourceFragment = coerceToStringOrNull(result.source_fragment) ?? result.source_fragment;
    delete result.source_fragment;
  }
  if (result.source_section !== undefined && !result.sourceSection) {
    result.sourceSection = coerceToStringOrNull(result.source_section) ?? result.source_section;
    delete result.source_section;
  }
  if (result.quantitative_detail !== undefined && result.quantitativeDetail === undefined) {
    result.quantitativeDetail = coerceToStringOrNull(result.quantitative_detail);
    delete result.quantitative_detail;
  }
  if (result.does_not_support !== undefined && result.doesNotSupport === undefined) {
    result.doesNotSupport = coerceToStringOrNull(result.does_not_support);
    delete result.does_not_support;
  }
  if (result.scope_condition !== undefined && result.scopeCondition === undefined) {
    result.scopeCondition = coerceToStringOrNull(result.scope_condition);
    delete result.scope_condition;
  }
  if (result.study_design !== undefined && result.studyDesign === undefined) {
    result.studyDesign = coerceToStringOrNull(result.study_design);
    delete result.study_design;
  }
  if (result.rigor_indicators !== undefined && result.rigorIndicators === undefined) {
    result.rigorIndicators = coerceToStringOrNull(result.rigor_indicators);
    delete result.rigor_indicators;
  }
  if (result.page_hint !== undefined && result.pageHint === undefined) {
    result.pageHint = coerceToStringOrNull(result.page_hint);
    delete result.page_hint;
  }
  if (result.comparable_metrics !== undefined && result.comparableMetrics === undefined) {
    result.comparableMetrics = result.comparable_metrics;
    delete result.comparable_metrics;
  }

  // Coerce camelCase fields that LLMs may return as arrays instead of strings
  const stringFields = [
    'rigorIndicators', 'studyDesign', 'scopeCondition', 'doesNotSupport',
    'quantitativeDetail', 'conditions', 'pageHint',
  ] as const;
  for (const field of stringFields) {
    if (result[field] !== undefined && result[field] !== null && typeof result[field] !== 'string') {
      result[field] = coerceToStringOrNull(result[field]);
    }
  }

  if (typeof result.comparableMetrics === 'string') {
    const metricsStr = result.comparableMetrics.trim();
    if (!metricsStr) {
      result.comparableMetrics = null;
    } else {
      try {
        const parsed = JSON.parse(metricsStr);
        result.comparableMetrics = typeof parsed === 'object' && parsed !== null ? parsed : { value: metricsStr };
      } catch {
        const pairs: Record<string, string> = {};
        const segments = metricsStr.split(/[;,]\s*/);
        for (const segment of segments) {
          const colonIdx = segment.indexOf(':');
          if (colonIdx > 0) {
            pairs[segment.slice(0, colonIdx).trim()] = segment.slice(colonIdx + 1).trim();
          } else {
            pairs.value = (pairs.value ? pairs.value + '; ' : '') + segment.trim();
          }
        }
        result.comparableMetrics = Object.keys(pairs).length > 0 ? pairs : { value: metricsStr };
      }
    }
  }

  if (Array.isArray(result.comparableMetrics)) {
    const obj: Record<string, string> = {};
    (result.comparableMetrics as unknown[]).forEach((item, i) => {
      if (typeof item === 'string') {
        obj[`metric_${i}`] = item;
      } else if (item && typeof item === 'object') {
        Object.assign(obj, item);
      }
    });
    result.comparableMetrics = Object.keys(obj).length > 0 ? obj : null;
  }

  return result;
}

function parseExtractionResponse(rawOutput: string, depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>): { cards: ExtractedEvidenceCard[]; warnings: string[] } {
  const warnings: string[] = [];
  let jsonText = stripJsonFences(rawOutput);

  let parsed: unknown;
  try {
    const recovered = recoverJsonArray(jsonText);
    parsed = recovered.parsed;
    if (recovered.recovered) {
      warnings.push('JSON recovered from partial response');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid output';
    console.error(`[EvidenceExtraction] JSON parse failed. Raw output (first 500 chars): ${rawOutput.slice(0, 500)}`);
    throw new Error(`LLM returned invalid JSON (${message})`);
  }

  if (!Array.isArray(parsed)) {
    console.error(`[EvidenceExtraction] Output is not array. Type=${typeof parsed}. Raw (first 300 chars): ${rawOutput.slice(0, 300)}`);
    throw new Error('LLM extraction output is not an array');
  }

  console.log(`[EvidenceExtraction] Received ${parsed.length} raw cards from LLM, validating...`);

  const validCards: ExtractedEvidenceCard[] = [];

  for (let index = 0; index < parsed.length; index += 1) {
    const normalized = normalizeCardBeforeParse(parsed[index]);

    const strict = extractionCardSchema.safeParse(normalized);
    if (strict.success) {
      validCards.push(enforceCardRules(strict.data, index, warnings));
      continue;
    }

    const lenientSchema = extractionCardSchema.extend({
      sourceFragment: z.string().min(1).max(1200),
      rigorIndicators: z.string().nullable().default(null),
      studyDesign: z.string().nullable().default(null),
      conditions: z.string().nullable().default(null),
    });
    const lenient = lenientSchema.safeParse(normalized);

    if (lenient.success) {
      warnings.push(`Card ${index}: lenient validation applied, confidence downgraded to LOW`);
      validCards.push(enforceCardRules({ ...lenient.data, confidence: 'LOW' }, index, warnings));
    } else {
      const firstError = strict.error.errors[0];
      const message = firstError
        ? `${firstError.path.join('.')}: ${firstError.message}`
        : 'validation failed';
      console.warn(`[EvidenceExtraction] Card ${index} dropped: ${message}. Keys: ${Object.keys(parsed[index] || {}).join(',')}`);
      warnings.push(`Card ${index}: dropped (${message})`);
    }
  }

  const expectedMin = depthLabel === 'DEEP_ANCHOR' ? 5 : 2;
  if (validCards.length < expectedMin) {
    warnings.push(`Only ${validCards.length} valid cards (expected >=${expectedMin})`);
  }

  if (validCards.length === 0) {
    const sampleKeys = parsed[0] ? Object.keys(parsed[0] as object).join(', ') : '(empty)';
    const sampleClaimType = parsed[0] ? String((parsed[0] as any).claimType || (parsed[0] as any).claim_type || '(missing)') : '(no card)';
    console.error(`[EvidenceExtraction] All ${parsed.length} cards failed validation. Sample keys=[${sampleKeys}], claimType="${sampleClaimType}"`);
    throw new Error(`No valid evidence cards extracted (${parsed.length} cards received but all failed schema validation)`);
  }

  console.log(`[EvidenceExtraction] Validated ${validCards.length}/${parsed.length} cards`);
  return { cards: validCards, warnings };
}

function deduplicateCards(cards: ExtractedEvidenceCard[]): ExtractedEvidenceCard[] {
  const rank: Record<ExtractedEvidenceCard['confidence'], number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };
  const byFingerprint = new Map<string, ExtractedEvidenceCard>();

  for (const card of cards) {
    const fingerprint = `${card.claimType}:${card.claim.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    const existing = byFingerprint.get(fingerprint);
    if (!existing || rank[card.confidence] > rank[existing.confidence]) {
      byFingerprint.set(fingerprint, card);
    }
  }

  return Array.from(byFingerprint.values());
}

function splitAtMidpoint(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  const paragraphBreak = text.indexOf('\n\n', mid);
  if (paragraphBreak !== -1 && paragraphBreak <= mid + 2000) {
    return [text.slice(0, paragraphBreak), text.slice(paragraphBreak)];
  }

  const lineBreak = text.indexOf('\n', mid);
  if (lineBreak !== -1) {
    return [text.slice(0, lineBreak), text.slice(lineBreak)];
  }

  return [text.slice(0, mid), text.slice(mid)];
}

function splitPreparedText(preparedText: PreparedPaperText): [PreparedPaperText, PreparedPaperText] {
  if (preparedText.sections && preparedText.sections.length >= 2) {
    const sections = preparedText.sections;
    const frontPattern = /intro|method|material|experimental|dataset|setup|participant/i;
    const backPattern = /result|finding|discussion|conclusion|limitation|future/i;
    const frontMatches = sections.filter(section => frontPattern.test(section.heading));
    const backMatches = sections.filter(section => backPattern.test(section.heading));

    if (frontMatches.length > 0 && backMatches.length > 0) {
      const firstBackIdx = sections.indexOf(backMatches[0]);
      const splitPoint = Math.max(1, firstBackIdx);
      const firstHalf = sections.slice(0, splitPoint);
      const secondHalf = sections.slice(splitPoint);

      if (firstHalf.length > 0 && secondHalf.length > 0) {
        const frontText = firstHalf.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
        const backText = secondHalf.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
        return [
          { ...preparedText, sections: firstHalf, fullText: frontText, estimatedTokens: Math.ceil(frontText.length / 4) },
          { ...preparedText, sections: secondHalf, fullText: backText, estimatedTokens: Math.ceil(backText.length / 4) },
        ];
      }
    }

    const midpoint = Math.ceil(sections.length / 2);
    const first = sections.slice(0, midpoint);
    const second = sections.slice(midpoint);
    const firstText = first.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');
    const secondText = second.map(section => `## ${section.heading}\n\n${section.text}`).join('\n\n');

    return [
      { ...preparedText, sections: first, fullText: firstText, estimatedTokens: Math.ceil(firstText.length / 4) },
      { ...preparedText, sections: second, fullText: secondText, estimatedTokens: Math.ceil(secondText.length / 4) },
    ];
  }

  const [firstHalf, secondHalf] = splitAtMidpoint(preparedText.fullText);
  return [
    { ...preparedText, sections: undefined, fullText: firstHalf, estimatedTokens: Math.ceil(firstHalf.length / 4) },
    { ...preparedText, sections: undefined, fullText: secondHalf, estimatedTokens: Math.ceil(secondHalf.length / 4) },
  ];
}

export interface ExtractEvidenceCardsInput {
  citationId: string;
  citationKey: string;
  referenceArchetype?: string | null;
  deepAnalysisLabel?: string | null;
  preparedText: PreparedPaperText;
  blueprintDimensions: string[];
  tenantContext?: TenantContext | null;
}

export interface ExtractEvidenceCardsResult {
  cards: ExtractedEvidenceCard[];
  warnings: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

class EvidenceExtractionService {
  private async extractSingle(
    input: ExtractEvidenceCardsInput,
    preparedText: PreparedPaperText,
    depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
    archetype: ReferenceArchetype
  ): Promise<ExtractEvidenceCardsResult> {
    const prompt = buildExtractionPrompt(
      archetype,
      depthLabel,
      preparedText,
      input.blueprintDimensions
    );

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[EvidenceExtraction] Retrying ${input.citationKey} (attempt ${attempt}/${LLM_MAX_RETRIES}) after ${LLM_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, LLM_RETRY_DELAY_MS));
      }

      try {
        const response = await llmGateway.executeLLMOperation(
          input.tenantContext ? { tenantContext: input.tenantContext } : { headers: {} },
          {
            taskCode: 'LLM2_DRAFT',
            stageCode: 'PAPER_LITERATURE_SUMMARIZE',
            prompt: `${prompt.system}\n\n${prompt.user}`,
            parameters: {
              purpose: 'full_text_evidence_extraction',
              temperature: 0,
            },
            idempotencyKey: `evidence_extract_${input.citationId}_${depthLabel}_${archetype}_${preparedText.source}_a${attempt}`,
            metadata: {
              citationId: input.citationId,
              citationKey: input.citationKey,
              archetype,
              depthLabel,
              source: preparedText.source,
              attempt,
            },
          }
        );

        if (!response.success || !response.response) {
          const err = new Error(response.error?.message || 'Evidence extraction LLM call failed');
          console.error(`[EvidenceExtraction] LLM call failed for ${input.citationKey} (attempt ${attempt}):`, response.error?.message);
          if (attempt < LLM_MAX_RETRIES) {
            lastError = err;
            continue;
          }
          throw err;
        }

        const rawOutput = response.response.output;
        console.log(`[EvidenceExtraction] LLM returned ${rawOutput?.length ?? 0} chars for ${input.citationKey}. First 200: ${String(rawOutput || '').slice(0, 200)}`);

        const parsed = parseExtractionResponse(rawOutput, depthLabel);
        const warnings = [...parsed.warnings];
        if (attempt > 0) {
          warnings.push(`Succeeded on retry attempt ${attempt}`);
        }
        return {
          cards: parsed.cards,
          warnings,
          usage: {
            inputTokens: Number((response.response.metadata as any)?.inputTokens || preparedText.estimatedTokens || 0),
            outputTokens: Number(response.response.outputTokens || 0),
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[EvidenceExtraction] Attempt ${attempt} failed for ${input.citationKey}: ${lastError.message}`);
        if (attempt < LLM_MAX_RETRIES) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('Evidence extraction failed after retries');
  }

  async extractCards(input: ExtractEvidenceCardsInput): Promise<ExtractEvidenceCardsResult> {
    const depthLabel = normalizeDepth(input.deepAnalysisLabel);
    const archetype = normalizeArchetype(input.referenceArchetype);
    const targets = DEFAULT_CARD_TARGETS[depthLabel];

    if (input.preparedText.estimatedTokens <= SINGLE_CALL_TOKEN_LIMIT) {
      const single = await this.extractSingle(input, input.preparedText, depthLabel, archetype);
      const deduped = deduplicateCards(single.cards).slice(0, targets.max);
      return {
        ...single,
        cards: deduped,
      };
    }

    const [firstHalf, secondHalf] = splitPreparedText(input.preparedText);
    const [firstResult, secondResult] = await Promise.all([
      this.extractSingle(input, firstHalf, depthLabel, archetype),
      this.extractSingle(input, secondHalf, depthLabel, archetype),
    ]);

    const merged = deduplicateCards([...firstResult.cards, ...secondResult.cards]);
    const warnings = [...firstResult.warnings, ...secondResult.warnings];
    warnings.push('Long paper fallback used: extracted in two parts');

    return {
      cards: merged.slice(0, targets.max),
      warnings,
      usage: {
        inputTokens: firstResult.usage.inputTokens + secondResult.usage.inputTokens,
        outputTokens: firstResult.usage.outputTokens + secondResult.usage.outputTokens,
      },
    };
  }
}

export const evidenceExtractionService = new EvidenceExtractionService();
export { EvidenceExtractionService, buildExtractionPrompt, parseExtractionResponse, deduplicateCards };
