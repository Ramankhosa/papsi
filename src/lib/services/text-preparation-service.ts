import fs from 'fs';
import path from 'path';
import { prisma } from '../prisma';
import type { DeepAnalysisLabel, PreparedPaperSection, PreparedPaperText } from './deep-analysis-types';

interface CitationIdentity {
  id: string;
  doi?: string | null;
  title: string;
  year?: number | null;
  authors?: string[];
  libraryReferenceId?: string | null;
}

export interface PreparedCitationTextResult {
  preparedText: PreparedPaperText;
  referenceId: string | null;
  documentId: string | null;
  parserUsed: 'GROBID' | 'REGEX_FALLBACK';
}

export interface CitationTextReadinessResult {
  ready: boolean;
  reason: string | null;
  referenceId: string | null;
  documentId: string | null;
  parserCandidate: 'GROBID' | 'REGEX_FALLBACK' | null;
}

interface MatchedReferenceDocument {
  referenceId: string;
  document: {
    id: string;
    status: string;
    parsedText: string | null;
    sectionsJson: unknown;
    parserUsed: string | null;
    mimeType: string;
    sourceType: string;
    storagePath: string;
  };
}

const MAX_TOKENS = 25_000;
const MAX_CHARS = MAX_TOKENS * 4;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDoi = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
    .replace(/\s+/g, '');
};

const decodeXmlEntities = (value: string): string => {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x2013;|&#8211;/g, '-')
    .replace(/&#x2014;|&#8212;/g, '-')
    .replace(/&#x2018;|&#8216;/g, "'")
    .replace(/&#x2019;|&#8217;/g, "'")
    .replace(/&#x201C;|&#8220;/g, '"')
    .replace(/&#x201D;|&#8221;/g, '"');
};

const stripTags = (value: string): string => decodeXmlEntities(value.replace(/<[^>]+>/g, ' '));
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const estimateTokens = (text: string): number => Math.ceil(String(text || '').length / 4);

const clampByTokenBudget = (text: string, maxChars = MAX_CHARS): string => {
  if (text.length <= maxChars) {
    return text;
  }

  const candidate = text.slice(0, maxChars);
  const paragraphBreak = candidate.lastIndexOf('\n\n');
  if (paragraphBreak > maxChars * 0.6) {
    return candidate.slice(0, paragraphBreak).trim();
  }

  const lineBreak = candidate.lastIndexOf('\n');
  if (lineBreak > maxChars * 0.6) {
    return candidate.slice(0, lineBreak).trim();
  }

  return candidate.trim();
};

class TextPreparationService {
  private static grobidInFlight = 0;
  private static grobidWaiters: Array<() => void> = [];
  private static grobidHealthCache: { url: string; checkedAt: number; reachable: boolean } | null = null;

  async prepareForCitation(
    sessionId: string,
    citation: CitationIdentity,
    depthLabel: DeepAnalysisLabel
  ): Promise<PreparedCitationTextResult> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });

    if (!session) {
      throw new Error('Drafting session not found');
    }

    const matched = await this.resolveReferenceDocument(session.userId, sessionId, citation);
    if (!matched?.document) {
      throw new Error(`No full-text document linked for citation ${citation.id}`);
    }

    const preparedText = await this.prepareFromDocument(matched.document, depthLabel);

    return {
      preparedText,
      referenceId: matched.referenceId,
      documentId: matched.document.id,
      parserUsed: preparedText.source,
    };
  }

  async checkCitationReadiness(
    sessionId: string,
    citation: CitationIdentity
  ): Promise<CitationTextReadinessResult> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });

    if (!session) {
      return {
        ready: false,
        reason: 'Drafting session not found',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
      };
    }

    const matched = await this.resolveReferenceDocument(session.userId, sessionId, citation);
    if (!matched?.document) {
      return {
        ready: false,
        reason: 'No linked full-text reference document found',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
      };
    }

    const hasParsedText = typeof matched.document.parsedText === 'string' && matched.document.parsedText.trim().length > 0;
    const storedSections = this.parseSectionsJson(matched.document.sectionsJson);

    if (hasParsedText || (storedSections && storedSections.length > 0)) {
      const parserCandidate = (storedSections && storedSections.length > 0) || this.hasGrobidCandidate(matched.document)
        ? 'GROBID'
        : 'REGEX_FALLBACK';
      return {
        ready: true,
        reason: null,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate,
      };
    }

    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) {
      return {
        ready: false,
        reason: 'Document has no parsed text and GROBID is not configured (set GROBID_URL)',
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
      };
    }

    const storagePath = this.resolveStoragePath(matched.document.storagePath);
    if (!storagePath || !fs.existsSync(storagePath)) {
      const missingPath = storagePath || matched.document.storagePath || '(missing storagePath)';
      return {
        ready: false,
        reason: `Document file not found at ${missingPath}`,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
      };
    }

    const mime = String(matched.document.mimeType || '').toLowerCase();
    const looksLikePdfPath = /\.pdf$/i.test(storagePath);
    if (!mime.includes('pdf') && !looksLikePdfPath) {
      return {
        ready: false,
        reason: `Document mime type ${matched.document.mimeType || 'unknown'} is not supported by GROBID`,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
      };
    }

    const grobidHealth = await this.getGrobidHealth();
    if (!grobidHealth.reachable) {
      return {
        ready: false,
        reason: `GROBID service unreachable at ${grobidHealth.url}. Check that the Docker container is running.`,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate: null,
      };
    }

    return {
      ready: true,
      reason: null,
      referenceId: matched.referenceId,
      documentId: matched.document.id,
      parserCandidate: 'GROBID',
    };
  }

  private async resolveReferenceDocument(
    userId: string,
    sessionId: string,
    citation: CitationIdentity
  ): Promise<MatchedReferenceDocument | null> {
    const documentSelect = {
      id: true,
      status: true,
      parsedText: true,
      sectionsJson: true,
      parserUsed: true,
      mimeType: true,
      sourceType: true,
      storagePath: true,
    } as const;

    // ── Fast path: direct lookup via libraryReferenceId ──
    // If the citation was imported from the library, resolve directly
    // without fuzzy matching — this is the most reliable path.
    const directRefId = citation.libraryReferenceId
      || await this.lookupLibraryReferenceIdFromCitation(citation.id);

    if (directRefId) {
      const directRef = await prisma.referenceLibrary.findFirst({
        where: { id: directRefId, userId, isActive: true },
        include: {
          documents: {
            where: { isPrimary: true },
            include: { document: { select: documentSelect } },
          },
        },
      });

      const directDoc = directRef?.documents[0]?.document;
      if (directDoc) {
        return {
          referenceId: directRef.id,
          document: {
            id: directDoc.id,
            status: directDoc.status,
            parsedText: directDoc.parsedText,
            sectionsJson: directDoc.sectionsJson,
            parserUsed: directDoc.parserUsed,
            mimeType: directDoc.mimeType,
            sourceType: directDoc.sourceType,
            storagePath: directDoc.storagePath,
          },
        };
      }
    }

    // ── Fallback: fuzzy DOI/title matching ──
    const marker = `AUTO_PAPER_SESSION:${sessionId}`;
    const citationDoi = normalizeDoi(citation.doi);
    const citationTitle = normalize(citation.title || '');
    const citationYear = Number.isFinite(Number(citation.year)) ? Number(citation.year) : null;
    const firstAuthor = normalize((citation.authors || [])[0] || '');

    const whereOr: any[] = [];
    if (citationDoi) {
      whereOr.push({ doi: { equals: citationDoi, mode: 'insensitive' } });
    }
    if (citation.title?.trim()) {
      whereOr.push({ title: { equals: citation.title.trim(), mode: 'insensitive' } });
      whereOr.push({ title: { contains: citation.title.trim().slice(0, 120), mode: 'insensitive' } });
    }

    const candidates = await prisma.referenceLibrary.findMany({
      where: {
        userId,
        isActive: true,
        ...(whereOr.length > 0 ? { OR: whereOr } : {}),
      },
      take: 60,
      include: {
        collections: {
          include: {
            collection: {
              select: { description: true },
            },
          },
        },
        documents: {
          where: { isPrimary: true },
          include: { document: { select: documentSelect } },
        },
      },
    });

    const scored: Array<{ score: number; item: MatchedReferenceDocument }> = [];

    for (const reference of candidates) {
      const inPaperCollection = reference.collections.some(link =>
        String(link.collection?.description || '').includes(marker)
      );
      const referenceDoi = normalizeDoi(reference.doi);
      const referenceTitle = normalize(reference.title || '');
      const referenceFirstAuthor = normalize(reference.authors?.[0] || '');

      let score = 0;
      if (inPaperCollection) score += 60;
      if (citationDoi && referenceDoi === citationDoi) score += 100;
      if (citationTitle && referenceTitle && citationTitle === referenceTitle) score += 60;
      if (citationTitle && referenceTitle && (citationTitle.includes(referenceTitle) || referenceTitle.includes(citationTitle))) {
        score += 25;
      }
      if (citationYear && reference.year === citationYear) score += 10;
      if (firstAuthor && referenceFirstAuthor && firstAuthor === referenceFirstAuthor) score += 10;

      const primary = reference.documents[0]?.document;
      if (!primary) continue;
      if (primary.parsedText && primary.parsedText.trim().length > 0) score += 20;
      if (primary.status === 'READY') score += 15;

      scored.push({
        score,
        item: {
          referenceId: reference.id,
          document: {
            id: primary.id,
            status: primary.status,
            parsedText: primary.parsedText,
            sectionsJson: primary.sectionsJson,
            parserUsed: primary.parserUsed,
            mimeType: primary.mimeType,
            sourceType: primary.sourceType,
            storagePath: primary.storagePath,
          },
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);

    const withText = scored.find(candidate =>
      typeof candidate.item.document.parsedText === 'string' && candidate.item.document.parsedText.trim().length > 0
    );

    if (withText) {
      // Backfill the libraryReferenceId on the citation if it was resolved by fuzzy match
      if (!directRefId) {
        this.backfillLibraryReferenceId(citation.id, withText.item.referenceId).catch(() => {});
      }
      return withText.item;
    }

    const fallback = scored[0]?.item || null;
    if (fallback && !directRefId) {
      this.backfillLibraryReferenceId(citation.id, fallback.referenceId).catch(() => {});
    }
    return fallback;
  }

  private async lookupLibraryReferenceIdFromCitation(citationId: string): Promise<string | null> {
    const row = await prisma.citation.findUnique({
      where: { id: citationId },
      select: { libraryReferenceId: true },
    });
    return row?.libraryReferenceId || null;
  }

  private async backfillLibraryReferenceId(citationId: string, referenceId: string): Promise<void> {
    await prisma.citation.update({
      where: { id: citationId },
      data: { libraryReferenceId: referenceId },
    });
  }

  private async prepareFromDocument(
    document: MatchedReferenceDocument['document'],
    depthLabel: DeepAnalysisLabel
  ): Promise<PreparedPaperText> {
    let grobidSections = this.parseSectionsJson(document.sectionsJson);
    let grobidFailureReason: string | null = null;
    let parsedWithGrobidThisRun = false;

    if (!grobidSections && this.shouldUseGrobid(document)) {
      const parsed = await this.tryParseWithGrobid(document);
      grobidSections = parsed.sections;
      grobidFailureReason = parsed.failureReason;
      if (grobidSections && grobidSections.length > 0) {
        parsedWithGrobidThisRun = true;
        const extractedFullText = this.joinSections(grobidSections);
        await prisma.referenceDocument.update({
          where: { id: document.id },
          data: {
            parsedText: extractedFullText,
            sectionsJson: grobidSections as any,
            parserUsed: 'GROBID',
          },
        }).catch(() => undefined);
      }
    }

    if (grobidSections && grobidSections.length > 0) {
      const selectedSections = this.selectSectionsByDepth(grobidSections, depthLabel);
      const fullBody = this.joinSections(grobidSections);
      const selectedText = this.joinSections(selectedSections.length > 0 ? selectedSections : grobidSections);
      const bounded = clampByTokenBudget(selectedText);

      const hasStoredParsedText = typeof document.parsedText === 'string' && document.parsedText.trim().length > 0;
      if (!parsedWithGrobidThisRun && !hasStoredParsedText && fullBody) {
        await prisma.referenceDocument.update({
          where: { id: document.id },
          data: {
            parsedText: fullBody,
            parserUsed: document.parserUsed || 'GROBID',
          },
        }).catch(() => undefined);
      }

      return {
        fullText: bounded,
        rawFullText: clampByTokenBudget(fullBody, MAX_CHARS * 2),
        sections: selectedSections.length > 0 ? selectedSections : grobidSections,
        source: 'GROBID',
        estimatedTokens: estimateTokens(bounded),
      };
    }

    const cleaned = this.regexClean(document.parsedText || '');
    if (!cleaned) {
      throw new Error(grobidFailureReason || 'Document has no parseable full text');
    }

    await prisma.referenceDocument.update({
      where: { id: document.id },
      data: {
        parserUsed: document.parserUsed || 'REGEX_FALLBACK',
      },
    }).catch(() => undefined);

    const bounded = clampByTokenBudget(cleaned);

    return {
      fullText: bounded,
      rawFullText: bounded,
      source: 'REGEX_FALLBACK',
      estimatedTokens: estimateTokens(bounded),
    };
  }

  private parseSectionsJson(raw: unknown): PreparedPaperSection[] | null {
    if (!Array.isArray(raw)) {
      return null;
    }

    const sections = raw
      .map(item => {
        if (!item || typeof item !== 'object') return null;
        const heading = String((item as any).heading || '').trim() || 'Untitled Section';
        const text = String((item as any).text || '').trim();
        if (!text) return null;
        return { heading, text };
      })
      .filter((item): item is PreparedPaperSection => Boolean(item));

    return sections.length > 0 ? sections : null;
  }

  private resolveStoragePath(storagePath?: string | null): string | null {
    const candidate = String(storagePath || '').trim();
    if (!candidate) return null;
    return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  }

  private hasGrobidCandidate(document: MatchedReferenceDocument['document']): boolean {
    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) return false;
    const resolvedPath = this.resolveStoragePath(document.storagePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) return false;
    const mime = String(document.mimeType || '').toLowerCase();
    return mime.includes('pdf') || /\.pdf$/i.test(resolvedPath);
  }

  private shouldUseGrobid(document: MatchedReferenceDocument['document']): boolean {
    return this.hasGrobidCandidate(document);
  }

  private getGrobidTimeoutMs(): number {
    const parsed = Number.parseInt(String(process.env.GROBID_TIMEOUT_MS || '90000'), 10);
    if (!Number.isFinite(parsed)) return 90_000;
    return Math.max(15_000, Math.min(300_000, parsed));
  }

  private getGrobidMaxRetries(): number {
    const parsed = Number.parseInt(String(process.env.GROBID_MAX_RETRIES || '4'), 10);
    if (!Number.isFinite(parsed)) return 4;
    return Math.max(1, Math.min(8, parsed));
  }

  private getGrobidConcurrency(): number {
    const parsed = Number.parseInt(String(process.env.GROBID_CONCURRENCY || '2'), 10);
    if (!Number.isFinite(parsed)) return 2;
    return Math.max(1, Math.min(8, parsed));
  }

  private getGrobidUrl(): string {
    return String(process.env.GROBID_URL || process.env.GROBID_BASE_URL || '')
      .trim()
      .replace(/\/$/, '');
  }

  private async getGrobidHealth(): Promise<{ url: string; reachable: boolean }> {
    const url = this.getGrobidUrl();
    if (!url) {
      return { url: '', reachable: false };
    }

    const cached = TextPreparationService.grobidHealthCache;
    const now = Date.now();
    if (cached && cached.url === url && now - cached.checkedAt < 30_000) {
      return { url, reachable: cached.reachable };
    }

    let reachable = false;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 5_000);
    try {
      const response = await fetch(`${url}/api/isalive`, {
        method: 'GET',
        signal: abortController.signal,
      });
      reachable = response.ok;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }

    TextPreparationService.grobidHealthCache = {
      url,
      checkedAt: now,
      reachable,
    };

    return { url, reachable };
  }

  private getGrobidVariants(): Array<{ endpointPath: string; fieldName: 'input' | 'inputFile' }> {
    const configuredEndpoint = String(process.env.GROBID_FULLTEXT_ENDPOINT || '/api/processFulltextDocument').trim();
    const normalizedEndpoint = configuredEndpoint.startsWith('/') ? configuredEndpoint : `/${configuredEndpoint}`;
    const configuredField = String(process.env.GROBID_INPUT_FIELD || 'input').trim().toLowerCase() === 'inputfile'
      ? 'inputFile'
      : 'input';

    const variants: Array<{ endpointPath: string; fieldName: 'input' | 'inputFile' }> = [
      { endpointPath: normalizedEndpoint, fieldName: configuredField },
      { endpointPath: '/api/processFulltextDocument', fieldName: 'input' },
      { endpointPath: '/api/processFulltextDocument', fieldName: 'inputFile' },
    ];

    const deduped = new Map<string, { endpointPath: string; fieldName: 'input' | 'inputFile' }>();
    for (const variant of variants) {
      const key = `${variant.endpointPath}::${variant.fieldName}`;
      if (!deduped.has(key)) {
        deduped.set(key, variant);
      }
    }
    return Array.from(deduped.values());
  }

  private async acquireGrobidSlot(limit: number): Promise<void> {
    while (TextPreparationService.grobidInFlight >= limit) {
      await new Promise<void>(resolve => {
        TextPreparationService.grobidWaiters.push(resolve);
      });
    }
    TextPreparationService.grobidInFlight += 1;
  }

  private releaseGrobidSlot(): void {
    TextPreparationService.grobidInFlight = Math.max(0, TextPreparationService.grobidInFlight - 1);
    const next = TextPreparationService.grobidWaiters.shift();
    if (next) {
      next();
    }
  }

  private async withGrobidSlot<T>(task: () => Promise<T>): Promise<T> {
    const limit = this.getGrobidConcurrency();
    await this.acquireGrobidSlot(limit);
    try {
      return await task();
    } finally {
      this.releaseGrobidSlot();
    }
  }

  private buildGrobidFormData(
    fileBuffer: Buffer,
    fileName: string,
    fieldName: 'input' | 'inputFile'
  ): FormData {
    const formData = new FormData();
    formData.append(
      fieldName,
      new Blob([fileBuffer as unknown as ArrayBuffer], { type: 'application/pdf' }),
      fileName
    );
    formData.append('consolidateHeader', '1');
    formData.append('consolidateCitations', '0');
    formData.append('segmentSentences', '1');
    return formData;
  }

  private async requestGrobidTEI(
    grobidUrl: string,
    endpointPath: string,
    fileBuffer: Buffer,
    fileName: string,
    fieldName: 'input' | 'inputFile',
    timeoutMs: number
  ): Promise<{ teiXml: string | null; retryable: boolean; unreachable: boolean }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(`${grobidUrl}${endpointPath}`, {
        method: 'POST',
        body: this.buildGrobidFormData(fileBuffer, fileName, fieldName),
        signal: abortController.signal,
        headers: {
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
        return {
          teiXml: null,
          retryable: retryableStatuses.has(response.status),
          unreachable: false,
        };
      }

      const teiXml = await response.text();
      return { teiXml, retryable: false, unreachable: false };
    } catch {
      return { teiXml: null, retryable: true, unreachable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private async tryParseWithGrobid(
    document: MatchedReferenceDocument['document']
  ): Promise<{ sections: PreparedPaperSection[] | null; failureReason: string | null }> {
    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) {
      return {
        sections: null,
        failureReason: 'GROBID URL is not configured (set GROBID_URL)',
      };
    }

    try {
      const storagePath = this.resolveStoragePath(document.storagePath);
      if (!storagePath || !fs.existsSync(storagePath)) {
        const missingPath = storagePath || document.storagePath || '(missing storagePath)';
        console.warn(`[TextPreparation] GROBID skipped for document ${document.id}: file not found at ${missingPath}`);
        return {
          sections: null,
          failureReason: `Document file not found at ${missingPath}`,
        };
      }

      const fileBuffer = fs.readFileSync(storagePath);
      const fileName = path.basename(storagePath || 'document.pdf');
      const timeoutMs = this.getGrobidTimeoutMs();
      const maxRetries = this.getGrobidMaxRetries();
      const variants = this.getGrobidVariants();

      return await this.withGrobidSlot(async () => {
        let sawConnectionFailure = false;

        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
          let shouldRetry = false;

          for (const variant of variants) {
            const response = await this.requestGrobidTEI(
              grobidUrl,
              variant.endpointPath,
              fileBuffer,
              fileName,
              variant.fieldName,
              timeoutMs
            );

            if (response.teiXml) {
              try {
                const parsed = this.parseGrobidTEI(response.teiXml);
                if (parsed.sections.length > 0) {
                  return {
                    sections: parsed.sections,
                    failureReason: null,
                  };
                }
              } catch {
                // Continue trying compatible endpoint/field combinations.
              }
            }

            if (response.unreachable) {
              sawConnectionFailure = true;
            }
            if (response.retryable) {
              shouldRetry = true;
            }
          }

          if (!shouldRetry || attempt >= maxRetries - 1) {
            break;
          }

          await this.delay(Math.min(1_500 * (attempt + 1), 6_000));
        }

        if (sawConnectionFailure) {
          return {
            sections: null,
            failureReason: `GROBID service unreachable at ${grobidUrl}. Check that the Docker container is running.`,
          };
        }

        return {
          sections: null,
          failureReason: 'GROBID returned no parseable sections',
        };
      });
    } catch (error) {
      console.warn(`[TextPreparation] GROBID parse failed for document ${document.id}:`, error);
      return {
        sections: null,
        failureReason: `GROBID parsing failed for document ${document.id}`,
      };
    }
  }

  private extractGrobidBodyXml(teiXml: string): { bodyXml: string | null; selfClosingBody: boolean } {
    const explicitBodyMatch = teiXml.match(/<(?:\w+:)?body\b[^>]*>([\s\S]*?)<\/(?:\w+:)?body>/i);
    if (explicitBodyMatch) {
      return {
        bodyXml: explicitBodyMatch[1],
        selfClosingBody: false,
      };
    }

    const selfClosingBodyMatch = teiXml.match(/<(?:\w+:)?body\b[^>]*\/>/i);
    if (selfClosingBodyMatch) {
      return {
        bodyXml: '',
        selfClosingBody: true,
      };
    }

    return {
      bodyXml: null,
      selfClosingBody: false,
    };
  }

  private parseGrobidTEI(teiXml: string): { sections: PreparedPaperSection[] } {
    const { bodyXml: extractedBodyXml, selfClosingBody } = this.extractGrobidBodyXml(teiXml);
    if (extractedBodyXml === null) {
      throw new Error('GROBID TEI has no body');
    }

    const bodyXml = extractedBodyXml
      .replace(/<(?:\w+:)?figure[\s\S]*?<\/(?:\w+:)?figure>/gi, ' ')
      .replace(/<(?:\w+:)?note[\s\S]*?<\/(?:\w+:)?note>/gi, ' ');

    const sections: PreparedPaperSection[] = [];
    const divRegex = /<(?:\w+:)?div\b[^>]*>([\s\S]*?)<\/(?:\w+:)?div>/gi;
    let divMatch: RegExpExecArray | null;

    while ((divMatch = divRegex.exec(bodyXml)) !== null) {
      const divXml = divMatch[1];
      const headingMatch = divXml.match(/<(?:\w+:)?head[^>]*>([\s\S]*?)<\/(?:\w+:)?head>/i);
      const headingRaw = headingMatch ? stripTags(headingMatch[1]) : 'Untitled Section';
      const heading = headingRaw.replace(/^\d+(?:\.\d+)*\s*/, '').trim() || 'Untitled Section';

      const paragraphs: string[] = [];
      const paragraphRegex = /<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/gi;
      let paragraphMatch: RegExpExecArray | null;
      while ((paragraphMatch = paragraphRegex.exec(divXml)) !== null) {
        const text = normalizeWhitespace(stripTags(paragraphMatch[1]));
        if (text) paragraphs.push(text);
      }

      if (paragraphs.length === 0) {
        const fallbackText = normalizeWhitespace(stripTags(divXml));
        if (fallbackText) {
          paragraphs.push(fallbackText);
        }
      }

      const joined = paragraphs.join('\n\n').trim();
      if (joined) {
        sections.push({ heading, text: joined });
      }
    }

    if (sections.length === 0 && bodyXml.trim().length > 0) {
      const text = normalizeWhitespace(stripTags(bodyXml));
      if (text) {
        sections.push({ heading: 'Body', text });
      }
    }

    if (sections.length === 0 && selfClosingBody) {
      const fallbackText = normalizeWhitespace(stripTags(teiXml));
      if (fallbackText) {
        sections.push({ heading: 'Body', text: fallbackText });
      }
    }

    if (sections.length === 0) {
      throw new Error('GROBID returned no parseable sections');
    }

    return { sections };
  }

  regexClean(text: string): string {
    let value = String(text || '').replace(/\r\n/g, '\n');

    const referencesMatch = value.match(/\n\s*(references|bibliography|works\s+cited)\s*\n/i);
    if (referencesMatch && typeof referencesMatch.index === 'number') {
      value = value.slice(0, referencesMatch.index);
    }

    const lines = value.split('\n');
    const shortLineCounts = new Map<string, number>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      if (line.length <= 80 && wordCount <= 8) {
        shortLineCounts.set(line, (shortLineCounts.get(line) || 0) + 1);
      }
    }

    const cleanedLines = lines.filter(rawLine => {
      const line = rawLine.trim();
      if (!line) return true;
      if (/^[\[(]?\d{1,4}[\])]?$/.test(line)) return false;
      const shortCount = shortLineCounts.get(line) || 0;
      if (line.length <= 80 && shortCount >= 3) return false;
      return true;
    });

    value = cleanedLines.join('\n');
    value = value
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return clampByTokenBudget(value);
  }

  private selectSectionsByDepth(
    sections: PreparedPaperSection[],
    depthLabel: DeepAnalysisLabel
  ): PreparedPaperSection[] {
    if (depthLabel === 'DEEP_ANCHOR') {
      return sections;
    }

    const supportPattern = /method|material|dataset|participant|experiment|evaluation|result|finding|analysis|experimental|setup|data|performance|outcome|benchmark|ablation|implementation|approach|design|procedure|framework|sample|measure|test|comparison|effect|impact/i;
    const stressPattern = /method|material|result|finding|discussion|limitation|threat|failure|conclusion|analysis/i;

    const pattern = depthLabel === 'DEEP_STRESS_TEST' ? stressPattern : supportPattern;
    const selected = sections.filter(section => pattern.test(section.heading));

    if (selected.length > 0) {
      return selected;
    }

    const midpoint = Math.ceil(sections.length / 2);
    if (depthLabel === 'DEEP_SUPPORT') {
      return sections.slice(Math.max(0, midpoint - 1));
    }

    return sections.slice(Math.max(0, midpoint - 1));
  }

  private joinSections(sections: PreparedPaperSection[]): string {
    return sections
      .map(section => `## ${section.heading}\n\n${section.text}`)
      .join('\n\n')
      .trim();
  }
}

export const textPreparationService = new TextPreparationService();
export { TextPreparationService };
