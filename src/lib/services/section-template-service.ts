/**
 * Section Template Service
 * Manages section templates for different paper types with venue overrides
 * 
 * Now loads prompts from database (PaperSupersetSection, PaperTypeSectionPrompt)
 * instead of static code files for admin configurability.
 */

import { prisma } from '../prisma';
import { paperTypeService } from './paper-type-service';
import { paperSectionTemplates } from '../prompts/paper-section-prompts';
import type { PaperTypeDefinition, PaperSupersetSection, PaperTypeSectionPrompt } from '@prisma/client';

export interface SectionTemplate {
  sectionKey: string;
  displayName: string;
  description?: string;
  defaultPrompt: string;
  promptsByPaperType?: Record<string, string>;
  constraints: SectionConstraints;
  applicablePaperTypes: string[]; // PaperTypeDefinition codes
  orderWeight: number;
  isRequired: boolean;
}

export interface SectionConstraints {
  wordLimit?: number;
  citationRequirements?: {
    minimum?: number;
    recommended?: number;
    types?: string[]; // e.g., ['empirical', 'theoretical']
  };
  tenseRequirements?: string[]; // e.g., ['past', 'present']
  styleRequirements?: string[]; // e.g., ['formal', 'objective']
}

export interface VenueSectionOverride {
  venueId: string;
  sectionKey: string;
  customPrompt?: string;
  wordLimitOverride?: number;
  citationRequirements?: SectionConstraints['citationRequirements'];
  additionalConstraints?: Partial<SectionConstraints>;
}

export interface SectionPromptContext {
  researchTopic?: any;
  citationCount?: number;
  availableCitations?: any[];
  previousSections?: Record<string, string>;
  wordCount?: number;
  targetWordCount?: number;
}

class SectionTemplateService {
  private templateCache: Map<string, SectionTemplate[]> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get all section templates for a specific paper type
   */
  async getSectionsForPaperType(paperTypeCode: string): Promise<SectionTemplate[]> {
    const cacheKey = `paperType_${paperTypeCode}`;
    const now = Date.now();

    // Check cache
    if (this.templateCache.has(cacheKey)) {
      const cached = this.templateCache.get(cacheKey)!;
      if ((now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
        return cached;
      }
    }

    // Get paper type to understand its sections
    const paperType = await paperTypeService.getPaperType(paperTypeCode);
    if (!paperType) {
      throw new Error(`Paper type not found: ${paperTypeCode}`);
    }

    // Get all section templates that apply to this paper type
    const templates = await this.getAllSectionTemplates();
    const applicableTemplates = templates.filter(template =>
      template.applicablePaperTypes.includes(paperTypeCode) ||
      template.applicablePaperTypes.includes('*') // Wildcard for all types
    );

    // Order by the paper type's section order, then by template order weight
    const orderedTemplates = this.orderTemplatesByPaperType(applicableTemplates, paperType);

    // Cache and return
    this.templateCache.set(cacheKey, orderedTemplates);
    this.cacheTimestamp = now;

    return orderedTemplates;
  }

  /**
   * Get a specific section template for a paper type
   */
  async getSectionTemplate(sectionKey: string, paperTypeCode: string): Promise<SectionTemplate | null> {
    const allTemplates = await this.getSectionsForPaperType(paperTypeCode);
    return allTemplates.find(template => template.sectionKey === sectionKey) || null;
  }

  /**
   * Build a complete prompt for a section including context
   */
  async getPromptForSection(
    sectionKey: string,
    paperTypeCode: string,
    context: SectionPromptContext = {}
  ): Promise<string> {
    const template = await this.getSectionTemplate(sectionKey, paperTypeCode);
    if (!template) {
      throw new Error(`Section template not found: ${sectionKey} for paper type ${paperTypeCode}`);
    }

    // resolvePromptForPaperType is now async to support DB loading
    let prompt = await this.resolvePromptForPaperType(template, paperTypeCode);

    // Replace context variables
    prompt = this.injectContextVariables(prompt, context);

    // Add constraints information
    const constraintsBlock = this.buildConstraintsBlock(template.constraints, context);
    if (constraintsBlock) {
      prompt += `\n\n${constraintsBlock}`;
    }

    // Add section-specific guidance
    const guidanceBlock = this.buildGuidanceBlock(sectionKey, context);
    if (guidanceBlock) {
      prompt += `\n\n${guidanceBlock}`;
    }

    return prompt;
  }

  /**
   * Get paper type override for a section (for debugging)
   * Returns just the override instruction, not combined with base
   */
  async getPaperTypeOverride(
    sectionKey: string,
    paperTypeCode: string
  ): Promise<string | null> {
    const useDb = await this.loadFromDatabase();
    const normalized = paperTypeCode.toUpperCase();

    if (useDb) {
      const overrideKey = `${normalized}:${sectionKey}`;
      const dbOverride = this.dbTypeOverrides.get(overrideKey);
      if (dbOverride) {
        return dbOverride.instruction;
      }
    } else {
      // Fall back to static templates
      const template = this.sectionTemplates.find(t => t.sectionKey === sectionKey);
      if (template?.promptsByPaperType) {
        if (template.promptsByPaperType[normalized]) {
          return template.promptsByPaperType[normalized];
        }
      }
    }

    return null;
  }

  /**
   * Create or update a section template
   */
  async upsertSectionTemplate(template: SectionTemplate): Promise<SectionTemplate> {
    // Validate template
    this.validateSectionTemplate(template);

    // Store in database (for now, we'll use a simple in-memory approach)
    // In a full implementation, this would be stored in a SectionTemplate table
    const existingIndex = this.sectionTemplates.findIndex(t => t.sectionKey === template.sectionKey);

    if (existingIndex >= 0) {
      this.sectionTemplates[existingIndex] = template;
    } else {
      this.sectionTemplates.push(template);
    }

    // Clear cache
    this.invalidateCache();

    return template;
  }

  /**
   * Get venue-specific overrides for a section
   */
  async getVenueOverrides(venueId: string, sectionKey: string): Promise<VenueSectionOverride | null> {
    // In a full implementation, this would query a VenueSectionOverride table
    // For now, return null (no overrides)
    return null;
  }

  /**
   * Apply venue overrides to a section template
   */
  applyVenueOverrides(template: SectionTemplate, overrides: VenueSectionOverride): SectionTemplate {
    const overridden = { ...template };

    if (overrides.customPrompt) {
      overridden.defaultPrompt = overrides.customPrompt;
    }

    if (overrides.wordLimitOverride) {
      overridden.constraints = {
        ...overridden.constraints,
        wordLimit: overrides.wordLimitOverride
      };
    }

    if (overrides.citationRequirements) {
      overridden.constraints = {
        ...overridden.constraints,
        citationRequirements: {
          ...overridden.constraints.citationRequirements,
          ...overrides.citationRequirements
        }
      };
    }

    if (overrides.additionalConstraints) {
      overridden.constraints = {
        ...overridden.constraints,
        ...overrides.additionalConstraints
      };
    }

    return overridden;
  }

  /**
   * Get section validation rules for a paper type
   */
  async getSectionValidationRules(paperTypeCode: string): Promise<Record<string, SectionConstraints>> {
    const templates = await this.getSectionsForPaperType(paperTypeCode);
    const rules: Record<string, SectionConstraints> = {};

    templates.forEach(template => {
      rules[template.sectionKey] = template.constraints;
    });

    return rules;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  // Fallback to static templates if DB is not seeded
  private sectionTemplates: SectionTemplate[] = paperSectionTemplates;
  
  // DB-loaded templates cache
  private dbSupersetSections: Map<string, PaperSupersetSection> = new Map();
  private dbTypeOverrides: Map<string, PaperTypeSectionPrompt> = new Map();
  private dbCacheTimestamp: number = 0;
  private readonly DB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  
  // Lock to prevent race condition during cache refresh
  private dbLoadingPromise: Promise<boolean> | null = null;

  /**
   * Load prompts from database
   * Uses PaperSupersetSection (base) + PaperTypeSectionPrompt (overrides)
   * 
   * Race condition prevention: Uses a loading promise to ensure only one
   * database query runs at a time, even with concurrent requests.
   */
  private async loadFromDatabase(): Promise<boolean> {
    const now = Date.now();
    
    // Check if cache is still valid
    if ((now - this.dbCacheTimestamp) < this.DB_CACHE_TTL_MS && this.dbSupersetSections.size > 0) {
      return true; // Use cached data
    }

    // If already loading, wait for that to complete
    if (this.dbLoadingPromise) {
      return this.dbLoadingPromise;
    }

    // Start loading and store the promise
    this.dbLoadingPromise = this.doLoadFromDatabase(now);
    
    try {
      return await this.dbLoadingPromise;
    } finally {
      this.dbLoadingPromise = null;
    }
  }

  private async doLoadFromDatabase(now: number): Promise<boolean> {
    try {
      // Load superset sections (base prompts)
      const supersetSections = await prisma.paperSupersetSection.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' }
      });

      if (supersetSections.length === 0) {
        // Database not seeded, fall back to static templates
        console.log('PaperSupersetSection table is empty, using static templates');
        return false;
      }

      // Load type overrides
      const typeOverrides = await prisma.paperTypeSectionPrompt.findMany({
        where: { status: 'ACTIVE' }
      });

      // Build new caches (don't clear old ones until new data is ready)
      const newSupersetMap = new Map<string, PaperSupersetSection>();
      const newOverrideMap = new Map<string, PaperTypeSectionPrompt>();

      for (const ss of supersetSections) {
        newSupersetMap.set(ss.sectionKey, ss);
      }

      for (const to of typeOverrides) {
        const key = `${to.paperTypeCode}:${to.sectionKey}`;
        newOverrideMap.set(key, to);
      }

      // Atomic swap of caches
      this.dbSupersetSections = newSupersetMap;
      this.dbTypeOverrides = newOverrideMap;
      this.dbCacheTimestamp = now;
      
      return true;
    } catch (error) {
      console.error('Failed to load paper prompts from database:', error);
      return false;
    }
  }

  /**
   * Resolve the prompt instruction for a paper type
   * NEW APPROACH (Option B - Layered/Top-Up):
   * Returns: BASE_PROMPT + PAPER_TYPE_ADDITIONS (not replacement)
   * 
   * The base prompt provides action-focused instructions.
   * The paper type additions provide type-specific guidance layered on top.
   */
  private async resolvePromptForPaperType(template: SectionTemplate, paperTypeCode: string): Promise<string> {
    const useDb = await this.loadFromDatabase();
    const normalized = paperTypeCode.toUpperCase();

    let basePrompt = template.defaultPrompt;
    let typeAdditions = '';

    if (useDb) {
      // Get base prompt from DB (if available)
      const dbBase = this.dbSupersetSections.get(template.sectionKey);
      if (dbBase) {
        basePrompt = dbBase.instruction;
      }

      // Get type-specific ADDITIONS from DB (not replacement!)
      const overrideKey = `${normalized}:${template.sectionKey}`;
      const dbOverride = this.dbTypeOverrides.get(overrideKey);
      if (dbOverride) {
        typeAdditions = dbOverride.instruction;
      }
    } else {
      // Fall back to static templates for additions
      const overrides = template.promptsByPaperType;
      if (overrides) {
        if (overrides[normalized]) {
          typeAdditions = overrides[normalized];
        } else {
          for (const [key, value] of Object.entries(overrides)) {
            if (key.endsWith('*') && normalized.startsWith(key.slice(0, -1))) {
              typeAdditions = value;
              break;
            }
            if (key.startsWith('*') && normalized.endsWith(key.slice(1))) {
              typeAdditions = value;
              break;
            }
          }
        }
      }
    }

    // Combine: BASE + TYPE_ADDITIONS (layered, not replaced)
    if (typeAdditions && typeAdditions.trim()) {
      return `${basePrompt}

═══════════════════════════════════════════════════════════════════════════════
PAPER TYPE SPECIFIC GUIDANCE (${normalized})
═══════════════════════════════════════════════════════════════════════════════
${typeAdditions}`;
    }

    return basePrompt;
  }

  /**
   * Get just the base prompt without any additions
   */
  async getBasePrompt(sectionKey: string): Promise<string | null> {
    const useDb = await this.loadFromDatabase();
    
    if (useDb) {
      const dbBase = this.dbSupersetSections.get(sectionKey);
      if (dbBase) {
        return dbBase.instruction;
      }
    }
    
    const template = this.sectionTemplates.find(t => t.sectionKey === sectionKey);
    return template?.defaultPrompt || null;
  }

  /**
   * Get just the paper type additions (for preview/editing)
   */
  async getPaperTypeAdditions(sectionKey: string, paperTypeCode: string): Promise<string | null> {
    const useDb = await this.loadFromDatabase();
    const normalized = paperTypeCode.toUpperCase();
    
    if (useDb) {
      const overrideKey = `${normalized}:${sectionKey}`;
      const dbOverride = this.dbTypeOverrides.get(overrideKey);
      if (dbOverride) {
        return dbOverride.instruction;
      }
    }
    
    const template = this.sectionTemplates.find(t => t.sectionKey === sectionKey);
    if (template?.promptsByPaperType?.[normalized]) {
      return template.promptsByPaperType[normalized];
    }
    
    return null;
  }

  private async getAllSectionTemplates(): Promise<SectionTemplate[]> {
    const useDb = await this.loadFromDatabase();

    if (useDb && this.dbSupersetSections.size > 0) {
      // Convert DB records to SectionTemplate format
      const dbTemplates: SectionTemplate[] = [];
      const dbSectionKeys = new Set<string>();
      
      for (const ss of Array.from(this.dbSupersetSections.values())) {
        const constraints = (ss.constraints || {}) as SectionConstraints;
        dbTemplates.push({
          sectionKey: ss.sectionKey,
          displayName: ss.label,
          description: ss.description || undefined,
          defaultPrompt: ss.instruction,
          promptsByPaperType: undefined, // Overrides handled separately
          constraints,
          applicablePaperTypes: ['*'], // All types (filtered by DB query)
          orderWeight: ss.displayOrder,
          isRequired: ss.isRequired
        });
        dbSectionKeys.add(ss.sectionKey);
      }

      // IMPORTANT: Merge with static templates for any sections not in DB
      // This ensures new static sections work even if DB hasn't been re-seeded
      const mergedTemplates = [...dbTemplates];
      
      for (const staticTemplate of this.sectionTemplates) {
        if (!dbSectionKeys.has(staticTemplate.sectionKey)) {
          console.warn(`Section "${staticTemplate.sectionKey}" not found in DB, using static template`);
          mergedTemplates.push(staticTemplate);
        }
      }

      return mergedTemplates;
    }

    // Fall back to static templates
    return this.sectionTemplates;
  }

  private orderTemplatesByPaperType(templates: SectionTemplate[], paperType: any): SectionTemplate[] {
    const sectionOrder = paperType.sectionOrder || [];
    const ordered: SectionTemplate[] = [];
    const remaining: SectionTemplate[] = [];

    // First, add templates in the paper type's specified order
    sectionOrder.forEach((sectionKey: string) => {
      const template = templates.find(t => t.sectionKey === sectionKey);
      if (template) {
        ordered.push(template);
      }
    });

    // Then add any remaining templates by their order weight
    templates.forEach(template => {
      if (!ordered.includes(template)) {
        remaining.push(template);
      }
    });

    remaining.sort((a, b) => a.orderWeight - b.orderWeight);

    return [...ordered, ...remaining];
  }

  private injectContextVariables(prompt: string, context: SectionPromptContext): string {
    let enhancedPrompt = prompt;
    const topic = context.researchTopic || {};

    const replaceToken = (token: string, value: string) => {
      enhancedPrompt = enhancedPrompt.split(token).join(value);
    };

    replaceToken('{{TITLE}}', this.formatValue(topic.title));
    replaceToken('{{RESEARCH_QUESTION}}', this.formatValue(topic.researchQuestion));
    replaceToken('{{HYPOTHESIS}}', this.formatValue(topic.hypothesis));
    replaceToken('{{METHODOLOGY}}', this.formatValue(topic.methodology));
    replaceToken('{{CONTRIBUTION_TYPE}}', this.formatValue(topic.contributionType));
    replaceToken('{{KEYWORDS}}', this.formatValue(topic.keywords));
    replaceToken('{{DATASET_DESCRIPTION}}', this.formatValue(topic.datasetDescription));
    replaceToken('{{ABSTRACT_DRAFT}}', this.formatValue(topic.abstractDraft));
    replaceToken('{{PREVIOUS_SECTIONS}}', this.formatPreviousSections(context.previousSections));

    if (context.citationCount !== undefined) {
      replaceToken('{{CITATION_COUNT}}', context.citationCount.toString());
    }

    if (context.wordCount !== undefined && context.targetWordCount !== undefined) {
      const remaining = Math.max(0, context.targetWordCount - context.wordCount);
      replaceToken('{{WORDS_REMAINING}}', remaining.toString());
      replaceToken('{{TARGET_WORD_COUNT}}', context.targetWordCount.toString());
    }

    return enhancedPrompt;
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean).join(', ');
    }
    return String(value);
  }

  private stripHtml(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private formatPreviousSections(previousSections?: Record<string, string>): string {
    if (!previousSections) return 'None';

    const entries = Object.entries(previousSections)
      .filter(([, text]) => typeof text === 'string' && text.trim().length > 0);

    if (entries.length === 0) return 'None';

    const lines: string[] = [];
    const maxTotal = 1200;
    let used = 0;

    for (const [key, raw] of entries) {
      const cleaned = this.stripHtml(String(raw));
      if (!cleaned) continue;
      const snippet = cleaned.slice(0, 400);
      lines.push(`${key.replace(/_/g, ' ')}: ${snippet}`);
      used += snippet.length;
      if (used >= maxTotal) break;
    }

    return lines.join('\n');
  }

  private buildConstraintsBlock(constraints: SectionConstraints, context: SectionPromptContext): string {
    const parts: string[] = [];

    if (constraints.wordLimit) {
      parts.push(`Word limit: ${constraints.wordLimit} words`);
    }

    if (constraints.citationRequirements) {
      const citeReq = constraints.citationRequirements;
      if (citeReq.minimum && citeReq.minimum > 0) {
        parts.push(`Minimum citations: ${citeReq.minimum}`);
      }
      if (citeReq.recommended) {
        parts.push(`Recommended citations: ${citeReq.recommended}`);
      }
    }

    if (constraints.tenseRequirements && constraints.tenseRequirements.length > 0) {
      parts.push(`Tense requirements: ${constraints.tenseRequirements.join(', ')}`);
    }

    if (constraints.styleRequirements && constraints.styleRequirements.length > 0) {
      parts.push(`Style requirements: ${constraints.styleRequirements.join(', ')}`);
    }

    return parts.length > 0 ? `CONSTRAINTS:\n${parts.map(part => `- ${part}`).join('\n')}` : '';
  }

  private buildGuidanceBlock(sectionKey: string, context: SectionPromptContext): string {
    const guidance: Record<string, string> = {
      abstract: `Remember: The abstract should be self-contained and include all key information. It should be understandable without reading the full paper.`,
      introduction: `Structure your introduction as an inverted pyramid: broad context -> specific problem -> your approach.`,
      literature_review: `Organize thematically rather than chronologically. Show how studies relate to each other and identify gaps.`,
      methodology: `Provide enough detail that another researcher could replicate your study. Justify methodological choices.`,
      results: `Present results first, interpret them in the Discussion section. Use tables/figures to enhance clarity.`,
      discussion: `Don't just restate results - interpret what they mean in the broader context of existing literature.`,
      conclusion: `Focus on contributions and implications, not just summarizing what you did.`
    };

    return guidance[sectionKey] || '';
  }

  private validateSectionTemplate(template: SectionTemplate): void {
    if (!template.sectionKey || template.sectionKey.trim().length === 0) {
      throw new Error('Section key is required');
    }

    if (!template.displayName || template.displayName.trim().length === 0) {
      throw new Error('Display name is required');
    }

    if (!template.defaultPrompt || template.defaultPrompt.trim().length === 0) {
      throw new Error('Default prompt is required');
    }

    if (!Array.isArray(template.applicablePaperTypes) || template.applicablePaperTypes.length === 0) {
      throw new Error('At least one applicable paper type must be specified');
    }

    if (typeof template.orderWeight !== 'number') {
      throw new Error('Order weight must be a number');
    }
  }

  private invalidateCache(): void {
    this.templateCache.clear();
    this.cacheTimestamp = 0;
    // Also invalidate DB cache
    this.dbSupersetSections.clear();
    this.dbTypeOverrides.clear();
    this.dbCacheTimestamp = 0;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; oldestEntry: number; dbCacheSize: number } {
    return {
      size: this.templateCache.size,
      oldestEntry: this.cacheTimestamp,
      dbCacheSize: this.dbSupersetSections.size + this.dbTypeOverrides.size
    };
  }

  /**
   * Force refresh from database
   */
  async refreshFromDatabase(): Promise<void> {
    this.dbCacheTimestamp = 0;
    await this.loadFromDatabase();
    this.templateCache.clear();
    this.cacheTimestamp = 0;
  }
}

// Export singleton instance
export const sectionTemplateService = new SectionTemplateService();

// Export class for testing
export { SectionTemplateService };
