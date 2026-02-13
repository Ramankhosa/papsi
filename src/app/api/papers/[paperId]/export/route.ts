import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { DraftingService } from '@/lib/drafting-service';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';
import { buildPaperDocxBuffer } from '@/lib/export/paper-docx-export';
import { buildLatexExport } from '@/lib/export/latex-export';
import { exportCitationsToBibtex } from '@/lib/export/bibtex-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_FORMATS = new Set(['docx', 'bibtex', 'latex']);

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      paperType: true,
      citationStyle: true,
      publicationVenue: true,
      researchTopic: true,
      figurePlans: true
    }
  });
}

async function getPaperDraft(sessionId: string) {
  return prisma.annexureDraft.findFirst({
    where: {
      sessionId,
      jurisdiction: 'PAPER'
    },
    orderBy: { version: 'desc' }
  });
}

function normalizeExtraSections(value: any): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as Record<string, string>;
  return {};
}

function getStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

const NUMERIC_ORDER_STYLES = new Set(['IEEE', 'VANCOUVER']);
const CITE_MARKER_REGEX = /\[CITE:([^\]]+)\]/gi;

function splitCitationKeys(rawKeys: string): string[] {
  if (!rawKeys) return [];
  return rawKeys
    .split(/[;,]/)
    .map(key => key.trim())
    .filter(Boolean);
}

function buildCanonicalCitationLookup(citations: Array<{ citationKey: string }>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const citation of citations) {
    const key = String(citation.citationKey || '').trim();
    if (!key) continue;
    lookup.set(key.toLowerCase(), key);
  }
  return lookup;
}

function extractOrderedCitationKeysFromSections(
  sections: Array<{ key: string; content: string }>,
  canonicalLookup: Map<string, string>
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const content = section.content || '';
    if (!content.trim()) continue;

    CITE_MARKER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = CITE_MARKER_REGEX.exec(content)) !== null) {
      const keys = splitCitationKeys(match[1] || '');
      for (const key of keys) {
        const canonical = canonicalLookup.get(key.toLowerCase());
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        ordered.push(canonical);
      }
    }
  }

  return ordered;
}

function mergeCitationOrder(primaryOrder: string[], fallbackOrder: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const append = (key: string) => {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(key);
  };
  for (const key of primaryOrder) append(key);
  for (const key of fallbackOrder) append(key);
  return merged;
}

function sortCitationsByOrderedKeys<T extends { citationKey: string }>(
  citations: T[],
  orderedCitationKeys: string[]
): T[] {
  const orderLookup = new Map<string, number>();
  orderedCitationKeys.forEach((key, index) => orderLookup.set(key, index));
  return [...citations].sort((a, b) => {
    const left = orderLookup.get(a.citationKey);
    const right = orderLookup.get(b.citationKey);
    const leftRank = typeof left === 'number' ? left : Number.MAX_SAFE_INTEGER;
    const rightRank = typeof right === 'number' ? right : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return a.citationKey.localeCompare(b.citationKey);
  });
}

function buildCitationNumberingMap(orderedCitationKeys: string[]): Record<string, number> {
  return Object.fromEntries(
    orderedCitationKeys.map((citationKey, index) => [citationKey, index + 1])
  );
}

function titleize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function stripHtml(value: string): string {
  let text = value;
  text = text.replace(/<\s*br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  return text.trim();
}

function parseFormattingGuidelines(venue: any) {
  const guidelines = venue?.formattingGuidelines || {};
  const fontFamily = guidelines.fontFamily || guidelines.font || 'Times New Roman';
  const fontSizePt = Number(guidelines.fontSizePt || guidelines.fontSize || 12);
  const lineSpacing = Number(guidelines.lineSpacing || 1.5);
  const marginsCm = parseMargins(guidelines.margins);
  const rawPageSize = typeof guidelines.pageSize === 'string' ? guidelines.pageSize.toUpperCase() : 'A4';
  const pageSize: 'A4' | 'LETTER' = rawPageSize === 'LETTER' ? 'LETTER' : 'A4';

  return {
    fontFamily,
    fontSizePt: Number.isFinite(fontSizePt) ? fontSizePt : 12,
    lineSpacing: Number.isFinite(lineSpacing) ? lineSpacing : 1.5,
    marginsCm,
    pageSize
  };
}

function parseMargins(value: any): { top: number; bottom: number; left: number; right: number } {
  const fallback = { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 };

  if (!value) return fallback;

  if (typeof value === 'string') {
    const match = value.trim().match(/([\d.]+)\s*(cm|in|inch|inches)?/i);
    if (!match) return fallback;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return fallback;
    const unit = (match[2] || 'in').toLowerCase();
    const cm = unit.startsWith('cm') ? amount : amount * 2.54;
    return { top: cm, bottom: cm, left: cm, right: cm };
  }

  if (typeof value === 'number') {
    const cm = value * 2.54;
    return { top: cm, bottom: cm, left: cm, right: cm };
  }

  if (typeof value === 'object') {
    const top = Number(value.top ?? value.vertical ?? value.all ?? fallback.top);
    const bottom = Number(value.bottom ?? value.vertical ?? value.all ?? fallback.bottom);
    const left = Number(value.left ?? value.horizontal ?? value.all ?? fallback.left);
    const right = Number(value.right ?? value.horizontal ?? value.all ?? fallback.right);
    return {
      top: Number.isFinite(top) ? top : fallback.top,
      bottom: Number.isFinite(bottom) ? bottom : fallback.bottom,
      left: Number.isFinite(left) ? left : fallback.left,
      right: Number.isFinite(right) ? right : fallback.right
    };
  }

  return fallback;
}

function resolveBibliographyStyle(styleCode: string): string {
  const code = styleCode.toUpperCase();
  if (code.startsWith('IEEE')) return 'IEEEtran';
  if (code.startsWith('APA')) return 'apalike';
  if (code.startsWith('CHICAGO')) return 'chicago';
  return 'plain';
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const format = new URL(request.url).searchParams.get('format')?.toLowerCase() || 'docx';
    if (!SUPPORTED_FORMATS.has(format)) {
      return NextResponse.json({ error: 'Unsupported export format' }, { status: 400 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const draft = await getPaperDraft(sessionId);
    if (!draft) {
      return NextResponse.json({ error: 'No paper draft available for export' }, { status: 400 });
    }

    const extraSections = normalizeExtraSections(draft.extraSections);
    const styleCode = getStyleCode(session);
    const sectionOrder = Array.isArray(session.paperType?.sectionOrder) ? (session.paperType.sectionOrder as string[]) : [];
    const orderedKeys: string[] = sectionOrder.length > 0
      ? [...sectionOrder, ...Object.keys(extraSections).filter(key => !sectionOrder.includes(key))]
      : Object.keys(extraSections);

    const sections = orderedKeys
      .filter(key => {
        if (!key || typeof key !== 'string') return false;
        const normalized = key.toLowerCase();
        return normalized !== 'title' && normalized !== 'references' && normalized !== 'bibliography';
      })
      .map(key => ({ key: key as string, raw: extraSections[key as string] || '' }))
      .filter(section => section.raw && section.raw.trim().length > 0);

    const citations = await citationService.getCitationsForSession(sessionId);
    const canonicalLookup = buildCanonicalCitationLookup(citations);
    const plainSections = sections.map(section => {
      const plain = stripHtml(section.raw);
      return {
        key: section.key,
        title: titleize(section.key),
        content: plain
      };
    });

    const orderedCitationKeys = extractOrderedCitationKeysFromSections(plainSections, canonicalLookup);
    const fallbackUsedKeys = orderedCitationKeys.length === 0
      ? Array.from(new Set(
          plainSections
            .flatMap(section => DraftingService.extractCitationKeys(section.content))
            .map(key => canonicalLookup.get(String(key || '').trim().toLowerCase()) || String(key || '').trim())
            .filter(Boolean)
        ))
      : [];
    const usedCitationKeys = orderedCitationKeys.length > 0
      ? orderedCitationKeys
      : fallbackUsedKeys;

    const filteredCitations = usedCitationKeys.length > 0
      ? citations.filter(citation => usedCitationKeys.includes(citation.citationKey))
      : citations;
    const isNumericOrderStyle = NUMERIC_ORDER_STYLES.has(styleCode.toUpperCase());
    const citationOrdering = mergeCitationOrder(
      orderedCitationKeys,
      filteredCitations.map(citation => citation.citationKey)
    );
    const citationNumbering = isNumericOrderStyle
      ? buildCitationNumberingMap(citationOrdering)
      : undefined;

    const formattedSections = await Promise.all(
      plainSections.map(async section => {
        const processed = await DraftingService.postProcessSection(
          section.content,
          sessionId,
          styleCode,
          {
            citationNumbering
          }
        );
        return {
          key: section.key,
          title: section.title,
          content: processed.processedContent
        };
      })
    );

    const bibliographyCitations = isNumericOrderStyle
      ? sortCitationsByOrderedKeys(filteredCitations, citationOrdering)
      : filteredCitations;
    const bibliography = await citationStyleService.generateBibliography(
      bibliographyCitations.map(toCitationData),
      styleCode,
      isNumericOrderStyle ? { sortOrder: 'order_of_appearance' } : undefined
    );

    const figures = (session.figurePlans || [])
      .slice()
      .sort((a, b) => a.figureNo - b.figureNo)
      .map(figure => ({
        figureNo: figure.figureNo,
        title: figure.title,
        description: figure.description
      }));

    const title = session.researchTopic?.title || draft.title || 'Untitled Paper';
    const formatting = parseFormattingGuidelines(session.publicationVenue);

    if (format === 'docx') {
      const buffer = await buildPaperDocxBuffer({
        title,
        sections: formattedSections,
        bibliography,
        figures,
        formatting
      });

      return new NextResponse(buffer as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="paper_${sessionId}.docx"`
        }
      });
    }

    if (format === 'latex') {
      const result = buildLatexExport({
        title,
        sections: plainSections,
        figures: figures.map(figure => ({
          figureNo: figure.figureNo,
          caption: `${figure.title || `Figure ${figure.figureNo}`}${figure.description ? ` - ${figure.description}` : ''}`
        })),
        citations: filteredCitations.map(toCitationData),
        bibliographyStyle: resolveBibliographyStyle(styleCode),
        formatting: {
          marginInches: formatting.marginsCm.top / 2.54,
          lineSpacing: formatting.lineSpacing,
          fontSizePt: formatting.fontSizePt
        }
      });

      return new NextResponse(result.latex, {
        headers: {
          'Content-Type': 'application/x-tex',
          'Content-Disposition': `attachment; filename="paper_${sessionId}.tex"`
        }
      });
    }

    const bibtex = exportCitationsToBibtex(
      filteredCitations.map(citation => ({
        ...toCitationData(citation),
        sourceType: citation.sourceType
      }))
    );

    return new NextResponse(bibtex, {
      headers: {
        'Content-Type': 'text/x-bibtex',
        'Content-Disposition': `attachment; filename="paper_${sessionId}.bib"`
      }
    });
  } catch (error) {
    console.error('[PaperExport] error:', error);
    return NextResponse.json({ error: 'Failed to export paper' }, { status: 500 });
  }
}
