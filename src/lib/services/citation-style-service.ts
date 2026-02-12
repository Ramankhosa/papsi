/**
 * Citation Style Service
 * Handles citation formatting and bibliography generation for academic writing
 */

import { prisma } from '../prisma';
import type { CitationStyleDefinition, Citation } from '@prisma/client';

export interface CitationData {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  isbn?: string;
  publisher?: string;
  edition?: string;
  citationKey: string;
}

export interface FormattingOptions {
  maxAuthors?: number; // Override default max authors before et al.
  includeDOI?: boolean; // Force include/exclude DOI
  shortForm?: boolean; // Use short form if supported by style
  citationNumber?: number; // Explicit numeric index for numbered citation styles (IEEE/Vancouver)
  citationNumbering?: Record<string, number>; // Optional numbering map keyed by citationKey
}

export interface BibliographyOptions {
  sortOrder?: 'alphabetical' | 'order_of_appearance';
  includeDOIs?: boolean;
  maxAuthors?: number;
}

export interface BibTeXEntry {
  type: string; // article, inproceedings, book, etc.
  key: string;  // citation key
  fields: Record<string, string>;
}

class CitationStyleService {
  private styleCache: Map<string, CitationStyleDefinition> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Get citation style by code with caching
   */
  async getCitationStyle(code: string): Promise<CitationStyleDefinition | null> {
    const now = Date.now();

    // Check cache first
    if (this.styleCache.has(code)) {
      const cached = this.styleCache.get(code)!;
      if ((now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
        return cached;
      }
    }

    const style = await prisma.citationStyleDefinition.findUnique({
      where: { code }
    });

    if (!style || !style.isActive) {
      return null;
    }

    this.styleCache.set(code, style);
    this.cacheTimestamp = now;

    return style;
  }

  /**
   * Format in-text citation
   */
  async formatInTextCitation(
    citation: CitationData,
    styleCode: string,
    options: FormattingOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    // For now, use simple formatting based on the inTextFormatTemplate
    // In a full implementation, this would parse the bibliographyRules
    const template = style.inTextFormatTemplate;

    switch (styleCode) {
      case 'APA7':
        return this.formatAPA7InText(citation, options);
      case 'IEEE':
        return this.formatIEEEInText(citation, options);
      case 'CHICAGO_AUTHOR_DATE':
        return this.formatChicagoAuthorDateInText(citation, options);
      case 'MLA9':
        return this.formatMLA9InText(citation, options);
      default:
        return this.formatGenericInText(citation, template, options);
    }
  }

  /**
   * Format bibliography entry
   */
  async formatBibliographyEntry(
    citation: CitationData,
    styleCode: string,
    options: FormattingOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    switch (styleCode) {
      case 'APA7':
        return this.formatAPA7Bibliography(citation, options);
      case 'IEEE':
        return this.formatIEEEBibliography(citation, options);
      case 'CHICAGO_AUTHOR_DATE':
        return this.formatChicagoAuthorDateBibliography(citation, options);
      case 'MLA9':
        return this.formatMLA9Bibliography(citation, options);
      default:
        return this.formatGenericBibliography(citation, style, options);
    }
  }

  /**
   * Generate complete bibliography
   */
  async generateBibliography(
    citations: CitationData[],
    styleCode: string,
    options: BibliographyOptions = {}
  ): Promise<string> {
    const style = await this.getCitationStyle(styleCode);
    if (!style) {
      throw new Error(`Citation style not found: ${styleCode}`);
    }

    if (citations.length === 0) {
      return '';
    }

    // Sort citations
    const sortOrder = options.sortOrder || style.bibliographySortOrder as 'alphabetical' | 'order_of_appearance';
    const sortedCitations = this.sortCitations(citations, sortOrder);

    // Format each entry
    const entries = await Promise.all(
      sortedCitations.map(async (citation, index) => {
        const formatted = await this.formatBibliographyEntry(citation, styleCode, {
          maxAuthors: options.maxAuthors
        });

        // Add numbering for order_of_appearance styles
        if (sortOrder === 'order_of_appearance') {
          return `[${index + 1}] ${formatted}`;
        }

        return formatted;
      })
    );

    return entries.join('\n\n');
  }

  /**
   * Generate unique citation key
   */
  generateCitationKey(citation: CitationData, existingKeys: string[] = []): string {
    if (!citation.authors || citation.authors.length === 0) {
      // Use title-based key if no authors
      const titleWords = citation.title.split(/\s+/).slice(0, 2);
      const baseKey = titleWords.join('').replace(/[^a-zA-Z0-9]/g, '').substring(0, 6);
      return this.ensureUniqueKey(`${baseKey}${citation.year || 'NoYear'}`, existingKeys);
    }

    // Use first author's last name
    const firstAuthor = citation.authors[0];
    const lastName = this.extractLastName(firstAuthor);

    // Add year
    let baseKey = `${lastName}${citation.year || 'NoYear'}`;

    // Ensure uniqueness
    return this.ensureUniqueKey(baseKey, existingKeys);
  }

  /**
   * Parse BibTeX string into citation objects
   */
  parseBibTeX(bibtexString: string): CitationData[] {
    const entries: CitationData[] = [];
    const entryRegex = /@(\w+)\{([^,]+),\s*([^@]+)\}/g;

    let match;
    while ((match = entryRegex.exec(bibtexString)) !== null) {
      const [, type, key, fields] = match;

      // Parse fields
      const fieldRegex = /(\w+)\s*=\s*["{]([^"}]+)["}]/g;
      const fieldMap: Record<string, string> = {};
      let fieldMatch;

      while ((fieldMatch = fieldRegex.exec(fields)) !== null) {
        const [, fieldName, fieldValue] = fieldMatch;
        fieldMap[fieldName.toLowerCase()] = fieldValue;
      }

      // Convert to CitationData format
      const citation: CitationData = {
        id: `bibtex_${key}_${Date.now()}`,
        title: fieldMap.title || '',
        authors: this.parseBibTeXAuthors(fieldMap.author || ''),
        year: fieldMap.year ? parseInt(fieldMap.year) : undefined,
        venue: fieldMap.journal || fieldMap.booktitle || fieldMap.publisher,
        volume: fieldMap.volume,
        issue: fieldMap.number,
        pages: fieldMap.pages,
        doi: fieldMap.doi,
        url: fieldMap.url,
        isbn: fieldMap.isbn,
        publisher: fieldMap.publisher,
        edition: fieldMap.edition,
        citationKey: key
      };

      entries.push(citation);
    }

    return entries;
  }

  /**
   * Export citations to BibTeX format
   */
  async exportToBibTeX(citations: CitationData[]): Promise<string> {
    const bibtexEntries: string[] = [];

    for (const citation of citations) {
      const entryType = this.inferBibTeXType(citation);
      const fields: string[] = [];

      // Add required fields
      fields.push(`title={${citation.title}}`);

      if (citation.authors && citation.authors.length > 0) {
        fields.push(`author={${citation.authors.join(' and ')}}`);
      }

      if (citation.year) {
        fields.push(`year={${citation.year}}`);
      }

      // Add optional fields
      if (citation.venue) {
        const fieldName = entryType === 'article' ? 'journal' :
                         entryType === 'inproceedings' ? 'booktitle' : 'publisher';
        fields.push(`${fieldName}={${citation.venue}}`);
      }

      if (citation.volume) fields.push(`volume={${citation.volume}}`);
      if (citation.issue) fields.push(`number={${citation.issue}}`);
      if (citation.pages) fields.push(`pages={${citation.pages}}`);
      if (citation.doi) fields.push(`doi={${citation.doi}}`);
      if (citation.url) fields.push(`url={${citation.url}}`);
      if (citation.isbn) fields.push(`isbn={${citation.isbn}}`);
      if (citation.publisher && entryType === 'book') fields.push(`publisher={${citation.publisher}}`);

      bibtexEntries.push(`@${entryType}{${citation.citationKey},\n  ${fields.join(',\n  ')}\n}`);
    }

    return bibtexEntries.join('\n\n');
  }

  // ============================================================================
  // PRIVATE FORMATTING METHODS
  // ============================================================================

  private formatAPA7InText(citation: CitationData, options: FormattingOptions): string {
    if (!citation.authors || citation.authors.length === 0) {
      return `(Anonymous, ${citation.year || 'n.d.'})`;
    }

    const maxAuthors = options.maxAuthors || 3;
    const authors = citation.authors.slice(0, maxAuthors);
    const authorText = authors.length === 1
      ? this.extractLastName(authors[0])
      : authors.length === 2
        ? `${this.extractLastName(authors[0])} & ${this.extractLastName(authors[1])}`
        : `${this.extractLastName(authors[0])} et al.`;

    return `(${authorText}, ${citation.year || 'n.d.'})`;
  }

  private formatIEEEInText(citation: CitationData, options: FormattingOptions): string {
    const explicit = Number(options?.citationNumber);
    if (Number.isFinite(explicit) && explicit > 0) {
      return `[${Math.trunc(explicit)}]`;
    }

    const fromMap = Number(options?.citationNumbering?.[citation.citationKey]);
    if (Number.isFinite(fromMap) && fromMap > 0) {
      return `[${Math.trunc(fromMap)}]`;
    }

    // Fallback to deterministic placeholder when no sequence context is provided.
    return '[1]';
  }

  private formatChicagoAuthorDateInText(citation: CitationData, options: FormattingOptions): string {
    if (!citation.authors || citation.authors.length === 0) {
      return `(Anonymous ${citation.year || 'n.d.'})`;
    }

    const lastName = this.extractLastName(citation.authors[0]);
    return `(${lastName} ${citation.year || 'n.d.'})`;
  }

  private formatMLA9InText(citation: CitationData, options: FormattingOptions): string {
    if (!citation.authors || citation.authors.length === 0) {
      return `("Anonymous" ${citation.year || 'n.d.'})`;
    }

    const lastName = this.extractLastName(citation.authors[0]);
    return `(${lastName} ${citation.year || 'n.d.'})`;
  }

  private formatGenericInText(citation: CitationData, template: string, options: FormattingOptions): string {
    // Simple template replacement - in production, this would be more sophisticated
    return template
      .replace('{authors}', citation.authors?.[0] || 'Anonymous')
      .replace('{year}', citation.year?.toString() || 'n.d.');
  }

  private formatAPA7Bibliography(citation: CitationData, options: FormattingOptions): string {
    const authors = this.formatAuthorsAPA7(citation.authors || []);
    const year = citation.year || 'n.d.';
    let entry = `${authors} (${year}). ${citation.title}.`;

    if (citation.venue) entry += ` ${citation.venue},`;
    if (citation.volume) entry += ` ${citation.volume}`;
    if (citation.issue) entry += `(${citation.issue})`;
    if (citation.pages) entry += `, ${citation.pages}`;
    if (citation.doi && options.includeDOI !== false) entry += `. https://doi.org/${citation.doi}`;

    return entry;
  }

  private formatIEEEBibliography(citation: CitationData, options: FormattingOptions): string {
    // IEEE formatting would go here - simplified for now
    const authors = citation.authors?.map(this.formatAuthorIEEE).join(', ') || 'Anonymous';
    const year = citation.year || 'n.d.';
    let entry = `${authors}, "${citation.title},"`;

    if (citation.venue) entry += ` ${citation.venue},`;
    if (citation.volume) entry += ` vol. ${citation.volume},`;
    if (citation.issue) entry += ` no. ${citation.issue},`;
    if (citation.pages) entry += ` pp. ${citation.pages},`;
    entry += ` ${year}.`;

    return entry;
  }

  private formatChicagoAuthorDateBibliography(citation: CitationData, options: FormattingOptions): string {
    const authors = this.formatAuthorsChicago(citation.authors || []);
    const year = citation.year || 'n.d.';
    let entry = `${authors} ${year}. "${citation.title}."`;

    if (citation.venue) entry += ` ${citation.venue}`;
    if (citation.volume) entry += ` ${citation.volume}`;
    if (citation.issue) entry += `, no. ${citation.issue}`;
    if (citation.pages) entry += `: ${citation.pages}`;
    entry += '.';

    return entry;
  }

  private formatMLA9Bibliography(citation: CitationData, options: FormattingOptions): string {
    const authors = this.formatAuthorsMLA9(citation.authors || []);
    const year = citation.year || 'n.d.';
    let entry = `${authors}. "${citation.title},"`;

    if (citation.venue) entry += ` ${citation.venue},`;
    if (citation.volume) entry += ` vol. ${citation.volume},`;
    if (citation.issue) entry += ` no. ${citation.issue},`;
    entry += ` ${year},`;
    if (citation.pages) entry += ` pp. ${citation.pages}.`;

    return entry;
  }

  private formatGenericBibliography(citation: CitationData, style: CitationStyleDefinition, options: FormattingOptions): string {
    // Fallback generic formatting
    const authors = citation.authors?.join(', ') || 'Anonymous';
    const year = citation.year || 'n.d.';
    return `${authors} (${year}). ${citation.title}. ${citation.venue || ''}`;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private formatAuthorsAPA7(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    const maxAuthors = 20; // APA allows up to 20 authors before et al.
    const displayAuthors = authors.slice(0, maxAuthors);

    if (displayAuthors.length === 1) {
      return this.formatAuthorAPA7(displayAuthors[0]);
    }

    const formattedAuthors = displayAuthors.map(author => this.formatAuthorAPA7(author));
    const lastAuthor = formattedAuthors.pop();

    if (displayAuthors.length < maxAuthors) {
      return formattedAuthors.join(', ') + ', & ' + lastAuthor;
    } else {
      return formattedAuthors.join(', ') + ', ... ' + lastAuthor;
    }
  }

  private formatAuthorAPA7(author: string): string {
    // APA: Last, F. M.
    const parts = author.split(' ');
    if (parts.length === 1) return author;
    const lastName = parts[parts.length - 1];
    const firstInitials = parts.slice(0, -1).map(name => name.charAt(0) + '.').join(' ');
    return `${lastName}, ${firstInitials}`;
  }

  private formatAuthorIEEE(author: string): string {
    // IEEE: F. M. Last
    const parts = author.split(' ');
    if (parts.length === 1) return author;
    const lastName = parts[parts.length - 1];
    const firstInitials = parts.slice(0, -1).map(name => name.charAt(0) + '. ').join('');
    return `${firstInitials}${lastName}`;
  }

  private formatAuthorsChicago(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    if (authors.length === 1) {
      return this.formatAuthorChicago(authors[0]);
    }

    if (authors.length === 2) {
      return `${this.formatAuthorChicago(authors[0])} and ${this.formatAuthorChicago(authors[1])}`;
    }

    // More than 2 authors
    const formattedAuthors = authors.slice(0, -1).map(author => this.formatAuthorChicago(author));
    const lastAuthor = this.formatAuthorChicago(authors[authors.length - 1]);
    return formattedAuthors.join(', ') + ', and ' + lastAuthor;
  }

  private formatAuthorChicago(author: string): string {
    // Chicago: First Last
    return author;
  }

  private formatAuthorsMLA9(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';

    if (authors.length === 1) {
      return this.extractLastName(authors[0]);
    }

    if (authors.length === 2) {
      return `${this.extractLastName(authors[0])} and ${this.extractLastName(authors[1])}`;
    }

    // More than 2 authors
    return `${this.extractLastName(authors[0])} et al.`;
  }

  private extractLastName(author: string): string {
    const parts = author.trim().split(/\s+/);
    return parts[parts.length - 1] || author;
  }

  private sortCitations(citations: CitationData[], sortOrder: 'alphabetical' | 'order_of_appearance'): CitationData[] {
    if (sortOrder === 'alphabetical') {
      return [...citations].sort((a, b) => {
        const authorA = a.authors?.[0] || 'Anonymous';
        const authorB = b.authors?.[0] || 'Anonymous';
        return authorA.localeCompare(authorB);
      });
    }

    // order_of_appearance - maintain current order
    return citations;
  }

  private ensureUniqueKey(baseKey: string, existingKeys: string[]): string {
    let key = baseKey;
    let counter = 1;

    while (existingKeys.includes(key)) {
      key = `${baseKey}${String.fromCharCode(96 + counter)}`; // a, b, c, etc.
      counter++;
      if (counter > 26) {
        // If we exhaust letters, add numbers
        key = `${baseKey}${counter - 26}`;
      }
    }

    return key;
  }

  private parseBibTeXAuthors(authorString: string): string[] {
    // Simple BibTeX author parsing - "Last, First and Last2, First2"
    return authorString.split(/\s+and\s+/).map(author => author.trim());
  }

  private inferBibTeXType(citation: CitationData): string {
    // Simple type inference based on available fields
    if (citation.doi && citation.volume) return 'article';
    if (citation.venue?.toLowerCase().includes('conference') || citation.venue?.toLowerCase().includes('proceedings')) return 'inproceedings';
    if (citation.isbn) return 'book';
    return 'misc'; // fallback
  }

  /**
   * Invalidate cache
   */
  invalidateCache(): void {
    this.styleCache.clear();
    this.cacheTimestamp = 0;
  }
}

// Export singleton instance
export const citationStyleService = new CitationStyleService();

// Export class for testing
export { CitationStyleService };
