import crypto from 'crypto';
import { llmGateway, type TenantContext } from '../metering';
import type { ResearchIntentLock } from './research-intent-lock-service';
import type { RhetoricalBlueprint } from './rhetorical-blueprint-service';

export interface ContributionLockValidation {
  passed: boolean;
  violations: string[];
  inspectedParagraphs: number;
}

export interface RhetoricalComposerResult {
  applied: boolean;
  content: string;
  promptUsed?: string;
  tokensUsed?: number;
  validation: ContributionLockValidation;
  retries: number;
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function splitParagraphs(content: string): string[] {
  return String(content || '')
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function hasContributionSignal(paragraph: string): boolean {
  return /(contribution|we\s+(contribute|propose|present|introduce)|this\s+paper\s+(contributes|proposes|presents|introduces))/i
    .test(paragraph);
}

function contributionSimilarity(paragraph: string, contribution: string): number {
  const pTokens = new Set(tokenize(paragraph));
  const cTokens = dedupe(tokenize(contribution));
  if (pTokens.size === 0 || cTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of cTokens) {
    if (pTokens.has(token)) overlap += 1;
  }

  return overlap / cTokens.length;
}

function buildContributionValidation(
  content: string,
  allowedContributions: string[],
  requireContributionParagraph: boolean
): ContributionLockValidation {
  if (!allowedContributions.length) {
    return { passed: true, violations: [], inspectedParagraphs: 0 };
  }

  const paragraphs = splitParagraphs(content);
  const contributionParagraphs = paragraphs.filter(hasContributionSignal);
  const violations: string[] = [];

  if (requireContributionParagraph && contributionParagraphs.length === 0) {
    violations.push('Missing contributions paragraph required by rhetorical blueprint.');
  }

  for (const paragraph of contributionParagraphs) {
    let maxSimilarity = 0;
    for (const contribution of allowedContributions) {
      const similarity = contributionSimilarity(paragraph, contribution);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    if (maxSimilarity < 0.2) {
      violations.push('Contribution paragraph contains claims outside ResearchIntentLock.');
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    inspectedParagraphs: contributionParagraphs.length,
  };
}

function buildComposerPrompt(params: {
  sectionKey: string;
  currentContent: string;
  rhetoricalBlueprint: RhetoricalBlueprint;
  thesisStatement?: string;
  allowedContributions: string[];
  evidenceDigestSummary?: string;
}): string {
  const slots = params.rhetoricalBlueprint.slots.map((slot, index) => ({
    order: index + 1,
    key: slot.key,
    required: slot.required,
    placement: slot.placement,
    intent: slot.intent,
    constraints: slot.constraints,
    citationPolicy: slot.citationPolicy,
  }));

  return `You are a rhetorical-composer pass. Repair the section so required rhetorical moves are present while preserving existing thematic content and citations.

SECTION KEY: ${params.sectionKey}

Rhetorical blueprint:
${JSON.stringify(slots, null, 2)}

ResearchIntentLock contributions (hard boundary):
Thesis: ${String(params.thesisStatement || '(not provided)')}
${params.allowedContributions.length > 0 ? params.allowedContributions.map((entry, index) => `${index + 1}. ${entry}`).join('\n') : '(none provided)'}

Evidence digest summary (optional grounding):
${String(params.evidenceDigestSummary || '(not provided)')}

Current section draft:
${params.currentContent}

Rules:
- Keep thematic paragraphs and citation anchors intact as much as possible.
- Insert or repair rhetorical paragraphs only where needed.
- Do not add claims outside ResearchIntentLock contributions.
- Respect slot placement intent (start/middle/end/final).
- Keep changes minimal and coherent.
- Rhetorical citations are optional and must obey slot citation policy.

Return ONLY clean markdown section text.`;
}

function buildContributionRewritePrompt(params: {
  sectionKey: string;
  content: string;
  thesisStatement?: string;
  allowedContributions: string[];
  violations: string[];
}): string {
  return `Fix contribution-lock violations in this section.

SECTION KEY: ${params.sectionKey}
Thesis boundary: ${String(params.thesisStatement || '(not provided)')}

Allowed contributions (use only these):
${params.allowedContributions.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}

Detected issues:
${params.violations.map((entry, index) => `${index + 1}. ${entry}`).join('\n')}

Current section:
${params.content}

Rewrite rules:
- Rewrite only contribution-oriented sentences/paragraphs.
- Keep all non-contribution content and citation anchors stable.
- Do not introduce new contribution claims.
- If needed, replace contribution wording with lock-aligned phrasing.

Return ONLY clean markdown section text.`;
}

async function executeRewrite(params: {
  sessionId: string;
  sectionKey: string;
  prompt: string;
  purpose: string;
  tenantContext?: TenantContext | null;
  requestHeaders?: Record<string, string>;
  attempt?: number;
}): Promise<{ content: string; tokensUsed?: number }> {
  const response = await llmGateway.executeLLMOperation(
    params.tenantContext ? { tenantContext: params.tenantContext } : { headers: params.requestHeaders || {} },
    {
      taskCode: 'LLM2_DRAFT',
      stageCode: 'PAPER_SECTION_DRAFT',
      prompt: params.prompt,
      parameters: {
        purpose: params.purpose,
        temperature: 0.2,
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        purpose: params.purpose,
        attempt: params.attempt || 0,
      },
    }
  );

  if (!response.success || !response.response?.output) {
    throw new Error(response.error?.message || `${params.purpose} failed`);
  }

  return {
    content: String(response.response.output || '').trim(),
    tokensUsed: response.response.outputTokens,
  };
}

class RhetoricalComposerService {
  async applyPass2B(params: {
    sessionId: string;
    sectionKey: string;
    content: string;
    rhetoricalBlueprint: RhetoricalBlueprint | null | undefined;
    researchIntentLock?: ResearchIntentLock | null;
    fallbackContributions?: string[];
    evidenceDigestSummary?: string;
    tenantContext?: TenantContext | null;
    requestHeaders?: Record<string, string>;
  }): Promise<RhetoricalComposerResult> {
    const initialContent = String(params.content || '').trim();
    const rhetorical = params.rhetoricalBlueprint;
    if (!initialContent || !rhetorical?.enabled || !rhetorical.slots?.length) {
      return {
        applied: false,
        content: initialContent,
        validation: { passed: true, violations: [], inspectedParagraphs: 0 },
        retries: 0,
      };
    }

    const lockContributions = Array.isArray(params.researchIntentLock?.contributions)
      ? params.researchIntentLock!.contributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const fallbackContributions = Array.isArray(params.fallbackContributions)
      ? params.fallbackContributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const allowedContributions = lockContributions.length > 0 ? lockContributions : fallbackContributions;
    const thesisStatement = String(params.researchIntentLock?.thesisStatement || '').trim();

    let content = initialContent;
    let tokensUsed = 0;
    let retries = 0;
    let promptUsed: string | undefined;

    const composePrompt = buildComposerPrompt({
      sectionKey: params.sectionKey,
      currentContent: content,
      rhetoricalBlueprint: rhetorical,
      thesisStatement,
      allowedContributions,
      evidenceDigestSummary: params.evidenceDigestSummary,
    });

    const composed = await executeRewrite({
      sessionId: params.sessionId,
      sectionKey: params.sectionKey,
      prompt: composePrompt,
      purpose: 'paper_section_rhetorical_pass2b',
      tenantContext: params.tenantContext,
      requestHeaders: params.requestHeaders,
      attempt: 0,
    });
    content = composed.content;
    tokensUsed += composed.tokensUsed || 0;
    promptUsed = composePrompt;

    let validation = buildContributionValidation(
      content,
      allowedContributions,
      rhetorical.slots.some((slot) => slot.key.toLowerCase() === 'contributions' && slot.required)
    );

    const maxRetries = 2;
    while (!validation.passed && retries < maxRetries) {
      retries += 1;
      const rewritePrompt = buildContributionRewritePrompt({
        sectionKey: params.sectionKey,
        content,
        thesisStatement,
        allowedContributions,
        violations: validation.violations,
      });
      const rewritten = await executeRewrite({
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        prompt: rewritePrompt,
        purpose: 'paper_section_rhetorical_contribution_rewrite',
        tenantContext: params.tenantContext,
        requestHeaders: params.requestHeaders,
        attempt: retries,
      });
      content = rewritten.content;
      tokensUsed += rewritten.tokensUsed || 0;
      promptUsed = rewritePrompt;

      validation = buildContributionValidation(
        content,
        allowedContributions,
        rhetorical.slots.some((slot) => slot.key.toLowerCase() === 'contributions' && slot.required)
      );
    }

    return {
      applied: true,
      content,
      promptUsed,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
      validation,
      retries,
    };
  }

  async enforceContributionLock(params: {
    sessionId: string;
    sectionKey: string;
    content: string;
    rhetoricalBlueprint: RhetoricalBlueprint | null | undefined;
    researchIntentLock?: ResearchIntentLock | null;
    fallbackContributions?: string[];
    tenantContext?: TenantContext | null;
    requestHeaders?: Record<string, string>;
  }): Promise<RhetoricalComposerResult> {
    const initialContent = String(params.content || '').trim();
    const rhetorical = params.rhetoricalBlueprint;
    if (!initialContent || !rhetorical?.enabled || !rhetorical.slots?.length) {
      return {
        applied: false,
        content: initialContent,
        validation: { passed: true, violations: [], inspectedParagraphs: 0 },
        retries: 0,
      };
    }

    const lockContributions = Array.isArray(params.researchIntentLock?.contributions)
      ? params.researchIntentLock!.contributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const fallbackContributions = Array.isArray(params.fallbackContributions)
      ? params.fallbackContributions.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const allowedContributions = lockContributions.length > 0 ? lockContributions : fallbackContributions;
    const thesisStatement = String(params.researchIntentLock?.thesisStatement || '').trim();

    const requireContributionParagraph = rhetorical.slots.some(
      (slot) => slot.key.toLowerCase() === 'contributions' && slot.required
    );

    let content = initialContent;
    let validation = buildContributionValidation(content, allowedContributions, requireContributionParagraph);
    let retries = 0;
    let tokensUsed = 0;
    let promptUsed: string | undefined;

    const maxRetries = 2;
    while (!validation.passed && retries < maxRetries) {
      retries += 1;
      const rewritePrompt = buildContributionRewritePrompt({
        sectionKey: params.sectionKey,
        content,
        thesisStatement,
        allowedContributions,
        violations: validation.violations,
      });

      const rewritten = await executeRewrite({
        sessionId: params.sessionId,
        sectionKey: params.sectionKey,
        prompt: rewritePrompt,
        purpose: 'paper_section_contribution_lock_rewrite',
        tenantContext: params.tenantContext,
        requestHeaders: params.requestHeaders,
        attempt: retries,
      });

      content = rewritten.content;
      tokensUsed += rewritten.tokensUsed || 0;
      promptUsed = rewritePrompt;
      validation = buildContributionValidation(content, allowedContributions, requireContributionParagraph);
    }

    return {
      applied: retries > 0,
      content,
      promptUsed,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
      validation,
      retries,
    };
  }
}

export const rhetoricalComposerService = new RhetoricalComposerService();
export { RhetoricalComposerService, buildContributionValidation };
