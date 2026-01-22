/**
 * Citation Management Service
 * Handles CRUD operations and management of citations for research papers
 */

import { prisma } from '../prisma';
import { literatureSearchService, SearchResult } from './literature-search-service';
import { citationStyleService, CitationData } from './citation-style-service';
import type { Citation, CitationUsage, CitationImportSource, CitationSourceType } from '@prisma/client';

// AI-generated citation metadata for section generation
export interface CitationAIMeta {
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  usage?: {
    introduction?: boolean;
    literatureReview?: boolean;
    methodology?: boolean;
    comparison?: boolean;
  };
  relevanceScore?: number;
  analyzedAt?: string;
}

export interface CreateCitationInput {
  sessionId: string;
  sourceType: CitationSourceType;
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
  importSource: CitationImportSource;
  notes?: string;
  tags?: string[];
  aiMeta?: CitationAIMeta; // AI-generated metadata for section generation
}

export interface UpdateCitationInput {
  title?: string;
  authors?: string[];
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
  notes?: string;
  tags?: string[];
  isActive?: boolean;
}

export interface CitationWithUsage extends Citation {
  usages: CitationUsage[];
  usageCount: number;
}

export interface QualityCheckResult {
  unusedCitations: CitationWithUsage[];
  duplicateCitations: Array<{
    citations: Citation[];
    reason: string;
  }>;
  incompleteCitations: Citation[];
  suggestions: string[];
}

class CitationService {
  /**
   * Import citation from DOI by fetching metadata
   */
  async importFromDOI(sessionId: string, doi: string): Promise<Citation> {
    // Clean and validate DOI format
    const cleanedDOI = this.cleanDOI(doi);
    if (!cleanedDOI) {
      throw new Error('Invalid DOI format. Please enter a valid DOI (e.g., 10.1038/nature12373)');
    }

    // Check if citation already exists for this session
    const existingCitation = await prisma.citation.findFirst({
      where: {
        sessionId,
        doi: cleanedDOI.toLowerCase()
      }
    });

    if (existingCitation) {
      throw new Error('Citation with this DOI already exists in the session');
    }

    // Fetch metadata from literature search service
    const searchResult = await literatureSearchService.getByIdentifier(cleanedDOI);
    if (!searchResult) {
      throw new Error('Could not find paper with this DOI. Please verify the DOI is correct.');
    }

    // Create citation from search result
    return this.importFromSearchResult(sessionId, searchResult);
  }

  /**
   * Import citations from BibTeX string
   */
  async importFromBibTeX(sessionId: string, bibtexString: string): Promise<Citation[]> {
    const parsedCitations = citationStyleService.parseBibTeX(bibtexString);

    if (parsedCitations.length === 0) {
      throw new Error('No valid citations found in BibTeX string');
    }

    const importedCitations: Citation[] = [];

    for (const parsedCitation of parsedCitations) {
      try {
        // Check for duplicates
        const existingCitation = await this.findDuplicate(sessionId, parsedCitation);
        if (existingCitation) {
          console.warn(`Skipping duplicate citation: ${parsedCitation.title}`);
          continue;
        }

        const citation = await this.createCitation({
          sessionId,
          sourceType: this.inferSourceType(parsedCitation),
          title: parsedCitation.title,
          authors: parsedCitation.authors,
          year: parsedCitation.year,
          venue: parsedCitation.venue,
          volume: parsedCitation.volume,
          issue: parsedCitation.issue,
          pages: parsedCitation.pages,
          doi: parsedCitation.doi,
          url: parsedCitation.url,
          isbn: parsedCitation.isbn,
          publisher: parsedCitation.publisher,
          edition: parsedCitation.edition,
          importSource: 'BIBTEX_IMPORT'
        });

        importedCitations.push(citation);
      } catch (error) {
        console.error(`Failed to import citation: ${parsedCitation.title}`, error);
        // Continue with other citations
      }
    }

    return importedCitations;
  }

  /**
   * Import citation from search result with optional AI-generated metadata
   */
  async importFromSearchResult(
    sessionId: string, 
    searchResult: SearchResult,
    citationMeta?: {
      keyContribution?: string;
      keyFindings?: string;
      methodologicalApproach?: string | null;
      relevanceToResearch?: string;
      limitationsOrGaps?: string | null;
      usage?: {
        introduction?: boolean;
        literatureReview?: boolean;
        methodology?: boolean;
        comparison?: boolean;
      };
      relevanceScore?: number;
    }
  ): Promise<Citation> {
    // Check for duplicates
    const existingCitation = await this.findDuplicate(sessionId, searchResult);
    if (existingCitation) {
      throw new Error('Similar citation already exists in the session');
    }

    return this.createCitation({
      sessionId,
      sourceType: this.inferSourceType(searchResult),
      title: searchResult.title,
      authors: searchResult.authors,
      year: searchResult.year,
      venue: searchResult.venue,
      doi: searchResult.doi,
      url: searchResult.url,
      notes: searchResult.abstract,
      importSource: this.mapSearchSourceToImportSource(searchResult.source),
      // Store AI-generated citation metadata for section generation
      aiMeta: citationMeta ? {
        keyContribution: citationMeta.keyContribution,
        keyFindings: citationMeta.keyFindings,
        methodologicalApproach: citationMeta.methodologicalApproach,
        relevanceToResearch: citationMeta.relevanceToResearch,
        limitationsOrGaps: citationMeta.limitationsOrGaps,
        usage: citationMeta.usage || {},
        relevanceScore: citationMeta.relevanceScore,
        analyzedAt: new Date().toISOString()
      } : undefined
    });
  }

  /**
   * Manually add a citation
   */
  async addManualCitation(sessionId: string, citationData: Omit<CreateCitationInput, 'sessionId' | 'importSource'>): Promise<Citation> {
    // Check for duplicates
    const existingCitation = await this.findDuplicate(sessionId, citationData);
    if (existingCitation) {
      throw new Error('Similar citation already exists in the session');
    }

    return this.createCitation({
      ...citationData,
      sessionId,
      importSource: 'MANUAL'
    });
  }

  /**
   * Update citation
   */
  async updateCitation(citationId: string, updates: UpdateCitationInput): Promise<Citation> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    // If DOI is being updated, check for duplicates
    if (updates.doi && updates.doi !== citation.doi) {
      const existingCitation = await prisma.citation.findFirst({
        where: {
          sessionId: citation.sessionId,
          doi: updates.doi.toLowerCase(),
          id: { not: citationId }
        }
      });

      if (existingCitation) {
        throw new Error('Citation with this DOI already exists in the session');
      }
    }

    return prisma.citation.update({
      where: { id: citationId },
      data: {
        title: updates.title,
        authors: updates.authors,
        year: updates.year,
        venue: updates.venue,
        volume: updates.volume,
        issue: updates.issue,
        pages: updates.pages,
        doi: updates.doi,
        url: updates.url,
        isbn: updates.isbn,
        publisher: updates.publisher,
        edition: updates.edition,
        notes: updates.notes,
        tags: updates.tags,
        isActive: updates.isActive
      }
    });
  }

  /**
   * Delete citation (with usage check)
   */
  async deleteCitation(citationId: string): Promise<{ deleted: boolean; warning?: string }> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId },
      include: { usages: true }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    if (citation.usages.length > 0) {
      return {
        deleted: false,
        warning: `Citation is used in ${citation.usages.length} section(s). Deletion will remove all references.`
      };
    }

    await prisma.citation.delete({
      where: { id: citationId }
    });

    return { deleted: true };
  }

  /**
   * Force delete citation (ignores usage warnings)
   */
  async forceDeleteCitation(citationId: string): Promise<void> {
    await prisma.citation.delete({
      where: { id: citationId }
    });
  }

  /**
   * Get all citations for a session
   */
  async getCitationsForSession(sessionId: string): Promise<CitationWithUsage[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      include: {
        usages: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations.map(citation => ({
      ...citation,
      usageCount: citation.usages.length
    }));
  }

  /**
   * Get citations used in a specific section
   */
  async getCitationsBySection(sessionId: string, sectionKey: string): Promise<Citation[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
        usages: {
          some: {
            sectionKey
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations;
  }

  /**
   * Mark citation as used in a section
   */
  async markCitationUsed(
    citationId: string,
    sectionKey: string,
    contextSnippet?: string,
    position?: number
  ): Promise<CitationUsage> {
    const citation = await prisma.citation.findUnique({
      where: { id: citationId }
    });

    if (!citation) {
      throw new Error('Citation not found');
    }

    // Check if usage already exists
    const existingUsage = await prisma.citationUsage.findFirst({
      where: {
        citationId,
        sectionKey,
        position
      }
    });

    if (existingUsage) {
      // Update existing usage
      return prisma.citationUsage.update({
        where: { id: existingUsage.id },
        data: {
          contextSnippet,
          updatedAt: new Date()
        }
      });
    }

    // Create new usage
    return prisma.citationUsage.create({
      data: {
        citationId,
        sectionKey,
        contextSnippet,
        position,
        inTextFormat: await this.generateInTextFormat(citation)
      }
    });
  }

  /**
   * Find unused citations in a session
   */
  async findUnusedCitations(sessionId: string): Promise<CitationWithUsage[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
        usages: {
          none: {}
        }
      },
      include: {
        usages: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return citations.map(citation => ({
      ...citation,
      usageCount: citation.usages.length
    }));
  }

  /**
   * Find duplicate citations in a session
   */
  async findDuplicateCitations(sessionId: string): Promise<Array<{
    citations: Citation[];
    reason: string;
  }>> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const duplicates: Array<{
      citations: Citation[];
      reason: string;
    }> = [];

    // Group by DOI
    const byDOI = new Map<string, Citation[]>();
    for (const citation of citations) {
      if (citation.doi) {
        const doi = citation.doi.toLowerCase();
        if (!byDOI.has(doi)) {
          byDOI.set(doi, []);
        }
        byDOI.get(doi)!.push(citation);
      }
    }

    // Find DOI duplicates
    for (const [doi, citationGroup] of Array.from(byDOI.entries())) {
      if (citationGroup.length > 1) {
        duplicates.push({
          citations: citationGroup,
          reason: `Duplicate DOI: ${doi}`
        });
      }
    }

    // Group by title + first author + year (fuzzy matching)
    const byTitleAuthor = new Map<string, Citation[]>();
    for (const citation of citations) {
      if (!citation.doi) { // Skip those with DOI as they're handled above
        const key = `${citation.title.toLowerCase().substring(0, 50)}|${citation.authors[0] || ''}|${citation.year || ''}`;
        if (!byTitleAuthor.has(key)) {
          byTitleAuthor.set(key, []);
        }
        byTitleAuthor.get(key)!.push(citation);
      }
    }

    // Find title/author duplicates
    for (const [key, citationGroup] of Array.from(byTitleAuthor.entries())) {
      if (citationGroup.length > 1) {
        duplicates.push({
          citations: citationGroup,
          reason: `Similar title and author: ${citationGroup[0].title.substring(0, 50)}...`
        });
      }
    }

    return duplicates;
  }

  /**
   * Run quality checks on citations
   */
  async runQualityChecks(sessionId: string): Promise<QualityCheckResult> {
    const [
      unusedCitations,
      duplicateCitations,
      allCitations
    ] = await Promise.all([
      this.findUnusedCitations(sessionId),
      this.findDuplicateCitations(sessionId),
      this.getCitationsForSession(sessionId)
    ]);

    // Find incomplete citations
    const incompleteCitations = allCitations.filter(citation =>
      !citation.title ||
      citation.authors.length === 0 ||
      !citation.year ||
      !citation.venue
    );

    // Generate suggestions
    const suggestions: string[] = [];

    if (unusedCitations.length > 0) {
      suggestions.push(`Consider removing ${unusedCitations.length} unused citation(s) or cite them in your paper`);
    }

    if (duplicateCitations.length > 0) {
      suggestions.push(`Review ${duplicateCitations.length} potential duplicate citation(s)`);
    }

    if (incompleteCitations.length > 0) {
      suggestions.push(`Complete metadata for ${incompleteCitations.length} citation(s) with missing information`);
    }

    // Check citation diversity
    const sourceTypes = new Set(allCitations.map(c => c.sourceType));
    if (sourceTypes.size < 3 && allCitations.length > 10) {
      suggestions.push('Consider diversifying your citation sources (journals, conferences, books)');
    }

    return {
      unusedCitations,
      duplicateCitations,
      incompleteCitations,
      suggestions
    };
  }

  /**
   * Get citation statistics for a session
   */
  async getCitationStats(sessionId: string): Promise<{
    total: number;
    bySourceType: Record<string, number>;
    byImportSource: Record<string, number>;
    unused: number;
    duplicates: number;
    averageAge: number;
  }> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      include: {
        usages: true
      }
    });

    const bySourceType: Record<string, number> = {};
    const byImportSource: Record<string, number> = {};
    let totalAge = 0;
    let ageCount = 0;

    for (const citation of citations) {
      // Count by source type
      bySourceType[citation.sourceType] = (bySourceType[citation.sourceType] || 0) + 1;

      // Count by import source
      byImportSource[citation.importSource] = (byImportSource[citation.importSource] || 0) + 1;

      // Calculate age
      if (citation.year) {
        totalAge += new Date().getFullYear() - citation.year;
        ageCount++;
      }
    }

    const unused = citations.filter(c => c.usages.length === 0).length;
    const duplicates = (await this.findDuplicateCitations(sessionId)).length;

    return {
      total: citations.length,
      bySourceType,
      byImportSource,
      unused,
      duplicates,
      averageAge: ageCount > 0 ? Math.round(totalAge / ageCount) : 0
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async createCitation(input: CreateCitationInput): Promise<Citation> {
    // Generate citation key
    const existingCitations = await this.getCitationsForSession(input.sessionId);
    const existingKeys = existingCitations.map(c => c.citationKey);

    const citationData: CitationData = {
      id: `citation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: input.title,
      authors: input.authors,
      year: input.year,
      venue: input.venue,
      volume: input.volume,
      issue: input.issue,
      pages: input.pages,
      doi: input.doi,
      url: input.url,
      isbn: input.isbn,
      publisher: input.publisher,
      edition: input.edition,
      citationKey: ''
    };

    citationData.citationKey = citationStyleService.generateCitationKey(citationData, existingKeys);

    return prisma.citation.create({
      data: {
        id: citationData.id,
        sessionId: input.sessionId,
        sourceType: input.sourceType,
        title: input.title,
        authors: input.authors,
        year: input.year,
        venue: input.venue,
        volume: input.volume,
        issue: input.issue,
        pages: input.pages,
        doi: input.doi,
        url: input.url,
        isbn: input.isbn,
        publisher: input.publisher,
        edition: input.edition,
        citationKey: citationData.citationKey,
        importSource: input.importSource,
        notes: input.notes,
        tags: input.tags || [],
        aiMeta: input.aiMeta || undefined as any
      }
    });
  }

  private async findDuplicate(sessionId: string, citationData: Partial<CreateCitationInput | SearchResult>): Promise<Citation | null> {
    // Check DOI first
    if (citationData.doi) {
      const existing = await prisma.citation.findFirst({
        where: {
          sessionId,
          doi: citationData.doi.toLowerCase()
        }
      });
      if (existing) return existing;
    }

    // Check title + first author + year
    if (citationData.title && citationData.authors && citationData.authors.length > 0 && citationData.year) {
      const existing = await prisma.citation.findFirst({
        where: {
          sessionId,
          title: {
            equals: citationData.title,
            mode: 'insensitive'
          },
          authors: {
            has: citationData.authors[0]
          },
          year: citationData.year
        }
      });
      if (existing) return existing;
    }

    return null;
  }

  private isValidDOI(doi: string): boolean {
    // Basic DOI validation
    return /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i.test(doi);
  }

  /**
   * Clean DOI - remove URL prefixes and normalize
   */
  private cleanDOI(doi: string): string | null {
    if (!doi || typeof doi !== 'string') return null;

    // Remove common prefixes
    let cleaned = doi.trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();

    // Validate the cleaned DOI
    if (this.isValidDOI(cleaned)) {
      return cleaned;
    }

    return null;
  }

  private inferSourceType(citationData: Partial<CreateCitationInput | SearchResult>): CitationSourceType {
    if (citationData.venue) {
      const venue = citationData.venue.toLowerCase();
      if (venue.includes('conference') || venue.includes('proceedings') || venue.includes('symposium')) {
        return 'CONFERENCE_PAPER';
      }
      if (venue.includes('journal') || venue.includes('transactions') || venue.includes('letters')) {
        return 'JOURNAL_ARTICLE';
      }
      if (venue.includes('book') || venue.includes('press')) {
        return 'BOOK';
      }
    }

    if (citationData.doi) {
      return 'JOURNAL_ARTICLE'; // Most DOIs are for journal articles
    }

    return 'OTHER';
  }

  private mapSearchSourceToImportSource(source: string): CitationImportSource {
    switch (source) {
      case 'google_scholar': return 'SCHOLAR_SEARCH';
      case 'semantic_scholar': return 'SEMANTIC_SCHOLAR';
      case 'crossref': return 'CROSSREF_API';
      case 'openalex': return 'OPENALEX';
      default: return 'MANUAL';
    }
  }

  private async generateInTextFormat(citation: Citation): Promise<string> {
    // This would be replaced with actual citation style formatting
    // For now, generate a simple format
    const authors = citation.authors.slice(0, 2).join(' & ');
    const year = citation.year || 'n.d.';
    return `(${authors}, ${year})`;
  }
}

// Export singleton instance
export const citationService = new CitationService();

// Export class for testing
export { CitationService };
