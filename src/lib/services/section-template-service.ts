/**
 * Section Template Service
 * Manages section templates for different paper types with venue overrides
 */

import { prisma } from '../prisma';
import { paperTypeService } from './paper-type-service';
import { paperSectionTemplates } from '../prompts/paper-section-prompts';
import type { PaperTypeDefinition } from '@prisma/client';

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

    let prompt = this.resolvePromptForPaperType(template, paperTypeCode);

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

  private sectionTemplates: SectionTemplate[] = paperSectionTemplates;

  private resolvePromptForPaperType(template: SectionTemplate, paperTypeCode: string): string {
    const overrides = template.promptsByPaperType;
    if (!overrides) return template.defaultPrompt;

    const normalized = paperTypeCode.toUpperCase();
    if (overrides[normalized]) return overrides[normalized];

    for (const [key, value] of Object.entries(overrides)) {
      if (key.endsWith('*') && normalized.startsWith(key.slice(0, -1))) {
        return value;
      }
      if (key.startsWith('*') && normalized.endsWith(key.slice(1))) {
        return value;
      }
    }

    return template.defaultPrompt;
  }

  private async getAllSectionTemplates(): Promise<SectionTemplate[]> {
    // In a full implementation, this would query a SectionTemplate database table
    // For now, return the hardcoded templates
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
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; oldestEntry: number } {
    return {
      size: this.templateCache.size,
      oldestEntry: this.cacheTimestamp
    };
  }
}

// Export singleton instance
export const sectionTemplateService = new SectionTemplateService();

// Export class for testing
export { SectionTemplateService };
