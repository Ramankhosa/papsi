import crypto from 'crypto';
import { llmGateway, type TenantContext } from '../metering';
import type { BlueprintWithSectionPlan } from './blueprint-service';
import {
  mappingResponseSchema,
  type ExtractedCardWithIdentity,
  type EvidenceMappingUseAs,
  type EvidenceConfidenceLevel,
} from './deep-analysis-types';

interface MappingPrompt {
  system: string;
  user: string;
}

export interface CardDimensionMapping {
  cardId: string;
  sectionKey: string;
  dimension: string;
  useAs: EvidenceMappingUseAs;
  mappingConfidence: EvidenceConfidenceLevel;
}

const MAPPING_SYSTEM_PROMPT = `You are mapping extracted evidence cards to sections and dimensions of an academic paper.

INPUT:
1. Evidence cards (with cardId, claim, claimType, quantitativeDetail, citationKey, archetype)
2. Blueprint sections with mustCover dimensions

TASK:
For each card, map it to relevant section/dimension pairs and assign:
- useAs: SUPPORT | CONTRAST | CONTEXT | DEFINITION
- mappingConfidence: HIGH | MEDIUM | LOW

RULES:
1. A card can map to multiple section/dimension pairs.
2. Only map when relevance is genuine; do not force mappings.
3. Return each cardId exactly as provided in the input cards.
4. UseAs guidance:
   - SUPPORT: backs a claim in that dimension
   - CONTRAST: challenges or differs from expected approach/result
   - CONTEXT: background framing evidence
   - DEFINITION: formal definition or framework card
5. Output JSON only.

OUTPUT FORMAT:
[
  {
    "cardId": "<cardId from input>",
    "mappings": [
      {
        "sectionKey": "methodology",
        "dimension": "Evaluation protocol and baseline comparisons",
        "useAs": "SUPPORT",
        "mappingConfidence": "HIGH"
      }
    ]
  }
]`;

function buildMappingPrompt(
  cards: ExtractedCardWithIdentity[],
  blueprint: BlueprintWithSectionPlan
): MappingPrompt {
  const cardSummaries = cards.map(card => ({
    cardId: card.cardId,
    claim: card.claim,
    claimType: card.claimType,
    quantitativeDetail: card.quantitativeDetail,
    citationKey: card.citationKey,
    archetype: card.referenceArchetype,
  }));

  const blueprintStructure = blueprint.sectionPlan.map(section => ({
    sectionKey: section.sectionKey,
    sectionLabel: section.purpose,
    dimensions: section.mustCover,
  }));

  const user = [
    '=== EVIDENCE CARDS ===',
    JSON.stringify(cardSummaries, null, 2),
    '',
    '=== PAPER BLUEPRINT ===',
    JSON.stringify(blueprintStructure, null, 2),
  ].join('\n');

  return {
    system: MAPPING_SYSTEM_PROMPT,
    user,
  };
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2);
}

function inferUseAs(card: ExtractedCardWithIdentity): EvidenceMappingUseAs {
  if (card.claimType === 'DEFINITION' || card.claimType === 'FRAMEWORK') {
    return 'DEFINITION';
  }
  if (card.claimType === 'LIMITATION' || card.claimType === 'GAP') {
    return 'CONTRAST';
  }
  return 'SUPPORT';
}

function heuristicMapCards(
  cards: ExtractedCardWithIdentity[],
  blueprint: BlueprintWithSectionPlan
): CardDimensionMapping[] {
  const mappings: CardDimensionMapping[] = [];

  for (const card of cards) {
    const cardTokens = new Set(tokenize(`${card.claim} ${card.quantitativeDetail || ''} ${card.studyDesign || ''}`));
    const candidates: Array<{
      sectionKey: string;
      dimension: string;
      score: number;
    }> = [];

    for (const section of blueprint.sectionPlan) {
      for (const dimension of section.mustCover || []) {
        const dimensionTokens = tokenize(dimension);
        if (dimensionTokens.length === 0) continue;
        const overlap = dimensionTokens.filter(token => cardTokens.has(token)).length;
        const score = overlap / dimensionTokens.length;
        if (score > 0) {
          candidates.push({ sectionKey: section.sectionKey, dimension, score });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score || a.sectionKey.localeCompare(b.sectionKey) || a.dimension.localeCompare(b.dimension));
      const bestScore = candidates[0].score;
      const minScore = Math.max(0.2, bestScore * 0.45);
      const maxMappings = card.claimType === 'DEFINITION' || card.claimType === 'FRAMEWORK' ? 2 : 3;

      let added = 0;
      for (const candidate of candidates) {
        if (candidate.score < minScore || added >= maxMappings) {
          continue;
        }
        mappings.push({
          cardId: card.cardId,
          sectionKey: candidate.sectionKey,
          dimension: candidate.dimension,
          useAs: inferUseAs(card),
          mappingConfidence: candidate.score >= 0.6 ? 'HIGH' : candidate.score >= 0.3 ? 'MEDIUM' : 'LOW',
        });
        added += 1;
      }
    }

    if (!mappings.some(mapping => mapping.cardId === card.cardId) && candidates.length > 0) {
      const best = candidates[0];
      mappings.push({
        cardId: card.cardId,
        sectionKey: best.sectionKey,
        dimension: best.dimension,
        useAs: inferUseAs(card),
        mappingConfidence: best.score >= 0.6 ? 'HIGH' : best.score >= 0.3 ? 'MEDIUM' : 'LOW',
      });
    }
  }

  return mappings;
}

function dedupeMappings(mappings: CardDimensionMapping[]): CardDimensionMapping[] {
  const rank: Record<EvidenceConfidenceLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const byKey = new Map<string, CardDimensionMapping>();

  for (const mapping of mappings) {
    const key = `${mapping.cardId}::${mapping.sectionKey}::${mapping.dimension}`;
    const existing = byKey.get(key);
    if (!existing || rank[mapping.mappingConfidence] > rank[existing.mappingConfidence]) {
      byKey.set(key, mapping);
    }
  }

  return Array.from(byKey.values());
}

class EvidenceMappingService {
  async mapCardsToDimensions(
    cards: ExtractedCardWithIdentity[],
    blueprint: BlueprintWithSectionPlan,
    tenantContext?: TenantContext | null
  ): Promise<{ mappings: CardDimensionMapping[]; warnings: string[]; usage: { inputTokens: number; outputTokens: number } }> {
    if (!cards.length || !blueprint.sectionPlan.length) {
      return {
        mappings: [],
        warnings: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const warnings: string[] = [];
    const prompt = buildMappingPrompt(cards, blueprint);

    const response = await llmGateway.executeLLMOperation(
      tenantContext ? { tenantContext } : { headers: {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'PAPER_REVIEW_COHERENCE',
        prompt: `${prompt.system}\n\n${prompt.user}`,
        parameters: {
          purpose: 'evidence_dimension_mapping',
          temperature: 0,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          purpose: 'evidence_dimension_mapping',
          cards: cards.length,
          sections: blueprint.sectionPlan.length,
        },
      }
    );

    if (!response.success || !response.response) {
      warnings.push(response.error?.message || 'Mapping LLM call failed, used heuristic fallback');
      const fallback = heuristicMapCards(cards, blueprint);
      return {
        mappings: dedupeMappings(fallback),
        warnings,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    let parsedRaw: unknown;
    const raw = String(response.response.output || '').trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw;

    try {
      parsedRaw = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('[');
      const end = candidate.lastIndexOf(']');
      if (start !== -1 && end > start) {
        parsedRaw = JSON.parse(candidate.slice(start, end + 1));
        warnings.push('Mapping JSON recovered from partial response');
      } else {
        warnings.push('Mapping output could not be parsed, used heuristic fallback');
        const fallback = heuristicMapCards(cards, blueprint);
        return {
          mappings: dedupeMappings(fallback),
          warnings,
          usage: {
            inputTokens: Number((response.response.metadata as any)?.inputTokens || 0),
            outputTokens: Number(response.response.outputTokens || 0),
          },
        };
      }
    }

    const parsed = mappingResponseSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      warnings.push(`Mapping validation failed (${parsed.error.errors[0]?.message || 'invalid output'}), used heuristic fallback`);
      const fallback = heuristicMapCards(cards, blueprint);
      return {
        mappings: dedupeMappings(fallback),
        warnings,
        usage: {
          inputTokens: Number((response.response.metadata as any)?.inputTokens || 0),
          outputTokens: Number(response.response.outputTokens || 0),
        },
      };
    }

    const idMap = new Map<string, string>();
    cards.forEach((card, index) => {
      idMap.set(`card_${index}`, card.cardId);
      idMap.set(card.cardId, card.cardId);
    });

    const validSectionKeys = new Set(blueprint.sectionPlan.map(section => section.sectionKey));
    const dimensionsBySection = new Map<string, Set<string>>();
    blueprint.sectionPlan.forEach(section => {
      dimensionsBySection.set(section.sectionKey, new Set(section.mustCover || []));
    });

    const mappings: CardDimensionMapping[] = [];

    for (const cardMapping of parsed.data) {
      const resolvedCardId = idMap.get(cardMapping.cardId);
      if (!resolvedCardId) {
        warnings.push(`Dropped mapping for unknown card id: ${cardMapping.cardId}`);
        continue;
      }

      for (const mapping of cardMapping.mappings) {
        if (!validSectionKeys.has(mapping.sectionKey)) {
          warnings.push(`Dropped mapping with invalid sectionKey: ${mapping.sectionKey}`);
          continue;
        }

        const validDimensions = dimensionsBySection.get(mapping.sectionKey);
        if (!validDimensions || !validDimensions.has(mapping.dimension)) {
          warnings.push(`Dropped mapping with invalid dimension for section ${mapping.sectionKey}`);
          continue;
        }

        mappings.push({
          cardId: resolvedCardId,
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          useAs: mapping.useAs,
          mappingConfidence: mapping.mappingConfidence,
        });
      }
    }

    if (mappings.length === 0) {
      warnings.push('LLM mapping returned no valid rows, used heuristic fallback');
      mappings.push(...heuristicMapCards(cards, blueprint));
    }

    return {
      mappings: dedupeMappings(mappings),
      warnings,
      usage: {
        inputTokens: Number((response.response.metadata as any)?.inputTokens || 0),
        outputTokens: Number(response.response.outputTokens || 0),
      },
    };
  }
}

export const evidenceMappingService = new EvidenceMappingService();
export { EvidenceMappingService, buildMappingPrompt };
