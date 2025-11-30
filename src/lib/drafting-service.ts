import { llmGateway, executePatentDrafting } from './metering/gateway';
import { prisma } from './prisma';
import { verifyJWT } from './auth';
import {
  getCountryProfile,
  getDraftingPrompts,
  getBaseStyle,
  getGlobalRules,
  getSectionRules
} from '@/lib/country-profile-service';
import {
  getWritingSample,
  buildWritingSampleBlock,
  getSectionStyleHints,
  type WritingSampleContext
} from '@/lib/writing-sample-service';
import crypto from 'crypto';

// Hard-coded Superset Section Prompts (Country-Neutral Base Prompts)
// Exported for use by prompt-merger-service and country-profile-service
export const SUPERSET_PROMPTS: Record<string, { instruction: string; constraints: string[] }> = {
  'title': {
    instruction: `**Role:** Formalities Officer (US/EP/PCT Compliance).

**Task:** Generate a strict, descriptive Title.

**Input Data:** {{ABSTRACT_OR_SUMMARY}}

**Drafting Logic (Chain-of-Thought):**

1. **Analyze Subject:** Is this a System, Method, Apparatus, or Composition?

2. **Identify Core Function:** What is the technical function (e.g., "compressing video"), not the result (e.g., "watching movies faster").

3. **Filter Profanity:** Check for and remove banned words: *Novel, Improved, Smart, Intelligent, New, Best*.

4. **Format:** Remove any starting articles ("A", "The").

**Output Constraint:** Maximum 15 words. Sentence case. No period at the end.`,
    constraints: [
      'Maximum 15 words',
      'Sentence case',
      'No period at the end',
      'No banned words: Novel, Improved, Smart, Intelligent, New, Best',
      'Remove starting articles (A, The)'
    ]
  },

  'preamble': {
    instruction: `**Role:** Legal Formalities Engine.

**Task:** Generate the mandatory statutory preamble *only if required*.

**Input Data:** {{COUNTRY_CODE}}, {{FILING_TYPE}} (Provisional/Complete)

**Drafting Logic:**

1. **Check Jurisdiction:**

   * IF Country == 'IN' (India) OR 'PK' (Pakistan):

       * IF Filing == 'Provisional': Output "The following specification describes the invention."

       * IF Filing == 'Complete': Output "The following specification particularly describes the invention and the manner in which it is to be performed."

   * IF Country == 'BD' (Bangladesh): Output "The following specification particularly describes and ascertains the nature of the invention and the manner in which the same is to be performed."

   * IF Country == 'ZA' (South Africa) OR 'NZ': Output "The following statement is a full description of this invention, including the best method of performing it known to me/us:"

2. **Default:** ELSE Return [EMPTY_STRING].`,
    constraints: [
      'Only output preamble if required by jurisdiction',
      'Use exact legal wording for each country',
      'Return empty string if not required'
    ]
  },

  'cross_reference': {
    instruction: `**Role:** Patent Paralegal.

**Task:** Draft the Priority and Government Rights paragraph.

**Input Data:** {{PARENT_APPS_LIST}}, {{GOV_CONTRACT_DETAILS}}

**Drafting Logic:**

1. **Priority Chain:**

   * Sort parent apps from Newest to Oldest.

   * Draft a single continuous sentence: *"This application claims the benefit of priority to [App X], filed [Date]..."*

   * *Constraint:* Ensure correct relationship terms (Continuation, Divisional, CIP).

2. **Gov Rights Check:**

   * IF contract details exist, draft: *"This invention was made with government support under [Contract ID] awarded by [Agency]. The government has certain rights in the invention."*

   * ELSE output nothing for this part.`,
    constraints: [
      'Sort parent applications from newest to oldest',
      'Use correct relationship terms (Continuation, Divisional, CIP)',
      'Include government rights only if contract details exist'
    ]
  },

  'field': {
    instruction: `**Role:** Patent Drafter (Neutral Tone).

**Task:** Draft the "Technical Field" section using the Funnel Method.

**Input Data:** {{INVENTION_TITLE}}, {{CORE_KEYWORDS}}

**Drafting Logic:**

1. **Broad Category:** Identify the general IPC class area (e.g., "Wireless Communication").

2. **Specific Niche:** Identify the specific sub-field (e.g., "Antenna modulation techniques").

3. **Combine:** Draft "The present disclosure relates generally to [Broad], and more particularly to [Specific]."

4. **Safety Check:** Do NOT use the word "Invention" (use "Disclosure" or "Subject Matter"). Do NOT use "Novel" or "New".`,
    constraints: [
      'Use funnel method: broad to specific',
      'Do not use word "Invention"',
      'Do not use "Novel" or "New"',
      'Maximum 1-2 sentences'
    ]
  },

  'background': {
    instruction: `**Role:** Defensive Patent Strategist.

**Task:** Draft the Background *without* admitting obviousness.

**Input Data:** {{PRIOR_ART_SUMMARY}}, {{PROBLEM_STATEMENT}}

**Drafting Logic (Chain-of-Thought):**

1. **Describe Convention:** Describe how the task is typically performed currently. Use safe words: *"Conventionally," "Typically," "In some scenarios."*

   * *Constraint:* NEVER say "It is well known that..." or "Prior art teaches..."

   * *Do NOT use legal/claim-like structure (e.g., "A system comprising…") in background language.

2. **Identify the Gap:** State the limitation of the conventional method objectively.

   * *Bad:* "The old way is slow."

   * *Good:* "Conventional systems may experience increased latency under high load."

3. **Stop:** Do NOT summarize the solution here.`,
    constraints: [
      'Never admit obviousness',
      'Use safe words: Conventionally, Typically, In some scenarios',
      'Do not use legal/claim-like structure',
      'Maximum 2 paragraphs',
      'State limitations objectively'
    ]
  },

  'objects': {
    instruction: `**Role:** Patent Agent (Commonwealth Specialist).

**Task:** List the objectives (required for India/Pakistan/Mexico/South Africa/UAE).

**Input Data:** {{ADVANTAGES_LIST}}, {{PROBLEM_STATEMENT}}, {{PRIOR_ART_SUMMARY}}

**Drafting Logic:**

1. **Format:** Create a numbered or bulleted list of objectives.

2. **Phrasing:** Start every sentence with *"The principal object of the present invention is to..."*, *"An object of the present disclosure is to..."* or *"Another object of this invention is to..."*

   * *Constraint:* NEVER say "The object..." (singular definite article implies there is only one, and if you fail it, the patent may be weakened).

3. **Focus:** Describe the *result* achieved (e.g., "to improve efficiency", "to overcome the limitations of prior art"), not the *means* of achieving it.

4. **Connection to Claims:** Each objective should correlate directly with features mentioned in the claims.

5. **Prior Art Acknowledgment:** Briefly acknowledge the closest prior art and clearly distinguish how the invention improves upon it.`,
    constraints: [
      'Start with "The principal object", "An object" or "Another object" (never just "The object")',
      'Describe results achieved, not the means of achieving them',
      'Use list format (numbered or bulleted)',
      'Each objective should correlate with claim features',
      'Do not admit non-patentability or that invention is obvious',
      'Avoid vague or non-technical goals',
      'Do not overstate benefits beyond what is demonstrable'
    ]
  },

  // Alias for objectsOfInvention (same as 'objects')
  'objectsOfInvention': {
    instruction: `**Role:** Patent Agent (Commonwealth Specialist).

**Task:** List the objectives (required for India/Pakistan/Mexico/South Africa/UAE).

**Input Data:** {{ADVANTAGES_LIST}}, {{PROBLEM_STATEMENT}}, {{PRIOR_ART_SUMMARY}}

**Drafting Logic:**

1. **Format:** Create a numbered or bulleted list of objectives.

2. **Phrasing:** Start every sentence with *"The principal object of the present invention is to..."*, *"An object of the present disclosure is to..."* or *"Another object of this invention is to..."*

   * *Constraint:* NEVER say "The object..." (singular definite article implies there is only one, and if you fail it, the patent may be weakened).

3. **Focus:** Describe the *result* achieved (e.g., "to improve efficiency", "to overcome the limitations of prior art"), not the *means* of achieving it.

4. **Connection to Claims:** Each objective should correlate directly with features mentioned in the claims.

5. **Prior Art Acknowledgment:** Briefly acknowledge the closest prior art and clearly distinguish how the invention improves upon it.`,
    constraints: [
      'Start with "The principal object", "An object" or "Another object" (never just "The object")',
      'Describe results achieved, not the means of achieving them',
      'Use list format (numbered or bulleted)',
      'Each objective should correlate with claim features',
      'Do not admit non-patentability or that invention is obvious',
      'Avoid vague or non-technical goals',
      'Do not overstate benefits beyond what is demonstrable'
    ]
  },

  'summary': {
    instruction: `**Role:** Senior Patent Attorney.

**Task:** Draft a Summary that strictly mirrors the Independent Claims.

**Input Data:** {{INDEPENDENT_CLAIMS}}, {{KEY_EMBODIMENTS}}

**Drafting Logic (Chain-of-Thought):**

1. **Mirroring:** Paraphrase the Independent Claim 1 into a narrative sentence. *"In one aspect, a method comprises..."*

2. **Softening:** Change definitive words ("consisting of") to permissive words ("including", "can", "may").

3. **Variations:** Add 1-2 sentences about key dependent claims using: *"In some embodiments..."*

4. **Safety Check:** Ensure NO feature is listed here that is not also in the Claims or Description.`,
    constraints: [
      'Strictly mirror independent claims',
      'Use permissive language (including, can, may)',
      'Add variations with "In some embodiments"',
      'Maximum 1-3 paragraphs',
      'No features not in claims or description'
    ]
  },

  'brief_drawings': {
    instruction: `**Role:** Formalities Specialist.

**Task:** Create the standard figure list.

**Input Data:** {{FIGURE_LIST}} (e.g., "Fig 1: System", "Fig 2: Flowchart")

**Drafting Logic:**

1. **Iterate:** Loop through every figure in the input.

2. **Format:** Apply standard template: *"FIG. [X] is a [Type] view of [Subject], in accordance with an embodiment."*

3. **Consistency:** Ensure strict matching of Figure Numbers to descriptions.`,
    constraints: [
      'Use standard template format',
      'Strict figure number matching',
      'Include "in accordance with an embodiment"'
    ]
  },

  'detailed_description': {
    instruction: `**Role:** Technical Writer (Anti-Hallucination).

**Task:** Draft the detailed enablement.

**Input Data:** {{FULL_DISCLOSURE_TEXT}}, {{ELEMENT_MAP}} (e.g., 10=Sensor)

**Drafting Logic (Chain-of-Thought):**

1. **Grounding Rule:** You may ONLY describe features found in the Input Data. If a specific detail (e.g., "Temperature = 50C") is missing, do NOT invent it. Use generic terms ("a suitable temperature").

2. **Structure:** Describe the *Apparatus* (Structure) first, then the *Method* (Operation) second.

3. **Reference Numeral Check:** Every time a listed element is named, append its number (e.g., "The sensor (10)...").

4. **Expansion:** Use non-limiting language: *"The processor may be X, Y, or Z."*`,
    constraints: [
      'Only use features from input data',
      'Do not invent details',
      'Structure: Apparatus first, then Method',
      'Always include reference numerals in parentheses',
      'Use non-limiting language'
    ]
  },

  'best_mode': {
    instruction: `**Role:** Patent Attorney (US/India Compliance).

**Task:** Explicitly describe the preferred embodiment.

**Input Data:** {{PREFERRED_PARAMS}}, {{BEST_EXAMPLE}}

**Drafting Logic:**

1. **Identify:** Select the most detailed example provided in the input.

2. **Flagging:** Introduce it with: *"In a preferred non-limiting embodiment..."* or *"According to the best mode contemplated..."*

3. **Detail:** Include specific metrics (e.g., "using a 12V battery", "using the AES-256 algorithm") to satisfy the 'Best Mode' requirement.`,
    constraints: [
      'Use most detailed example from input',
      'Include specific metrics/parameters',
      'Introduce with preferred embodiment language',
      'Maximum 1 paragraph'
    ]
  },

  'industrial_applicability': {
    instruction: `**Role:** EPO/PCT Agent.

**Task:** Statement of utility.

**Input Data:** {{USE_CASES}}

**Drafting Logic:**

1. **Statement:** Explicitly state the field of use. *"The present subject matter is suitable for use in the field of [Industry]..."*

2. **Capability:** State *how* it is used. *"The system can be manufactured and utilized to [Function]..."*`,
    constraints: [
      'State field of use explicitly',
      'State how it is used/capable',
      'Maximum 1 paragraph'
    ]
  },

  'claims': {
    instruction: `**Role:** Claim Master (Strict Logic).

**Task:** Draft Independent and Dependent Claims.

**Input Data:** {{NOVELTY_POINT}}, {{ELEMENT_LIST}}

**Drafting Logic (Self-Correction):**

1. **Draft:** Write the Independent Claim using "comprising".

2. **Antecedent Check (Mandatory):** Scan the text.

   * *Correction:* If you wrote "the widget" but haven't introduced "a widget" earlier in the same claim, change "the" to "a".

3. **Broadening:** Ensure no unnecessary adjectives are used in the main claim (e.g., use "fastener" instead of "steel screw").`,
    constraints: [
      'Use "comprising" for open-ended claims',
      'Perform antecedent check and correction',
      'Avoid unnecessary adjectives in independent claims',
      'Use numbered format'
    ]
  },

  'abstract': {
    instruction: `**Role:** Abstract Specialist.

**Task:** Concise summary for publication.

**Input Data:** {{FULL_DRAFT_TEXT}}

**Drafting Logic:**

1. **Constraint:** Count words. Must be 50-150 words.

2. **Formatting:** Single paragraph.

3. **Editing:** Remove "legal" phrases like *"The present invention relates to..."* Start directly with the subject: *"A system for [Function] is disclosed, comprising..."*

4. **Reference Numerals:** If Figure 1 is the main figure, optionally add numerals in parentheses after main elements (e.g., "A lever (10)...").`,
    constraints: [
      '50-150 words',
      'Single paragraph',
      'Remove legal phrases',
      'Start directly with subject',
      'Optionally include reference numerals'
    ]
  }
};

export interface IdeaNormalizationRequest {
  rawIdea: string;
  title: string;
  tenantId?: string;
}

export interface IdeaNormalizationResult {
  success: boolean;
  normalizedData?: any;
  extractedFields?: {
    searchQuery?: string;
    problem?: string;
    objectives?: string;
    components?: any[];
    logic?: string;
    inputs?: string;
    outputs?: string;
    variants?: string;
    inventionType?: string[];
      bestMethod?: string;
      fieldOfRelevance?: string;
      subfield?: string;
      recommendedFocus?: string;
      complianceNotes?: string;
      drawingsFocus?: string;
      claimStrategy?: string;
      riskFlags?: string;
      abstract?: string;
      cpcCodes?: string[];
      ipcCodes?: string[];
  };
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

export interface ComponentValidationResult {
  valid: boolean;
  components?: any;
  errors?: string[];
}

export interface PlantUMLGenerationResult {
  success: boolean;
  plantumlCode?: string;
  checksum?: string;
  error?: string;
}

export interface AnnexureDraftResult {
  success: boolean;
  draft?: {
    title: string;
    fieldOfInvention?: string;
    crossReference?: string;
    background?: string;
    summary?: string;
    briefDescriptionOfDrawings?: string;
    detailedDescription?: string;
    bestMethod?: string;
    claims?: string;
    abstract?: string;
    listOfNumerals?: string;
    fullText: string;
  };
  isValid?: boolean;
  validationReport?: any;
  llmPrompt?: string;
  llmResponse?: any;
  tokensUsed?: number;
  error?: string;
}

interface SectionPromptContext {
  jurisdiction: string;
  countryProfile?: any | null;
  baseStyle?: any | null;
  sectionPrompt?: { instruction?: string; constraints?: string[] } | null;
  sectionRules?: any | null;
  sectionMeta?: any | null;
  globalRules?: any | null;
  sectionChecks?: any[] | null;
  crossChecksFrom?: any[] | null;
  claimsRules?: any | null;
  // Writing sample for example-based style mimicry
  writingSample?: WritingSampleContext | null;
  userId?: string | null;
  usePersonaStyle?: boolean;
}

export interface SectionGenerationResult {
  success: boolean;
  generated?: Record<string, string>;
  debugSteps?: Array<{ step: string; status: 'ok'|'fail'; meta?: any }>;
  llmMeta?: { model?: string; promptHash?: string; params?: any };
  error?: string;
}

export class DraftingService {
  private static sectionKeyMap: Record<string, string[]> = {
    title: ['title'],
    abstract: ['abstract'],
    fieldOfInvention: ['fieldOfInvention', 'field', 'technical_field', 'field_of_invention', 'technical_field_of_the_invention'],
    background: ['background', 'background_art'],
    preamble: ['preamble', 'opening_statement'],
    crossReference: ['cross_reference', 'cross reference', 'cross-reference'],
    summary: ['summary', 'summary_of_invention'],
    briefDescriptionOfDrawings: ['briefDescriptionOfDrawings', 'brief_drawings', 'brief_description_of_drawings'],
    detailedDescription: ['detailedDescription', 'detailed_description', 'description'],
    modeOfCarryingOut: ['mode_of_carrying_out', 'mode_for_carrying_out', 'modes_for_carrying_out', 'specific_mode_for_carrying_out_the_invention'],
    bestMethod: ['bestMethod', 'best_mode', 'best_method'],
    claims: ['claims'],
    objectsOfInvention: ['objects', 'objects_of_invention', 'object_of_the_invention'],
    technicalProblem: ['technical_problem', 'problem_to_be_solved'],
    technicalSolution: ['technical_solution', 'solution_to_problem'],
    advantageousEffects: ['advantageous_effects', 'advantages', 'effects_of_invention'],
    industrialApplicability: ['industrialApplicability', 'industrial_applicability', 'utility'],
    listOfNumerals: ['listOfNumerals', 'reference_numerals', 'reference_signs', 'list_of_numerals']
  }

  private static mapToInternalKey(candidate: string): string | undefined {
    const lc = (candidate || '').toLowerCase()
    for (const [internal, aliases] of Object.entries(this.sectionKeyMap)) {
      if (aliases.map(a => a.toLowerCase()).includes(lc) || internal.toLowerCase() === lc) {
        return internal
      }
    }
    return undefined
  }

  /**
   * Execute drafting workflow - creates session and initializes drafting process
   */
  static async executeDrafting(params: {
    patentId: string;
    jwtToken: string;
    mode: 'standalone' | 'with_novelty_assessment';
    assessmentId?: string;
    title: string;
    problem: string;
    solution: string;
    technicalFeatures: any[];
    jurisdiction: string;
    filingType: string;
    inventionType?: string;
  }): Promise<{ success: boolean; draftId?: string; error?: string }> {
    try {
      // Verify JWT token
      const payload = verifyJWT(params.jwtToken);
      if (!payload || !payload.email) {
        return { success: false, error: 'Invalid authentication token' };
      }

      const user = await prisma.user.findUnique({ where: { email: payload.email } });
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Verify patent access
      const patent = await prisma.patent.findFirst({
        where: {
          id: params.patentId,
          OR: [
            { createdBy: user.id },
            {
              project: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { userId: user.id } } }
                ]
              }
            }
          ]
        }
      });

      if (!patent) {
        return { success: false, error: 'Patent not found or access denied' };
      }

      // Create drafting session
      const session = await prisma.draftingSession.create({
        data: {
          patentId: params.patentId,
          userId: user.id
        }
      });

      // Create initial idea record with the input data
      await prisma.ideaRecord.create({
        data: {
          sessionId: session.id,
          title: params.title,
          rawInput: JSON.stringify({
            mode: params.mode,
            assessmentId: params.assessmentId,
            title: params.title,
            problem: params.problem,
            solution: params.solution,
            technicalFeatures: params.technicalFeatures,
            jurisdiction: params.jurisdiction,
            filingType: params.filingType,
          }),
          normalizedData: {}
        }
      });

      // Normalize the idea first
      const normalizationResult = await this.normalizeIdea(
        `Title: ${params.title}\nProblem: ${params.problem}\nSolution: ${params.solution}\nTechnical Features: ${params.technicalFeatures.join(', ')}`,
        params.title,
        user.tenantId || undefined,
        undefined,
        params.inventionType
      );

      if (!normalizationResult.success) {
        return { success: false, error: normalizationResult.error || 'Failed to normalize idea' };
      }

      // Persist normalization output on the idea record for downstream use (including archetype)
      await prisma.ideaRecord.update({
        where: { sessionId: session.id },
        data: {
          normalizedData: normalizationResult.normalizedData || {},
          problem: normalizationResult.extractedFields?.problem,
          objectives: normalizationResult.extractedFields?.objectives,
          components: normalizationResult.extractedFields?.components || [],
          logic: normalizationResult.extractedFields?.logic,
          inputs: normalizationResult.extractedFields?.inputs,
          outputs: normalizationResult.extractedFields?.outputs,
          variants: normalizationResult.extractedFields?.variants,
          bestMethod: normalizationResult.extractedFields?.bestMethod,
          abstract: normalizationResult.extractedFields?.abstract,
          searchQuery: normalizationResult.extractedFields?.searchQuery,
          cpcCodes: normalizationResult.extractedFields?.cpcCodes || [],
          ipcCodes: normalizationResult.extractedFields?.ipcCodes || [],
          llmPromptUsed: normalizationResult.llmPrompt,
          llmResponse: normalizationResult.llmResponse,
          tokensUsed: normalizationResult.tokensUsed
        }
      })

      // Update session with normalized data
      await prisma.draftingSession.update({
        where: { id: session.id },
        data: {
          referenceMap: normalizationResult.extractedFields
            ? {
                create: {
                  components: normalizationResult.extractedFields.components || [],
                  isValid: false,
                }
              }
            : undefined
        }
      });

      return { success: true, draftId: session.id };

    } catch (error) {
      console.error('executeDrafting error:', error);
      return { success: false, error: 'Internal server error during drafting initialization' };
    }
  }

  /**
   * Get drafting history for a patent (placeholder implementation)
   */
  static async getDraftingHistory(patentId: string, userId: string): Promise<any[]> {
    try {
      // TODO: Implement proper drafting history retrieval
      // For now, return empty array
      return [];
    } catch (error) {
      console.error('Get drafting history error:', error);
      throw error;
    }
  }

  /**
   * Normalize raw invention idea using LLM
   */
  static async normalizeIdea(
    rawIdea: string,
    title: string,
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    areaOfInvention?: string,
    allowRefine: boolean = true
  ): Promise<IdeaNormalizationResult> {
    try {
      // Debug logging
      console.log('DraftingService.normalizeIdea called with:', {
        rawIdeaLength: rawIdea.length,
        title,
        tenantId
      });

      // Validate input length - limit to prevent token overflow
      if (rawIdea.length > 5000) {
        return {
          success: false,
          error: 'Idea text exceeds maximum length of 5,000 characters. Please shorten your description.'
        };
      }
      
      const domainExpertise = (areaOfInvention && areaOfInvention.trim()) ? ` with core expertise in ${areaOfInvention.trim()}` : '';
      const refinementNote = allowRefine
        ? ''
        : '\n- Do NOT invent or add new components/claims beyond what is provided. Preserve the user-described invention faithfully; paraphrase only for clarity.';

      const prompt = `You are an expert patent attorney specializing in drafting and structuring patent disclosures across all domains (mechanical, electrical, software, biotech, chemistry, medical devices, materials, aerospace, etc.)${domainExpertise}.

Task: Read the invention description and output ONLY a valid JSON object capturing the key drafting elements.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use concise, formal patent language suitable for specification drafting.
- Keep each field as a single string (no arrays), except: "components" (array of objects), "cpcCodes" (array of strings), "ipcCodes" (array of strings), and "inventionType" (array of archetype tags).
- Include "inventionType" as the archetype classification (one or more of: MECHANICAL, ELECTRICAL, SOFTWARE, CHEMICAL, BIO, GENERAL). Allow multiple using either an array or a "+"-joined string (e.g., "MECHANICAL+SOFTWARE"); uppercase the values.
- Additionally, provide a compact "searchQuery" string (<= 25 words) optimized for PQAI prior-art search. This should be plain text, ASCII-safe, no quotes, no brackets, no CPC/IPC codes, no labels. Include only essential technical nouns/verbs.
- Use double-quoted keys and strings; avoid line breaks mid-sentence when possible.
 - Keep content succinct; avoid redundancy and marketing language.
 - Components: return up to 8 items maximum by default (more only if essential). Use hierarchy when helpful (module → submodule → sub-submodule). Keep each item's description to one sentence.${refinementNote}

TITLE: ${title}

INVENTION DESCRIPTION:
${rawIdea}

Respond in this exact JSON shape:
{
  "searchQuery": "concise plain-text search query (G25 words, ASCII, no quotes/brackets)",
  "problem": "concise statement of the technical problem",
  "objectives": "succinct objectives of the invention",
  "components": [{
    "name": "component name",
    "type": "MAIN_CONTROLLER|SUBSYSTEM|MODULE|INTERFACE|SENSOR|ACTUATOR|PROCESSOR|MEMORY|DISPLAY|COMMUNICATION|POWER_SUPPLY|OTHER",
    "description": "technical role in the system",
    "inputs": "optional: key inputs/signals/data",
    "outputs": "optional: key outputs/actions/data",
    "dependencies": "optional: other components relied on",
    "figureHint": "optional: what to highlight in figures",
    "parent": "optional: parent component name if this is a submodule",
    "level": "optional: 0 for root modules, 1 for child, 2 for grandchild, etc.",
    "sequence": "optional: order within its level (1-based)",
    "numberingHint": "optional: preferred hundreds bucket e.g., 100|200|300|400|500|600|700|800|900"
  }],
  "inventionType": ["MECHANICAL", "SOFTWARE"],
  "logic": "how components interact to achieve the objectives",
  "inputs": "key inputs/signals/data required",
  "outputs": "key outputs/actions/data produced",
  "variants": "notable embodiments or alternatives",
  "bestMethod": "preferred implementation at filing date",
  "fieldOfRelevance": "primary domain (e.g., Mechanical, Electrical, Software, Medical Device, Biotech, Chemistry, Materials, Aerospace)",
  "subfield": "more specific area (e.g., fluid mechanics, image processing, polymer chemistry)",
  "recommendedFocus": "what to emphasize in drafting for this field",
  "complianceNotes": "regulatory or standards-related notes if relevant",
  "drawingsFocus": "what figures should emphasize given the field",
  "claimStrategy": "high-level claim drafting approach suited to this field",
  "riskFlags": "any potential enablement or patentability risks to watch",
  "abstract": "G150 words abstract that begins exactly with the title; neutral tone; no claims/advantages/numerals",
  "cpcCodes": ["primary CPC code like H04L 29/08", "optional secondary"],
  "ipcCodes": ["primary IPC code like G06F 17/30", "optional secondary"]
}`;

      console.log('Calling LLM gateway with taskCode: LLM2_DRAFT');

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const llmResult = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId, ...(allowRefine ? { temperature: 0.4 } : { temperature: 0.0 }) },
        idempotencyKey: crypto.randomUUID()
      });

      console.log('LLM gateway result:', {
        success: llmResult.success,
        hasResponse: !!llmResult.response,
        error: llmResult.error?.message
      });

      if (!llmResult.success || !llmResult.response) {
        return {
          success: false,
          error: llmResult.error?.message || 'LLM processing failed'
        };
      }

      // Parse LLM response (robust JSON extraction)
      let normalizedData;
      try {
        const output = (llmResult.response.output || '').trim();
        console.log('Raw LLM output (first 500 chars):', output.substring(0, 500));
        console.log('Raw LLM output length:', output.length);

        let jsonText = output;

        // If fenced with backticks, strip the outer fence even if closing fence is missing
        const fenceStart = jsonText.indexOf('```');
        if (fenceStart !== -1) {
          jsonText = jsonText.slice(fenceStart + 3); // drop opening ```
          // drop optional language tag like 'json'
          jsonText = jsonText.replace(/^json\s*/i, '');
          const fenceEnd = jsonText.indexOf('```');
          if (fenceEnd !== -1) {
            jsonText = jsonText.slice(0, fenceEnd);
          }
        }

        // Trim to the JSON object boundaries
        const startBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (startBrace !== -1) {
          jsonText = lastBrace !== -1 && lastBrace > startBrace
            ? jsonText.slice(startBrace, lastBrace + 1)
            : jsonText.slice(startBrace);
        }

        // Cleanup common JSON issues
        jsonText = jsonText
          .replace(/`+/g, '') // remove stray backticks
          .replace(/,(\s*[}\]])/g, '$1') // remove trailing commas
          .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, ''); // remove control chars

        console.log('Extracted JSON string (first 500 chars):', jsonText.substring(0, 500));

        // First parse attempt
        try {
          normalizedData = JSON.parse(jsonText);
        } catch (firstErr) {
          // Fallback: attempt to quote unquoted keys
          const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
          normalizedData = JSON.parse(quotedKeys);
        }

        // Normalize component hierarchy if provided
        if (Array.isArray(normalizedData?.components)) {
          normalizedData.components = normalizedData.components.map((c: any, idx: number) => ({
            ...c,
            level: typeof c?.level === 'number' && c.level >= 0 ? c.level : 0,
            sequence: typeof c?.sequence === 'number' && c.sequence > 0 ? c.sequence : (idx + 1),
          }))
        }

        if (!normalizedData || typeof normalizedData !== 'object') {
          throw new Error('LLM did not return a valid object');
        }

      } catch (parseError) {
        console.error('LLM response parsing error:', parseError);
        console.error('Full LLM output:', llmResult.response.output);
        // Provide clearer error when response was truncated
        const truncated = llmResult.response.metadata?.finishReason === 'MAX_TOKENS';
        return {
          success: false,
          error: truncated
            ? 'LLM response was truncated and could not be parsed as JSON. Please try again with a shorter idea.'
            : `Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          llmResponse: llmResult.response,
        };
      }

      // Extract fields for easy database querying
      // Auto-detect archetype/invention type so downstream drafting/diagramming can use it without user input
      const detectedArchetype = this.normalizeArchetypeList(
        normalizedData?.inventionType,
        normalizedData?.fieldOfRelevance || areaOfInvention || ''
      )
      normalizedData.inventionType = detectedArchetype

      const extractedFields = {
        searchQuery: typeof normalizedData.searchQuery === 'string' ? String(normalizedData.searchQuery).trim() : undefined,
        problem: normalizedData.problem,
        objectives: normalizedData.objectives,
        components: normalizedData.components,
        logic: normalizedData.logic,
        inputs: normalizedData.inputs,
        outputs: normalizedData.outputs,
        variants: normalizedData.variants,
        inventionType: detectedArchetype,
        bestMethod: normalizedData.bestMethod,
        fieldOfRelevance: normalizedData.fieldOfRelevance,
        subfield: normalizedData.subfield,
        recommendedFocus: normalizedData.recommendedFocus,
        complianceNotes: normalizedData.complianceNotes,
        drawingsFocus: normalizedData.drawingsFocus,
        claimStrategy: normalizedData.claimStrategy,
        riskFlags: normalizedData.riskFlags,
        abstract: normalizedData.abstract,
        cpcCodes: Array.isArray(normalizedData.cpcCodes) ? normalizedData.cpcCodes.map((s: any) => String(s).trim()).filter(Boolean) : undefined,
        ipcCodes: Array.isArray(normalizedData.ipcCodes) ? normalizedData.ipcCodes.map((s: any) => String(s).trim()).filter(Boolean) : undefined
      };

      return {
        success: true,
        normalizedData,
        extractedFields,
        llmPrompt: prompt,
        llmResponse: llmResult.response,
        tokensUsed: llmResult.response.outputTokens
      };

    } catch (error) {
      console.error('Idea normalization error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Idea normalization failed'
      };
    }
  }

  // New: Generate specific annexure sections with guardrails and debug steps
  static async generateSections(
    session: any,
    sections: string[],
    instructions?: Record<string, string>,
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    selectedPatents?: any[],
    jurisdiction: string = 'IN',
    preferredLanguage?: string
  ): Promise<SectionGenerationResult> {
    const debugSteps: Array<{ step: string; status: 'ok'|'fail'; meta?: any }> = []
    try {
      // Step: gather context
      const idea = session.ideaRecord || {}
      const referenceMap = session.referenceMap || { components: [] }
      const jurisdictionCode = (jurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'IN').toUpperCase()
      let countryProfile: any = await getCountryProfile(jurisdictionCode)
      if (preferredLanguage) {
        const langs: string[] = Array.isArray((countryProfile as any)?.profileData?.meta?.languages)
          ? (countryProfile as any).profileData.meta.languages
          : []
        const reordered = [preferredLanguage, ...langs.filter(l => l !== preferredLanguage)]
        countryProfile = {
          ...countryProfile,
          profileData: {
            ...(countryProfile as any)?.profileData || {},
            meta: {
              ...(countryProfile as any)?.profileData?.meta || {},
              languages: reordered
            }
          }
        }
      }
      const baseStyle = countryProfile ? await getBaseStyle(jurisdictionCode) : null
      const globalRules = countryProfile ? await getGlobalRules(jurisdictionCode) : null
      if (!countryProfile) {
        debugSteps.push({ step: 'jurisdiction_fallback', status: 'fail', meta: { jurisdiction: jurisdictionCode } })
      }

      const crossSectionChecks = countryProfile?.profileData?.validation?.crossSectionChecks || []
      const claimsRules = countryProfile?.profileData?.rules?.claims || null

      const sectionResources: Record<string, { prompt: any; rules: any; meta: any; altKeys: string[]; checks?: any[]; cross?: any[]; claimsRules?: any; importFiguresDirectly?: boolean }> = {}
      const sessionId = session?.id || session?._id || null // Get session ID for user instructions
      for (const s of sections) {
        const sectionMeta = this.resolveSectionMeta(countryProfile, s)
        const sectionKey = sectionMeta?.id || this.getFallbackSectionKey(s)
        // Pass sessionId to get merged prompt with user instructions (highest priority)
        const promptCfg = sectionKey ? await getDraftingPrompts(jurisdictionCode, sectionKey, sessionId) : null
        const sectionRules = sectionKey ? await getSectionRules(jurisdictionCode, sectionKey) : null
        const checks = countryProfile?.profileData?.validation?.sectionChecks?.[sectionKey] || countryProfile?.profileData?.validation?.sectionChecks?.[s]
        const cross = Array.isArray(crossSectionChecks) ? crossSectionChecks.filter((c: any) => (c?.from === sectionKey) || (c?.from === s)) : []
        
        // Check if this section should import figures directly without LLM
        // Priority: 1. Database CountrySectionPrompt, 2. JSON country profile
        const sectionPromptCfg = countryProfile?.profileData?.prompts?.sections?.[s] || 
                                 countryProfile?.profileData?.prompts?.sections?.[sectionKey] ||
                                 countryProfile?.profileData?.prompts?.sections?.['briefDescriptionOfDrawings']
        // Check database first (via promptCfg which comes from getDraftingPrompts)
        const dbImportFigures = (promptCfg as any)?.importFiguresDirectly === true
        const jsonImportFigures = sectionPromptCfg?.importFiguresDirectly === true
        const importFiguresDirectly = dbImportFigures || jsonImportFigures
        
        sectionResources[s] = {
          prompt: promptCfg,
          rules: sectionRules,
          meta: sectionMeta,
          altKeys: Array.isArray(sectionMeta?.canonicalKeys) ? sectionMeta.canonicalKeys.map((k: string) => k.toLowerCase()) : [],
          checks: Array.isArray(checks) ? checks : undefined,
          cross: cross.length ? cross : undefined,
          claimsRules: s === 'claims' ? claimsRules : undefined,
          importFiguresDirectly
        }
        if (!sectionMeta) {
          debugSteps.push({ step: `section_unmapped_${s}`, status: 'fail', meta: { jurisdiction: jurisdictionCode } })
        }
      }

      // Gather prior art data for background section
      const manualPriorArt = (session as any).manualPriorArt || null
      const rawRelatedArtSelections = Array.isArray(session.relatedArtSelections)
        ? session.relatedArtSelections
        : []
      // Only treat USER_SELECTED records as approved prior art for drafting
      const relatedArtSelections = rawRelatedArtSelections.filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )
      const aiAnalysis = (session as any).aiAnalysisData || {}

      // Strategy: Use user-selected patents first; fallback to any available related art if none explicitly marked
      let selectedPriorArtPatents: any[] = []

      const userSelectedPool = rawRelatedArtSelections.filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )
      const fallbackPool = userSelectedPool.length ? userSelectedPool : rawRelatedArtSelections

      if (selectedPatents && selectedPatents.length > 0) {
        // User explicitly picked patents in the UI
        selectedPriorArtPatents = selectedPatents
          .map((sel: any) => {
            const fullPatentData =
              rawRelatedArtSelections.find((r: any) => r.patentNumber === sel.patentNumber) || sel
            return {
              ...fullPatentData,
              aiSummary: aiAnalysis[sel.patentNumber]?.aiSummary || '',
              noveltyComparison: aiAnalysis[sel.patentNumber]?.noveltyComparison || '',
              noveltyThreat: aiAnalysis[sel.patentNumber]?.noveltyThreat || 'unknown'
            }
          })
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
          .slice(0, 6)
      } else if (manualPriorArt?.useOnlyManualPriorArt) {
        // Respect user preference: no AI/related art
        selectedPriorArtPatents = []
      } else {
        // Use the best available pool (user-selected if present; otherwise all related art)
        selectedPriorArtPatents = fallbackPool
          .map((sel: any) => ({
            ...sel,
            aiSummary: aiAnalysis[sel.patentNumber]?.aiSummary || '',
            noveltyComparison: aiAnalysis[sel.patentNumber]?.noveltyComparison || '',
            noveltyThreat: aiAnalysis[sel.patentNumber]?.noveltyThreat || 'unknown'
          }))
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
          .slice(0, 6)
      }

      // Merge figures from plans AND diagram sources (regardless of upload status)
      // This ensures ALL figures are available for drafting, not just uploaded ones
      const planFigures = (session.figurePlans || []).map((f: any) => ({
        figureNo: f.figureNo,
        title: this.sanitizeFigureTitle(f.title) || `Figure ${f.figureNo}`
      }))
      // Include ALL diagram sources, not just uploaded ones - a figure with PlantUML code is still valid
      const diagramFigures = (session.diagramSources || []).map((d: any) => {
          const found = planFigures.find((f: any) => f.figureNo === d.figureNo)
          const sanitized = this.sanitizeFigureTitle(found?.title || d.title)
          return { figureNo: d.figureNo, title: sanitized || `Figure ${d.figureNo}` }
        })
      const mergedByNo = new Map<number, any>()
      // Add all plan figures first
      for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
      // Add/overwrite with diagram figures (may have additional metadata or corrected titles)
      for (const f of diagramFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
      const figures = Array.from(mergedByNo.values()).sort((a:any,b:any)=>a.figureNo-b.figureNo)
      debugSteps.push({
        step: 'load_context',
        status: 'ok',
        meta: {
          ideaLoaded: !!idea,
          componentsCount: referenceMap.components?.length || 0,
          figuresCount: figures.length,
          manualPriorArtProvided: !!manualPriorArt,
          manualPriorArtPreview: manualPriorArt?.manualPriorArtText ? String(manualPriorArt.manualPriorArtText).slice(0, 140) + (String(manualPriorArt.manualPriorArtText).length > 140 ? '…' : '') : null,
          useOnlyManualPriorArt: !!manualPriorArt?.useOnlyManualPriorArt,
          useManualAndAISearch: !!manualPriorArt?.useManualAndAISearch,
          selectedPriorArtPatentsCount: selectedPriorArtPatents.length,
          selectedPriorArtPreview: selectedPriorArtPatents.slice(0, 6).map((p: any) => ({
            patentNumber: p.patentNumber || p.pn || 'Unknown',
            noveltyThreat: p.noveltyThreat,
            hasAiSummary: !!p.aiSummary,
            hasNoveltyComparison: !!p.noveltyComparison
          }))
        }
      })
      debugSteps.push({
        step: 'jurisdiction_context',
        status: 'ok',
        meta: { jurisdiction: jurisdictionCode, hasCountryProfile: !!countryProfile }
      })

      // Build payload available across sections
      const payload = { idea, referenceMap, figures, approved: session.annexureDrafts?.[0] || {}, instructions: instructions || {}, manualPriorArt, selectedPriorArtPatents }

      // Step: call LLM per section with single-section schema
      const request = { headers: requestHeaders || {} }
      const generated: Record<string, string> = {}
      let llmMeta: any = undefined

      for (const s of sections) {
        // Check if this section should import figures directly without LLM
        if (sectionResources[s]?.importFiguresDirectly && figures.length > 0) {
          // Direct import: Format figures as Brief Description of Drawings
          // This preserves the exact titles from figure planning stage
          const figureLines = figures.map((f: any) => {
            const figNo = f.figureNo
            let title = f.title || `a view of Figure ${figNo}`
            
            // Clean up title: remove any existing "FIG. X is" prefix if present
            title = title.replace(/^(FIG\.?\s*\d+\s*(is\s*)?|Figure\s*\d+\s*(is\s*)?)/i, '').trim()
            
            // Ensure title starts with an article if it doesn't already
            if (!/^(a|an|the)\s/i.test(title)) {
              // Check if first word suggests it needs 'a' or 'an'
              const firstWord = title.split(/\s+/)[0]?.toLowerCase() || ''
              const needsAn = /^[aeiou]/i.test(firstWord)
              title = `${needsAn ? 'an' : 'a'} ${title}`
            }
            
            // Ensure proper punctuation
            const line = `FIG. ${figNo} is ${title}`
            return line.endsWith('.') ? line : `${line}.`
          }).join('\n\n')
          
          generated[s] = figureLines
          debugSteps.push({ 
            step: `direct_import_${s}`, 
            status: 'ok', 
            meta: { 
              figuresCount: figures.length, 
              method: 'importFiguresDirectly',
              preview: figureLines.substring(0, 200) 
            } 
          })
          continue // Skip LLM call for this section
        }

        // Fetch writing sample for example-based style mimicry (if persona style is enabled)
        const usePersonaStyle = (session as any).usePersonaStyle !== false // Default to true unless explicitly disabled
        let writingSample: WritingSampleContext | null = null
        if (usePersonaStyle && session?.userId) {
          try {
            writingSample = await getWritingSample(session.userId, s, jurisdictionCode)
            if (writingSample) {
              debugSteps.push({ 
                step: `writing_sample_${s}`, 
                status: 'ok', 
                meta: { 
                  jurisdiction: writingSample.jurisdiction,
                  isUniversal: writingSample.isUniversal,
                  wordCount: writingSample.sampleText.split(/\s+/).length
                } 
              })
            }
          } catch (err) {
            console.warn(`[DraftingService] Failed to get writing sample for ${s}:`, err)
          }
        }

        const prompt = this.buildSectionPrompt(s, payload, {
          jurisdiction: jurisdictionCode,
          countryProfile,
          baseStyle,
          sectionPrompt: sectionResources[s]?.prompt,
          sectionRules: sectionResources[s]?.rules,
          sectionMeta: sectionResources[s]?.meta,
          globalRules,
          sectionChecks: sectionResources[s]?.checks,
          crossChecksFrom: sectionResources[s]?.cross,
          claimsRules: sectionResources[s]?.claimsRules,
          writingSample,
          userId: session?.userId,
          usePersonaStyle
        })
        // Add debug info about prompt injection (B+T+U)
        const promptDebug = sectionResources[s]?.prompt?.debug
        debugSteps.push({ 
          step: `build_prompt_${s}`, 
          status: 'ok',
          meta: {
            promptInjection: promptDebug ? {
              B: promptDebug.hasBase,
              T: promptDebug.hasTopUp,
              U: promptDebug.hasUser,
              source: promptDebug.topUpSource,
              key: promptDebug.sectionKey,
              strategy: promptDebug.mergeStrategy
            } : { B: true, T: false, U: false, source: null }
          }
        })

        // Increase tokens for long sections
        const sectionMaxTokens = s === 'detailedDescription' ? 6000 : undefined

        const result = await llmGateway.executeLLMOperation(request, {
          taskCode: 'LLM2_DRAFT',
          prompt,
          parameters: { tenantId, ...(sectionMaxTokens && { maxOutputTokens: sectionMaxTokens }) },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            patentId: session.patentId,
            sessionId: session.id,
            section: s,
            purpose: 'draft_section'
          }
        })
        if (!result.success || !result.response) {
          debugSteps.push({ step: `llm_call_${s}`, status: 'fail', meta: { error: result.error?.message } })
          return { success: false, error: result.error?.message || `LLM failed for ${s}`, debugSteps }
        }
        debugSteps.push({ step: `llm_call_${s}`, status: 'ok', meta: { outputTokens: result.response.outputTokens } })

        // Parse single-section JSON (robust)
        let normalizedData: any
        let parsed: any
        try {
          const output = (result.response.output || '').trim();
          console.log('Raw LLM output (first 500 chars):', output.substring(0, 500));
          console.log('Raw LLM output length:', output.length);

          // Merge any fenced JSON blocks if present
          const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
          let merged: Record<string, any> = {};
          let fenceMatch: RegExpExecArray | null;
          let fenceCount = 0;
          while ((fenceMatch = fenceRegex.exec(output)) !== null) {
            let block = (fenceMatch[1] || '').trim();
            if (!block) continue;
            block = block
              .replace(/,(\s*[}\]])/g, '$1')
              .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');
            try {
              let obj: any;
              try { obj = JSON.parse(block); } 
              catch { obj = JSON.parse(block.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')); }
              if (obj && typeof obj === 'object') { merged = { ...merged, ...obj }; fenceCount++; }
            } catch {}
          }

          if (fenceCount > 0) {
            parsed = merged
            normalizedData = merged
            console.log('Merged JSON blocks from fences:', Object.keys(merged))
          } else {
            let jsonText = output
            const fenceStart = jsonText.indexOf('```')
            if (fenceStart !== -1) {
              jsonText = jsonText.slice(fenceStart + 3)
              jsonText = jsonText.replace(/^json\s*/i, '')
              const fenceEnd = jsonText.indexOf('```')
              if (fenceEnd !== -1) jsonText = jsonText.slice(0, fenceEnd)
            }
            const startBrace = jsonText.indexOf('{')
            const lastBrace = jsonText.lastIndexOf('}')
            if (startBrace !== -1) {
              jsonText = lastBrace !== -1 && lastBrace > startBrace ? jsonText.slice(startBrace, lastBrace + 1) : jsonText.slice(startBrace)
            }
            jsonText = jsonText.replace(/`+/g, '').replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')

            // Handle unescaped newlines in JSON strings by temporarily replacing them
            const hasUnescapedNewlines = /"[^"]*\n[^"]*"/.test(jsonText)
            if (hasUnescapedNewlines) {
              // Replace unescaped newlines in string values with escaped versions
              jsonText = jsonText.replace(/"([^"]*(?:\n|\r|\r\n)[^"]*)"/g, (match, content) => {
                return '"' + content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\r\n/g, '\\r\\n') + '"'
              })
            }

            try { normalizedData = JSON.parse(jsonText) }
            catch {
              const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
              normalizedData = JSON.parse(quotedKeys)
            }
            parsed = normalizedData
          }
          debugSteps.push({ step: `parse_${s}`, status: 'ok', meta: { parsingMethod: 'normalizeIdea_style' } })
        } catch (parseErr) {
          debugSteps.push({ step: `parse_${s}`, status: 'fail', meta: { error: parseErr instanceof Error ? parseErr.message : String(parseErr) } })
          return { success: false, error: `Invalid JSON from LLM for ${s}.`, debugSteps }
        }

        // Guardrails + Background D-label normalization
        let val = typeof parsed?.[s] === 'string' ? parsed[s].trim() : ''
        if (!val && sectionResources[s]?.altKeys?.length) {
          for (const alt of sectionResources[s].altKeys) {
            if (typeof parsed?.[alt] === 'string' && parsed[alt].trim()) {
              val = parsed[alt].trim()
              debugSteps.push({ step: `alt_key_used_${s}`, status: 'ok', meta: { alt } })
              break
            }
          }
        }
        if (val && sectionResources[s]?.checks) {
          for (const check of sectionResources[s].checks) {
            if (check?.type === 'maxWords' && typeof check.limit === 'number') {
              const words = val.split(/\s+/)
              if (words.length > check.limit) {
                val = words.slice(0, check.limit).join(' ')
                debugSteps.push({ step: `clip_words_${s}`, status: 'ok', meta: { limit: check.limit } })
              }
            }
            if (check?.type === 'maxChars' && typeof check.limit === 'number') {
              if (val.length > check.limit) {
                val = val.slice(0, check.limit)
                debugSteps.push({ step: `clip_chars_${s}`, status: 'ok', meta: { limit: check.limit } })
              }
            }
          }
        }
        if (s === 'background' && val) {
          // Normalize any D-labels to incremental order of first use and show identifier only on first mention
          const normalizeDLabels = (text: string) => {
            // 1) Find all first mentions: D<digits>( <identifier> ) or D<digits> (<identifier>) or raw identifiers
            const order: string[] = []
            const idForD: Record<string,string> = {}

            // Capture explicit Dn (ID)
            const firstMentionRegex = /\bD(\d+)\s*\(([^)]+)\)/g
            let m: RegExpExecArray | null
            while ((m = firstMentionRegex.exec(text)) !== null) {
              const d = `D${m[1]}`
              const id = m[2].trim()
              if (!order.includes(d)) {
                order.push(d)
                idForD[d] = id
              }
            }

            // If no explicit Dn(ID) found, try to capture bare Dn and then later references won't have IDs
            const bareDRegex = /\bD(\d+)\b/g
            while ((m = bareDRegex.exec(text)) !== null) {
              const d = `D${m[1]}`
              if (!order.includes(d)) order.push(d)
            }

            // 2) Build mapping to sequential D1, D2, ... by order of first use
            const mapOldToNew: Record<string,string> = {}
            order.forEach((old, idx) => { mapOldToNew[old] = `D${idx + 1}` })

            // 3) Replace all Dn labels consistently, preserving first-mention IDs only once
            let replaced = text
            // Replace labels with temp markers to avoid double replace (e.g., D1 -> D2 then D2 again)
            Object.entries(mapOldToNew).forEach(([oldD, newD]) => {
              const tmp = `@@${newD}@@`
              const re = new RegExp(`\\b${oldD}\\b`, 'g')
              replaced = replaced.replace(re, tmp)
            })
            // Drop old parentheses IDs tied to old labels, they'll be reattached on first mention
            replaced = replaced.replace(/@@D(\d+)@@\s*\(([^)]+)\)/g, '@@D$1@@')

            // Now finalize markers back to new labels
            replaced = replaced.replace(/@@(D\d+)@@/g, '$1')

            // 4) Re-attach identifier only to the first occurrence of each new label
            const seen: Set<string> = new Set()
            replaced = replaced.replace(/\b(D\d+)\b(?!\s*\()/g, (match) => {
              if (!seen.has(match) && idForD[order[Object.values(mapOldToNew).indexOf(match)] || '']) {
                seen.add(match)
                const orig = order[Object.values(mapOldToNew).indexOf(match)]
                const id = orig ? idForD[orig] : undefined
                return id ? `${match} (${id})` : match
              }
              return match
            })

            return replaced
          }
          try { val = normalizeDLabels(val) } catch {}
        }
        if (!val) {
          val = this.getFallbackContent(s, payload)
          debugSteps.push({ step: `fallback_${s}`, status: 'ok', meta: { used: true } })
        }
        const approvedTitle = s === 'abstract' ? (payload.approved?.title || idea?.title) : undefined
        let check = this.guardrailCheck(
          s,
          val,
          referenceMap,
          figures,
          approvedTitle,
          { sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules }
        )
        if (!check.ok) {
          debugSteps.push({ step: `critic_${s}`, status: 'fail', meta: { reason: check.reason } })
          const fixed = this.minimalFix(s, val, { reason: check.reason, approvedTitle, referenceMap, figures, sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules })
          if (fixed && fixed.trim() && fixed !== val) {
            val = fixed.trim()
            const recheck = this.guardrailCheck(
              s,
              val,
              referenceMap,
              figures,
              approvedTitle,
              { sectionChecks: sectionResources[s]?.checks, claimsRules: sectionResources[s]?.claimsRules }
            )
            if (recheck.ok) {
              debugSteps.push({ step: `fixer_${s}`, status: 'ok', meta: { applied: true, fixedTo: val.substring(0, 100) + '...' } })
              generated[s] = val
              debugSteps.push({ step: `guard_${s}`, status: 'ok' })
              // Enforce section hard word limits post-guard
              try {
                const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
                if (enforced.clipped) {
                  generated[s] = enforced.text
                  debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
                }
              } catch {}
            } else {
              debugSteps.push({ step: `fixer_${s}`, status: 'fail', meta: { reason: recheck.reason, fixedTo: val.substring(0, 100) + '...' } })
              if (s === 'abstract' && recheck.reason === 'Abstract must not include numerals/figure refs') {
                debugSteps.push({ step: `guard_${s}`, status: 'ok', meta: { note: 'Allowing abstract with numerals for partial generation' } })
                generated[s] = val
                // Enforce section hard word limits post-guard
                try {
                  const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
                  if (enforced.clipped) {
                    generated[s] = enforced.text
                    debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
                  }
                } catch {}
              } else {
                return { success: false, error: `Guardrail failed for ${s}: ${recheck.reason}`, debugSteps }
              }
            }
          } else {
            return { success: false, error: `Guardrail failed for ${s}: ${check.reason}`, debugSteps }
          }
        } else {
          generated[s] = val
          debugSteps.push({ step: `guard_${s}`, status: 'ok' })
          // Enforce section hard word limits post-guard
          try {
            const enforced = this.enforceMaxWords(s, generated[s], sectionResources[s]?.checks, sectionResources[s]?.rules)
            if (enforced.clipped) {
              generated[s] = enforced.text
              debugSteps.push({ step: `limit_enforce_${s}`, status: 'ok', meta: { before: enforced.before, after: enforced.after, maxEnforced: true } })
            }
          } catch {}
        }

        // Save last llmMeta
        llmMeta = {
          modelClass: result.response.modelClass,
          promptHash: crypto.createHash('sha256').update(prompt).digest('hex'),
          params: result.response.metadata
        }
      }

      // Pair safety remains effective if both requested
      if (sections.includes('fieldOfInvention') && sections.includes('background')) {
        if (!generated.fieldOfInvention || !generated.fieldOfInvention.trim()) {
          generated.fieldOfInvention = this.getFallbackContent('fieldOfInvention', payload)
          debugSteps.push({ step: 'pair_guard_fieldOfInvention', status: 'ok' })
        }
        if (!generated.background || !generated.background.trim()) {
          generated.background = this.getFallbackContent('background', payload)
          debugSteps.push({ step: 'pair_guard_background', status: 'ok' })
        }
      }

      // Step: numeral/figure integrity quick check (relaxed for partial sections)
      const fullText = Object.values(generated).join('\n')
      const validation = this.validateDraftConsistency({ fullText }, session)
      const hasInvalidRefs = validation.report.invalidReferences.length > 0
      debugSteps.push({ step: 'integrity_check', status: hasInvalidRefs ? 'fail' : 'ok', meta: validation.report })
      if (hasInvalidRefs) return { success: false, error: 'Numeral/Figure integrity check failed: invalid figure references', debugSteps }

      return { success: true, generated, debugSteps, llmMeta }
    } catch (e) {
      debugSteps.push({ step: 'exception', status: 'fail', meta: { message: e instanceof Error ? e.message : String(e) } })
      return { success: false, error: 'Section generation failed', debugSteps }
    }
  }

  private static resolveSectionMeta(profile: any | null, section: string) {
    if (!profile) return null
    const variants = profile?.profileData?.structure?.variants || []
    const defaultVariantId = profile?.profileData?.structure?.defaultVariant
    const variant = variants.find((v: any) => v.id === defaultVariantId) || variants[0]
    if (!variant?.sections) return null
    const candidates = this.sectionKeyMap[section] || [section]
    return variant.sections.find((s: any) =>
      candidates.some(key => s.id === key || (Array.isArray(s.canonicalKeys) && s.canonicalKeys.includes(key)))
    ) || null
  }

  private static getFallbackSectionKey(section: string): string {
    const candidates = this.sectionKeyMap[section]
    return candidates?.[0] || section
  }

  private static describeVoice(voice?: string): string {
    const val = (voice || '').toLowerCase()
    if (val.includes('impersonal')) return 'impersonal third person'
    if (val.includes('first')) return 'first person (avoid unless required)'
    if (val.includes('active')) return 'active voice'
    return voice || 'impersonal third person'
  }

  private static getSectionGuidance(section: string, sectionRules?: any): { label: string; target?: string } {
    const defaults: Record<string, { label: string; target?: string }> = {
      title: { label: 'Title', target: '<= 15 words' },
      abstract: { label: 'Abstract', target: '130-150 words' },
      preamble: { label: 'Preamble', target: '<= 40 words' },
      objectsOfInvention: { label: 'Objects of the Invention', target: '50-120 words' },
      fieldOfInvention: { label: 'Technical Field', target: '40-80 words' },
      background: { label: 'Background', target: '250-400 words' },
      crossReference: { label: 'Cross-Reference to Related Applications', target: '<= 120 words' },
      summary: { label: 'Summary', target: '120-200 words' },
      technicalProblem: { label: 'Technical Problem', target: '40-80 words' },
      technicalSolution: { label: 'Technical Solution', target: '60-120 words' },
      advantageousEffects: { label: 'Advantageous Effects', target: '60-120 words' },
      briefDescriptionOfDrawings: { label: 'Brief Description of Drawings', target: '80-150 words' },
      detailedDescription: { label: 'Detailed Description', target: '600-1200 words' },
      modeOfCarryingOut: { label: 'Mode of Carrying Out the Invention', target: '300-500 words' },
      bestMethod: { label: 'Best Mode', target: '150-300 words' },
      claims: { label: 'Claims' },
      industrialApplicability: { label: 'Industrial Applicability', target: '80-150 words' },
      listOfNumerals: { label: 'List of Reference Numerals' }
    }
    const base = { ...(defaults[section] || { label: section }) }
    if (sectionRules?.wordRange?.min || sectionRules?.wordRange?.max) {
      const min = sectionRules.wordRange?.min
      const max = sectionRules.wordRange?.max
      base.target = `${min || '~'}-${max || '~'} words`
    } else if (sectionRules?.maxWords) {
      base.target = `<= ${sectionRules.maxWords} words`
    }
    return base
  }

  private static normalizeArchetypeList(input: any, fallbackField?: string): string[] {
    const set = new Set<string>()
    const add = (raw?: string) => {
      if (!raw) return
      String(raw)
        .split('+')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean)
        .forEach((p) => set.add(p))
    }
    if (Array.isArray(input)) input.forEach((v) => add(typeof v === 'string' ? v : String(v)))
    else if (typeof input === 'string') add(input)
    if (set.size === 0 && fallbackField) add(this.determineArchetype(fallbackField))
    if (set.size === 0) set.add('GENERAL')
    if (set.size > 1 && set.has('GENERAL')) set.delete('GENERAL')
    return Array.from(set)
  }

  private static sanitizeFigureTitle(title?: string | null): string {
    const raw = typeof title === 'string' ? title : (title ?? '').toString()
    if (!raw.trim()) return ''
    const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
    let cleaned = raw.replace(cpcIpcPattern, '')
    cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    return cleaned.trim()
  }

  private static determineArchetype(field: string): string {
    const f = field?.toLowerCase() || ''
    if (/(software|computer|internet|app|data|ai|algorithm|blockchain|network|platform|server|cloud|processor)/.test(f)) return 'SOFTWARE'
    if (/(chem|pharma|compound|composition|material|polymer|alloy|drug|molecule|synthesis)/.test(f)) return 'CHEMICAL'
    if (/(bio|gene|cell|protein|dna|rna|medical|diagnostic|therapeutic|antibody|sequence)/.test(f)) return 'BIO'
    if (/(electric|circuit|semiconductor|voltage|power|sensor|transistor|communication|wireless|signal)/.test(f)) return 'ELECTRICAL'
    if (/(mechanic|device|apparatus|tool|machine|engine|structure|fastener|assembly|housing)/.test(f)) return 'MECHANICAL'
    return 'GENERAL'
  }

  private static getArchetypeInstructions(archetype: string): string {
    const base = 'CRITICAL: You are executing a DEEP DRAFTING PROTOCOL. Apply the following mental models where relevant to the component/step being described. Do not force-fit attributes (e.g., do not invent "force transmission" for a static label).'
    
    // Handle hybrid types (e.g., "MECHANICAL+SOFTWARE")
    const types = archetype.split('+')
    let instructions = base + '\n'

    if (types.includes('MECHANICAL')) {
      instructions += `
        [MECHANICAL PROTOCOL]
        For physical assemblies, consider this KINEMATIC CHAIN pattern:
        1. **Geometric Definition**: Define shape, orientation, and connectivity.
        2. **Force/Motion Transmission**: Explain how movement/force flows between parts.
        3. **Constraint Logic**: Describe how degrees of freedom are restricted.
        4. **Material Alternatives**: List functional equivalents (e.g., "fastener -> screw, weld").
      `
    }
    if (types.includes('SOFTWARE')) {
      instructions += `
        [SOFTWARE PROTOCOL]
        For algorithmic steps, consider this DATA-FLOW pattern:
        1. **I/O Contract**: Define inputs and outputs.
        2. **Transformation Logic**: Explain the step-by-step processing.
        3. **State Management**: Describe triggers and state transitions.
        4. **Hardware Tether**: Link logic to physical hardware (processor/memory) for eligibility.
      `
    }
    if (types.includes('CHEMICAL')) {
      instructions += `
        [CHEMICAL PROTOCOL]
        For substances, consider this FORMULATION pattern:
        1. **Range Definitions**: State broad/preferred ranges and optimal values.
        2. **Functional Role**: Explain the technical purpose of the ingredient.
        3. **Equivalents (Markush)**: List chemical analogs with similar function.
        4. **Synthesis Parameters**: Define critical conditions (temp, pressure, pH).
      `
    }
    if (types.includes('ELECTRICAL')) {
      instructions += `
        [ELECTRICAL PROTOCOL]
        For circuits, consider this SIGNAL-PATH pattern:
        1. **Topological Connection**: Describe series/parallel connections.
        2. **Signal Characteristics**: Define voltage/frequency/logic states.
        3. **Operational Logic**: Explain gating or switching behavior.
        4. **Component Values**: Mention typical ratings/values if enabling.
      `
    }
    if (types.includes('BIO')) {
      instructions += `
        [BIO PROTOCOL]
        For biological entities, consider this ENABLEMENT pattern:
        1. **Sequence/Structure**: Refer to IDs or structural formulas.
        2. **Functional Activity**: Quantify the biological effect or affinity.
        3. **Homology/Variants**: Define acceptable identity percentages.
        4. **Preparation**: Reference isolation or synthesis methods.
      `
    }
    
    if (types.includes('GENERAL') || instructions === base + '\n') {
       instructions += `
        [GENERAL PROTOCOL]
        1. Structural/Logical Definition: Define it by connection to neighbors.
        2. Configuration Sprawl: List material/structural alternatives.
        3. Interaction Dynamics: Explain system behavior when this acts.
        4. Reference Chaining: Use phrases like "With simultaneous reference to FIGS. 1 and 2...".
       `
    }

    return instructions
  }

  private static buildSectionPrompt(section: string, payload: any, ctx: SectionPromptContext): string {
    const { idea, referenceMap, figures, approved, instructions, manualPriorArt, selectedPriorArtPatents } = payload

    // Priority: 1. Manually confirmed types (array/string) -> 2. Normalized data -> 3. Auto-detected (regex)
    const archetypeList = this.normalizeArchetypeList(
      idea?.inventionType ?? idea?.normalizedData?.inventionType,
      idea?.fieldOfRelevance || idea?.normalizedData?.fieldOfRelevance || ''
    )
    const archetype = archetypeList.join('+') || 'GENERAL'

    const numerals = (referenceMap?.components || []).map((c: any) => `${c.name} (${c.numeral})`).join(', ')
    const figs = (figures || []).map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
    const instr = (instructions && instructions[section]) ? String(instructions[section]) : 'none'

    const jurisdiction = (ctx?.jurisdiction || 'IN').toUpperCase()
    const countryName = ctx?.countryProfile?.name || jurisdiction
    const officeName = ctx?.countryProfile?.profileData?.meta?.office || 'Patent Office'
    const language = (ctx?.countryProfile?.profileData?.meta?.languages?.[0] || 'English')
    const tone = ctx?.baseStyle?.tone || 'technical, neutral, precise'
    const voice = this.describeVoice(ctx?.baseStyle?.voice || 'impersonal third person')
    const avoid = Array.isArray(ctx?.baseStyle?.avoid) ? ctx.baseStyle.avoid.join(', ') : (ctx?.baseStyle?.avoid || 'marketing language, unsupported advantages, unsubstantiated claims')
    const guidance = this.getSectionGuidance(section, ctx?.sectionRules || undefined)
    const sectionLabel = (guidance as any)?.label || section

    // Handle superset prompts with template variables
    let promptInstruction = ''
    let promptConstraints = ''

    if (ctx?.sectionPrompt?.instruction) {
      promptInstruction = ctx.sectionPrompt.instruction

      // Replace template variables in superset prompts
      const templateVars: Record<string, string> = {
        '{{COUNTRY_CODE}}': jurisdiction,
        '{{FILING_TYPE}}': idea?.filingType || 'Complete', // Default to Complete if not specified
        '{{ABSTRACT_OR_SUMMARY}}': idea?.abstract || idea?.description || idea?.title || 'No summary available',
        '{{INVENTION_TITLE}}': idea?.title || 'Untitled Invention',
        '{{CORE_KEYWORDS}}': (idea?.keywords || idea?.normalizedData?.keywords || []).join(', ') || 'invention, technology',
        '{{PRIOR_ART_SUMMARY}}': manualPriorArt || 'No prior art specified',
        '{{PROBLEM_STATEMENT}}': idea?.problemStatement || idea?.description || 'Technical problem to be solved',
        '{{ADVANTAGES_LIST}}': (idea?.advantages || idea?.benefits || []).join('; ') || 'Improved efficiency, better performance',
        '{{INDEPENDENT_CLAIMS}}': 'Claims data not available', // Would need to be populated from claims section
        '{{KEY_EMBODIMENTS}}': 'Key embodiments data not available', // Would need to be populated from description
        '{{FIGURE_LIST}}': figs || 'No figures available',
        '{{FULL_DISCLOSURE_TEXT}}': idea?.description || idea?.detailedDescription || 'Full disclosure not available',
        '{{ELEMENT_MAP}}': numerals || 'No element mapping available',
        '{{PREFERRED_PARAMS}}': 'Preferred parameters not specified',
        '{{BEST_EXAMPLE}}': 'Best example not specified',
        '{{USE_CASES}}': (idea?.useCases || idea?.applications || []).join('; ') || 'General technical applications',
        '{{NOVELTY_POINT}}': idea?.noveltyPoint || 'Novel technical features',
        '{{ELEMENT_LIST}}': numerals || 'No elements specified',
        '{{FULL_DRAFT_TEXT}}': 'Full draft text not available' // Would need current draft content
      }

      // Replace all template variables
      for (const [key, value] of Object.entries(templateVars)) {
        promptInstruction = promptInstruction.replace(new RegExp(key, 'g'), value)
      }
    }

    if (ctx?.sectionPrompt?.constraints?.length) {
      promptConstraints = `Constraints: ${ctx.sectionPrompt.constraints.join('; ')}`
    }

    const targetLine = (guidance as any)?.target || ''
    const targetDisplay = targetLine ? `Target length: ${targetLine}.` : ''

    const ruleLines: string[] = []
    if (Array.isArray(ctx?.sectionChecks)) {
      for (const c of ctx.sectionChecks) {
        if (c?.type === 'maxWords' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} words.`)
        if (c?.type === 'maxChars' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} characters.`)
        if (c?.type === 'maxCount' && typeof c.limit === 'number') ruleLines.push(`- Do not exceed ${c.limit} items/paragraphs.`)
      }
    }
    if (Array.isArray(ctx?.crossChecksFrom) && ctx.crossChecksFrom.length) {
      for (const c of ctx.crossChecksFrom) {
        if (c?.type === 'support' && Array.isArray(c.mustBeSupportedBy)) {
          ruleLines.push(`- Must be fully supported by: ${c.mustBeSupportedBy.join(', ')}.`)
        }
        if (c?.type === 'consistency' && Array.isArray(c.mustBeConsistentWith)) {
          ruleLines.push(`- Must be consistent with: ${c.mustBeConsistentWith.join(', ')}.`)
        }
      }
    }
    if (section === 'claims' && ctx?.claimsRules) {
      const cr = ctx.claimsRules
      if (cr.twoPartFormPreferred === false) ruleLines.push('- Avoid two-part "characterized in that" format; use single-part claims.')
      if (cr.allowMultipleDependent === false) ruleLines.push('- Each dependent claim must reference a single prior claim (no multiple dependency).')
      if (Array.isArray(cr.discouragedConnectors) && cr.discouragedConnectors.length) {
        ruleLines.push(`- Discouraged connectors: ${cr.discouragedConnectors.join(', ')}.`)
      }
      if (Array.isArray(cr.forbiddenPhrases) && cr.forbiddenPhrases.length) {
        ruleLines.push(`- Forbidden phrases: ${cr.forbiddenPhrases.join(', ')}.`)
      }
      if (typeof cr.maxIndependentClaimsBeforeExtraFee === 'number') {
        ruleLines.push(`- Keep independent claims ≤ ${cr.maxIndependentClaimsBeforeExtraFee} before extra fees.`)
      }
      if (typeof cr.maxTotalClaimsRecommended === 'number') {
        ruleLines.push(`- Recommended total claims ≤ ${cr.maxTotalClaimsRecommended}.`)
      }
      if (cr.requireSupportInDescription) {
        ruleLines.push('- Every claim element must be supported in the Detailed Description.')
      }
      if (cr.allowReferenceNumeralsInClaims === false) {
        ruleLines.push('- Do not use reference numerals inside claims.')
      } else if (cr.allowReferenceNumeralsInClaims === true) {
        ruleLines.push('- You may include reference numerals where helpful.')
      }
    }
    const ruleBlock = ruleLines.length ? `Additional Rules:\n${ruleLines.join('\n')}` : ''

    // Build writing sample block for example-based style mimicry
    let writingSampleBlock = ''
    if (ctx?.usePersonaStyle && ctx?.writingSample) {
      writingSampleBlock = buildWritingSampleBlock(ctx.writingSample, section)
      const styleHints = getSectionStyleHints(section)
      if (styleHints) {
        writingSampleBlock += `\n${styleHints}`
      }
    }

    const roleToneHeader = `
You are a senior patent attorney drafting the "${sectionLabel}" section for a ${countryName} patent specification handled by the ${officeName}.
- Jurisdiction: ${jurisdiction}
- Language: ${language}
- Tone: ${tone}
- Voice: ${voice}
- Archetype: ${archetype}
- Avoid: ${avoid}
${targetDisplay}
${promptInstruction}
${promptConstraints}
${ruleBlock ? `${ruleBlock}\n` : ''}
Ensure the writing is objective, precise, and ready for filing.
${writingSampleBlock}`

    switch (section) {
      case 'title':
        return `
${roleToneHeader}
Task: Generate the Title of the invention for this jurisdiction.
Rules:
- Keep it clear and functional; <=15 words.
- No marketing or evaluative terms ("novel", "improved", "smart", etc.).
- Use nouns/adjectives only as needed for precision.
Context:
title idea=${idea?.title || ''}; problem=${idea?.problem || ''}; objectives=${idea?.objectives || ''}.
Instructions(title): ${instr}.
${targetDisplay || 'Target length: <=15 words.'}
Output JSON: { "title": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.`
      case 'preamble':
        return `
${roleToneHeader}
Task: Draft a short preamble/opening statement for the specification.
Rules:
- Keep it concise (<= 40 words).
- Neutral tone; no claims or marketing.
Context:
title=${idea?.title || ''}.
Instructions(preamble): ${instr}.
${targetDisplay || 'Target length: <=40 words.'}
Output JSON: { "preamble": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'abstract':
        return `
${roleToneHeader}
Task: Generate the Abstract for this jurisdiction.
Rules:
- 130-150 words (hard cap 150).
- Must begin exactly with the approved Title (case- and space-normalized).
- Avoid numeric data unless essential to describe architecture.
- No numerals, figure references, or claim terms.
- Neutral tone; no evaluative adjectives ("novel", "inventive", "unique", "best", "advantage", "benefit").
Context:
approvedTitle=${approved?.title || idea?.title || ''}; problem=${idea?.problem || ''}; objectives=${idea?.objectives || ''}; numerals=[${numerals}]; figures=[${figs}].
Instructions(abstract): ${instr}.
${targetDisplay || 'Target length: 130-150 words.'}
Output JSON: { "abstract": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'fieldOfInvention':
        return `
${roleToneHeader}
Task: Write the Technical Field / Field of Invention.
Rules:
- 40-80 words; one short paragraph describing domain and subdomain.
- Avoid claims or advantages.
- No prior art discussion; just classification.
Context: field=${idea?.fieldOfRelevance || ''}; subfield=${idea?.subfield || ''}.
Instructions(fieldOfInvention): ${instr}.
${targetDisplay || 'Target length: 40-80 words.'}
Output JSON: { "fieldOfInvention": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'background': {
        let priorArtRefs = ''
        let priorArtCount = 0
        if (manualPriorArt) {
          if (manualPriorArt.useOnlyManualPriorArt) {
            priorArtRefs = `Available prior-art pool (select 5-6 most relevant):
Manual analysis (user-provided): ${manualPriorArt.manualPriorArtText}`
            priorArtCount = 1
          } else if (manualPriorArt.useManualAndAISearch) {
            const maxAdditionalPatents = 4
            const additionalPatents = selectedPriorArtPatents.slice(0, maxAdditionalPatents)
            const aiLines = additionalPatents.map((patent: any) => {
              const patentNumber = patent.patentNumber || patent.pn || 'Unknown'
              return `- ${patentNumber} - AI relevance: ${String(patent.aiSummary || '').substring(0, 200)}... | Novelty: ${String(patent.noveltyComparison || '').substring(0, 200)}...`
            }).join('\n')
            priorArtRefs = `Available prior-art pool (select total 5-6 most relevant):
Manual analysis (user-provided): ${manualPriorArt.manualPriorArtText}
${aiLines ? `AI-adjacent patents:
${aiLines}` : ''}`
            priorArtCount = 2 + additionalPatents.length
          }
        } else {
          const topAIRefs = selectedPriorArtPatents.slice(0, 6)
          priorArtRefs = `Available prior-art pool (select 5-6 most relevant):
${topAIRefs.map((patent: any) => {
            const patentNumber = patent.patentNumber || patent.pn || 'Unknown'
            return `- ${patentNumber} - AI relevance: ${String(patent.aiSummary || '').substring(0, 200)}... | Novelty: ${String(patent.noveltyComparison || '').substring(0, 200)}...`
          }).join('\n')}`
          priorArtCount = topAIRefs.length
        }

        return `
${roleToneHeader}
Task: Draft the Background / Prior Art section.
Rules:
- 250-400 words, 2-3 paragraphs max.
- Para 1: Context/problem space; Para 2+: Prior art comparison (5-6 references), identify drawbacks/gaps; Final sentence: segue to invention.
- Avoid claiming novelty; focus on shortcomings of prior art.
- No claim-like language or self-praise.
Available prior art (${priorArtCount} references available):
${priorArtRefs || 'No prior art supplied; objectively describe the problem space.'}
Context:
problem=${idea?.problem || ''}; objectives=${idea?.objectives || ''}; numerals=[${numerals}]; figures=[${figs}].
Instructions(background): ${instr}.
${targetDisplay || 'Target length: 250-400 words.'}
Output JSON: { "background": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      }
      case 'objectsOfInvention':
      case 'objects':
        return `
${roleToneHeader}
Task: Draft the "Object(s) of the Invention" section for a ${countryName} patent specification.

This section is crucial in Commonwealth jurisdictions (India, Pakistan, South Africa, UAE, Mexico) and is placed after Background and before Summary.

Rules:
- 80-150 words; focus on technical objectives to be achieved.
- Use statements beginning with "The principal object of the present invention is to..." or "Another object of this invention is to..."
- NEVER use "The object..." (singular definite article) as it implies only one objective.
- Focus on the RESULTS achieved (e.g., "to improve efficiency"), NOT the means of achieving them.
- Each objective should correlate directly with features mentioned in the claims.
- Acknowledge the closest prior art limitations and clearly distinguish how the invention overcomes them.
- Do NOT admit non-patentability or state that the invention is obvious.
- Avoid vague or non-technical goals; stick to demonstrable technical advantages.

Context:
problem=${idea?.problem || ''};
objectives=${idea?.objectives || ''};
advantages=${(idea?.advantages || idea?.benefits || []).join('; ') || 'none specified'};
priorArtLimitations=${manualPriorArt?.manualPriorArtText?.substring(0, 300) || 'conventional approaches have limitations'}.

Instructions(objectsOfInvention): ${instr}.
${targetDisplay || 'Target length: 80-150 words.'}

Output JSON: { "objectsOfInvention": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, or line breaks outside JSON.`
      case 'crossReference': {
        const priorArtList = (selectedPriorArtPatents || []).map((p: any, idx: number) => {
          const pn = p.patentNumber || p.pn || `Ref-${idx + 1}`
          const title = p.title ? `: ${String(p.title).substring(0, 120)}...` : ''
          return `- ${pn}${title}`
        }).join('\n')
        return `
${roleToneHeader}
Task: Draft the Cross-Reference to Related Applications / cited references.
Rules:
- 60-120 words.
- Mention related applications or cited patents by number; keep concise.
- Do not assert priority unless provided by the user; avoid legal conclusions.
Available references:
${priorArtList || '- None supplied; keep section minimal and generic.'}
Instructions(crossReference): ${instr}.
${targetDisplay || 'Target length: 60-120 words.'}
Output JSON: { "crossReference": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      }
      case 'summary':
        return `
${roleToneHeader}
Task: Write the Summary of the Invention.
Rules:
- 120-200 words, 2-3 paragraphs maximum.
- Cover: high-level architecture, control/data flow, key differentiators, safety/compliance, and improvements over prior art (without marketing tone).
- Avoid claims formatting; keep concise and technical.
Context:
title=${idea?.title || ''}; problem=${idea?.problem || ''}; objectives=${idea?.objectives || ''}; numerals=[${numerals}]; figures=[${figs}].
Instructions(summary): ${instr}.
${targetDisplay || 'Target length: 120-200 words.'}
Output JSON: { "summary": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'technicalProblem':
        return `
${roleToneHeader}
Task: Describe the technical problem addressed by the invention.
Rules:
- 40-80 words; keep strictly technical.
- No advantages or marketing language.
Context:
problem=${idea?.problem || ''}.
Instructions(technicalProblem): ${instr}.
${targetDisplay || 'Target length: 40-80 words.'}
Output JSON: { "technicalProblem": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'technicalSolution':
        return `
${roleToneHeader}
Task: Describe the technical solution provided by the invention.
Rules:
- 60-120 words; concise description of the core solution.
- Ensure consistency with claims/summary; no puffery.
Context:
objectives=${idea?.objectives || ''}; logic=${idea?.logic || ''}.
Instructions(technicalSolution): ${instr}.
${targetDisplay || 'Target length: 60-120 words.'}
Output JSON: { "technicalSolution": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'advantageousEffects':
        return `
${roleToneHeader}
Task: State the advantageous effects (technical effects) of the invention.
Rules:
- 60-120 words; limit to technical effects tied to the solution.
- Avoid business/marketing benefits.
Context:
objectives=${idea?.objectives || ''}; variants=${idea?.variants || ''}.
Instructions(advantageousEffects): ${instr}.
${targetDisplay || 'Target length: 60-120 words.'}
Output JSON: { "advantageousEffects": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'briefDescriptionOfDrawings':
        return `
${roleToneHeader}
Task: Write the Brief Description of Drawings.
Rules:
- Mention every figure number sequentially; for each, provide 1-2 sentences on what it depicts.
- No functionality analysis; just descriptive.
- Use "Fig. X" format; ensure numerals referenced exist.
Context: figures=[${figs}].
Instructions(briefDescriptionOfDrawings): ${instr}.
${targetDisplay || 'Target length: 80-150 words.'}
Output JSON: { "briefDescriptionOfDrawings": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'detailedDescription':
        const deepProto = this.getArchetypeInstructions(archetype)
        return `
${roleToneHeader}
Task: Draft the Detailed Description of the Invention.
Rules:
- Structure: overview -> components/functions -> control/data flow -> variations -> fail-safes/edge cases -> method steps (if any) -> hardware/software considerations.
- Use numerals for every component mention; reference figures appropriately (Fig. X).
- Avoid claim language; describe embodiments and enablement.
- Avoid repetition; be concise but enabling.
Context:
idea.title=${idea?.title || ''}; numerals=[${numerals}]; figures=[${figs}]; objectives=${idea?.objectives || ''}; logic=${idea?.logic || ''}; variants=${idea?.variants || ''}; bestMethod=${idea?.bestMethod || ''}.
Instructions(detailedDescription): ${instr}.
${deepProto}
${targetDisplay || 'Target length: 600-1200 words (apply judgment based on complexity).'}
Output JSON: { "detailedDescription": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'modeOfCarryingOut':
        return `
${roleToneHeader}
Task: Describe the mode(s) for carrying out the invention.
Rules:
- 300-500 words; enabling level of detail with preferred embodiments.
- Reference figures/numerals where applicable; avoid claim-style language.
Context:
numerals=[${numerals}]; figures=[${figs}]; bestMethod=${idea?.bestMethod || ''}.
Instructions(modeOfCarryingOut): ${instr}.
${targetDisplay || 'Target length: 300-500 words.'}
Output JSON: { "modeOfCarryingOut": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'bestMethod':
        return `
${roleToneHeader}
Task: Describe the Best Mode / Preferred Implementation.
Rules:
- 150-300 words.
- Focus on the most effective implementation: key parameters, configurations, and operating conditions.
- Ensure consistency with Detailed Description; avoid claim-like language.
- Mention materials/software versions if relevant.
Context: bestMethod=${idea?.bestMethod || ''}; objectives=${idea?.objectives || ''}; numerals=[${numerals}].
Instructions(bestMethod): ${instr}.
${targetDisplay || 'Target length: 150-300 words.'}
Output JSON: { "bestMethod": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'claims':
        return `
${roleToneHeader}
Task: Draft Claims aligned to this jurisdiction (clear, concise, supported).
Rules:
- Provide 6-8 claims: 1 independent system/apparatus claim + dependent claims; include one method claim if appropriate.
- Use one-part claim structure; ensure strict antecedent basis.
- Independent claim must capture essential components/steps; dependent claims add technical limitations only.
- Avoid result-oriented language; no business method framing.
- Number claims sequentially; no missing numbers.
Context:
components=[${numerals}]; figures=[${figs}]; objectives=${idea?.objectives || ''}; logic=${idea?.logic || ''}.
Instructions(claims): ${instr}.
Output JSON: { "claims": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'industrialApplicability':
        return `
${roleToneHeader}
Task: Draft Industrial Applicability / Usefulness.
Rules:
- 80-150 words.
- Describe concrete industrial domains and use-cases; focus on practical deployment.
- Avoid marketing terms; keep tone factual.
Context: objectives=${idea?.objectives || ''}; numerals=[${numerals}].
Instructions(industrialApplicability): ${instr}.
${targetDisplay || 'Target length: 80-150 words.'}
Output JSON: { "industrialApplicability": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      case 'listOfNumerals':
        return `
${roleToneHeader}
Task: Prepare List of Reference Numerals.
Rules:
- Include every numeral from Reference Map and drawings.
- Format: "[numeral] - [component name]: [1-line function/use]".
- Keep to <=1 line each; sorted ascending by numeral.
Context: numerals=[${numerals}]; figures=[${figs}].
Instructions(listOfNumerals): ${instr}.
Output JSON: { "listOfNumerals": "..." }
Return ONLY a valid JSON object exactly matching the schema above.`
      default:
        return `{"${section}": ""}`
    }
  }

  // Enforce conservative hard upper word limits per section to avoid overflows
  private static enforceMaxWords(
    section: string,
    text: string,
    sectionChecks?: any[] | null,
    sectionRules?: any | null
  ): { text: string; clipped: boolean; before: number; after: number } {
    const wc = (t: string) => (String(t || '').trim().length ? String(t).trim().split(/\s+/).length : 0)
    const before = wc(text)
    let max: number | undefined
    const maxWordLimiter = (sectionChecks || []).find((c: any) => c?.type === 'maxWords' && typeof c.limit === 'number')
    if (maxWordLimiter) {
      max = maxWordLimiter.limit
    } else if (sectionRules?.wordRange?.max) {
      max = sectionRules.wordRange.max
    } else if (sectionRules?.maxWords) {
      max = sectionRules.maxWords
    }
    if (!max) {
      const fallback: Record<string, number> = {
        title: 15,
        abstract: 150,
        fieldOfInvention: 80,
        background: 400,
        summary: 300,
        briefDescriptionOfDrawings: 80,
        detailedDescription: 1200,
        bestMethod: 350,
        claims: 900,
        industrialApplicability: 100,
        listOfNumerals: 1000
      }
      max = fallback[section]
    }
    if (!max || before <= max) return { text, clipped: false, before, after: before }

    const sentenceSplit = (t: string) => t.split(/(?<=[\.!?;:])\s+/).filter(Boolean)
    const wordTrim = (t: string, m: number) => t.split(/\s+/).slice(0, m).join(' ')

    // Claims: preserve numbering; trim from last dependent claims backwards
    if (section === 'claims') {
      let blocks = String(text).split(/\n\s*(?=\d+\.)/).map(s => s.trim()).filter(Boolean)
      const blockWordCount = () => wc(blocks.join('\n'))
      let current = blockWordCount()
      // Iteratively shorten last block sentences, then drop last block if still long
      while (current > max && blocks.length > 0) {
        const lastIdx = blocks.length - 1
        const last = blocks[lastIdx]
        const m = last.match(/^(\d+\.\s*)([\s\S]*)$/)
        if (!m) { blocks.pop(); current = blockWordCount(); continue }
        const prefix = m[1]
        let body = m[2].trim()
        const sentences = sentenceSplit(body)
        if (sentences.length > 1) {
          // Remove trailing sentence and re-evaluate
          sentences.pop()
          body = sentences.join(' ')
          blocks[lastIdx] = `${prefix}${body}`.trim()
        } else {
          // If only one sentence remains, drop the entire last block
          blocks.pop()
        }
        current = blockWordCount()
      }
      const out = blocks.join('\n')
      const after = wc(out)
      return { text: out, clipped: after < before, before, after }
    }

    // Brief Description: keep per-line cap (handled elsewhere) and enforce total cap
    if (section === 'briefDescriptionOfDrawings') {
      const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean)
      const outLines: string[] = []
      let total = 0
      for (const l of lines) {
        const words = l.split(/\s+/)
        if (total + words.length <= max) {
          outLines.push(l)
          total += words.length
        } else {
          const remaining = Math.max(0, max - total)
          if (remaining > 0) {
            outLines.push(words.slice(0, remaining).join(' '))
            total = max
          }
          break
        }
      }
      const out = outLines.join('\n')
      const after = wc(out)
      return { text: out, clipped: after < before, before, after }
    }

    // Default: drop trailing sentences until within cap; fallback to word trim
    let sentences = sentenceSplit(String(text))
    while (wc(sentences.join(' ')) > max && sentences.length > 1) {
      sentences.pop()
    }
    let out = sentences.join(' ')
    if (wc(out) > max) out = wordTrim(out, max)
    const after = wc(out)
    return { text: out, clipped: after < before, before, after }
  }

  private static wrapMultiSectionPrompt(prompts: Record<string, string>): string {
    const entries = Object.entries(prompts).map(([k,v]) => `SECTION ${k.toUpperCase()}:\n${v}`).join('\n\n')
    return `You are a senior Indian Patent Attorney (IN, Form-2). Return a single JSON object with only the requested keys. No markdown, no commentary.\n\n${entries}`
  }

  private static guardrailCheck(
    section: string,
    text: string,
    referenceMap: any,
    figures: any[],
    approvedTitle?: string,
    ctx?: { sectionChecks?: any[]; claimsRules?: any }
  ): { ok: boolean; reason?: string } {
    const fallbackMax: Record<string, number> = {
      title: 15,
      abstract: 150,
      preamble: 40,
      fieldOfInvention: 80,
      background: 400,
      objectsOfInvention: 120,
      crossReference: 120,
      summary: 300,
      technicalProblem: 120,
      technicalSolution: 150,
      advantageousEffects: 150,
      briefDescriptionOfDrawings: 80,
      detailedDescription: 1200,
      modeOfCarryingOut: 500,
      bestMethod: 350,
      claims: 900,
      industrialApplicability: 100,
      listOfNumerals: 1000
    }
    const extractLimits = (checks?: any[]) => {
      const limits: { maxWords?: number; maxChars?: number; maxCount?: number } = {}
      if (Array.isArray(checks)) {
        for (const c of checks) {
          if (c?.type === 'maxWords' && typeof c.limit === 'number') limits.maxWords = c.limit
          if (c?.type === 'maxChars' && typeof c.limit === 'number') limits.maxChars = c.limit
          if (c?.type === 'maxCount' && typeof c.limit === 'number') limits.maxCount = c.limit
        }
      }
      return limits
    }
    const limits = extractLimits(ctx?.sectionChecks)
    const onlyExistingFigures = (s: string) => {
      const set = new Set((figures||[]).map((f:any)=>String(f.figureNo)))
      const refs = Array.from(s.matchAll(/Fig\.?\s*(\d+)/gi)).map(m=>m[1])
      return refs.every(r=>set.has(String(r)))
    }
    if (section === 'title') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.title
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      if (maxWords && text.trim().split(/\s+/).length > maxWords) {
        return { ok: false, reason: `Title exceeds ${maxWords} words` }
      }
      if (maxChars && text.length > maxChars) {
        return { ok: false, reason: `Title exceeds ${maxChars} characters` }
      }
    }
    if (section === 'abstract') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.abstract
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      if (maxWords && text.split(/\s+/).length > maxWords) {
        return { ok: false, reason: `Abstract exceeds ${maxWords} words` }
      }
      if (maxChars && text.length > maxChars) {
        return { ok: false, reason: `Abstract exceeds ${maxChars} characters` }
      }
      // Note: numerals/figure refs check relaxed for partial generation - will be enforced in full draft
      if (/(novel|inventive|best|unique|claim|claims)/i.test(text)) return { ok: false, reason: 'Improper tone in abstract' }
    }
    // claims-specific normalization should not be performed here; handled in minimalFix
    if (section === 'briefDescriptionOfDrawings') {
      // Only check figure references if figures have been declared
      const declaredFigures = figures || []
      if (declaredFigures.length > 0 && !onlyExistingFigures(text)) {
        return { ok: false, reason: 'BDOD references non-existing figure' }
      }
      const lines = text.split(/\n+/)
      if (lines.some(l=>l.split(/\s+/).filter(Boolean).length>40)) return { ok: false, reason: 'BDOD line exceeds 40 words' }
      if (/(advantage|benefit|claim)/i.test(text)) return { ok: false, reason: 'BDOD contains claims/advantages language' }
    }
    if (section === 'claims') {
      if (/(and\/or|etc\.|approximately|substantially)/i.test(text)) return { ok: false, reason: 'Claims hygiene violation' }
      // Disallow parentheses around claim numbers (e.g., claim (1))
      if (/\bclaim\s*\(\d+\)/i.test(text)) return { ok: false, reason: 'Parentheses around claim numbers are not allowed' }

      // Sequential numbering and immediate dependency enforcement
      const blocks = text.split(/\n\s*(?=\d+\.)/).map(s=>s.trim()).filter(Boolean)
      let expected = 1
      const allowMultipleDependent = ctx?.claimsRules?.allowMultipleDependent !== false
      for (let i=0; i<blocks.length; i++) {
        const b = blocks[i]
        const m = b.match(/^(\d+)\./)
        if (!m) return { ok: false, reason: 'Claims must be numbered as \'N. ...\'' }
        const num = parseInt(m[1],10)
        if (num !== expected) return { ok: false, reason: 'Claims numbering not sequential' }
        if (i >= 1) {
          const dep = b.match(/^\d+\.\s*The\s+(system|device|method)\s+of\s+claim\s+(\d+)(?:\s+and\s+claim\s+\d+)*/i)
          if (!dep) return { ok: false, reason: 'Dependent claim must start with "The system/device/method of claim X, ..."' }
          const refs = Array.from(dep[0].matchAll(/claim\s+(\d+)/gi)).map(r=>parseInt(r[1],10))
          if (!refs.length) return { ok: false, reason: 'Dependent claim must reference an earlier claim' }
          if (!allowMultipleDependent && refs.length > 1) return { ok: false, reason: 'Multiple dependency not allowed by jurisdiction' }
          if (refs.some(r => r >= num || r < 1)) return { ok: false, reason: 'Dependent claim must reference an earlier claim' }
          if (!allowMultipleDependent && refs[0] !== expected - 1) return { ok: false, reason: 'Dependent claim must depend on immediately preceding claim' }
        }
        expected++
      }
      if (typeof limits.maxCount === 'number' && blocks.length > limits.maxCount) {
        return { ok: false, reason: `Claims exceed ${limits.maxCount} count limit` }
      }
    }
    if (section === 'listOfNumerals') {
      // Only check numerals if components have been declared
      const declaredComponents = referenceMap?.components || []
      if (declaredComponents.length > 0) {
        const allowed = new Set(declaredComponents.map((c:any)=>c.numeral))
      const refs = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (refs.some(n=>!allowed.has(n))) return { ok: false, reason: 'List includes undeclared numeral' }
      }
    }
    if (section === 'detailedDescription') {
      // Enforce: no undeclared numerals and only existing figure references
      // BUT only if components/figures have been declared - otherwise skip these checks
      const declaredComponents = referenceMap?.components || []
      const declaredFigures = figures || []
      
      // Only check numerals if there are declared components
      if (declaredComponents.length > 0) {
        const allowedNums = new Set(declaredComponents.map((c:any)=>c.numeral))
      const usedNums = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (usedNums.some(n=>!allowedNums.has(n))) {
        return { ok: false, reason: 'Detailed Description uses undeclared numeral' }
      }
      }
      
      // Only check figure references if there are declared figures
      if (declaredFigures.length > 0 && !onlyExistingFigures(text)) {
        return { ok: false, reason: 'Detailed Description references non-existing figure' }
      }
    }
    if (section === 'industrialApplicability') {
      const maxWords = typeof limits.maxWords === 'number' ? limits.maxWords : fallbackMax.industrialApplicability
      const maxChars = typeof limits.maxChars === 'number' ? limits.maxChars : undefined
      if (maxWords && text.split(/\s+/).length > maxWords) {
        return { ok: false, reason: `Industrial applicability exceeds ${maxWords} words` }
      }
      if (maxChars && text.length > maxChars) {
        return { ok: false, reason: `Industrial applicability exceeds ${maxChars} characters` }
      }
    }
    return { ok: true }
  }

  private static minimalFix(
    section: string,
    text: string,
    ctx: { reason?: string; approvedTitle?: string; referenceMap?: any; figures?: any[]; sectionChecks?: any[]; claimsRules?: any }
  ): string | null {
    let out = String(text || '')
    const extractLimit = (checks: any[] | undefined, type: 'maxWords' | 'maxChars') => {
      if (!Array.isArray(checks)) return undefined
      const rule = checks.find(c => c?.type === type && typeof c.limit === 'number')
      return rule?.limit
    }
    if (section === 'abstract') {
      // Remove prohibited tone words and claims language
      out = out.replace(/\b(novel|inventive|best|unique|claim|claims)\b/gi, '')
      // Note: numerals/figure refs allowed for partial generation
      // Collapse extra spaces and clean up
      out = out.replace(/\s{2,}/g, ' ').trim()
      // Enforce starts with title if available
      if (ctx.approvedTitle && ctx.reason && ctx.reason.toLowerCase().includes('title') && !out.startsWith(ctx.approvedTitle)) {
        out = `${ctx.approvedTitle} ${out}`.trim()
      }
      // Enforce max words, and ensure it's meaningful
      const maxWords = extractLimit(ctx.sectionChecks, 'maxWords')
      const words = out.split(/\s+/).filter(w=>w.length>0)
      if (maxWords && words.length > maxWords) out = words.slice(0, maxWords).join(' ')
      if (words.length < 5) out = ctx.approvedTitle || 'Patent invention description.' // Fallback if too short
      return out
    }
    if (section === 'industrialApplicability') {
      const maxWords = extractLimit(ctx.sectionChecks, 'maxWords')
      const words = out.split(/\s+/).filter(w=>w.length>0)
      if (maxWords && words.length > maxWords) out = words.slice(0, maxWords).join(' ')
      return out
    }
    if (section === 'briefDescriptionOfDrawings') {
      const allowed = new Set((ctx.figures||[]).map((f:any)=>String(f.figureNo)))
      const lines = out.split(/\n+/).map(l=>l.trim()).filter(Boolean)
      const cleaned = lines
        .filter(l=>{
          const m = l.match(/Fig\.?\s*(\d+)/i); return !!(m && allowed.has(String(m[1])))
        })
        .map(l=>l.replace(/\b(advantage|advantages|benefit|benefits|claim|claims)\b/gi,'').trim())
        .map(l=>{
          const w = l.split(/\s+/); return w.length>40? w.slice(0,40).join(' ') : l
        })
      return cleaned.length > 0 ? cleaned.join('\n') : 'No valid figure descriptions.'
    }
    if (section === 'claims') {
      // Normalize parentheses around claim numbers in text body
      let fixed = out.replace(/\bclaim\s*\((\d+)\)/gi, 'claim $1')

      // Split into numbered claim blocks. If numbering missing, attempt to infer by splitting on newlines.
      let blocks = fixed.split(/\n\s*(?=\d+\.)/).map(s=>s.trim()).filter(Boolean)
      if (blocks.length === 0) {
        const rough = fixed.split(/\n+/).map(s=>s.trim()).filter(Boolean)
        blocks = rough.map((s, i) => `${i+1}. ${s.replace(/^\d+\.\s*/, '')}`)
      }

      const subjectHint = /\b(system|device|method)\b/i.test(blocks[0]) ? (blocks[0].match(/\b(system|device|method)\b/i)![1].toLowerCase()) : 'system'

      const normalized: string[] = []
      for (let i = 0; i < blocks.length; i++) {
        const expected = i + 1
        let body = blocks[i].replace(/^\d+\.\s*/, '').trim()

        if (i === 0) {
          // Ensure independent claim numbered correctly
          normalized.push(`${expected}. ${body}`)
          continue
        }

        // For dependent claims, enforce immediate dependency preamble
        // Clean up any duplicate "The X of claim Y" phrases first
        body = body.replace(/(The\s+(?:system|device|method)\s+of\s+claim\s+\d+,\s*)+/gi, '')

        // Then add the correct preamble
        body = `The ${subjectHint} of claim ${expected-1}, ${body.replace(/^The\s+/, '').replace(/^,\s*/, '')}`

        normalized.push(`${expected}. ${body}`)
      }

      return normalized.join('\n')
    }
    return null
  }

  // Public wrapper for consistency validation
  static validateDraftConsistencyPublic(draft: any, session: any) {
    return this.validateDraftConsistency(draft, session)
  }

  private static getFallbackContent(section: string, payload: any): string {
    const { idea, referenceMap } = payload
    switch (section) {
      case 'title':
        return idea?.title || 'Patent Invention'
      case 'abstract':
        return (idea?.title || 'Patent Invention') + ' provides a technical solution.'
      case 'summary':
        return 'This invention provides an improved technical solution.'
      case 'briefDescriptionOfDrawings':
        return 'Fig. 1 shows the system architecture.'
      case 'fieldOfInvention':
        return 'The invention relates to the field of technology.'
      case 'background':
        return 'Conventional approaches have limitations.'
      case 'objectsOfInvention':
      case 'objects':
        return 'The principal object of the present invention is to provide an improved solution that overcomes limitations of conventional approaches. Another object is to enhance efficiency and reliability in the relevant technical field.'
      case 'technicalProblem':
        return 'The invention addresses a technical problem in the art.'
      case 'technicalSolution':
        return 'The invention provides a technical solution comprising the disclosed architecture.'
      case 'advantageousEffects':
        return 'The solution yields technical effects that improve performance or reliability.'
      case 'crossReference':
        return 'This application is related to prior filings and references identified by the applicant.'
      case 'detailedDescription':
        return 'The invention comprises several components working together.'
      case 'modeOfCarryingOut':
        return 'A mode for carrying out the invention is described with sufficient detail for a skilled person.'
      case 'bestMethod':
        return 'The best method involves the following steps.'
      case 'claims':
        return '1. A system comprising: components as described.'
      case 'listOfNumerals':
        const nums = (referenceMap?.components || []).map((c: any) => `( ${c.numeral} ) G ${c.name}`).join('\n')
        return nums || '(100) G Main component'
      default:
        return 'Content not available.'
    }
  }

  /**
   * Validate and process component map with numeral assignment
   */
  static validateComponentMap(components: any[]): ComponentValidationResult {
    const errors: string[] = [];
    const processedComponents: any[] = [];

    if (!Array.isArray(components) || components.length === 0) {
      return { valid: false, errors: ['Components array is required and cannot be empty'] };
    }

    if (components.length > 100) {
      return { valid: false, errors: ['Maximum 100 components allowed'] };
    }

    // Build tree by parentId (optional)
    type Comp = { id?: string; name: string; description?: string; parentId?: string };
    const nodes: Record<string, any> = {};
    const roots: any[] = [];

    for (const comp of components as Comp[]) {
      if (!comp.name || typeof comp.name !== 'string') {
        errors.push('Component name is required and must be a string');
        continue;
      }
      const id = comp.id || crypto.randomUUID();
      nodes[id] = {
        id,
        name: comp.name.trim(),
        description: comp.description || '',
        parentId: (comp as any).parentId || null,
        numeral: typeof (comp as any).numeral === 'number' ? (comp as any).numeral : undefined,
        type: (comp as any).type || 'OTHER',
        children: []
      };
    }

    // Link children
    Object.values(nodes).forEach((n: any) => {
      if (n.parentId && nodes[n.parentId]) {
        nodes[n.parentId].children.push(n);
      } else {
        roots.push(n);
      }
    });

    // Assign numerals in 100-blocks per root to avoid overlap; respect user-supplied numerals when unique/valid
    const usedNumerals = new Set<number>();
    let rootIndex = 1; // 100, 200, ... 900

    const assignBlock = (node: any, base: number) => {
      let cursor = base;

      const dfs = (n: any) => {
        if (cursor > base + 99) {
          errors.push(`Too many subcomponents under root block ${base}`);
          return;
        }
        // Respect user-supplied numeral if valid and unique
        if (typeof n.numeral === 'number' && n.numeral >= 1 && n.numeral <= 999) {
          if (usedNumerals.has(n.numeral)) {
            errors.push(`Duplicate numeral ${n.numeral} detected`);
          } else {
            usedNumerals.add(n.numeral);
            cursor = Math.max(cursor, n.numeral + 1);
          }
        } else {
          // Assign numeral automatically
          while (usedNumerals.has(cursor) && cursor <= base + 99) cursor++;
          n.numeral = cursor;
          usedNumerals.add(cursor);
          cursor++;
        }
        // Children
        if (Array.isArray(n.children) && n.children.length > 0) {
          // Stable order
          n.children.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
          n.children.forEach((c: any) => dfs(c));
        }
      };

      dfs(node);
    };

    // Sort roots by name for stability, assign blocks 100..900
    roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    for (const root of roots) {
      let base = rootIndex * 100;
      if (base > 900) {
        // Fallback: find next free block within 100..999
        base = 100;
        while (base <= 900 && Array.from({ length: 100 }).some((_, i) => usedNumerals.has(base + i))) {
          base += 100;
        }
        if (base > 900) {
          errors.push('No available 100-blocks remain for numbering');
          break;
        }
      }
      assignBlock(root, base);
      rootIndex++;
    }

    // Flatten back into processed list
    const collect = (n: any) => {
      processedComponents.push({
        id: n.id,
        name: n.name,
        type: n.type || 'OTHER',
        description: n.description,
        numeral: n.numeral,
        range: `${Math.floor(n.numeral / 100) * 100}s`,
        parentId: n.parentId || undefined
      });
      n.children?.forEach((c: any) => collect(c));
    };
    roots.forEach((r) => collect(r));

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, components: processedComponents };
  }

  /**
   * Generate PlantUML code from figure plan and reference map
   */
  static async generatePlantUML(
    figurePlan: any,
    referenceMap: any,
    archetype?: string | string[]
  ): Promise<PlantUMLGenerationResult> {
    try {
      const archetypeList = this.normalizeArchetypeList(
        archetype ?? referenceMap?.inventionType ?? referenceMap?.normalizedData?.inventionType,
        referenceMap?.fieldOfRelevance
      )
      const archetypeLabel = archetypeList.join('+')

      // Build component lookup by numeral
      const componentLookup: Record<number, any> = {};
      if (referenceMap?.components) {
        for (const component of referenceMap.components) {
          componentLookup[component.numeral] = component;
        }
      }

      // Generate PlantUML code
      let plantumlCode = '@startuml\n';

      // Add title
      plantumlCode += `title ${figurePlan.title}\n\n`;
      if (archetypeLabel) {
        plantumlCode += `caption Archetype: ${archetypeLabel}\n\n`
      }

      // Add components as rectangles or other shapes
      if (figurePlan.nodes && Array.isArray(figurePlan.nodes)) {
        for (const nodeRef of figurePlan.nodes) {
          const component = componentLookup[nodeRef];
          if (component) {
            const shape = this.getShapeForComponent(component.type);
            plantumlCode += `${shape} "${component.name} (${component.numeral})" as C${component.numeral}\n`;
          }
        }
      }

      plantumlCode += '\n';

      // Add connections
      if (figurePlan.edges && Array.isArray(figurePlan.edges)) {
        for (const edge of figurePlan.edges) {
          const fromComponent = componentLookup[edge.from];
          const toComponent = componentLookup[edge.to];

          if (fromComponent && toComponent) {
            const label = edge.label ? ` : ${edge.label}` : '';
            plantumlCode += `C${fromComponent.numeral} --> C${toComponent.numeral}${label}\n`;
          }
        }
      }

      plantumlCode += '\n@enduml';

      // Generate checksum
      const checksum = crypto.createHash('sha256').update(plantumlCode).digest('hex');

      return {
        success: true,
        plantumlCode,
        checksum
      };

    } catch (error) {
      console.error('PlantUML generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PlantUML generation failed'
      };
    }
  }

  /**
   * Get appropriate PlantUML shape for component type
   */
  private static getShapeForComponent(type: string): string {
    const shapeMap: Record<string, string> = {
      MAIN_CONTROLLER: 'rectangle',
      SUBSYSTEM: 'rectangle',
      MODULE: 'component',
      INTERFACE: 'interface',
      SENSOR: 'circle',
      ACTUATOR: 'hexagon',
      PROCESSOR: 'node',
      MEMORY: 'database',
      DISPLAY: 'actor',
      COMMUNICATION: 'queue',
      POWER_SUPPLY: 'storage',
      OTHER: 'rectangle'
    };

    return shapeMap[type] || 'rectangle';
  }

  /**
   * Generate complete annexure draft using LLM
   */
  static async generateAnnexureDraft(
    session: any,
    jurisdiction: string = 'IN',
    filingType: string = 'utility',
    tenantId?: string,
    requestHeaders?: Record<string, string>,
    referenceDraft?: any,
    preferredLanguage?: string,
    sourceJurisdiction?: string
  ): Promise<AnnexureDraftResult> {
    try {
      const sectionDefs = await this.buildSectionDefinitions(jurisdiction)

      // Build comprehensive prompt
      const prompt = await this.buildAnnexurePrompt(session, jurisdiction, filingType, sectionDefs, referenceDraft, preferredLanguage, sourceJurisdiction);

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const result = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId, jurisdiction, filingType },
        idempotencyKey: crypto.randomUUID(),
        metadata: {
          patentId: session.patentId,
          sessionId: session.id,
          jurisdiction,
          filingType,
          purpose: 'annexure_draft'
        }
      });

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Draft generation failed'
        };
      }

      // Parse and structure the draft
      const draftResult = this.parseDraftResponse(result.response.output, sectionDefs);

      if (!draftResult.success) {
        return {
          success: false,
          error: draftResult.error
        };
      }

      // Validate draft consistency
      // Apply basic section-level validation from profile if available
      await this.applySectionChecks(draftResult.draft, jurisdiction);

      const validation = this.validateDraftConsistency(draftResult.draft, session);

      return {
        success: true,
        draft: draftResult.draft,
        isValid: validation.valid,
        validationReport: validation.report,
        llmPrompt: prompt,
        llmResponse: result.response,
        tokensUsed: result.response.outputTokens
      };

    } catch (error) {
      console.error('Annexure draft generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Draft generation failed'
      };
    }
  }

  /**
   * Build section definitions from country profile (or fallback)
   */
  /**
   * Map superset code to section key
   */
  private static supersetCodeToSectionKey(supersetCode: string): string {
    const mapping: Record<string, string> = {
      '01. Title': 'title',
      '02. Preamble': 'preamble',
      '03. Cross-Ref/Fed': 'cross_reference',
      '04. Tech Field': 'field',
      '05. Background': 'background',
      '06. Objects': 'objects',
      '07. Summary (Gen)': 'summary',
      '07a. Tech Problem': 'technical_problem',
      '07b. Tech Solution': 'technical_solution',
      '07c. Effects': 'advantageous_effects',
      '08. Drawings': 'brief_drawings',
      '09. Detailed Desc': 'detailed_description',
      '10. Best Mode': 'best_mode',
      '11. Ind. Applicability': 'industrial_applicability',
      '12. Claims': 'claims',
      '13. Abstract': 'abstract'
    }
    return mapping[supersetCode] || supersetCode.toLowerCase().replace(/[^a-z]/g, '_')
  }

  /**
   * Get default label for section key
   */
  private static getDefaultLabel(sectionKey: string): string {
    const labels: Record<string, string> = {
      'title': 'Title',
      'preamble': 'Preamble',
      'cross_reference': 'Cross-Reference',
      'field': 'Technical Field',
      'background': 'Background',
      'objects': 'Objects',
      'summary': 'Summary of the Invention',
      'technical_problem': 'Technical Problem',
      'technical_solution': 'Technical Solution',
      'advantageous_effects': 'Advantageous Effects',
      'brief_drawings': 'Brief Description of Drawings',
      'detailed_description': 'Detailed Description',
      'best_mode': 'Best Mode',
      'industrial_applicability': 'Industrial Applicability',
      'claims': 'Claims',
      'abstract': 'Abstract'
    }
    return labels[sectionKey] || sectionKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  /**
   * Determine if section is required for jurisdiction
   */
  private static isSectionRequired(sectionKey: string, jurisdiction: string): boolean {
    // Core sections that are typically required
    const alwaysRequired = ['title', 'claims', 'abstract']

    if (alwaysRequired.includes(sectionKey)) return true

    // Country-specific requirements
    const countryRequirements: Record<string, string[]> = {
      'US': ['detailed_description', 'background', 'summary'],
      'IN': ['field', 'background', 'objects', 'summary', 'detailed_description'],
      'EP': ['detailed_description', 'background', 'claims'],
      'CN': ['detailed_description', 'claims'],
      'JP': ['detailed_description', 'claims']
    }

    return countryRequirements[jurisdiction]?.includes(sectionKey) || false
  }

  private static async buildSectionDefinitions(jurisdiction: string): Promise<Array<{ key: string; label: string; required: boolean; constraints?: string[]; altKeys: string[] }>> {
    const profile = await getCountryProfile(jurisdiction)
    const defs: Array<{ key: string; label: string; required: boolean; constraints?: string[]; altKeys: string[] }> = []

    // Get all sections mapped for this country from database
    const countryMappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: jurisdiction }
    })

    // Use database mappings to determine available sections
    for (const mapping of countryMappings) {
      let sectionKey = (mapping as any).sectionKey
      if (!sectionKey) {
        // Map superset code to section key if not provided
        sectionKey = this.supersetCodeToSectionKey(mapping.supersetCode)
      }

      if (!sectionKey) continue

      // Get constraints from our hard-coded superset prompts
      const supersetPrompt = SUPERSET_PROMPTS[sectionKey as keyof typeof SUPERSET_PROMPTS]

      defs.push({
        key: sectionKey,
        label: mapping.heading && mapping.heading !== '(N/A)' ? mapping.heading : this.getDefaultLabel(sectionKey),
        required: this.isSectionRequired(sectionKey, jurisdiction),
        constraints: supersetPrompt?.constraints || [],
        altKeys: [mapping.supersetCode.toLowerCase()]
      })
    }

    // Fallback if no database mappings found
    if (defs.length === 0) {
      const promptSections = profile?.profileData?.prompts?.sections || {}
      const variant = profile?.profileData?.structure?.variants?.find((v: any) => v.id === profile?.profileData?.structure?.defaultVariant) || profile?.profileData?.structure?.variants?.[0]
      if (variant?.sections?.length) {
        for (const sec of variant.sections) {
          const keys = (sec.canonicalKeys || []).map((k: string) => k.toLowerCase())
          let mapped: string | undefined
          for (const k of keys) {
            mapped = this.mapToInternalKey(k)
            if (mapped) break
          }
          if (!mapped) mapped = this.mapToInternalKey(sec.id)
          if (!mapped) continue
          const altKeys = Array.from(new Set([sec.id, ...(sec.canonicalKeys || [])].map((k: string) => k.toLowerCase())))
          defs.push({
            key: mapped,
            label: sec.label || sec.id,
            required: !!sec.required,
            constraints: promptSections?.[sec.id]?.constraints || [],
            altKeys
          })
        }
      }
    }
    if (defs.length === 0) {
      return [
        { key: 'title', label: 'Title', required: true, altKeys: [] },
        { key: 'abstract', label: 'Abstract', required: true, altKeys: [] },
        { key: 'preamble', label: 'Preamble', required: false, altKeys: [] },
        { key: 'fieldOfInvention', label: 'Technical Field', required: true, altKeys: ['technical_field'] },
        { key: 'background', label: 'Background', required: true, altKeys: [] },
        { key: 'objectsOfInvention', label: 'Objects of the Invention', required: false, altKeys: ['objects'] },
        { key: 'crossReference', label: 'Cross-Reference', required: false, altKeys: ['cross_reference'] },
        { key: 'summary', label: 'Summary', required: true, altKeys: [] },
        { key: 'technicalProblem', label: 'Technical Problem', required: false, altKeys: ['technical_problem'] },
        { key: 'technicalSolution', label: 'Technical Solution', required: false, altKeys: ['technical_solution'] },
        { key: 'advantageousEffects', label: 'Advantageous Effects', required: false, altKeys: ['advantageous_effects'] },
        { key: 'briefDescriptionOfDrawings', label: 'Brief Description of Drawings', required: false, altKeys: [] },
        { key: 'detailedDescription', label: 'Detailed Description', required: true, altKeys: [] },
        { key: 'modeOfCarryingOut', label: 'Mode of Carrying Out the Invention', required: false, altKeys: ['modes_for_carrying_out'] },
        { key: 'bestMethod', label: 'Best Mode', required: false, altKeys: ['best_mode'] },
        { key: 'industrialApplicability', label: 'Industrial Applicability', required: false, altKeys: ['utility'] },
        { key: 'claims', label: 'Claims', required: true, altKeys: [] },
        { key: 'listOfNumerals', label: 'List of Reference Numerals', required: false, altKeys: ['reference_numerals'] }
      ]
    }
    return defs
  }

  private static async applySectionChecks(draft: any, jurisdiction: string) {
    const profile = await getCountryProfile(jurisdiction)
    const checks = profile?.profileData?.validation?.sectionChecks || {}
    if (!checks) return
    const enforce = (key: string, rules: any[]) => {
      const val = draft[key]
      if (!val || typeof val !== 'string') return
      for (const rule of rules) {
        if (rule.type === 'maxWords' && typeof rule.limit === 'number') {
          const words = val.trim().split(/\s+/)
          if (words.length > rule.limit) {
            draft[key] = words.slice(0, rule.limit).join(' ')
          }
        }
        if (rule.type === 'maxChars' && typeof rule.limit === 'number') {
          if (val.length > rule.limit) draft[key] = val.slice(0, rule.limit)
        }
        if (rule.type === 'maxCount' && typeof rule.limit === 'number' && key === 'claims') {
          const blocks = val.split(/\n\s*(?=\d+\.)/).map(s => s.trim()).filter(Boolean)
          if (blocks.length > rule.limit) {
            draft[key] = blocks.slice(0, rule.limit).join('\n')
          }
        }
      }
    }
    for (const [sectionId, ruleList] of Object.entries(checks) as Array<[string, any[]]>) {
      const mapped = this.mapToInternalKey(sectionId) || sectionId
      if (Array.isArray(ruleList)) enforce(mapped, ruleList)
    }
  }

  /**
   * Build comprehensive annexure generation prompt using jurisdiction-aware sections
   */
  private static async buildAnnexurePrompt(
    session: any,
    jurisdiction: string,
    filingType: string,
    sections: Array<{ key: string; label: string; required: boolean; constraints?: string[] }>,
    referenceDraft?: any,
    preferredLanguage?: string,
    sourceJurisdiction?: string
  ): Promise<string> {
    const idea = session.ideaRecord;
    const components: any[] = session.referenceMap?.components || [];
    const planFigures: any[] = (session.figurePlans || []).map((f: any) => ({
      figureNo: f.figureNo,
      title: this.sanitizeFigureTitle(f.title) || `Figure ${f.figureNo}`
    }));
    // Include ALL diagram sources, not just uploaded ones
    const diagramFigures: any[] = (session.diagramSources || []).map((d: any) => {
        const found = planFigures.find((f: any) => f.figureNo === d.figureNo)
        const sanitized = this.sanitizeFigureTitle(found?.title || d.title)
        return { figureNo: d.figureNo, title: sanitized || `Figure ${d.figureNo}` }
      })
    const mergedByNo = new Map<number, any>()
    for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
    for (const f of diagramFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
    const figures: any[] = Array.from(mergedByNo.values()).sort((a,b)=>a.figureNo-b.figureNo)

    let profile = await getCountryProfile(jurisdiction)
    if (profile && preferredLanguage) {
      const langs: string[] = Array.isArray(profile?.profileData?.meta?.languages)
        ? profile.profileData.meta.languages
        : []
      const normalizedPref = preferredLanguage.trim()
      const reordered = [normalizedPref, ...langs.filter((l: string) => l !== normalizedPref)]
      profile = {
        ...profile,
        profileData: {
          ...(profile?.profileData || {}),
          meta: {
            ...(profile?.profileData?.meta || {}),
            languages: reordered.length ? reordered : langs
          }
        }
      }
    }
    const primaryLanguage = (profile?.profileData?.meta?.languages?.[0]) || preferredLanguage || 'English'
    const baseStyle = profile ? await getBaseStyle(jurisdiction) : null
    const archetypeList = this.normalizeArchetypeList(
      (idea as any)?.normalizedData?.inventionType ?? (idea as any)?.inventionType,
      (idea as any)?.fieldOfRelevance || (idea as any)?.normalizedData?.fieldOfRelevance || ''
    )
    const archetype = archetypeList.join('+')
    const archetypeGuidance = this.getArchetypeInstructions(archetype)
    const priorArtSelections: Array<{ patentNumber: string; title?: string; snippet?: string; score?: number; tags?: string[]; userNotes?: string }> =
      (((session as any).relatedArtSelections || (session as any).priorArt || []) as any[]).filter(
        (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
      )

    const styleLines = [
      `Language: ${primaryLanguage}`,
      `Tone: ${baseStyle?.tone || 'technical, neutral, precise'}`,
      `Voice: ${baseStyle?.voice || 'impersonal third person'}`,
      `Avoid: ${Array.isArray(baseStyle?.avoid) ? baseStyle?.avoid.join(', ') : (baseStyle?.avoid || 'marketing language, unsupported advantages')}`
    ].join('\n')

    const sectionLines = sections.map((s, idx) => {
      const constraintText = (s.constraints && s.constraints.length) ? `Constraints: ${s.constraints.join('; ')}` : ''
      return `${idx + 1}. ${s.label} (${s.key})${s.required ? ' [required]' : ''}${constraintText ? `\n   ${constraintText}` : ''}`
    }).join('\n')

    const requiredKeys = sections.map(s => `"${s.key}"`).join(', ')

    const referenceSource = (sourceJurisdiction || session?.jurisdictionDraftStatus?.__sourceOfTruth || session?.draftingJurisdictions?.[0] || jurisdiction || '').toString().toUpperCase()
    const referenceBlock = referenceDraft
      ? `\nREFERENCE DRAFT (source jurisdiction ${referenceSource}):\n${String(referenceDraft.fullDraftText || '').slice(0, 2000)}${String(referenceDraft.fullDraftText || '').length > 2000 ? '... [truncated]' : ''}\n\nUse this as the baseline; adapt ordering/headings/limits to ${jurisdiction} but do not invent new content beyond the reference.`
      : ''

    return `You are drafting a ${jurisdiction} patent specification.
Apply these style rules:
${styleLines}

ARCHETYPE PROTOCOL:
- Archetype: ${archetype}
${archetypeGuidance}

INVENTION CONTEXT:
Title: ${idea.title}
Problem: ${idea.problem || 'Not specified'}
Objectives: ${idea.objectives || 'Not specified'}
Components: ${components.map(c => `${c.name} (${c.numeral})`).join(', ')}
Logic: ${idea.logic || 'Not specified'}
${figures.length > 0 ? `Figures: ${figures.map(f => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}
${priorArtSelections.length > 0 ? `Prior art for context (approved): ${priorArtSelections.slice(0,6).map(p=>`${p.patentNumber}${p.title?`: ${p.title}`:''}`).join(' | ')}` : ''}

${referenceBlock}

REQUIRED SECTIONS AND ORDER (return all keys even if blank):
${sectionLines}

OUTPUT FORMAT:
- Return ONLY JSON object with keys: ${requiredKeys}
- Do not include markdown or explanations.
`
  }

  /**
   * Parse LLM response into structured draft sections (JSON-first, profile-aware)
   */
  private static parseDraftResponse(output: string, sectionDefs: Array<{ key: string; altKeys: string[] }>): { success: boolean; draft?: any; error?: string } {
    try {
      let parsed: any = null
      let text = (output || '').trim()
      // Extract fenced JSON if present
      const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
      let merged: Record<string, any> = {}
      let fenceCount = 0
      let m: RegExpExecArray | null
      while ((m = fenceRegex.exec(text)) !== null) {
        let block = (m[1] || '').trim()
        if (!block) continue
        block = block.replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')
        try {
          let obj: any
          try { obj = JSON.parse(block) } catch { obj = JSON.parse(block.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')) }
          if (obj && typeof obj === 'object') { merged = { ...merged, ...obj }; fenceCount++ }
        } catch {}
      }
      if (fenceCount > 0) {
        parsed = merged
      } else {
        let jsonText = text
        const start = jsonText.indexOf('{')
        if (start !== -1) jsonText = jsonText.slice(start)
        jsonText = jsonText.replace(/```/g, '').replace(/,(\s*[}\]])/g, '$1').replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '')
        parsed = JSON.parse(jsonText)
      }

      const draft: Record<string, string> = {}
      for (const def of sectionDefs) {
        const keysToCheck = [def.key, ...def.altKeys]
        let val = ''
        for (const k of keysToCheck) {
          if (typeof parsed?.[k] === 'string' && parsed[k].trim()) { val = parsed[k].trim(); break }
        }
        draft[def.key] = val || ''
      }

      // Build full text
      const fullText = Object.entries(draft)
        .filter(([key, value]) => value && key !== 'title')
        .map(([key, value]) => `${key.toUpperCase().replace(/([A-Z])/g, ' $1').trim()}:\n\n${value}`)
        .join('\n\n');

      return { success: true, draft: { ...draft, fullText } }
    } catch (error) {
      return { success: false, error: 'Failed to parse draft response' }
    }
  }

  /**
   * Validate draft consistency with components and figures
   */
  private static validateDraftConsistency(draft: any, session: any): { valid: boolean; report: any } {
    const report = {
      numeralConsistency: true,
      figureReferences: true,
      missingNumerals: [],
      unusedNumerals: [],
      invalidReferences: []
    };

    try {
      // Extract all numerals from draft text
      const numeralRegex = /\((\d{2,3})\)/g;
      const usedNumerals = new Set<number>();
      let match;

      const fullText = draft.fullText || '';
      while ((match = numeralRegex.exec(fullText)) !== null) {
        usedNumerals.add(parseInt(match[1]));
      }

      // Check against reference map
      const referenceNumerals = new Set<number>();
      if (session.referenceMap?.components) {
        for (const component of session.referenceMap.components) {
          referenceNumerals.add(component.numeral);
        }
      }

      // Find missing and unused numerals
      referenceNumerals.forEach((refNum: number) => {
        if (!usedNumerals.has(refNum)) {
          (report.missingNumerals as Array<number>).push(refNum);
        }
      });

      usedNumerals.forEach((usedNum: number) => {
        if (!referenceNumerals.has(usedNum)) {
          (report.unusedNumerals as Array<number>).push(usedNum);
        }
      });

      // Check figure references
      const figureRegex = /Fig\.?\s*(\d+)/gi;
      const referencedFigures = new Set<number>();
      while ((match = figureRegex.exec(fullText)) !== null) {
        referencedFigures.add(parseInt(match[1]));
      }

      const availableFigures = new Set<number>((session.figurePlans?.map((f: any) => f.figureNo) || []));
      referencedFigures.forEach((refFig: number) => {
        if (!availableFigures.has(refFig)) {
          (report.invalidReferences as Array<string | number>).push(`Figure ${refFig}`);
        }
      });

      report.numeralConsistency = report.missingNumerals.length === 0 && report.unusedNumerals.length === 0;
      report.figureReferences = report.invalidReferences.length === 0;

      return {
        valid: report.numeralConsistency && report.figureReferences,
        report
      };

    } catch (error) {
      return {
        valid: false,
        report: {
          error: 'Validation failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Extended rule-based validator (no LLM) covering IPO-focused checks
   */
  static validateDraftExtended(draftObj: any, session: any, profile?: any | null, jurisdiction?: string): { valid: boolean; report: any } {
    const textNorm = (s: string) => (s || '').replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
    const wordCount = (s: string) => (textNorm(s).match(/\b\w+\b/g) || []).length
    const activeJurisdiction = (jurisdiction || session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()
    const sectionChecks = profile?.profileData?.validation?.sectionChecks || {}
    const getLimit = (sectionId: string, type: 'maxWords' | 'maxChars' | 'maxCount') => {
      const internal = this.mapToInternalKey(sectionId) || sectionId
      const arr = sectionChecks[internal] || sectionChecks[sectionId] || []
      const rule = Array.isArray(arr) ? arr.find((c: any) => c?.type === type && typeof c.limit === 'number') : undefined
      return rule?.limit
    }

    const last = draftObj || {}
    const report: any = {
      wordCounts: {},
      abstract: {},
      bdod: {},
      figures: {},
      numerals: {},
      claims: {},
      bestMethod: {},
      industrialApplicability: {},
      terminology: {},
      section3Flags: [],
      sectionPresence: {},
      complianceScore: 100,
      hardFail: false
    }

    const title = textNorm(last.title || '')
    const abstract = textNorm(last.abstract || '')
    const fieldOfInvention = textNorm(last.fieldOfInvention || '')
    const background = textNorm(last.background || '')
    const summary = textNorm(last.summary || '')
    const bdod = (last.briefDescriptionOfDrawings || '').replace(/\r/g, '')
    const detailed = textNorm(last.detailedDescription || '')
    const bestMethod = textNorm(last.bestMethod || '')
    const claims = (last.claims || '').replace(/\r/g, '')
    const industrial = textNorm(last.industrialApplicability || '')
    const numeralsList = (last.listOfNumerals || '').replace(/\r/g, '')

    report.wordCounts = {
      title: wordCount(title),
      abstract: wordCount(abstract),
      fieldOfInvention: wordCount(fieldOfInvention),
      background: wordCount(background),
      summary: wordCount(summary),
      bdod: wordCount(bdod),
      detailed: wordCount(detailed),
      bestMethod: wordCount(bestMethod),
      claims: wordCount(claims),
      industrialApplicability: wordCount(industrial),
      listOfNumerals: wordCount(numeralsList)
    }

    const titleMaxWords = getLimit('title', 'maxWords')
    const titleMaxChars = getLimit('title', 'maxChars')
    report.title = { length: report.wordCounts.title, maxWords: titleMaxWords, maxChars: titleMaxChars }
    if ((titleMaxWords && report.wordCounts.title > titleMaxWords) || (titleMaxChars && title.length > titleMaxChars)) {
      report.hardFail = true; report.complianceScore -= 5
    }

    // P0: Abstract discipline
    const abstractForbidden = /(\bnovel\b|\binventive\b|\bunique\b|\bbest\b|\badvantage\b|\bbenefit\b|\bclaim\b|\bclaims\b)/i
    const abstractDigits = /\d/
    const absLen = report.wordCounts.abstract
    const absForbiddenHits = (abstractForbidden.test(abstract) ? ['lexicon'] : [])
    const absMaxWords = getLimit('abstract', 'maxWords')
    const absMaxChars = getLimit('abstract', 'maxChars')
    const abstractStartsWithTitle = !!(title && abstract && abstract.startsWith(title))
    report.abstract = {
      digits: abstractDigits.test(abstract),
      forbiddenHits: absForbiddenHits,
      length: absLen,
      maxWords: absMaxWords,
      maxChars: absMaxChars,
      startsWithTitle: abstractStartsWithTitle
    }
    if ((absMaxWords && absLen > absMaxWords) || absForbiddenHits.length > 0) {
      report.hardFail = true; report.complianceScore -= 10
    }
    if (absMaxChars && abstract.length > absMaxChars) {
      report.hardFail = true; report.complianceScore -= 5
    }
    // Only treat "must start with title" as a strict rule for Indian practice
    if (activeJurisdiction === 'IN' && !abstractStartsWithTitle) {
      report.complianceScore -= 3
    }

    // P0: BDOD format & coverage
    const planFigures = (session.figurePlans || []).map((f:any)=>f.figureNo)
    const bdodLines = bdod.split(/\n+/).map((l: string)=>l.trim()).filter(Boolean)
    const figRefRegex = /\b(Fig\.?|Figure)\s*0*(\d+)\b/i
    const normalizedLines = bdodLines.map((l: string) => l.replace(/^\s*(?:Figure|FIG\.|Fig\.)\s*0*(\d+)/i, (m: string, g1: string) => `Fig. ${g1}`))
    const seen = new Set<number>()
    const overlength: number[] = []
    const missing: number[] = []
    const extra: number[] = []
    const formatViolations: number[] = []
    normalizedLines.forEach((l: string, idx: number) => {
      const wc = wordCount(l)
      if (wc > 40) overlength.push(idx+1)
      const m = l.match(/^Fig\.\s*(\d+)\s*[G-]/)
      if (!m) { formatViolations.push(idx+1); return }
      const num = parseInt(m[1], 10)
      if (!planFigures.includes(num)) extra.push(num)
      seen.add(num)
    })
    planFigures.forEach((n: number) => { if (!seen.has(n)) missing.push(n) })
    report.bdod = { missingFigures: missing, extraFigures: extra, overlengthLines: overlength, formatViolations }
    if (missing.length>0 || extra.length>0 || overlength.length>0 || formatViolations.length>0) { report.hardFail = true; report.complianceScore -= 10 }

    // P0: Industrial Applicability
    const iaPresent = industrial.length>0
    const iaLen = report.wordCounts.industrialApplicability
    const iaForbidden = abstractForbidden.test(industrial)
    const iaMaxWords = getLimit('industrialApplicability', 'maxWords')
    const iaMaxChars = getLimit('industrialApplicability', 'maxChars')
    report.industrialApplicability = {
      present: iaPresent,
      length: iaLen,
      forbiddenHits: iaForbidden ? ['lexicon'] : [],
      maxWords: iaMaxWords,
      maxChars: iaMaxChars,
      startsWith: undefined as boolean | undefined
    }
    if (!iaPresent) { report.hardFail = true; report.complianceScore -= 10 }
    if (iaMaxWords && iaLen > iaMaxWords) { report.hardFail = true; report.complianceScore -= 5 }
    if (iaMaxChars && industrial.length > iaMaxChars) { report.hardFail = true; report.complianceScore -= 5 }
    if (activeJurisdiction === 'IN') {
      const iaStarts = industrial.startsWith('The invention is industrially applicable to')
      report.industrialApplicability.startsWith = iaStarts
      if (!iaStarts || iaLen < 50) { report.hardFail = true; report.complianceScore -= 5 }
    }

    // P0: Numeral integrity expanded (treat only three-digit numerals 100G999 as reference numerals)
    const numRegex = /\((\d{3})\)/g
    const used = new Map<number, number>()
    const fullText = textNorm([
      title, fieldOfInvention, background, summary, normalizedLines.join('\n'), detailed, bestMethod, claims, industrial, numeralsList
    ].join('\n'))
    let m: RegExpExecArray | null
    while ((m = numRegex.exec(fullText)) !== null) {
      const n = parseInt(m[1],10); used.set(n,(used.get(n)||0)+1)
    }
    const declared = new Set<number>((session.referenceMap?.components||[]).map((c:any)=>c.numeral))
    const declaredNotUsed: number[] = []; declared.forEach(n=>{ if(!used.has(n)) declaredNotUsed.push(n) })
    const usedNotDeclared: number[] = []; used.forEach((_,n)=>{ if(!declared.has(n)) usedNotDeclared.push(n) })
    // Repeated mentions of the same numeral across the specification are expected; do not treat as an error here.
    const duplicates: number[] = []
    report.numerals = { declaredNotUsed, usedNotDeclared, duplicates, styleViolations: 0 }
    if (usedNotDeclared.length>0) { report.hardFail = true; report.complianceScore -= 10 }

    // P0: Figure integrity (invalid refs anywhere; coverage outside BDOD)
    const figureRefRegex = /\b(Fig\.?|Figure)\s*0*(\d+)\b/gi
    const refs = new Set<number>()
    let fm: RegExpExecArray | null
    while ((fm = figureRefRegex.exec(fullText)) !== null) { refs.add(parseInt(fm[2],10)) }
    const availableSet = new Set<number>(planFigures)
    const invalidReferences: number[] = []; refs.forEach(n=>{ if(!availableSet.has(n)) invalidReferences.push(n) })
    const outsideText = textNorm([summary,detailed,claims].join('\n'))
    const coverage: any = { mentionedOutsideBDOD: [] }
    planFigures.forEach((n: number) => { coverage.mentionedOutsideBDOD.push(new RegExp(`\\b(Fig\\.?|Figure)\\s*0*${n}\\b`,'i').test(outsideText)) })
    report.figures = { invalidReferences, coverage }
    if (invalidReferences.length>0) { report.hardFail = true; report.complianceScore -= 10 }

    // P0: Claims hygiene
    const forbiddenClaims = /(and\/or|etc\.|approximately|substantially)/i
    const vagueAdj = /(\bnear\b|\bfast\b|\befficient\b|\boptimal\b|\brobust\b|\bsecure\b)/ig
    const claimBlocks = claims.split(/\n\s*(?=\d+\.)/).map((s: string)=>s.trim()).filter(Boolean)
    const totalClaims = claimBlocks.length
    const independentWords = claimBlocks[0] ? wordCount(claimBlocks[0].replace(/^\d+\./,'')) : 0
    const claimsMaxCount = getLimit('claims', 'maxCount')
    // naive dependency depth: count "claim X" chains
    const depDepthRegex = /claim\s+(\d+)/ig
    let depthMax = 1
    claimBlocks.forEach((cb: string) => {
      const chain = Array.from(cb.matchAll(depDepthRegex)).map((m: RegExpMatchArray)=>parseInt(m[1],10))
      depthMax = Math.max(depthMax, chain.length || 1)
    })
    const forbiddenHits = forbiddenClaims.test(claims) ? ['lexicon'] : []
    const antecedentFailures: string[] = []
    // basic antecedent: fail if 'the ' appears before any ' a/an ' in the same claim (rough heuristic)
    claimBlocks.forEach((cb: string, i: number)=>{
      const body = cb.toLowerCase()
      if (body.indexOf(' the ') !== -1 && body.indexOf(' a ') === -1 && body.indexOf(' an ') === -1) antecedentFailures.push(`claim ${i+1}`)
    })
    report.claims = {
      total: totalClaims,
      independents: totalClaims>0?1:0,
      maxIndependentWords: independentWords,
      dependencyDepthMax: depthMax,
      forbiddenHits,
      antecedentFailures,
      maxCount: claimsMaxCount
    }
    if ((claimsMaxCount && totalClaims > claimsMaxCount) || forbiddenHits.length>0) { report.hardFail = true; report.complianceScore -= 10 }

    // P0: Best Method sufficiency
    const hasNumeric = /\d/.test(bestMethod)
    const hedges = (bestMethod.match(/\b(may|could|might|preferred|ideally)\b/gi) || []).length
    const tokens = (bestMethod.match(/\b\w+\b/g) || []).length || 1
    const hedgingDensity = hedges / tokens
    report.bestMethod = { hasNumeric, hedgingDensity }
    if (!hasNumeric || hedgingDensity > 0.03) { report.hardFail = true; report.complianceScore -= 10 }

    // P1: Field/Background tone (simple)
    const badTone = /(holistic|breakthrough|revolutionary)/i
    if (badTone.test(background)) report.complianceScore -= 2
    // If a field/technical-field maxWords rule exists in the profile, use that; otherwise do not enforce a hard 40–80 range globally
    const fieldMaxWords = getLimit('fieldOfInvention', 'maxWords') || getLimit('technical_field', 'maxWords') || getLimit('field', 'maxWords')
    if (fieldMaxWords && report.wordCounts.fieldOfInvention > fieldMaxWords) {
      report.complianceScore -= 2
    }

    // P1: List of numerals hygiene
    const listLines = numeralsList.split(/\n+/).map((l: string)=>l.trim()).filter(Boolean)
    const listNums = listLines.map((l: string) => { const m = l.match(/\((\d{1,5})\)\s*[G-]\s*/); return m?parseInt(m[1],10):null }).filter((n: number | null)=>n!==null) as number[]
    const ascending = listNums.every((n: number, i: number, arr: number[])=> i===0 || arr[i-1]<=n)
    const dupList = listNums.filter((n: number, i: number, arr: number[])=> arr.indexOf(n) !== i)
    report.numerals.list = { ascending, duplicates: dupList }
    if (!ascending || dupList.length>0) report.complianceScore -= 4

    // P1: Section 3 India red-flags (simple regex) – only for IN
    const s3Flags: any[] = []
    if (activeJurisdiction === 'IN') {
      const addFlag = (clause: string, phrase: string, location: string, severity: 'warn' | 'fail') =>
        s3Flags.push({ clause, phrase, location, severity })
      if (/algorithm\s+per\s*se/i.test(claims)) addFlag('3(k)', 'algorithm per se', 'claims', 'fail')
      if (/computer\s+program\s+product/i.test(claims)) addFlag('3(k)', 'computer program product', 'claims', 'warn')
      if (/diagnos|therapy/i.test(claims)) addFlag('3(i)', 'diagnosis/therapy', 'claims', 'warn')
      if (s3Flags.some(f => f.severity === 'fail')) { report.hardFail = true; report.complianceScore -= 10 }
    }
    report.section3Flags = s3Flags

    // Final decision
    return { valid: !report.hardFail, report }
  }
}
