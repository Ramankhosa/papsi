import type { CitationData } from '@/lib/services/citation-style-service';
import type { CitationSourceType } from '@prisma/client';

export interface BibtexCitation extends CitationData {
  sourceType?: CitationSourceType | null;
}

export interface BibtexExportOptions {
  includeUrl?: boolean;
  includeDoi?: boolean;
}

const DEFAULT_OPTIONS: Required<BibtexExportOptions> = {
  includeUrl: true,
  includeDoi: true
};

export function exportCitationsToBibtex(
  citations: BibtexCitation[],
  options: BibtexExportOptions = {}
): string {
  const merged = { ...DEFAULT_OPTIONS, ...options };

  return citations.map(citation => {
    const entryType = inferEntryType(citation);
    const fields: string[] = [];

    fields.push(`title={${escapeBibtex(citation.title)}}`);

    if (citation.authors && citation.authors.length > 0) {
      fields.push(`author={${escapeBibtex(citation.authors.join(' and '))}}`);
    }

    if (citation.year) {
      fields.push(`year={${citation.year}}`);
    }

    if (citation.venue) {
      const fieldName = entryType === 'article'
        ? 'journal'
        : entryType === 'inproceedings'
          ? 'booktitle'
          : 'publisher';
      fields.push(`${fieldName}={${escapeBibtex(citation.venue)}}`);
    }

    if (citation.volume) fields.push(`volume={${escapeBibtex(citation.volume)}}`);
    if (citation.issue) fields.push(`number={${escapeBibtex(citation.issue)}}`);
    if (citation.pages) fields.push(`pages={${escapeBibtex(citation.pages)}}`);
    if (citation.publisher && entryType === 'book') fields.push(`publisher={${escapeBibtex(citation.publisher)}}`);
    if (citation.edition && entryType === 'book') fields.push(`edition={${escapeBibtex(citation.edition)}}`);
    if (citation.isbn) fields.push(`isbn={${escapeBibtex(citation.isbn)}}`);
    if (merged.includeDoi && citation.doi) fields.push(`doi={${escapeBibtex(citation.doi)}}`);
    if (merged.includeUrl && citation.url) fields.push(`url={${escapeBibtex(citation.url)}}`);

    return `@${entryType}{${citation.citationKey},\n  ${fields.join(',\n  ')}\n}`;
  }).join('\n\n');
}

function inferEntryType(citation: BibtexCitation): string {
  const sourceType = citation.sourceType;
  if (sourceType) {
    switch (sourceType) {
      case 'BOOK':
      case 'BOOK_CHAPTER':
        return 'book';
      case 'CONFERENCE_PAPER':
        return 'inproceedings';
      case 'THESIS':
        return 'phdthesis';
      case 'REPORT':
        return 'techreport';
      case 'WEBSITE':
        return 'misc';
      case 'PATENT':
        return 'patent';
      default:
        return 'article';
    }
  }

  if (citation.isbn || citation.publisher) return 'book';
  if (citation.venue && (citation.issue || citation.volume)) return 'article';
  if (citation.venue && citation.pages) return 'inproceedings';
  return 'misc';
}

function escapeBibtex(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/%/g, '\\%')
    .replace(/~/g, '\\~{}')
    .replace(/\^/g, '\\^{}');
}
