/**
 * Literature Search Service
 * Unified service for searching academic databases and literature
 */

import crypto from 'crypto';

// Search result interface
export interface SearchResult {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  url?: string;
  citationCount?: number;
  source: string; // Which provider returned this result
  rawData?: any; // Original API response for debugging
}

// Search options
export interface SearchOptions {
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  sources?: string[]; // Which providers to search
  includeAbstract?: boolean;
}

// Provider interface
export interface SearchProvider {
  name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getByIdentifier(identifier: string): Promise<SearchResult | null>;
  getRateLimit(): { requests: number; period: number }; // requests per period (in seconds)
}

// Cache entry
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
  query: string;
  options: SearchOptions;
}

class LiteratureSearchService {
  private providers: Map<string, SearchProvider> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();

  constructor() {
    this.initializeProviders();
  }

  /**
   * Unified search across multiple academic databases
   */
  async search(query: string, options: SearchOptions = {}): Promise<{
    results: SearchResult[];
    totalFound: number;
    sources: string[];
  }> {
    const sources = options.sources || ['google_scholar', 'semantic_scholar', 'crossref'];
    const limit = options.limit || 20;

    // Check cache first
    const cacheKey = this.generateCacheKey(query, options);
    const cached = this.getCachedResults(cacheKey);
    if (cached) {
      return {
        results: cached.results.slice(0, limit),
        totalFound: cached.results.length,
        sources: [cached.results[0]?.source || 'cache']
      };
    }

    // Perform searches in parallel with rate limiting
    const searchPromises = sources
      .filter(source => this.providers.has(source))
      .map(async (source) => {
        try {
          await this.checkRateLimit(source);
          const provider = this.providers.get(source)!;
          const results = await provider.search(query, options);
          this.recordRequest(source);
          return results;
        } catch (error) {
          console.warn(`Search failed for ${source}:`, error);
          return [];
        }
      });

    const allResults = await Promise.all(searchPromises);
    const flattenedResults = allResults.flat();

    // Deduplicate by DOI
    const deduplicatedResults = this.deduplicateResults(flattenedResults);

    // Sort by relevance (citation count, then year)
    const sortedResults = deduplicatedResults.sort((a, b) => {
      const aScore = (a.citationCount || 0) + (a.year ? (new Date().getFullYear() - a.year) * 0.1 : 0);
      const bScore = (b.citationCount || 0) + (b.year ? (new Date().getFullYear() - b.year) * 0.1 : 0);
      return bScore - aScore;
    });

    // Cache results
    this.cacheResults(cacheKey, sortedResults, query, options);

    const finalResults = sortedResults.slice(0, limit);

    return {
      results: finalResults,
      totalFound: sortedResults.length,
      sources: sources.filter(source => this.providers.has(source))
    };
  }

  /**
   * Get paper by DOI, arXiv ID, or other identifier
   */
  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Try each provider in order of reliability
    const providers = ['crossref', 'semantic_scholar', 'google_scholar'];

    for (const providerName of providers) {
      if (!this.providers.has(providerName)) continue;

      try {
        await this.checkRateLimit(providerName);
        const provider = this.providers.get(providerName)!;
        const result = await provider.getByIdentifier(identifier);
        if (result) {
          this.recordRequest(providerName);
          return result;
        }
      } catch (error) {
        console.warn(`Identifier lookup failed for ${providerName}:`, error);
      }
    }

    return null;
  }

  /**
   * Get available search providers
   */
  getAvailableProviders(): Array<{ name: string; description: string; rateLimit: { requests: number; period: number } }> {
    return Array.from(this.providers.entries()).map(([key, provider]) => ({
      name: key,
      description: this.getProviderDescription(key),
      rateLimit: provider.getRateLimit()
    }));
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; oldestEntry: number; newestEntry: number } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntry: 0, newestEntry: 0 };
    }

    const timestamps = Array.from(this.cache.values()).map(entry => entry.timestamp);
    return {
      size: this.cache.size,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps)
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private initializeProviders(): void {
    // Initialize search providers
    this.providers.set('google_scholar', new GoogleScholarProvider());
    this.providers.set('semantic_scholar', new SemanticScholarProvider());
    this.providers.set('crossref', new CrossRefProvider());
    this.providers.set('openalex', new OpenAlexProvider());
  }

  private generateCacheKey(query: string, options: SearchOptions): string {
    const normalizedOptions = {
      ...options,
      sources: options.sources?.sort() || []
    };
    const hash = crypto.createHash('md5')
      .update(JSON.stringify({ query, options: normalizedOptions }))
      .digest('hex');
    return hash;
  }

  private getCachedResults(cacheKey: string): CacheEntry | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry;
  }

  private cacheResults(cacheKey: string, results: SearchResult[], query: string, options: SearchOptions): void {
    // Limit cache size to prevent memory issues
    if (this.cache.size >= 1000) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, 100);
      toRemove.forEach(([key]) => this.cache.delete(key));
    }

    this.cache.set(cacheKey, {
      results,
      timestamp: Date.now(),
      query,
      options
    });
  }

  private async checkRateLimit(providerName: string): Promise<void> {
    const provider = this.providers.get(providerName);
    if (!provider) return;

    const rateLimit = provider.getRateLimit();
    const now = Date.now();
    const key = `ratelimit_${providerName}`;

    let countData = this.requestCounts.get(key);
    if (!countData || now > countData.resetTime) {
      countData = { count: 0, resetTime: now + (rateLimit.period * 1000) };
    }

    if (countData.count >= rateLimit.requests) {
      const waitTime = countData.resetTime - now;
      throw new Error(`Rate limit exceeded for ${providerName}. Wait ${Math.ceil(waitTime / 1000)} seconds.`);
    }

    countData.count++;
    this.requestCounts.set(key, countData);
  }

  private recordRequest(providerName: string): void {
    // Additional logging/metrics could go here
    console.log(`Search request completed for ${providerName}`);
  }

  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seenDOIs = new Set<string>();
    const deduplicated: SearchResult[] = [];

    for (const result of results) {
      const doi = result.doi?.toLowerCase();
      if (doi && seenDOIs.has(doi)) {
        continue; // Skip duplicate DOI
      }

      if (doi) {
        seenDOIs.add(doi);
      }

      deduplicated.push(result);
    }

    return deduplicated;
  }

  private getProviderDescription(providerName: string): string {
    const descriptions: Record<string, string> = {
      google_scholar: 'Google Scholar - Broad academic search with citation counts',
      semantic_scholar: 'Semantic Scholar - Rich metadata and citation networks',
      crossref: 'CrossRef - Authoritative DOI lookups and metadata',
      openalex: 'OpenAlex - Comprehensive academic graph data'
    };
    return descriptions[providerName] || providerName;
  }
}

// ============================================================================
// SEARCH PROVIDER IMPLEMENTATIONS
// ============================================================================

class GoogleScholarProvider implements SearchProvider {
  name = 'google_scholar';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Use Serp_API_KEY (user's env variable name)
    const apiKey = process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY;
    if (!apiKey) {
      console.warn('SerpAPI key not configured (set Serp_API_KEY or SERPAPI_API_KEY), returning empty results');
      return [];
    }

    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google_scholar',
        q: query,
        num: (options.limit || 20).toString(),
      });

      // Add year filters if provided
      if (options.yearFrom) {
        params.set('as_ylo', options.yearFrom.toString());
      }
      if (options.yearTo) {
        params.set('as_yhi', options.yearTo.toString());
      }

      const response = await this.fetchWithTimeout(`https://serpapi.com/search.json?${params}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`SerpAPI error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`SerpAPI error: ${data.error}`);
      }

      const organicResults = data.organic_results || [];

      return organicResults.map((result: any, index: number) => ({
        id: `gs_${result.result_id || index}`,
        title: result.title || '',
        authors: this.parseAuthors(result.publication_info?.authors || result.publication_info?.summary),
        year: this.extractYear(result.publication_info?.summary),
        venue: this.extractVenue(result.publication_info?.summary),
        abstract: result.snippet || '',
        doi: this.extractDOI(result.link),
        url: result.link,
        citationCount: result.inline_links?.cited_by?.total || 0,
        source: 'google_scholar',
        rawData: result
      }));
    } catch (error) {
      console.error('Google Scholar search failed:', error);
      return [];
    }
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Search by DOI or title
    const apiKey = process.env.Serp_API_KEY || process.env.SERPAPI_API_KEY;
    if (!apiKey) return null;

    try {
      const results = await this.search(identifier, { limit: 1 });
      return results[0] || null;
    } catch (error) {
      console.error('Google Scholar identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    return { requests: 100, period: 86400 }; // 100 requests per day (SerpAPI limit)
  }

  private parseAuthors(authorsData: any): string[] {
    if (!authorsData) return [];
    
    // If it's an array of author objects
    if (Array.isArray(authorsData)) {
      return authorsData.map((a: any) => a.name || a.author || String(a)).filter(Boolean);
    }
    
    // If it's a string (from summary), try to extract authors
    if (typeof authorsData === 'string') {
      // Pattern: "Author1, Author2 - Journal, Year"
      const parts = authorsData.split(' - ');
      if (parts.length > 0) {
        return parts[0].split(',').map(s => s.trim()).filter(s => s && !s.match(/^\d{4}$/));
      }
    }
    
    return [];
  }

  private extractYear(summary: string | undefined): number | undefined {
    if (!summary) return undefined;
    const yearMatch = summary.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? parseInt(yearMatch[0], 10) : undefined;
  }

  private extractVenue(summary: string | undefined): string | undefined {
    if (!summary) return undefined;
    // Pattern: "Authors - Venue, Year" or "Authors - Venue"
    const parts = summary.split(' - ');
    if (parts.length >= 2) {
      // Remove year from venue if present
      return parts[1].replace(/,?\s*\d{4}\s*$/, '').trim() || undefined;
    }
    return undefined;
  }

  private extractDOI(url: string | undefined): string | undefined {
    if (!url) return undefined;
    // Try to extract DOI from URL if present
    const doiMatch = url.match(/10\.\d{4,}\/[^\s]+/);
    return doiMatch ? doiMatch[0] : undefined;
  }
}

class SemanticScholarProvider implements SearchProvider {
  name = 'semantic_scholar';
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 second between requests
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Add delay between requests to avoid rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const params = new URLSearchParams({
          query: query,
          limit: (options.limit || 20).toString(),
          fields: 'title,authors,year,venue,abstract,citationCount,doi,url'
        });

        if (options.yearFrom) params.set('yearFrom', options.yearFrom.toString());
        if (options.yearTo) params.set('yearTo', options.yearTo.toString());

        this.lastRequestTime = Date.now();
        const response = await this.fetchWithTimeout(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
          headers: {
            'User-Agent': 'Research-Paper-Writing-App/1.0'
          }
        });

        if (response.status === 429) {
          // Rate limited - apply exponential backoff
          const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
          const backoffMs = retryAfter > 0 
            ? retryAfter * 1000 
            : Math.min(1000 * Math.pow(2, attempt + 1), 30000); // Max 30 seconds
          console.warn(`Semantic Scholar rate limited (429). Waiting ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (!response.ok) {
          throw new Error(`Semantic Scholar API error: ${response.status}`);
        }

        const data = await response.json();

        return (data.data || []).map((paper: any) => ({
          id: `ss_${paper.paperId}`,
          title: paper.title || '',
          authors: (paper.authors || []).map((author: any) => author.name || ''),
          year: paper.year,
          venue: paper.venue,
          abstract: paper.abstract,
          doi: paper.doi,
          url: paper.url,
          citationCount: paper.citationCount,
          source: 'semantic_scholar',
          rawData: paper
        }));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar search attempt ${attempt + 1} failed, retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error('Semantic Scholar search failed after retries:', lastError);
    return [];
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    // Add delay between requests to avoid rate limiting
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.lastRequestTime = Date.now();
        // Try DOI first
        const response = await this.fetchWithTimeout(`https://api.semanticscholar.org/graph/v1/paper/DOI:${identifier}`, {
          headers: {
            'User-Agent': 'Research-Paper-Writing-App/1.0'
          }
        });

        if (response.status === 429) {
          // Rate limited - apply exponential backoff
          const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
          const backoffMs = retryAfter > 0 
            ? retryAfter * 1000 
            : Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar rate limited (429). Waiting ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (response.ok) {
          const paper = await response.json();
          return {
            id: `ss_${paper.paperId}`,
            title: paper.title || '',
            authors: (paper.authors || []).map((author: any) => author.name || ''),
            year: paper.year,
            venue: paper.venue,
            abstract: paper.abstract,
            doi: paper.doi,
            url: paper.url,
            citationCount: paper.citationCount,
            source: 'semantic_scholar',
            rawData: paper
          };
        }

        // Non-429 error, don't retry
        return null;
      } catch (error) {
        // Check if it's a timeout/abort error
        const isTimeout = error instanceof Error && (
          error.name === 'AbortError' || 
          error.message.includes('timeout') ||
          error.message.includes('CONNECT_TIMEOUT')
        );
        
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt + 1), 30000);
          console.warn(`Semantic Scholar identifier lookup attempt ${attempt + 1} failed${isTimeout ? ' (timeout)' : ''}, retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error('Semantic Scholar identifier lookup failed:', error);
        }
      }
    }
    return null;
  }

  getRateLimit() {
    return { requests: 100, period: 300 }; // 100 requests per 5 minutes (unauthenticated)
  }
}

class CrossRefProvider implements SearchProvider {
  name = 'crossref';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sanitize query for CrossRef API
   * CrossRef can return 400 for queries with special characters or malformed syntax
   */
  private sanitizeQuery(query: string): string {
    // Remove or replace problematic characters
    let sanitized = query
      .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ') // Remove special query syntax characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // CrossRef requires at least some searchable content
    if (sanitized.length < 2) {
      return query.replace(/[^\w\s]/g, ' ').trim();
    }

    return sanitized;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const email = process.env.CROSSREF_EMAIL;
        const userAgent = email ? `Research-Paper-Writing-App/1.0 (${email})` : 'Research-Paper-Writing-App/1.0';

        // Sanitize query to avoid 400 errors
        const sanitizedQuery = this.sanitizeQuery(query);
        if (!sanitizedQuery) {
          console.warn('CrossRef: Query empty after sanitization, skipping search');
          return [];
        }

        const params = new URLSearchParams({
          query: sanitizedQuery,
          rows: (options.limit || 20).toString(),
          'sort': 'relevance'
        });

        if (options.yearFrom) params.set('from-pub-date', `${options.yearFrom}-01-01`);
        if (options.yearTo) params.set('until-pub-date', `${options.yearTo}-12-31`);

        const response = await this.fetchWithTimeout(`https://api.crossref.org/works?${params}`, {
          headers: {
            'User-Agent': userAgent
          }
        });

        if (!response.ok) {
          // Log more details for debugging 400 errors
          if (response.status === 400) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`CrossRef API 400 error. Query: "${sanitizedQuery}", Response: ${errorText}`);
          }
          throw new Error(`CrossRef API error: ${response.status}`);
        }

        const data = await response.json();

        return (data.message?.items || []).map((work: any) => ({
          id: `cr_${work.DOI || work.URL || crypto.randomUUID()}`,
          title: work.title?.[0] || '',
          authors: (work.author || []).map((author: any) => `${author.family || ''}, ${author.given || ''}`.trim()),
          year: work.issued?.['date-parts']?.[0]?.[0],
          venue: work['container-title']?.[0] || work.publisher,
          abstract: work.abstract,
          doi: work.DOI,
          url: work.URL,
          citationCount: work['is-referenced-by-count'],
          source: 'crossref',
          rawData: work
        }));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a timeout/abort error
        const isTimeout = lastError.name === 'AbortError' || 
          lastError.message.includes('timeout') ||
          lastError.message.includes('CONNECT_TIMEOUT') ||
          lastError.message.includes('fetch failed');
        
        if (attempt < maxRetries - 1 && isTimeout) {
          const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.warn(`CrossRef search attempt ${attempt + 1} failed (timeout), retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error('CrossRef search failed:', lastError);
    return [];
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    const maxRetries = 2;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const email = process.env.CROSSREF_EMAIL;
        const userAgent = email ? `Research-Paper-Writing-App/1.0 (${email})` : 'Research-Paper-Writing-App/1.0';

        const response = await this.fetchWithTimeout(`https://api.crossref.org/works/${identifier}`, {
          headers: {
            'User-Agent': userAgent
          }
        });

        if (!response.ok) {
          return null;
        }

        const data = await response.json();
        const work = data.message;

        return {
          id: `cr_${work.DOI || work.URL || crypto.randomUUID()}`,
          title: work.title?.[0] || '',
          authors: (work.author || []).map((author: any) => `${author.family || ''}, ${author.given || ''}`.trim()),
          year: work.issued?.['date-parts']?.[0]?.[0],
          venue: work['container-title']?.[0] || work.publisher,
          abstract: work.abstract,
          doi: work.DOI,
          url: work.URL,
          citationCount: work['is-referenced-by-count'],
          source: 'crossref',
          rawData: work
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isTimeout = err.name === 'AbortError' || 
          err.message.includes('timeout') ||
          err.message.includes('CONNECT_TIMEOUT') ||
          err.message.includes('fetch failed');
        
        if (attempt < maxRetries - 1 && isTimeout) {
          const backoffMs = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.warn(`CrossRef identifier lookup attempt ${attempt + 1} failed (timeout), retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          console.error('CrossRef identifier lookup failed:', error);
          return null;
        }
      }
    }
    return null;
  }

  getRateLimit() {
    return { requests: 50, period: 1 }; // 50 requests per second (polite pool)
  }
}

class OpenAlexProvider implements SearchProvider {
  name = 'openalex';
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 second timeout

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        search: query,
        per_page: (options.limit || 20).toString(),
        'sort': 'relevance_score:desc'
      });

      if (options.yearFrom) params.set('from_publication_year', options.yearFrom.toString());
      if (options.yearTo) params.set('to_publication_year', options.yearTo.toString());

      const response = await this.fetchWithTimeout(`https://api.openalex.org/works?${params}`, {
        headers: {
          'User-Agent': 'Research-Paper-Writing-App/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json();

      return (data.results || []).map((work: any) => ({
        id: `oa_${work.id?.replace('https://openalex.org/', '') || crypto.randomUUID()}`,
        title: work.title || '',
        authors: (work.authorships || []).map((auth: any) => auth.author?.display_name || ''),
        year: work.publication_year,
        venue: work.primary_location?.source?.display_name || work.host_venue_name,
        abstract: work.abstract_inverted_index ? this.reconstructAbstract(work.abstract_inverted_index) : undefined,
        doi: work.doi?.replace('https://doi.org/', ''),
        url: work.primary_location?.landing_page_url || work.doi,
        citationCount: work.cited_by_count,
        source: 'openalex',
        rawData: work
      }));
    } catch (error) {
      console.error('OpenAlex search failed:', error);
      return [];
    }
  }

  async getByIdentifier(identifier: string): Promise<SearchResult | null> {
    try {
      // Try DOI lookup
      const doiParam = identifier.startsWith('10.') ? identifier : `https://doi.org/${identifier}`;
      const response = await this.fetchWithTimeout(`https://api.openalex.org/works/doi:${doiParam}`, {
        headers: {
          'User-Agent': 'Research-Paper-Writing-App/1.0'
        }
      });

      if (!response.ok) {
        return null;
      }

      const work = await response.json();

      return {
        id: `oa_${work.id?.replace('https://openalex.org/', '') || crypto.randomUUID()}`,
        title: work.title || '',
        authors: (work.authorships || []).map((auth: any) => auth.author?.display_name || ''),
        year: work.publication_year,
        venue: work.primary_location?.source?.display_name || work.host_venue_name,
        abstract: work.abstract_inverted_index ? this.reconstructAbstract(work.abstract_inverted_index) : undefined,
        doi: work.doi?.replace('https://doi.org/', ''),
        url: work.primary_location?.landing_page_url || work.doi,
        citationCount: work.cited_by_count,
        source: 'openalex',
        rawData: work
      };
    } catch (error) {
      console.error('OpenAlex identifier lookup failed:', error);
      return null;
    }
  }

  getRateLimit() {
    return { requests: 100000, period: 1 }; // Unlimited (be reasonable)
  }

  private reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    const words: string[] = [];
    const positions = Object.entries(invertedIndex);

    positions.sort((a, b) => a[1][0] - b[1][0]);

    for (const [word, pos] of positions) {
      for (const position of pos) {
        if (words[position] === undefined) {
          words[position] = word;
        }
      }
    }

    return words.join(' ');
  }
}

// Export singleton instance
export const literatureSearchService = new LiteratureSearchService();

// Export class for testing
export { LiteratureSearchService };
