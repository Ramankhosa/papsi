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

    if (this.documentHasExtractableText(matched.document)) {
      const parserCandidate = this.hasGrobidCandidate(matched.document) ? 'GROBID' : 'REGEX_FALLBACK';
      return {
        ready: true,
        reason: null,
        referenceId: matched.referenceId,
        documentId: matched.document.id,
        parserCandidate,
      };
    }

    return {
      ready: false,
      reason: 'Document exists but has no parsed text and cannot be parsed with GROBID',
      referenceId: matched.referenceId,
      documentId: matched.document.id,
      parserCandidate: null,
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

    if (!grobidSections && this.shouldUseGrobid(document)) {
      grobidSections = await this.tryParseWithGrobid(document);
      if (grobidSections && grobidSections.length > 0) {
        await prisma.referenceDocument.update({
          where: { id: document.id },
          data: {
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
      throw new Error('Document has no parseable full text');
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

  private hasGrobidCandidate(document: MatchedReferenceDocument['document']): boolean {
    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) return false;
    if (!document.storagePath || !fs.existsSync(document.storagePath)) return false;
    const mime = String(document.mimeType || '').toLowerCase();
    return mime.includes('pdf');
  }

  private documentHasExtractableText(document: MatchedReferenceDocument['document']): boolean {
    const hasParsedText = typeof document.parsedText === 'string' && document.parsedText.trim().length > 0;
    if (hasParsedText) {
      return true;
    }

    const sections = this.parseSectionsJson(document.sectionsJson);
    if (sections && sections.length > 0) {
      return true;
    }

    return this.hasGrobidCandidate(document);
  }

  private shouldUseGrobid(document: MatchedReferenceDocument['document']): boolean {
    return this.hasGrobidCandidate(document);
  }

  private getGrobidUrl(): string {
    return String(process.env.GROBID_URL || process.env.GROBID_BASE_URL || '')
      .trim()
      .replace(/\/$/, '');
  }

  private async tryParseWithGrobid(
    document: MatchedReferenceDocument['document']
  ): Promise<PreparedPaperSection[] | null> {
    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) return null;

    try {
      const fileBuffer = fs.readFileSync(document.storagePath);
      const formData = new FormData();
      const fileName = path.basename(document.storagePath || 'document.pdf');
      formData.append('input', new Blob([fileBuffer]), fileName);
      formData.append('consolidateHeader', '1');
      formData.append('consolidateCitations', '0');

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 25_000);

      const response = await fetch(`${grobidUrl}/api/processFulltextDocument`, {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return null;
      }

      const teiXml = await response.text();
      const parsed = this.parseGrobidTEI(teiXml);
      return parsed.sections;
    } catch {
      return null;
    }
  }

  private parseGrobidTEI(teiXml: string): { sections: PreparedPaperSection[] } {
    const bodyMatch = teiXml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) {
      throw new Error('GROBID TEI has no body');
    }

    const bodyXml = bodyMatch[1]
      .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
      .replace(/<note[\s\S]*?<\/note>/gi, ' ');

    const sections: PreparedPaperSection[] = [];
    const divRegex = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch: RegExpExecArray | null;

    while ((divMatch = divRegex.exec(bodyXml)) !== null) {
      const divXml = divMatch[1];
      const headingMatch = divXml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      const headingRaw = headingMatch ? stripTags(headingMatch[1]) : 'Untitled Section';
      const heading = headingRaw.replace(/^\d+(?:\.\d+)*\s*/, '').trim() || 'Untitled Section';

      const paragraphs: string[] = [];
      const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
      let paragraphMatch: RegExpExecArray | null;
      while ((paragraphMatch = paragraphRegex.exec(divXml)) !== null) {
        const text = stripTags(paragraphMatch[1]).replace(/\s+/g, ' ').trim();
        if (text) paragraphs.push(text);
      }

      if (paragraphs.length === 0) {
        const fallbackText = stripTags(divXml).replace(/\s+/g, ' ').trim();
        if (fallbackText) {
          paragraphs.push(fallbackText);
        }
      }

      const joined = paragraphs.join('\n\n').trim();
      if (joined) {
        sections.push({ heading, text: joined });
      }
    }

    if (sections.length === 0) {
      const text = stripTags(bodyXml).replace(/\s+/g, ' ').trim();
      if (text) {
        sections.push({ heading: 'Body', text });
      }
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

    const supportPattern = /method|material|dataset|participant|experiment|evaluation|result|finding|analysis/i;
    const stressPattern = /method|material|result|finding|discussion|limitation|threat|failure|conclusion|analysis/i;

    const pattern = depthLabel === 'DEEP_STRESS_TEST' ? stressPattern : supportPattern;
    const selected = sections.filter(section => pattern.test(section.heading));

    if (selected.length > 0) {
      return selected;
    }

    const midpoint = Math.ceil(sections.length / 2);
    if (depthLabel === 'DEEP_SUPPORT') {
      return sections.slice(0, Math.max(1, midpoint));
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
