/**
 * Paper Section Service
 * Generates paper sections with inline memory for coherence
 * 
 * Key Innovation: Each section generation returns:
 * - content: The actual section text
 * - memory: Structured summary (keyPoints, termsIntroduced, mainClaims, forwardReferences)
 * 
 * The memory is passed to subsequent sections, enabling coherence without
 * passing full section text (token efficient).
 */

import { prisma } from '../prisma';
import { llmGateway } from '../metering';
import { blueprintService, type BlueprintContext, type SectionPlanItem } from './blueprint-service';
import { sectionTemplateService } from './section-template-service';
import { getMethodologyConstraints } from '../prompts/methodology-constraints';
import { 
  getPaperWritingSample, 
  buildPaperWritingSampleBlock, 
  getPaperSectionStyleHints,
  type PaperPersonaSelection 
} from '../paper-writing-sample-service';
import { 
  paperPromptDebug, 
  buildPromptDebugInfo, 
  buildLLMDebugInfo,
  logFullReport,
  isDebugEnabled,
  type PromptDebugInfo,
  type LLMDebugInfo,
  type FullDebugReport
} from './paper-prompt-debug';
import type { PaperSection, PaperSectionStatus } from '@prisma/client';
import crypto from 'crypto';
import { polishDraftMarkdown } from '../markdown-draft-formatter';

// ============================================================================
// Types
// ============================================================================

export interface SectionMemory {
  keyPoints: string[];      // 3-5 bullets summarizing what this section covers
  termsIntroduced: string[]; // Technical terms/concepts first defined here
  mainClaims: string[];      // Key assertions (labeled: BACKGROUND/GAP/THESIS/METHOD/RESULT)
  forwardReferences: string[]; // Promises to address something in later sections
}

export interface PaperSectionWithMemory extends Omit<PaperSection, 'memory'> {
  memory: SectionMemory | null;
}

export interface SectionGenerationInput {
  sessionId: string;
  sectionKey: string;
  userInstructions?: string; // Optional user-provided guidance (one-time override)
  useStoredInstructions?: boolean; // If true, also fetch from UserSectionInstruction table
  usePersonaStyle?: boolean; // If true, fetch and inject user's writing style samples
  personaSelection?: PaperPersonaSelection; // Optional persona selection (primary + secondary)
  regenerate?: boolean;      // If true, regenerate even if exists
}

export interface UserSectionInstructionData {
  instruction?: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
}

export interface SectionGenerationResult {
  success: boolean;
  section?: PaperSectionWithMemory;
  error?: string;
}

export interface PreviousSectionSummary {
  sectionKey: string;
  displayName: string;
  memory: SectionMemory;
}

// ============================================================================
// Section Names Map
// ============================================================================

const SECTION_DISPLAY_NAMES: Record<string, string> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  literature_review: 'Literature Review',
  related_work: 'Related Work',
  methodology: 'Methodology',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  acknowledgments: 'Acknowledgments',
  references: 'References',
  future_directions: 'Future Directions',
  future_work: 'Future Work',
  case_description: 'Case Description',
  analysis: 'Analysis',
  recommendations: 'Recommendations',
  main_content: 'Main Content',
  case_studies: 'Case Studies',
  main_findings: 'Main Findings',
  appendix: 'Appendix'
};

// ============================================================================
// Paper Section Service Class
// ============================================================================

class PaperSectionService {

  /**
   * Generate a single paper section with memory
   */
  async generateSection(input: SectionGenerationInput): Promise<SectionGenerationResult> {
    const { 
      sessionId, 
      sectionKey, 
      userInstructions, 
      useStoredInstructions = true, 
      usePersonaStyle = false,
      personaSelection,
      regenerate 
    } = input;

    try {
      // Check if blueprint is ready
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (!blueprintReady.ready) {
        return {
          success: false,
          error: blueprintReady.reason || 'Blueprint not ready'
        };
      }

      // Check for existing section
      const existingSection = await prisma.paperSection.findUnique({
        where: { sessionId_sectionKey: { sessionId, sectionKey } }
      });

      if (existingSection && !regenerate && !existingSection.isStale) {
        return {
          success: true,
          section: this.transformSection(existingSection)
        };
      }

      // Get blueprint context for this section
      const blueprintContext = await blueprintService.getSectionContext(sessionId, sectionKey);
      if (!blueprintContext) {
        return {
          success: false,
          error: `Section ${sectionKey} not found in blueprint`
        };
      }

      // Get previous sections' memories
      const previousMemories = await this.getPreviousSectionMemories(sessionId, sectionKey);

      // Get the session to fetch paper type and research topic
      const session = await prisma.draftingSession.findUnique({
        where: { id: sessionId },
        include: {
          researchTopic: true,
          paperType: true
        }
      });

      if (!session || !session.researchTopic) {
        return {
          success: false,
          error: 'Session or research topic not found'
        };
      }

      const paperTypeCode = session.paperType?.code || 'JOURNAL_ARTICLE';

      // Get methodology type from blueprint
      const blueprint = await blueprintService.getBlueprint(sessionId);
      const methodologyType = (blueprint as any)?.methodologyType || null;

      // Fetch and combine user instructions (paper-type-specific)
      let combinedUserInstructions = '';
      
      if (useStoredInstructions) {
        const storedInstructions = await this.getUserSectionInstructions(
          session.userId,
          sessionId,
          sectionKey,
          paperTypeCode // Pass paper type for type-specific instructions
        );
        if (storedInstructions) {
          combinedUserInstructions = this.formatUserInstructions(storedInstructions);
        }
      }
      
      // One-time instructions take precedence but are combined
      if (userInstructions) {
        if (combinedUserInstructions) {
          combinedUserInstructions += `\n\nADDITIONAL ONE-TIME INSTRUCTIONS:\n${userInstructions}`;
        } else {
          combinedUserInstructions = userInstructions;
        }
      }

      // Fetch writing style sample if persona style is enabled
      let writingStyleBlock = '';
      if (usePersonaStyle) {
        const sample = await getPaperWritingSample(
          session.userId,
          sectionKey,
          paperTypeCode,
          personaSelection
        );
        if (sample) {
          writingStyleBlock = buildPaperWritingSampleBlock(sample, sectionKey);
          const styleHints = getPaperSectionStyleHints(sectionKey);
          if (styleHints) {
            writingStyleBlock += `\n${styleHints}`;
          }
        }
      }

      // Build the generation prompt with debug info
      const { prompt, debugInfo } = await this.buildSectionPromptWithDebug(
        blueprintContext,
        previousMemories,
        session.researchTopic,
        paperTypeCode,
        methodologyType,
        combinedUserInstructions || undefined,
        writingStyleBlock || undefined,
        sessionId,
        sectionKey
      );

      // Log prompt hierarchy if debug is enabled
      if (isDebugEnabled() && debugInfo) {
        paperPromptDebug.logPromptHierarchy(debugInfo);
      }

      const llmStartTime = Date.now();

      // Call LLM
      const result = await llmGateway.executeLLMOperation(
        { headers: {} },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'PAPER_SECTION_GEN',
          prompt,
          // maxTokensOut is controlled via super admin LLM config for PAPER_SECTION_GEN stage
          parameters: {
            purpose: 'paper_section_generation',
            temperature: 0.5,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId,
            sectionKey,
            purpose: 'paper_section_generation'
          }
        }
      );

      const llmEndTime = Date.now();
      const llmLatencyMs = llmEndTime - llmStartTime;

      // Log LLM result if debug is enabled
      if (isDebugEnabled()) {
        const llmDebugInfo = buildLLMDebugInfo(
          result.response?.modelClass || 'unknown',
          (result.response?.metadata as any)?.inputTokens || 0,
          result.response?.outputTokens || 0,
          (result.response?.metadata as any)?.inputCostPer1M || 0,
          (result.response?.metadata as any)?.outputCostPer1M || 0,
          llmLatencyMs,
          result.success,
          result.error?.message
        );
        paperPromptDebug.logLLMResult(llmDebugInfo);

        // Log output preview
        if (result.response?.output) {
          const preview = result.response.output.substring(0, 500);
          console.log(`\n\x1b[33m\x1b[1mOUTPUT PREVIEW\x1b[0m`);
          console.log(`\x1b[2m${'─'.repeat(80)}\x1b[0m`);
          console.log(`\x1b[2m${preview}${result.response.output.length > 500 ? '...' : ''}\x1b[0m`);
          console.log(`\n\x1b[34m${'═'.repeat(80)}\x1b[0m`);
          console.log(`\x1b[44m\x1b[37m END DEBUG - ${sectionKey.toUpperCase()} \x1b[0m\n`);
        }
      }

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Section generation failed'
        };
      }

      // Parse the response
      const parsed = this.parseSectionResponse(result.response.output);

      // Get blueprint version (reuse existing blueprint)
      const blueprintVersion = blueprint?.version || 1;

      // Upsert section
      const sectionData = {
        sectionKey,
        displayName: SECTION_DISPLAY_NAMES[sectionKey] || sectionKey,
        content: parsed.content,
        wordCount: this.countWords(parsed.content),
        memory: parsed.memory as any,
        blueprintVersion,
        promptUsed: prompt,
        llmResponse: result.response.output,
        tokensUsed: result.response.outputTokens,
        status: 'DRAFT' as PaperSectionStatus,
        isStale: false,
        generatedAt: new Date()
      };

      let section: PaperSection;
      if (existingSection) {
        section = await prisma.paperSection.update({
          where: { sessionId_sectionKey: { sessionId, sectionKey } },
          data: {
            ...sectionData,
            version: { increment: 1 }
          }
        });
      } else {
        section = await prisma.paperSection.create({
          data: {
            sessionId,
            ...sectionData
          }
        });
      }

      return {
        success: true,
        section: this.transformSection(section)
      };

    } catch (error) {
      console.error('Section generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get a section by key
   */
  async getSection(sessionId: string, sectionKey: string): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    return this.transformSection(section);
  }

  /**
   * Get all sections for a session
   */
  async getAllSections(sessionId: string): Promise<PaperSectionWithMemory[]> {
    const sections = await prisma.paperSection.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' }
    });

    return sections.map(s => this.transformSection(s));
  }

  /**
   * Update section content (manual edit)
   */
  async updateSectionContent(
    sessionId: string,
    sectionKey: string,
    content: string
  ): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    const polishedContent = polishDraftMarkdown(content);

    // When content is manually edited, we should re-extract memory
    // For now, mark memory as potentially stale
    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: {
        content: polishedContent,
        wordCount: this.countWords(polishedContent),
        status: 'DRAFT',
        version: { increment: 1 }
      }
    });

    return this.transformSection(updated);
  }

  /**
   * Re-extract memory from section content
   * (Used after manual edits)
   */
  async reExtractMemory(
    sessionId: string,
    sectionKey: string
  ): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    // Build memory extraction prompt
    const prompt = this.buildMemoryExtractionPrompt(section.content, sectionKey);

    const result = await llmGateway.executeLLMOperation(
      { headers: {} },
      {
        taskCode: 'LLM2_DRAFT',
        stageCode: 'PAPER_MEMORY_EXTRACT',
        prompt,
        // maxTokensOut is controlled via super admin LLM config for PAPER_MEMORY_EXTRACT stage
        parameters: {
          purpose: 'memory_extraction',
          temperature: 0.2,
        },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          sessionId,
          sectionKey,
          purpose: 'memory_extraction'
        }
      }
    );

    if (!result.success || !result.response) {
      console.error('Memory extraction failed:', result.error);
      return this.transformSection(section);
    }

    const memory = this.parseMemoryResponse(result.response.output);

    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: { memory: memory as any }
    });

    return this.transformSection(updated);
  }

  /**
   * Mark section as approved
   */
  async approveSection(sessionId: string, sectionKey: string): Promise<PaperSectionWithMemory | null> {
    const section = await prisma.paperSection.findUnique({
      where: { sessionId_sectionKey: { sessionId, sectionKey } }
    });

    if (!section) {
      return null;
    }

    const updated = await prisma.paperSection.update({
      where: { sessionId_sectionKey: { sessionId, sectionKey } },
      data: { status: 'APPROVED' }
    });

    return this.transformSection(updated);
  }

  /**
   * Get generation order for sections based on dependencies
   */
  async getSectionGenerationOrder(sessionId: string): Promise<string[]> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      return [];
    }

    // Topological sort based on dependencies
    const sections = blueprint.sectionPlan;
    const order: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (sectionKey: string) => {
      if (visited.has(sectionKey)) return;
      if (temp.has(sectionKey)) {
        throw new Error(`Circular dependency detected: ${sectionKey}`);
      }

      temp.add(sectionKey);

      const section = sections.find(s => s.sectionKey === sectionKey);
      if (section) {
        for (const dep of section.dependencies) {
          if (sections.some(s => s.sectionKey === dep)) {
            visit(dep);
          }
        }
      }

      temp.delete(sectionKey);
      visited.add(sectionKey);
      order.push(sectionKey);
    };

    for (const section of sections) {
      visit(section.sectionKey);
    }

    return order;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Fetch user's section instructions from database
   * Checks in order of specificity:
   * 1. Session-level + paper-type-specific
   * 2. Session-level + universal
   * 3. User-level + paper-type-specific
   * 4. User-level + universal
   */
  private async getUserSectionInstructions(
    userId: string,
    sessionId: string,
    sectionKey: string,
    paperTypeCode?: string
  ): Promise<UserSectionInstructionData | null> {
    try {
      const normalizedType = paperTypeCode?.toUpperCase();

      // 1. Session-level + paper-type-specific
      if (normalizedType) {
        const sessionTypeSpecific = await prisma.userSectionInstruction.findFirst({
          where: {
            userId,
            sessionId,
            sectionKey,
            paperTypeCode: normalizedType,
            isActive: true
          }
        });
        if (sessionTypeSpecific) {
          return this.mapInstructionToData(sessionTypeSpecific);
        }
      }

      // 2. Session-level + universal (any paper type)
      const sessionUniversal = await prisma.userSectionInstruction.findFirst({
        where: {
          userId,
          sessionId,
          sectionKey,
          OR: [
            { paperTypeCode: '*' },
            { paperTypeCode: null }
          ],
          isActive: true
        }
      });
      if (sessionUniversal) {
        return this.mapInstructionToData(sessionUniversal);
      }

      // 3. User-level + paper-type-specific
      if (normalizedType) {
        const userTypeSpecific = await prisma.userSectionInstruction.findFirst({
          where: {
            userId,
            sessionId: null,
            sectionKey,
            paperTypeCode: normalizedType,
            isActive: true
          }
        });
        if (userTypeSpecific) {
          return this.mapInstructionToData(userTypeSpecific);
        }
      }

      // 4. User-level + universal
      const userUniversal = await prisma.userSectionInstruction.findFirst({
        where: {
          userId,
          sessionId: null,
          sectionKey,
          OR: [
            { paperTypeCode: '*' },
            { paperTypeCode: null }
          ],
          isActive: true
        }
      });
      if (userUniversal) {
        return this.mapInstructionToData(userUniversal);
      }

      return null;
    } catch (error) {
      console.error('Failed to fetch user section instructions:', error);
      return null;
    }
  }

  private mapInstructionToData(instruction: any): UserSectionInstructionData {
    return {
      instruction: instruction.instruction,
      emphasis: instruction.emphasis || undefined,
      avoid: instruction.avoid || undefined,
      style: instruction.style || undefined,
      wordCount: instruction.wordCount || undefined
    };
  }

  /**
   * Format user instructions into a readable block for the prompt
   */
  private formatUserInstructions(data: UserSectionInstructionData): string {
    const parts: string[] = [];

    if (data.instruction) {
      parts.push(`MAIN INSTRUCTION:\n${data.instruction}`);
    }

    if (data.emphasis) {
      parts.push(`EMPHASIZE:\n${data.emphasis}`);
    }

    if (data.avoid) {
      parts.push(`AVOID:\n${data.avoid}`);
    }

    if (data.style) {
      parts.push(`WRITING STYLE: ${data.style}`);
    }

    if (data.wordCount) {
      parts.push(`TARGET WORD COUNT: ~${data.wordCount} words`);
    }

    return parts.join('\n\n');
  }

  private async getPreviousSectionMemories(
    sessionId: string,
    currentSectionKey: string
  ): Promise<PreviousSectionSummary[]> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      return [];
    }

    // Get the current section's dependencies
    const currentPlan = blueprint.sectionPlan.find(s => s.sectionKey === currentSectionKey);
    const dependencies = currentPlan?.dependencies || [];

    // Get sections that should come before this one
    const generationOrder = await this.getSectionGenerationOrder(sessionId);
    const currentIndex = generationOrder.indexOf(currentSectionKey);
    const previousKeys = currentIndex > 0 ? generationOrder.slice(0, currentIndex) : [];

    // Get sections with memory
    const sections = await prisma.paperSection.findMany({
      where: {
        sessionId,
        sectionKey: { in: previousKeys },
        memory: { not: null as any }
      }
    });

    // Sort by generation order
    const sortedSections = previousKeys
      .map(key => sections.find(s => s.sectionKey === key))
      .filter((s): s is PaperSection => s !== null && s !== undefined);

    return sortedSections.map(s => ({
      sectionKey: s.sectionKey,
      displayName: SECTION_DISPLAY_NAMES[s.sectionKey] || s.sectionKey,
      memory: s.memory as any as SectionMemory
    }));
  }

  /**
   * Build section prompt with debug information
   */
  private async buildSectionPromptWithDebug(
    blueprintContext: BlueprintContext,
    previousMemories: PreviousSectionSummary[],
    researchTopic: any,
    paperTypeCode: string,
    methodologyType: string | null,
    userInstructions?: string,
    writingStyleBlock?: string,
    sessionId?: string,
    sectionKey?: string
  ): Promise<{ prompt: string; debugInfo: PromptDebugInfo | null }> {
    const { thesisStatement, centralObjective, keyContributions, currentSection, preferredTerms } = blueprintContext;

    // Track components for debug
    const debugComponents: {
      basePrompt: string;
      paperTypeOverride?: string;
      methodologyConstraints?: string;
      blueprintContext?: string;
      previousMemories?: string;
      preferredTerms?: string;
      writingPersona?: string;
      userInstructions?: string;
    } = { basePrompt: '' };

    // Get base section prompt from template service
    let basePrompt = '';
    let paperTypeOverride = '';
    try {
      // Get base prompt
      const templateResult = await sectionTemplateService.getPromptForSection(
        currentSection.sectionKey,
        paperTypeCode,
        { researchTopic }
      );
      basePrompt = templateResult;
      debugComponents.basePrompt = basePrompt;

      // Try to get paper type override separately for debug purposes
      try {
        const overrideResult = await sectionTemplateService.getPaperTypeOverride(
          currentSection.sectionKey,
          paperTypeCode
        );
        if (overrideResult) {
          paperTypeOverride = overrideResult;
          debugComponents.paperTypeOverride = paperTypeOverride;
        }
      } catch {
        // No override - that's fine
      }
    } catch (e) {
      // Use generic prompt if template not found
      basePrompt = `Write the ${currentSection.sectionKey} section for an academic paper.`;
      debugComponents.basePrompt = basePrompt;
    }

    // Get methodology-specific constraints to inject
    const methodologyBlock = getMethodologyConstraints(methodologyType, currentSection.sectionKey);
    if (methodologyBlock) {
      debugComponents.methodologyConstraints = methodologyBlock;
    }

    // Build previous sections summary
    let previousSectionsSummary = '';
    if (previousMemories.length > 0) {
      previousSectionsSummary = previousMemories.map(pm => `
### ${pm.displayName}
- Key Points: ${pm.memory.keyPoints.join('; ')}
- Terms Introduced: ${pm.memory.termsIntroduced.join(', ')}
- Claims Made: ${pm.memory.mainClaims.join('; ')}
${pm.memory.forwardReferences.length > 0 ? `- Promises: ${pm.memory.forwardReferences.join('; ')}` : ''}`
      ).join('\n');
      debugComponents.previousMemories = previousSectionsSummary;
    }

    // Build preferred terms block
    let termsBlock = '';
    if (Object.keys(preferredTerms).length > 0) {
      termsBlock = Object.entries(preferredTerms)
        .map(([term, def]) => `- ${term}: ${def}`)
        .join('\n');
      debugComponents.preferredTerms = termsBlock;
    }

    // Build blueprint context for debug
    debugComponents.blueprintContext = `Thesis: ${thesisStatement}\nObjective: ${centralObjective}\nContributions: ${keyContributions.join('; ')}\nSection Purpose: ${currentSection.purpose}`;

    // Track writing style and user instructions for debug
    if (writingStyleBlock) {
      debugComponents.writingPersona = writingStyleBlock;
    }
    if (userInstructions) {
      debugComponents.userInstructions = userInstructions;
    }

    // Build prompt with EXPLICIT PRIORITY ORDERING
    // Priority: Lower numbers = lower priority, Higher numbers = higher priority
    // When contradictions exist, HIGHER PRIORITY WINS
    
    const prompt = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  PROMPT PRIORITY GUIDE                                                        ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Priority increases from top to bottom. When instructions conflict:           ║
║  • Later sections OVERRIDE earlier sections                                   ║
║  • User instructions have HIGHEST priority                                    ║
║  • Writing style preferences override generic academic style                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 1 - BASE] SECTION WRITING TASK
═══════════════════════════════════════════════════════════════════════════════
${basePrompt}

═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 2 - CONTEXT] PAPER BLUEPRINT (Frozen Plan)
═══════════════════════════════════════════════════════════════════════════════
Thesis Statement: ${thesisStatement}

Central Objective: ${centralObjective}

Key Contributions:
${keyContributions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Section: ${currentSection.sectionKey}
Purpose: ${currentSection.purpose}

MUST COVER (Required):
${currentSection.mustCover.map(c => `✓ ${c}`).join('\n')}

MUST AVOID (Prevent duplication):
${currentSection.mustAvoid.map(c => `✗ ${c}`).join('\n')}

${currentSection.wordBudget ? `Word Budget: ~${currentSection.wordBudget} words` : ''}

${previousSectionsSummary ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 3 - CONTINUITY] PREVIOUS SECTIONS MEMORY
═══════════════════════════════════════════════════════════════════════════════
${previousSectionsSummary}
` : ''}

${termsBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 4 - TERMINOLOGY] PREFERRED TERMS (Use These Exact Terms)
═══════════════════════════════════════════════════════════════════════════════
${termsBlock}
` : ''}

${methodologyBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 5 - METHODOLOGY] ${methodologyType?.toUpperCase() || 'GENERAL'} REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
These methodology-specific requirements OVERRIDE generic section guidance.
${methodologyBlock}
` : ''}

${writingStyleBlock ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 6 - STYLE] YOUR WRITING PERSONA (Override Generic Style)
═══════════════════════════════════════════════════════════════════════════════
${writingStyleBlock}
` : ''}

${userInstructions ? `
═══════════════════════════════════════════════════════════════════════════════
[PRIORITY 7 - HIGHEST] USER INSTRUCTIONS (OVERRIDE EVERYTHING ABOVE)
═══════════════════════════════════════════════════════════════════════════════
⚠️ These instructions have the HIGHEST PRIORITY.
When these conflict with any guidance above, FOLLOW THESE INSTRUCTIONS.

${userInstructions}
` : ''}

═══════════════════════════════════════════════════════════════════════════════
COHERENCE RULES (Always Apply)
═══════════════════════════════════════════════════════════════════════════════
1. Support the thesis statement in all assertions
2. Do NOT redefine terms already introduced in previous sections
3. Do NOT contradict claims made in previous sections
4. Do NOT include content listed in "MUST AVOID"
5. Reference previous sections naturally where appropriate

═══════════════════════════════════════════════════════════════════════════════
CONTENT STRUCTURE (Use proper academic formatting)
═══════════════════════════════════════════════════════════════════════════════
Your content MUST be well-organized with:

1. SUBSECTION HEADINGS (use ### for subsections):
   - Divide the section into 2-4 logical subsections
   - Example: "### Background and Motivation", "### Problem Formulation"
   
2. BULLET POINTS (use - for unordered, 1. for ordered):
   - Use bullets for: criteria, findings, requirements, comparisons
   - Keep each bullet concise (1-2 sentences)
   - Example: "Key challenges include:\\n- Challenge 1\\n- Challenge 2"

3. PARAGRAPH STRUCTURE:
   - Start subsections with topic sentences
   - Use transition phrases between paragraphs
   - End with summary or bridge to next topic

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (Return ONLY valid JSON)
═══════════════════════════════════════════════════════════════════════════════

{
  "content": "<section with ### subsections, paragraphs, and bullet points>",
  "memory": {
    "keyPoints": ["point1", "point2", "point3"],
    "termsIntroduced": ["term1", "term2"],
    "mainClaims": ["BACKGROUND: claim1", "GAP: claim2", "THESIS: claim3"],
    "forwardReferences": ["will discuss X in methodology"]
  }
}

CONTENT FIELD RULES:
- Use ### for subsection headings (2-4 per section)
- Use - for bullet lists, 1. for numbered lists
- Use \\n for line breaks
- Write flowing paragraphs for explanations

MEMORY FIELD RULES:
- keyPoints: 3-5 bullets summarizing what this section covers
- termsIntroduced: Terms FIRST defined in THIS section only
- mainClaims: Key assertions with type prefix (BACKGROUND/GAP/THESIS/METHOD/RESULT)
- forwardReferences: Promises to address something in later sections

⚠️ CRITICAL: Output ONLY raw JSON. No markdown code fences. Start with { and end with }`;

    // Build debug info if debug is enabled
    let debugInfo: PromptDebugInfo | null = null;
    if (isDebugEnabled() && sessionId && sectionKey) {
      debugInfo = buildPromptDebugInfo(
        sessionId,
        sectionKey,
        paperTypeCode,
        methodologyType,
        debugComponents,
        prompt
      );
    }

    return { prompt, debugInfo };
  }

  private buildMemoryExtractionPrompt(content: string, sectionKey: string): string {
    return `Extract a structured memory summary from the following ${sectionKey} section.

═══════════════════════════════════════════════════════════════════════════════
SECTION CONTENT
═══════════════════════════════════════════════════════════════════════════════
${content}

═══════════════════════════════════════════════════════════════════════════════
EXTRACTION TASK
═══════════════════════════════════════════════════════════════════════════════
Extract and return a JSON object with:

{
  "keyPoints": ["point1", "point2", "point3"],
  "termsIntroduced": ["term1", "term2"],
  "mainClaims": ["TYPE: claim1", "TYPE: claim2"],
  "forwardReferences": ["reference1"]
}

FIELD DEFINITIONS:
- keyPoints: 3-5 crisp bullets capturing what this section covers
- termsIntroduced: Technical terms or concepts that are defined/introduced here
- mainClaims: Key assertions made, prefixed with type:
  - BACKGROUND: Facts about the field/domain
  - GAP: What's missing or problematic
  - THESIS: Central argument or position
  - METHOD: Methodological choices
  - RESULT: Findings or observations
  - LIMITATION: Constraints or caveats
- forwardReferences: Promises to cover something in later sections

⚠️ Output ONLY raw JSON. No markdown. Start with { end with }`;
  }

  private parseSectionResponse(output: string): { content: string; memory: SectionMemory } {
    let text = (output || '').trim();

    // Remove code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // Find JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end < start) {
      // If no JSON found, treat entire output as content with empty memory
      console.warn('No JSON structure found in section response, using raw output as content');
      return {
        content: polishDraftMarkdown(text),
        memory: {
          keyPoints: [],
          termsIntroduced: [],
          mainClaims: [],
          forwardReferences: []
        }
      };
    }

    text = text.slice(start, end + 1);

    try {
      const parsed = JSON.parse(text);

      const content = polishDraftMarkdown(parsed.content || '');
      const memory: SectionMemory = {
        keyPoints: Array.isArray(parsed.memory?.keyPoints) ? parsed.memory.keyPoints : [],
        termsIntroduced: Array.isArray(parsed.memory?.termsIntroduced) ? parsed.memory.termsIntroduced : [],
        mainClaims: Array.isArray(parsed.memory?.mainClaims) ? parsed.memory.mainClaims : [],
        forwardReferences: Array.isArray(parsed.memory?.forwardReferences) ? parsed.memory.forwardReferences : []
      };

      return { content, memory };
    } catch (error) {
      console.error('Section parse error:', error);
      console.error('Raw output:', output.substring(0, 500));
      
      // Try to extract content even if JSON is malformed
      const contentMatch = output.match(/"content"\s*:\s*"([\s\S]*?)(?:","memory"|"})/);
      if (contentMatch) {
        return {
          content: polishDraftMarkdown(contentMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')),
          memory: {
            keyPoints: [],
            termsIntroduced: [],
            mainClaims: [],
            forwardReferences: []
          }
        };
      }

      throw new Error(`Failed to parse section response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseMemoryResponse(output: string): SectionMemory {
    let text = (output || '').trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1) {
      return {
        keyPoints: [],
        termsIntroduced: [],
        mainClaims: [],
        forwardReferences: []
      };
    }

    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return {
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        termsIntroduced: Array.isArray(parsed.termsIntroduced) ? parsed.termsIntroduced : [],
        mainClaims: Array.isArray(parsed.mainClaims) ? parsed.mainClaims : [],
        forwardReferences: Array.isArray(parsed.forwardReferences) ? parsed.forwardReferences : []
      };
    } catch (error) {
      console.error('Memory parse error:', error);
      return {
        keyPoints: [],
        termsIntroduced: [],
        mainClaims: [],
        forwardReferences: []
      };
    }
  }

  private countWords(text: string): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  private transformSection(section: PaperSection): PaperSectionWithMemory {
    return {
      ...section,
      memory: section.memory as SectionMemory | null
    };
  }
}

// Export singleton instance
export const paperSectionService = new PaperSectionService();

// Export class for testing
export { PaperSectionService };

