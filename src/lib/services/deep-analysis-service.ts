import crypto from 'crypto';
import type { DeepAnalysisStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { blueprintService, type BlueprintWithSectionPlan } from './blueprint-service';
import {
  DEEP_ANALYSIS_LABELS,
  DEFAULT_EXTRACTION_CONCURRENCY,
  MAX_CARD_PAGE_SIZE,
  REFERENCE_ARCHETYPES,
  type DeepAnalysisLabel,
  type ExtractedCardWithIdentity,
  type EvidenceConfidenceLevel,
  type ReferenceArchetype,
} from './deep-analysis-types';
import { textPreparationService } from './text-preparation-service';
import { evidenceExtractionService } from './evidence-extraction-service';
import { quoteVerificationService } from './quote-verification-service';
import { evidenceMappingService, type CardDimensionMapping } from './evidence-mapping-service';
import type { TenantContext } from '../metering';

interface StartBatchOptions {
  concurrency?: number;
  tenantContext?: TenantContext | null;
}

export interface DeepAnalysisStartJobSummary {
  jobId: string;
  citationId: string;
  citationKey: string;
  depthLabel: string;
  status: DeepAnalysisStatus;
}

export interface DeepAnalysisStartResult {
  batchId: string;
  jobsCreated: number;
  estimatedSeconds: number;
  jobs: DeepAnalysisStartJobSummary[];
  skipped?: Array<{
    citationId: string;
    citationKey: string;
    reason: string;
  }>;
}

export interface DeepAnalysisStatusResult {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL';
  totalJobs: number;
  completed: number;
  failed: number;
  inProgress: number;
  totalCardsExtracted: number;
  totalMappingsCreated: number;
  startedAt: string | null;
  estimatedSecondsRemaining: number | null;
  jobs: Array<{
    jobId: string;
    citationId: string;
    citationKey: string;
    status: DeepAnalysisStatus;
    cardsExtracted: number | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export interface EvidenceCardsQuery {
  view?: 'paper' | 'dimension' | 'section';
  citationId?: string;
  sectionKey?: string;
  dimension?: string;
  claimType?: string;
  confidence?: string;
  verified?: boolean;
  page?: number;
  limit?: number;
}

export interface DeepAnalysisCandidate {
  citationId: string;
  citationKey: string;
  title: string;
  depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>;
  referenceArchetype: ReferenceArchetype;
  deepAnalysisStatus: string | null;
  evidenceCardCount: number;
  ready: boolean;
  readinessReason: string | null;
  documentId: string | null;
  referenceId: string | null;
  parserCandidate: 'GROBID' | 'REGEX_FALLBACK' | null;
}

export interface DeepAnalysisCandidatesResult {
  ready: DeepAnalysisCandidate[];
  notReady: DeepAnalysisCandidate[];
  totalEligible: number;
}

interface CoverageSummary {
  totalDimensions: number;
  coveredDimensions: number;
  gaps: string[];
  underSupported: string[];
}

const ACTIVE_STATUSES: DeepAnalysisStatus[] = ['PENDING', 'PREPARING', 'EXTRACTING', 'MAPPING'];
const RECOVERABLE_STALE_STATUSES: DeepAnalysisStatus[] = ['PREPARING', 'EXTRACTING', 'MAPPING'];
const CANCELLATION_ERROR = 'Cancelled by user';
const STALE_JOB_RECOVERY_MS = 5 * 60 * 1000;
const STALE_JOB_WARNING = 'Job was auto-requeued after worker interruption';

const LABEL_SET = new Set<string>(DEEP_ANALYSIS_LABELS);
const ARCHETYPE_SET = new Set<string>(REFERENCE_ARCHETYPES);

const normalizeDoi = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
    .replace(/\s+/g, '');
};

const normalizeTitle = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

function normalizeArchetype(value: unknown): ReferenceArchetype {
  const candidate = String(value || '').trim().toUpperCase();
  return ARCHETYPE_SET.has(candidate)
    ? (candidate as ReferenceArchetype)
    : 'SYSTEM_ALGO_EVALUATION';
}

function normalizeDepthLabel(value: unknown): DeepAnalysisLabel {
  const candidate = String(value || '').trim().toUpperCase();
  return LABEL_SET.has(candidate)
    ? (candidate as DeepAnalysisLabel)
    : 'LIT_ONLY';
}

function estimateDepthLabelFromCitation(citation: any): DeepAnalysisLabel {
  const explicit = normalizeDepthLabel(citation.deepAnalysisLabel || (citation.aiMeta as any)?.deepAnalysisRecommendation);
  if (explicit !== 'LIT_ONLY') {
    return explicit;
  }

  const score = Number((citation.aiMeta as any)?.relevanceScore || 0);
  if (score >= 85) return 'DEEP_ANCHOR';
  if (score >= 65) return 'DEEP_SUPPORT';
  if (score >= 45) return 'DEEP_STRESS_TEST';
  return 'LIT_ONLY';
}

function estimateArchetypeFromCitation(citation: any): ReferenceArchetype {
  const aiMetaArchetype = citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? String((citation.aiMeta as any).referenceArchetype || '').trim().toUpperCase()
    : '';

  if (ARCHETYPE_SET.has(aiMetaArchetype)) {
    return aiMetaArchetype as ReferenceArchetype;
  }

  const corpus = [
    citation?.title,
    citation?.abstract,
    citation?.venue,
    citation?.sourceType,
    citation?.aiMeta && typeof citation.aiMeta === 'object'
      ? JSON.stringify(citation.aiMeta)
      : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!corpus) {
    return 'POSITION_CONCEPTUAL';
  }

  if (/\b(systematic review|meta-analys(?:is|es)|scoping review|literature review|review article)\b/.test(corpus)) {
    return 'SYNTHESIS_REVIEW';
  }

  if (/\b(mixed methods?|multi[-\s]?method|triangulation|qualitative and quantitative)\b/.test(corpus)) {
    return 'MIXED_METHODS_APPLIED_STUDY';
  }

  if (/\b(randomized|randomised|control group|intervention|placebo|double blind|trial)\b/.test(corpus)) {
    return 'CONTROLLED_EXPERIMENTAL_STUDY';
  }

  if (/\b(observational|cohort|cross[-\s]?sectional|longitudinal|case[-\s]?control|regression|odds ratio|hazard ratio|survey)\b/.test(corpus)) {
    return 'EMPIRICAL_OBSERVATIONAL_STUDY';
  }

  if (/\b(algorithm|model|dataset|benchmark|baseline|accuracy|auc|f1|ablation|architecture)\b/.test(corpus)) {
    return 'SYSTEM_ALGO_EVALUATION';
  }

  if (/\b(theory|theoretical|conceptual|framework|normative|philosoph|discourse|hermeneutic)\b/.test(corpus)) {
    return 'POSITION_CONCEPTUAL';
  }

  return 'POSITION_CONCEPTUAL';
}

function rankConfidence(value: EvidenceConfidenceLevel): number {
  if (value === 'HIGH') return 3;
  if (value === 'MEDIUM') return 2;
  return 1;
}

function clampConcurrency(value?: number): number {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_EXTRACTION_CONCURRENCY;
  return Math.max(1, Math.min(20, parsed || DEFAULT_EXTRACTION_CONCURRENCY || 10));
}

function nowIso(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isCancelledError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as any).code === 'CANCELLED'
  );
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(limit, items.length);
  let cursor = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

class DeepAnalysisService {
  private activeRunners = new Map<string, Promise<void>>();

  private runnerKey(sessionId: string, batchId: string): string {
    return `${sessionId}:${batchId}`;
  }

  private triggerBatch(
    sessionId: string,
    batchId: string,
    jobIds: string[],
    options: { concurrency: number; tenantContext?: TenantContext | null },
    source: 'start' | 'retry' | 'status'
  ): void {
    const ids = Array.from(new Set(jobIds.map(id => String(id || '').trim()).filter(Boolean)));
    if (ids.length === 0) return;

    const key = this.runnerKey(sessionId, batchId);
    if (this.activeRunners.has(key)) return;

    const runner = this.runBatch(sessionId, batchId, ids, options)
      .catch(error => {
        console.error(`[DeepAnalysis] ${source} batch failed:`, error);
      })
      .finally(() => {
        this.activeRunners.delete(key);
      });

    this.activeRunners.set(key, runner);
  }

  private async recoverStaleJobs(sessionId: string): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_JOB_RECOVERY_MS);
    const staleJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: { in: RECOVERABLE_STALE_STATUSES },
        updatedAt: { lt: staleBefore },
      },
      select: {
        id: true,
        citationId: true,
      },
    });

    if (staleJobs.length === 0) {
      return;
    }

    const staleJobIds = staleJobs.map(job => job.id);
    const citationIds = Array.from(new Set(staleJobs.map(job => job.citationId)));

    await prisma.$transaction(async tx => {
      await tx.deepAnalysisJob.updateMany({
        where: {
          id: { in: staleJobIds },
          status: { in: RECOVERABLE_STALE_STATUSES },
        },
        data: {
          status: 'PENDING',
          startedAt: null,
          completedAt: null,
          error: null,
          warning: STALE_JOB_WARNING,
        },
      });

      await tx.citation.updateMany({
        where: {
          id: { in: citationIds },
        },
        data: {
          deepAnalysisStatus: 'PENDING',
        },
      });
    });
  }

  private async triggerActiveBatches(
    sessionId: string,
    options: { concurrency: number; tenantContext?: TenantContext | null }
  ): Promise<void> {
    const pendingJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: 'PENDING',
      },
      select: {
        id: true,
        batchId: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (pendingJobs.length === 0) {
      return;
    }

    const jobsByBatch = new Map<string, string[]>();
    for (const job of pendingJobs) {
      const batchId = job.batchId || `recovered_${sessionId}`;
      if (!jobsByBatch.has(batchId)) {
        jobsByBatch.set(batchId, []);
      }
      jobsByBatch.get(batchId)!.push(job.id);
    }

    jobsByBatch.forEach((jobIds, batchId) => {
      this.triggerBatch(sessionId, batchId, jobIds, options, 'status');
    });
  }

  private async throwIfJobCancelled(jobId: string): Promise<void> {
    const row = await prisma.deepAnalysisJob.findUnique({
      where: { id: jobId },
      select: { status: true, error: true },
    });

    if (!row) {
      const error = new Error('Deep analysis job not found');
      (error as any).code = 'JOB_NOT_FOUND';
      throw error;
    }

    if (row.status === 'FAILED' && String(row.error || '').includes(CANCELLATION_ERROR)) {
      const error = new Error('Deep analysis job was cancelled');
      (error as any).code = 'CANCELLED';
      throw error;
    }
  }

  private async getBlueprintContext(sessionId: string): Promise<{ blueprint: BlueprintWithSectionPlan | null; dimensions: string[] }> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint?.sectionPlan?.length) {
      return { blueprint: null, dimensions: [] };
    }

    const dimensions = Array.from(
      new Set(
        blueprint.sectionPlan.flatMap(section => Array.isArray(section.mustCover) ? section.mustCover : [])
      )
    );

    return { blueprint, dimensions };
  }

  private async ensureNoActiveRun(sessionId: string): Promise<void> {
    const activeCount = await prisma.deepAnalysisJob.count({
      where: {
        sessionId,
        status: { in: ACTIVE_STATUSES },
      },
    });

    if (activeCount > 0) {
      const error = new Error('Deep analysis already in progress');
      (error as any).code = 'ACTIVE_RUN';
      (error as any).activeCount = activeCount;
      throw error;
    }
  }

  async startBatch(
    sessionId: string,
    citationIds: string[],
    options: StartBatchOptions = {}
  ): Promise<DeepAnalysisStartResult> {
    if (!citationIds.length) {
      throw new Error('No citation IDs were provided');
    }

    await this.ensureNoActiveRun(sessionId);

    const uniqueCitationIds = Array.from(new Set(citationIds.map(id => String(id || '').trim()).filter(Boolean)));
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        id: { in: uniqueCitationIds },
        isActive: true,
      },
      select: {
        id: true,
        citationKey: true,
        title: true,
        abstract: true,
        venue: true,
        sourceType: true,
        doi: true,
        year: true,
        authors: true,
        aiMeta: true,
        deepAnalysisLabel: true,
        libraryReferenceId: true,
      },
    });

    if (citations.length === 0) {
      throw new Error('No eligible citations found for deep analysis');
    }

    const batchId = crypto.randomUUID();
    const now = new Date();

    const jobs: DeepAnalysisStartJobSummary[] = [];
    const skipped: Array<{ citationId: string; citationKey: string; reason: string }> = [];

    const readinessMap = new Map<string, Awaited<ReturnType<typeof textPreparationService.checkCitationReadiness>>>();
    await runWithConcurrency(citations, 6, async (citation) => {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      if (depthLabel === 'LIT_ONLY') {
        return;
      }

      const readiness = await textPreparationService.checkCitationReadiness(sessionId, {
        id: citation.id,
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        authors: citation.authors,
        libraryReferenceId: citation.libraryReferenceId,
      });
      readinessMap.set(citation.id, readiness);
    });

    for (const citation of citations) {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      const archetype = estimateArchetypeFromCitation(citation);

      if (depthLabel === 'LIT_ONLY') {
        continue;
      }

      const readiness = readinessMap.get(citation.id);
      if (!readiness?.ready) {
        skipped.push({
          citationId: citation.id,
          citationKey: citation.citationKey,
          reason: readiness?.reason || 'No full text available',
        });
        await prisma.citation.update({
          where: { id: citation.id },
          data: {
            deepAnalysisStatus: 'FAILED',
            deepAnalysisLabel: depthLabel,
            evidenceCardCount: 0,
          },
        }).catch(() => undefined);
        continue;
      }

      const job = await prisma.deepAnalysisJob.upsert({
        where: {
          sessionId_citationId: {
            sessionId,
            citationId: citation.id,
          },
        },
        update: {
          batchId,
          status: 'PENDING',
          startedAt: null,
          completedAt: null,
          error: null,
          warning: null,
          referenceArchetype: archetype,
          deepAnalysisLabel: depthLabel,
          textSource: 'REGEX_FALLBACK',
          inputTokens: null,
          outputTokens: null,
          updatedAt: now,
        },
        create: {
          batchId,
          sessionId,
          citationId: citation.id,
          status: 'PENDING',
          referenceArchetype: archetype,
          deepAnalysisLabel: depthLabel,
          textSource: 'REGEX_FALLBACK',
        },
      });

      await prisma.evidenceCard.deleteMany({
        where: { jobId: job.id },
      });

      await prisma.citation.update({
        where: { id: citation.id },
        data: {
          deepAnalysisStatus: 'PENDING',
          deepAnalysisLabel: depthLabel,
          evidenceCardCount: 0,
        },
      });

      jobs.push({
        jobId: job.id,
        citationId: citation.id,
        citationKey: citation.citationKey,
        depthLabel,
        status: 'PENDING',
      });
    }

    const concurrency = clampConcurrency(options.concurrency);
    const estimatedSeconds = Math.max(10, Math.ceil(jobs.length / Math.max(1, concurrency / 3)) * 25);

    if (jobs.length > 0) {
      this.triggerBatch(
        sessionId,
        batchId,
        jobs.map(job => job.jobId),
        {
          concurrency,
          tenantContext: options.tenantContext || null,
        },
        'start'
      );
    }

    return {
      batchId,
      jobsCreated: jobs.length,
      estimatedSeconds,
      jobs,
      skipped,
    };
  }

  async getCandidates(sessionId: string): Promise<DeepAnalysisCandidatesResult> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
      },
      select: {
        id: true,
        citationKey: true,
        title: true,
        abstract: true,
        venue: true,
        sourceType: true,
        doi: true,
        year: true,
        authors: true,
        aiMeta: true,
        deepAnalysisLabel: true,
        deepAnalysisStatus: true,
        evidenceCardCount: true,
        libraryReferenceId: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const eligible = citations.filter(citation => estimateDepthLabelFromCitation(citation) !== 'LIT_ONLY');

    const candidates: DeepAnalysisCandidate[] = await Promise.all(eligible.map(async citation => {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      const archetype = estimateArchetypeFromCitation(citation);

      const readiness = await textPreparationService.checkCitationReadiness(sessionId, {
        id: citation.id,
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        authors: citation.authors,
        libraryReferenceId: citation.libraryReferenceId,
      }).catch(() => ({
        ready: false,
        reason: 'Unable to verify text readiness',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
      }));

      return {
        citationId: citation.id,
        citationKey: citation.citationKey,
        title: citation.title,
        depthLabel: depthLabel as Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
        referenceArchetype: archetype,
        deepAnalysisStatus: citation.deepAnalysisStatus || null,
        evidenceCardCount: Number(citation.evidenceCardCount || 0),
        ready: Boolean(readiness.ready),
        readinessReason: readiness.reason || null,
        documentId: readiness.documentId || null,
        referenceId: readiness.referenceId || null,
        parserCandidate: readiness.parserCandidate || null,
      };
    }));

    const ready = candidates.filter(candidate => candidate.ready);
    const notReady = candidates.filter(candidate => !candidate.ready);

    return {
      ready,
      notReady,
      totalEligible: candidates.length,
    };
  }

  private async runBatch(
    sessionId: string,
    batchId: string,
    jobIds: string[],
    options: { concurrency: number; tenantContext?: TenantContext | null }
  ): Promise<void> {
    const jobs = await prisma.deepAnalysisJob.findMany({
      where: {
        id: { in: jobIds },
        sessionId,
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
            title: true,
            doi: true,
            year: true,
            authors: true,
            aiMeta: true,
            libraryReferenceId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const { blueprint, dimensions } = await this.getBlueprintContext(sessionId);

    await runWithConcurrency(jobs, options.concurrency, async (job) => {
      await this.processJob(job, {
        batchId,
        dimensions,
        blueprint,
        tenantContext: options.tenantContext || null,
      });
    });
  }

  private async processJob(
    job: any,
    context: {
      batchId: string;
      dimensions: string[];
      blueprint: BlueprintWithSectionPlan | null;
      tenantContext?: TenantContext | null;
    }
  ): Promise<void> {
    const jobId = job.id;

    try {
      const claim = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: 'PENDING',
        },
        data: {
          status: 'PREPARING',
          startedAt: new Date(),
          error: null,
          warning: null,
          batchId: context.batchId,
        },
      });
      if (claim.count === 0) {
        return;
      }

      await this.throwIfJobCancelled(jobId);

      const prepared = await textPreparationService.prepareForCitation(
        job.sessionId,
        {
          id: job.citation.id,
          doi: job.citation.doi,
          title: job.citation.title,
          year: job.citation.year,
          authors: job.citation.authors,
          libraryReferenceId: job.citation.libraryReferenceId,
        },
        normalizeDepthLabel(job.deepAnalysisLabel)
      );

      const movedToExtracting = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: 'PREPARING',
        },
        data: {
          status: 'EXTRACTING',
          textSource: prepared.preparedText.source,
        },
      });
      if (movedToExtracting.count === 0) {
        return;
      }

      const extracted = await evidenceExtractionService.extractCards({
        citationId: job.citation.id,
        citationKey: job.citation.citationKey,
        referenceArchetype: job.referenceArchetype,
        deepAnalysisLabel: job.deepAnalysisLabel,
        preparedText: prepared.preparedText,
        blueprintDimensions: context.dimensions,
        tenantContext: context.tenantContext || null,
      });

      await this.throwIfJobCancelled(jobId);

      const verifyAgainst = prepared.preparedText.rawFullText || prepared.preparedText.fullText;
      const verifiedCards = quoteVerificationService.verifyAllCards(extracted.cards, verifyAgainst);

      const cardIdentityRows: ExtractedCardWithIdentity[] = verifiedCards.map((card, index) => ({
        ...card,
        cardId: `card_${index}`,
        citationId: job.citation.id,
        citationKey: job.citation.citationKey,
        referenceArchetype: normalizeArchetype(job.referenceArchetype),
        deepAnalysisLabel: normalizeDepthLabel(job.deepAnalysisLabel),
      }));

      const movedToMapping = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: 'EXTRACTING',
        },
        data: {
          status: 'MAPPING',
        },
      });
      if (movedToMapping.count === 0) {
        return;
      }

      let mappingWarnings: string[] = [];
      let mappings: CardDimensionMapping[] = [];
      let mappingUsage = { inputTokens: 0, outputTokens: 0 };

      if (context.blueprint) {
        try {
          const mapped = await evidenceMappingService.mapCardsToDimensions(
            cardIdentityRows,
            context.blueprint,
            context.tenantContext || null
          );
          mappings = mapped.mappings;
          mappingWarnings = mapped.warnings;
          mappingUsage = mapped.usage;
        } catch (mappingError) {
          const message = mappingError instanceof Error ? mappingError.message : 'Unknown mapping error';
          mappingWarnings.push(`Mapping failed: ${message.slice(0, 400)}. Cards were saved without mappings.`);
        }
      }

      await this.throwIfJobCancelled(jobId);

      const cardIdMap = new Map<string, string>();

      await prisma.$transaction(async tx => {
        const currentJob = await tx.deepAnalysisJob.findUnique({
          where: { id: jobId },
          select: { status: true, error: true },
        });

        if (!currentJob || (currentJob.status === 'FAILED' && String(currentJob.error || '').includes(CANCELLATION_ERROR))) {
          return;
        }

        await tx.evidenceCard.deleteMany({
          where: { jobId },
        });

        for (const card of cardIdentityRows) {
          const created = await tx.evidenceCard.create({
            data: {
              jobId,
              sessionId: job.sessionId,
              citationId: job.citation.id,
              citationKey: job.citation.citationKey,
              referenceArchetype: card.referenceArchetype,
              deepAnalysisLabel: card.deepAnalysisLabel,
              sourceSection: card.sourceSection,
              claim: card.claim,
              claimType: card.claimType,
              quantitativeDetail: card.quantitativeDetail,
              conditions: card.conditions,
              comparableMetrics: card.comparableMetrics
                ? (card.comparableMetrics as Prisma.InputJsonValue)
                : undefined,
              doesNotSupport: card.doesNotSupport,
              scopeCondition: card.scopeCondition,
              studyDesign: card.studyDesign,
              rigorIndicators: card.rigorIndicators,
              sourceFragment: card.sourceFragment,
              pageHint: card.pageHint,
              quoteVerified: card.quoteVerified,
              quoteVerificationMethod: card.quoteVerificationMethod || null,
              quoteVerificationScore: card.quoteVerificationScore ?? null,
              confidence: card.confidence,
              extractedFrom: 'FULL_TEXT',
            },
            select: { id: true },
          });
          cardIdMap.set(card.cardId, created.id);
        }

        const mappingRows = mappings
          .map(mapping => {
            const resolvedCardId = cardIdMap.get(mapping.cardId);
            if (!resolvedCardId) return null;
            return {
              cardId: resolvedCardId,
              sectionKey: mapping.sectionKey,
              dimension: mapping.dimension,
              useAs: mapping.useAs,
              mappingConfidence: mapping.mappingConfidence,
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (mappingRows.length > 0) {
          await tx.evidenceCardMapping.createMany({ data: mappingRows });
        }

        const warningParts = [...extracted.warnings, ...mappingWarnings];

        const completedUpdate = await tx.deepAnalysisJob.updateMany({
          where: {
            id: jobId,
            status: 'MAPPING',
          },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            warning: warningParts.length > 0 ? warningParts.join(' | ').slice(0, 6000) : null,
            error: null,
            inputTokens: extracted.usage.inputTokens + mappingUsage.inputTokens,
            outputTokens: extracted.usage.outputTokens + mappingUsage.outputTokens,
          },
        });

        if (completedUpdate.count > 0) {
          await tx.citation.update({
            where: { id: job.citation.id },
            data: {
              deepAnalysisStatus: 'COMPLETED',
              deepAnalysisLabel: job.deepAnalysisLabel,
              evidenceCardCount: cardIdentityRows.length,
            },
          });
        }
      });
    } catch (error) {
      if (isCancelledError(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown deep analysis error';
      const failedUpdate = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: message.slice(0, 6000),
        },
      }).catch(() => ({ count: 0 }));

      if (failedUpdate.count > 0) {
        await prisma.citation.update({
          where: { id: job.citation.id },
          data: {
            deepAnalysisStatus: 'FAILED',
            deepAnalysisLabel: job.deepAnalysisLabel,
          },
        }).catch(() => undefined);
      }
    }
  }

  async stopActive(
    sessionId: string
  ): Promise<{ stoppedCount: number; jobs: Array<{ jobId: string; citationId: string; citationKey: string }> }> {
    const activeJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: { in: ACTIVE_STATUSES },
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
          },
        },
      },
    });

    if (activeJobs.length === 0) {
      return { stoppedCount: 0, jobs: [] };
    }

    const ids = activeJobs.map(job => job.id);
    const citationIds = Array.from(new Set(activeJobs.map(job => job.citationId)));

    await prisma.$transaction(async tx => {
      await tx.deepAnalysisJob.updateMany({
        where: {
          id: { in: ids },
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: CANCELLATION_ERROR,
        },
      });

      await tx.citation.updateMany({
        where: {
          id: { in: citationIds },
        },
        data: {
          deepAnalysisStatus: 'FAILED',
        },
      });
    });

    return {
      stoppedCount: ids.length,
      jobs: activeJobs.map(job => ({
        jobId: job.id,
        citationId: job.citationId,
        citationKey: job.citation.citationKey,
      })),
    };
  }

  async getStatus(sessionId: string): Promise<DeepAnalysisStatusResult> {
    await this.recoverStaleJobs(sessionId);
    await this.triggerActiveBatches(sessionId, {
      concurrency: clampConcurrency(DEFAULT_EXTRACTION_CONCURRENCY),
      tenantContext: null,
    });

    const jobs = await prisma.deepAnalysisJob.findMany({
      where: { sessionId },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
          },
        },
        _count: {
          select: {
            cards: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const totalJobs = jobs.length;
    const completed = jobs.filter(job => job.status === 'COMPLETED').length;
    const failed = jobs.filter(job => job.status === 'FAILED').length;
    const inProgress = jobs.filter(job => ACTIVE_STATUSES.includes(job.status)).length;

    const totalCardsExtracted = jobs.reduce((sum, job) => sum + (job._count?.cards || 0), 0);

    const totalMappingsCreated = await prisma.evidenceCardMapping.count({
      where: {
        card: {
          sessionId,
        },
      },
    });

    let status: DeepAnalysisStatusResult['status'];
    if (totalJobs === 0) {
      status = 'IDLE';
    } else if (inProgress > 0) {
      status = 'RUNNING';
    } else if (failed === 0 && completed === totalJobs) {
      status = 'COMPLETED';
    } else {
      status = 'PARTIAL';
    }

    const oldestActive = jobs
      .filter(job => job.status !== 'COMPLETED' && job.status !== 'FAILED')
      .sort((a, b) => (a.startedAt?.getTime() || 0) - (b.startedAt?.getTime() || 0))[0];

    const estimatedSecondsRemaining = inProgress > 0
      ? inProgress * 18 + jobs.filter(job => job.status === 'PENDING').length * 28
      : null;

    return {
      status,
      totalJobs,
      completed,
      failed,
      inProgress,
      totalCardsExtracted,
      totalMappingsCreated,
      startedAt: nowIso(oldestActive?.startedAt || jobs[0]?.startedAt || null),
      estimatedSecondsRemaining,
      jobs: jobs.map(job => ({
        jobId: job.id,
        citationId: job.citationId,
        citationKey: job.citation.citationKey,
        status: job.status,
        cardsExtracted: job._count?.cards || null,
        error: job.error,
        startedAt: nowIso(job.startedAt),
        completedAt: nowIso(job.completedAt),
      })),
    };
  }

  async retryFailed(
    sessionId: string,
    jobIds: string[] | undefined,
    options: StartBatchOptions = {}
  ): Promise<{ retriedCount: number; jobs: Array<{ jobId: string; citationKey: string; status: 'PENDING' }> }> {
    const where: Prisma.DeepAnalysisJobWhereInput = {
      sessionId,
      status: 'FAILED',
      ...(Array.isArray(jobIds) && jobIds.length > 0 ? { id: { in: jobIds } } : {}),
    };

    const failedJobs = await prisma.deepAnalysisJob.findMany({
      where,
      include: {
        citation: {
          select: {
            citationKey: true,
          },
        },
      },
    });

    if (failedJobs.length === 0) {
      return { retriedCount: 0, jobs: [] };
    }

    const batchId = crypto.randomUUID();

    await prisma.$transaction(async tx => {
      for (const job of failedJobs) {
        await tx.deepAnalysisJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            error: null,
            warning: null,
            startedAt: null,
            completedAt: null,
            batchId,
          },
        });

        await tx.evidenceCard.deleteMany({ where: { jobId: job.id } });

        await tx.citation.update({
          where: { id: job.citationId },
          data: {
            deepAnalysisStatus: 'PENDING',
            evidenceCardCount: 0,
          },
        });
      }
    });

    const concurrency = clampConcurrency(options.concurrency);
    this.triggerBatch(
      sessionId,
      batchId,
      failedJobs.map(job => job.id),
      {
        concurrency,
        tenantContext: options.tenantContext || null,
      },
      'retry'
    );

    return {
      retriedCount: failedJobs.length,
      jobs: failedJobs.map(job => ({ jobId: job.id, citationKey: job.citation.citationKey, status: 'PENDING' })),
    };
  }

  async remapAll(
    sessionId: string,
    tenantContext?: TenantContext | null
  ): Promise<{ cardsRemapped: number; newMappingsCreated: number; oldMappingsDeleted: number }> {
    const { blueprint } = await this.getBlueprintContext(sessionId);
    if (!blueprint) {
      throw new Error('Blueprint not found for remapping');
    }

    const cards = await prisma.evidenceCard.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        citationId: true,
        citationKey: true,
        referenceArchetype: true,
        deepAnalysisLabel: true,
        claim: true,
        claimType: true,
        quantitativeDetail: true,
        conditions: true,
        comparableMetrics: true,
        doesNotSupport: true,
        scopeCondition: true,
        studyDesign: true,
        rigorIndicators: true,
        sourceFragment: true,
        pageHint: true,
        confidence: true,
        sourceSection: true,
        quoteVerified: true,
        quoteVerificationMethod: true,
        quoteVerificationScore: true,
      },
    });

    if (cards.length === 0) {
      return {
        cardsRemapped: 0,
        newMappingsCreated: 0,
        oldMappingsDeleted: 0,
      };
    }

    const oldMappingsDeletedResult = await prisma.evidenceCardMapping.deleteMany({
      where: {
        card: { sessionId },
      },
    });

    const cardsByCitation = new Map<string, ExtractedCardWithIdentity[]>();

    for (const card of cards) {
      const row: ExtractedCardWithIdentity = {
        cardId: card.id,
        citationId: card.citationId,
        citationKey: card.citationKey,
        referenceArchetype: normalizeArchetype(card.referenceArchetype),
        deepAnalysisLabel: normalizeDepthLabel(card.deepAnalysisLabel),
        claim: card.claim,
        claimType: card.claimType as any,
        quantitativeDetail: card.quantitativeDetail,
        conditions: card.conditions,
        comparableMetrics: (card.comparableMetrics || null) as any,
        doesNotSupport: card.doesNotSupport,
        scopeCondition: card.scopeCondition,
        studyDesign: card.studyDesign,
        rigorIndicators: card.rigorIndicators,
        sourceFragment: card.sourceFragment,
        pageHint: card.pageHint,
        confidence: card.confidence as any,
        sourceSection: card.sourceSection || 'unknown',
        quoteVerified: card.quoteVerified,
        quoteVerificationMethod: card.quoteVerificationMethod,
        quoteVerificationScore: card.quoteVerificationScore,
      };

      if (!cardsByCitation.has(card.citationId)) {
        cardsByCitation.set(card.citationId, []);
      }
      cardsByCitation.get(card.citationId)!.push(row);
    }

    const allMappings: CardDimensionMapping[] = [];

    for (const citationCards of Array.from(cardsByCitation.values())) {
      const mapped = await evidenceMappingService.mapCardsToDimensions(citationCards, blueprint, tenantContext || null);
      allMappings.push(...mapped.mappings);
    }

    if (allMappings.length > 0) {
      await prisma.evidenceCardMapping.createMany({
        data: allMappings.map(mapping => ({
          cardId: mapping.cardId,
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          useAs: mapping.useAs,
          mappingConfidence: mapping.mappingConfidence,
        })),
      });
    }

    return {
      cardsRemapped: cards.length,
      newMappingsCreated: allMappings.length,
      oldMappingsDeleted: oldMappingsDeletedResult.count,
    };
  }

  private async buildCoverageSummary(sessionId: string): Promise<CoverageSummary> {
    const { blueprint } = await this.getBlueprintContext(sessionId);
    if (!blueprint) {
      return {
        totalDimensions: 0,
        coveredDimensions: 0,
        gaps: [],
        underSupported: [],
      };
    }

    const allDimensions = blueprint.sectionPlan.flatMap(section =>
      (section.mustCover || []).map(dimension => ({ sectionKey: section.sectionKey, dimension }))
    );

    if (allDimensions.length === 0) {
      return {
        totalDimensions: 0,
        coveredDimensions: 0,
        gaps: [],
        underSupported: [],
      };
    }

    const mappings = await prisma.evidenceCardMapping.findMany({
      where: {
        card: { sessionId },
      },
      include: {
        card: {
          select: {
            confidence: true,
          },
        },
      },
    });

    const byDimension = new Map<string, Array<{ confidence: EvidenceConfidenceLevel }>>();

    for (const mapping of mappings) {
      const key = `${mapping.sectionKey}::${mapping.dimension}`;
      if (!byDimension.has(key)) {
        byDimension.set(key, []);
      }
      byDimension.get(key)!.push({ confidence: mapping.card.confidence as EvidenceConfidenceLevel });
    }

    const gaps: string[] = [];
    const underSupported: string[] = [];
    let coveredDimensions = 0;

    for (const row of allDimensions) {
      const key = `${row.sectionKey}::${row.dimension}`;
      const evidences = byDimension.get(key) || [];
      if (evidences.length === 0) {
        gaps.push(row.dimension);
        continue;
      }

      coveredDimensions += 1;
      const strongest = evidences.reduce((best, current) =>
        rankConfidence(current.confidence) > rankConfidence(best)
          ? current.confidence
          : best,
        'LOW' as EvidenceConfidenceLevel
      );

      if (strongest === 'LOW') {
        underSupported.push(row.dimension);
      }
    }

    return {
      totalDimensions: allDimensions.length,
      coveredDimensions,
      gaps,
      underSupported,
    };
  }

  async getCards(sessionId: string, query: EvidenceCardsQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(MAX_CARD_PAGE_SIZE, Number(query.limit || 50)));

    const where: Prisma.EvidenceCardWhereInput = {
      sessionId,
      ...(query.citationId ? { citationId: query.citationId } : {}),
      ...(query.claimType ? { claimType: query.claimType } : {}),
      ...(query.confidence ? { confidence: query.confidence } : {}),
      ...(typeof query.verified === 'boolean' ? { quoteVerified: query.verified } : {}),
      ...(query.sectionKey || query.dimension
        ? {
            mappings: {
              some: {
                ...(query.sectionKey ? { sectionKey: query.sectionKey } : {}),
                ...(query.dimension ? { dimension: query.dimension } : {}),
              },
            },
          }
        : {}),
    };

    const [totalCards, rows] = await Promise.all([
      prisma.evidenceCard.count({ where }),
      prisma.evidenceCard.findMany({
        where,
        include: {
          mappings: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const coverage = await this.buildCoverageSummary(sessionId);

    const cards = rows.map(card => ({
      id: card.id,
      citationKey: card.citationKey,
      citationId: card.citationId,
      claim: card.claim,
      claimType: card.claimType,
      quantitativeDetail: card.quantitativeDetail,
      conditions: card.conditions,
      comparableMetrics: card.comparableMetrics,
      doesNotSupport: card.doesNotSupport,
      scopeCondition: card.scopeCondition,
      studyDesign: card.studyDesign,
      rigorIndicators: card.rigorIndicators,
      sourceFragment: card.sourceFragment,
      pageHint: card.pageHint,
      confidence: card.confidence,
      sourceSection: card.sourceSection,
      quoteVerified: card.quoteVerified,
      mappings: card.mappings.map(mapping => ({
        sectionKey: mapping.sectionKey,
        dimension: mapping.dimension,
        useAs: mapping.useAs,
        mappingConfidence: mapping.mappingConfidence,
      })),
    }));

    const dimensionGroups = new Map<string, {
      sectionKey: string;
      dimension: string;
      cards: typeof cards;
      citationKeys: Set<string>;
    }>();

    for (const card of cards) {
      for (const mapping of card.mappings) {
        const key = `${mapping.sectionKey}::${mapping.dimension}`;
        if (!dimensionGroups.has(key)) {
          dimensionGroups.set(key, {
            sectionKey: mapping.sectionKey,
            dimension: mapping.dimension,
            cards: [],
            citationKeys: new Set<string>(),
          });
        }
        const group = dimensionGroups.get(key)!;
        group.cards.push(card);
        group.citationKeys.add(card.citationKey);
      }
    }

    const paperGroups = (() => {
      const byPaper = new Map<string, { citationId: string; citationKey: string; cardCount: number; cards: typeof cards }>();
      for (const card of cards) {
        const key = `${card.citationId}::${card.citationKey}`;
        if (!byPaper.has(key)) {
          byPaper.set(key, {
            citationId: card.citationId,
            citationKey: card.citationKey,
            cardCount: 0,
            cards: [],
          });
        }
        const group = byPaper.get(key)!;
        group.cards.push(card);
        group.cardCount += 1;
      }
      return Array.from(byPaper.values())
        .sort((a, b) => b.cardCount - a.cardCount || a.citationKey.localeCompare(b.citationKey));
    })();

    const dimensions = Array.from(dimensionGroups.values())
      .map(group => ({
        sectionKey: group.sectionKey,
        dimension: group.dimension,
        cardCount: group.cards.length,
        paperCount: group.citationKeys.size,
        cards: group.cards,
      }))
      .sort((a, b) =>
        a.sectionKey.localeCompare(b.sectionKey)
        || a.dimension.localeCompare(b.dimension)
      );

    const sections = (() => {
      const bySection = new Map<string, Array<{
        dimension: string;
        cardCount: number;
        paperCount: number;
        cards: typeof cards;
      }>>();

      for (const dim of dimensions) {
        if (!bySection.has(dim.sectionKey)) {
          bySection.set(dim.sectionKey, []);
        }
        bySection.get(dim.sectionKey)!.push({
          dimension: dim.dimension,
          cardCount: dim.cardCount,
          paperCount: dim.paperCount,
          cards: dim.cards,
        });
      }

      return Array.from(bySection.entries())
        .map(([sectionKey, groupedDimensions]) => ({
          sectionKey,
          cardCount: groupedDimensions.reduce((sum, item) => sum + item.cardCount, 0),
          dimensions: groupedDimensions.sort((a, b) => a.dimension.localeCompare(b.dimension)),
        }))
        .sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));
    })();

    return {
      totalCards,
      page,
      limit,
      cards,
      viewData: {
        requestedView: query.view || 'paper',
        papers: paperGroups,
        dimensions,
        sections,
      },
      coverage,
    };
  }

  async getCoverage(sessionId: string) {
    const { blueprint } = await this.getBlueprintContext(sessionId);

    const [mappings, cards] = await Promise.all([
      prisma.evidenceCardMapping.findMany({
        where: { card: { sessionId } },
        include: {
          card: {
            select: {
              citationKey: true,
              citationId: true,
              confidence: true,
            },
          },
        },
      }),
      prisma.evidenceCard.findMany({
        where: { sessionId },
        select: {
          citationKey: true,
          citationId: true,
        },
      }),
    ]);

    const citationSectionCounts = new Map<string, Map<string, number>>();
    const dimensionSummary = new Map<string, { sectionKey: string; dimension: string; cardIds: Set<string>; citationIds: Set<string>; minConfidence: EvidenceConfidenceLevel }>();

    for (const mapping of mappings) {
      const citationKey = mapping.card.citationKey;
      if (!citationSectionCounts.has(citationKey)) {
        citationSectionCounts.set(citationKey, new Map());
      }
      const sectionMap = citationSectionCounts.get(citationKey)!;
      sectionMap.set(mapping.sectionKey, (sectionMap.get(mapping.sectionKey) || 0) + 1);

      const dimKey = `${mapping.sectionKey}::${mapping.dimension}`;
      if (!dimensionSummary.has(dimKey)) {
        dimensionSummary.set(dimKey, {
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          cardIds: new Set(),
          citationIds: new Set(),
          minConfidence: mapping.card.confidence as EvidenceConfidenceLevel,
        });
      }

      const summary = dimensionSummary.get(dimKey)!;
      summary.cardIds.add(mapping.cardId);
      summary.citationIds.add(mapping.card.citationId);
      if (rankConfidence(mapping.card.confidence as EvidenceConfidenceLevel) < rankConfidence(summary.minConfidence)) {
        summary.minConfidence = mapping.card.confidence as EvidenceConfidenceLevel;
      }
    }

    const matrix = Array.from(citationSectionCounts.entries()).map(([citationKey, sections]) => ({
      citationKey,
      sections: Object.fromEntries(sections.entries()),
    }));

    const dimensionCoverage = Array.from(dimensionSummary.values()).map(item => ({
      sectionKey: item.sectionKey,
      dimension: item.dimension,
      cardCount: item.cardIds.size,
      paperCount: item.citationIds.size,
      minConfidence: item.minConfidence,
    }));

    const blueprintDimensions = blueprint
      ? blueprint.sectionPlan.flatMap(section =>
          (section.mustCover || []).map(dimension => ({ sectionKey: section.sectionKey, dimension }))
        )
      : [];

    const covered = new Set(dimensionCoverage.map(item => `${item.sectionKey}::${item.dimension}`));
    const gaps = blueprintDimensions
      .filter(item => !covered.has(`${item.sectionKey}::${item.dimension}`))
      .map(item => item.dimension);

    const overallCoverage = blueprintDimensions.length > 0
      ? (blueprintDimensions.length - gaps.length) / blueprintDimensions.length
      : 0;

    return {
      matrix,
      dimensionCoverage,
      gaps,
      overallCoverage,
      totalCards: cards.length,
    };
  }
}

export const deepAnalysisService = new DeepAnalysisService();
export { DeepAnalysisService };
