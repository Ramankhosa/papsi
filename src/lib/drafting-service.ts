import { llmGateway, executePatentDrafting } from './metering/gateway';
import { prisma } from './prisma';
import { verifyJWT } from './auth';
import crypto from 'crypto';

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

export interface SectionGenerationResult {
  success: boolean;
  generated?: Record<string, string>;
  debugSteps?: Array<{ step: string; status: 'ok'|'fail'; meta?: any }>;
  llmMeta?: { model?: string; promptHash?: string; params?: any };
  error?: string;
}

export class DraftingService {

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
        user.tenantId || undefined
      );

      if (!normalizationResult.success) {
        return { success: false, error: normalizationResult.error || 'Failed to normalize idea' };
      }

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
    areaOfInvention?: string
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

      const prompt = `You are an expert patent attorney specializing in drafting and structuring patent disclosures across all domains (mechanical, electrical, software, biotech, chemistry, medical devices, materials, aerospace, etc.)${domainExpertise}.

Task: Read the invention description and output ONLY a valid JSON object capturing the key drafting elements.

Rules (must follow strictly):
- Output MUST be a single JSON object, no code fences, no backticks, no prose.
- Use concise, formal patent language suitable for specification drafting.
- Keep each field as a single string (no arrays), except: "components" (array of objects), "cpcCodes" (array of strings), and "ipcCodes" (array of strings).
- Additionally, provide a compact "searchQuery" string (≤ 25 words) optimized for PQAI prior-art search. This should be plain text, ASCII-safe, no quotes, no brackets, no CPC/IPC codes, no labels. Include only essential technical nouns/verbs.
- Use double-quoted keys and strings; avoid line breaks mid-sentence when possible.
 - Keep content succinct; avoid redundancy and marketing language.
 - Components: return up to 8 items maximum by default (more only if essential). Use hierarchy when helpful (module → submodule → sub-submodule). Keep each item's description to one sentence.

TITLE: ${title}

INVENTION DESCRIPTION:
${rawIdea}

Respond in this exact JSON shape:
{
  "searchQuery": "concise plain-text search query (≤25 words, ASCII, no quotes/brackets)",
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
  "abstract": "≤150 words abstract that begins exactly with the title; neutral tone; no claims/advantages/numerals",
  "cpcCodes": ["primary CPC code like H04L 29/08", "optional secondary"],
  "ipcCodes": ["primary IPC code like G06F 17/30", "optional secondary"]
}`;

      console.log('Calling LLM gateway with taskCode: LLM2_DRAFT');

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const llmResult = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId },
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
      const extractedFields = {
        searchQuery: typeof normalizedData.searchQuery === 'string' ? String(normalizedData.searchQuery).trim() : undefined,
        problem: normalizedData.problem,
        objectives: normalizedData.objectives,
        components: normalizedData.components,
        logic: normalizedData.logic,
        inputs: normalizedData.inputs,
        outputs: normalizedData.outputs,
        variants: normalizedData.variants,
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
    selectedPatents?: any[]
  ): Promise<SectionGenerationResult> {
    const debugSteps: Array<{ step: string; status: 'ok'|'fail'; meta?: any }> = []
    try {
      // Step: gather context
      const idea = session.ideaRecord || {}
      const referenceMap = session.referenceMap || { components: [] }

      // Gather prior art data for background section
      const manualPriorArt = (session as any).manualPriorArt || null
      const relatedArtSelections = session.relatedArtSelections || []
      const aiAnalysis = (session as any).aiAnalysisData || {}

      // Strategy: Use user-selected patents first, fallback to adjacent patents
      let selectedPriorArtPatents = []

      if (selectedPatents && selectedPatents.length > 0) {
        // User has explicitly selected patents - use those (up to 5-6 most relevant)
        selectedPriorArtPatents = selectedPatents
          .map((sel: any) => {
            // Find the full patent data from relatedArtSelections and merge with AI analysis
            const fullPatentData = relatedArtSelections.find((r: any) => r.patentNumber === sel.patentNumber) || sel
            return {
              ...fullPatentData,
              aiSummary: aiAnalysis[sel.patentNumber]?.aiSummary || '',
              noveltyComparison: aiAnalysis[sel.patentNumber]?.noveltyComparison || '',
              noveltyThreat: aiAnalysis[sel.patentNumber]?.noveltyThreat || 'unknown'
            }
          })
          .sort((a: any, b: any) => {
            // Sort by relevance score (higher first)
            const scoreA = a.score || 0
            const scoreB = b.score || 0
            return scoreB - scoreA
          })
          .slice(0, 6) // Take top 6 user-selected patents
      } else {
        // No user selections
        if (manualPriorArt?.useOnlyManualPriorArt) {
          // Respect user preference: do not include AI prior art
          selectedPriorArtPatents = []
        } else {
          // Fallback to adjacent category patents (top 6)
          selectedPriorArtPatents = relatedArtSelections
            .filter((sel: any) => {
              // Find AI analysis for this patent
              const analysis = aiAnalysis[sel.patentNumber]
              return analysis?.noveltyThreat === 'adjacent'
            })
            .map((sel: any) => ({
              ...sel,
              aiSummary: aiAnalysis[sel.patentNumber]?.aiSummary || '',
              noveltyComparison: aiAnalysis[sel.patentNumber]?.noveltyComparison || '',
              noveltyThreat: aiAnalysis[sel.patentNumber]?.noveltyThreat || 'adjacent'
            }))
            .sort((a: any, b: any) => {
              // Sort by relevance score (higher first)
              const scoreA = a.score || 0
              const scoreB = b.score || 0
              return scoreB - scoreA
            })
            .slice(0, 6) // Take top 6 adjacent patents as fallback
        }
      }

      // Merge figures from plans and uploaded images
      const planFigures = session.figurePlans || []
      const imageBacked = (session.diagramSources || [])
        .filter((d: any) => d?.imageUploadedAt)
        .map((d: any) => ({ figureNo: d.figureNo, title: planFigures.find((f:any)=>f.figureNo===d.figureNo)?.title || `Figure ${d.figureNo}` }))
      const mergedByNo = new Map<number, any>()
      for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
      for (const f of imageBacked) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
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

      // Build payload available across sections
      const payload = { idea, referenceMap, figures, approved: session.annexureDrafts?.[0] || {}, instructions: instructions || {}, manualPriorArt, selectedPriorArtPatents }

      // Step: call LLM per section with single-section schema
      const request = { headers: requestHeaders || {} }
      const generated: Record<string, string> = {}
      let llmMeta: any = undefined

      for (const s of sections) {
        const prompt = this.buildSectionPrompt(s, payload)
        debugSteps.push({ step: `build_prompt_${s}`, status: 'ok' })

        // Increase tokens for long sections
        const sectionMaxTokens = s === 'detailedDescription' ? 6000 : undefined

        const result = await llmGateway.executeLLMOperation(request, {
          taskCode: 'LLM2_DRAFT',
          prompt,
          parameters: { tenantId, ...(sectionMaxTokens && { maxOutputTokens: sectionMaxTokens }) },
          idempotencyKey: crypto.randomUUID()
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
            // Drop old parentheses IDs tied to old labels, they’ll be reattached on first mention
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
        let check = this.guardrailCheck(s, val, referenceMap, figures, approvedTitle)
        if (!check.ok) {
          debugSteps.push({ step: `critic_${s}`, status: 'fail', meta: { reason: check.reason } })
          const fixed = this.minimalFix(s, val, { reason: check.reason, approvedTitle, referenceMap, figures })
          if (fixed && fixed.trim() && fixed !== val) {
            val = fixed.trim()
            const recheck = this.guardrailCheck(s, val, referenceMap, figures, approvedTitle)
            if (recheck.ok) {
              debugSteps.push({ step: `fixer_${s}`, status: 'ok', meta: { applied: true, fixedTo: val.substring(0, 100) + '...' } })
              generated[s] = val
              debugSteps.push({ step: `guard_${s}`, status: 'ok' })
            } else {
              debugSteps.push({ step: `fixer_${s}`, status: 'fail', meta: { reason: recheck.reason, fixedTo: val.substring(0, 100) + '...' } })
              if (s === 'abstract' && recheck.reason === 'Abstract must not include numerals/figure refs') {
                debugSteps.push({ step: `guard_${s}`, status: 'ok', meta: { note: 'Allowing abstract with numerals for partial generation' } })
                generated[s] = val
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

  private static buildSectionPrompt(section: string, payload: any): string {
    const { idea, referenceMap, figures, approved, instructions, manualPriorArt, selectedPriorArtPatents } = payload
    const numerals = (referenceMap?.components || []).map((c: any) => `${c.name} (${c.numeral})`).join(', ')
    const figs = (figures || []).map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
    const instr = (instructions && instructions[section]) ? String(instructions[section]) : 'none'

    const roleToneHeader = `
You are a **Senior Indian Patent Attorney and Technical Drafter** preparing the "${section}" section
of an **Indian Patent Form-2 Complete Specification** (as per the Patents Rules, 2003).
Maintain a **precise, formal, and neutral tone** throughout.
Write in the **impersonal third person** (no “I”, “we”, or “our”).
Prefer **short, declarative sentences**. Avoid marketing, advocacy, speculation, or emotional adjectives.
Use **Indian English** spelling and conventions.
Follow all professional drafting norms used in the Indian Patent Office.

Before emitting output, apply this internal self-checklist:
1. Confirm compliance with section-specific word range (±20% tolerance).
2. Confirm forbidden words (novel, inventive, best, unique, advantage, benefit, claim, claims, etc.) are absent.
3. Confirm all numerals appear in parentheses, match declared ReferenceMap numerals, and no invented numerals appear.
4. Confirm all figure references correspond to existing figures only, using “Fig. X” format.
5. Confirm tone is technical, objective, and impersonal.
6. Confirm no claim language appears outside the Claims section.
7. Confirm JSON format matches the requested output schema exactly.
8. Confirm units are SI; ranges are closed (e.g., 5–10 °C, not “about 10”).
9. Confirm antecedent basis and logical consistency where applicable.
10. Confirm the text would be legally and technically acceptable for filing at the Indian Patent Office.

Good tone example: "The controller (110) regulates voltage based on feedback from sensor (120)."
Bad tone example: "This innovative controller smartly manages voltage in the best way possible."
`

    switch (section) {
      case 'title':
        return `
${roleToneHeader}
Task: Generate the Title of the invention for Indian Patent Form-2.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- ≤15 words.
- Must clearly indicate subject matter and function.
- No marketing or evaluative terms (“novel”, “improved”, “smart”, etc.).
- Use nouns/adjectives only as needed for precision.
Context:
title idea=${idea?.title||''}; problem=${idea?.problem||''}; objectives=${idea?.objectives||''}.
Instructions(title): ${instr}.
Target length: ≤15 words.
Output JSON: { "title": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'abstract':
        return `
${roleToneHeader}
Task: Generate the Abstract for Indian Patent Form-2.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 130–150 words (hard cap 150).
- Must **begin exactly** with the approved Title (case- and space-normalized).
- Avoid numeric data unless essential to describe architecture (e.g., layer count, dimension, or temperature).
- No numerals, figure references, or claim terms.
- No evaluative adjectives (“novel”, “inventive”, “unique”, “best”, “advantage”, “benefit”).
- Neutral tone: describe purpose, configuration, and effect briefly.
Context:
approvedTitle=${approved?.title||idea?.title||''}; problem=${idea?.problem||''}; objectives=${idea?.objectives||''}; numerals=[${numerals}]; figures=[${figs}].
Instructions(abstract): ${instr}.
Target length: 130–150 words.
Output JSON: { "abstract": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'fieldOfInvention':
        return `
${roleToneHeader}
Task: Write the Field of Invention.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 40–80 words.
- One short paragraph describing the domain and subdomain.
- Avoid claims or advantages.
- No prior art discussion here; just classification.
Context: field=${idea?.fieldOfRelevance||''}; subfield=${idea?.subfield||''}.
Instructions(fieldOfInvention): ${instr}.
Target length: 40–80 words.
Output JSON: { "fieldOfInvention": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'background': {
        // Prepare prior art references for background section (limit to 5-6 most relevant)
        let priorArtRefs = ''
        let priorArtCount = 0

        // Check if user has manual prior art and their selection
          if (manualPriorArt) {
            if (manualPriorArt.useOnlyManualPriorArt) {
              // Use only manual prior art - extract up to 5-6 most relevant patents
              priorArtRefs = `Available prior-art pool (select 5–6 most relevant):\nManual analysis (user-provided): ${manualPriorArt.manualPriorArtText}`
              priorArtCount = 1 // Represents the manual analysis as one reference block
            } else if (manualPriorArt.useManualAndAISearch) {
              // Use manual prior art + selected prior art patents (total 5-6 references)
              const maxAdditionalPatents = 4 // Reserve slots for manual analysis
              const additionalPatents = selectedPriorArtPatents.slice(0, maxAdditionalPatents)

              const aiLines = additionalPatents.map((patent: any) => {
                const patentNumber = patent.patentNumber || patent.pn || 'Unknown'
                return `- ${patentNumber} — AI relevance: ${patent.aiSummary.substring(0, 200)}... | Novelty: ${patent.noveltyComparison.substring(0, 200)}...`
              }).join('\n')

              priorArtRefs = `Available prior-art pool (select total 5–6 most relevant):\nManual analysis (user-provided): ${manualPriorArt.manualPriorArtText}\n${aiLines ? `\nAI-adjacent patents:\n${aiLines}` : ''}`
              priorArtCount = 2 + additionalPatents.length // Manual (1-2) + additional patents
            }
          } else {
            // No manual prior art
            const maxPatents = 6
            const selectedPatents = selectedPriorArtPatents.slice(0, maxPatents)

            if (selectedPatents.length > 0) {
              const aiLines = selectedPatents.map((patent: any) => {
                const patentNumber = patent.patentNumber || patent.pn || 'Unknown'
                return `- ${patentNumber} — AI relevance: ${patent.aiSummary.substring(0, 200)}... | Novelty: ${patent.noveltyComparison.substring(0, 200)}...`
              }).join('\n')
              priorArtRefs = `Available prior-art pool (select top 5–6 most relevant):\n${aiLines}`
              priorArtCount = selectedPatents.length
            }
          }

        // Debug: emit what we're about to pass to the LLM for prior art
        try {
          const refsForDebug: Array<{label: string; patentNumber?: string}> = []
          // Best-effort parse of the priorArtRefs lines
          priorArtRefs.split('\n').forEach(line => {
            const m = line.match(/^D(\d+):\s*([^\s]+)?/)
            if (m) refsForDebug.push({ label: `D${m[1]}`, patentNumber: m[2] })
          })
          // Log for diagnostics (buildSectionPrompt has no access to debugSteps scope)
          try { console.log('prior_art_refs_built', { count: refsForDebug.length, refs: refsForDebug }) } catch {}
        } catch {}

        return `
${roleToneHeader}
Task: Write the Background of the Invention.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 250–400 words (±20%).
- Describe state of the art and the problem to be solved.
- Do not describe the invention itself.
- Use neutral, factual language ("Existing systems rely on…", "However, these methods…").
- No evaluative terms ("inefficient", "obsolete") unless technically grounded.
- PARAGRAPH STRUCTURE (CRITICAL for patent formatting):
  • Break content into logical paragraphs of 50-120 words each.
  • Each paragraph should contain a complete thought about prior art or problem analysis.
  • Use paragraph breaks (\n\n) to separate distinct prior art references or problem aspects.
  • Ensure content is properly paragraphed for DOCX export processing.
 - Assign labels incrementally by order of first use: D1, then D2, then D3, and so on.
 - On the FIRST mention of a prior-art item, include its unique identifier in parentheses immediately after the label, e.g., "D1 (CN115164845A)", "D2 (US2020379124A1)". After the first mention, refer to the same item only as D1, D2, etc., WITHOUT the identifier.
 - Do NOT invent identifiers. Use exactly the identifiers provided in the "Available Prior Art References" list below. If an identifier is not present for a manual prior-art item, use the D-label without parentheses.
 - IMPORTANT: Use ONLY 5–6 prior-art references total, selecting the most relevant ones that clearly establish novelty and improve patent grant chances.
${priorArtRefs ? `Available Prior Art References:\n${priorArtRefs}\n` : ''}
IMPORTANT: Use ONLY 5–6 total references. If the user's manual prior art includes multiple patents, extract the 1–2 most probative entries that best establish novelty. If additional AI-suggested adjacent references are provided, select the next most relevant 3–4 among them by technical closeness (not by text similarity alone). Do not pre-assign D-labels from the list; assign D1, D2, … in the order you first cite them in the paragraph.
Context: problem=${idea?.problem||''}; field=${idea?.fieldOfRelevance||''}; availablePriorArtReferences=${priorArtCount}.
Instructions(background): ${instr}.
Target length: 250–400 words.
Output JSON: { "background": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      }
      case 'summary':
        return `
${roleToneHeader}
Task: Write the Summary of the Invention.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 200–300 words (±20%).
- High-level description of the inventive concept.
- Use numerals in parentheses, e.g., controller (110).
- Mention only declared components; no invented elements.
- Avoid claims or marketing tone.
- PARAGRAPH STRUCTURE (CRITICAL for patent formatting):
  • Break content into logical paragraphs of 50-120 words each.
  • Each paragraph should contain a complete aspect of the invention summary.
  • Use paragraph breaks (\n\n) to separate distinct components or operational concepts.
  • Ensure content is properly paragraphed for DOCX export processing.
Context numerals=[${numerals}] figures=[${figs}] approvedTitle=${approved?.title||''}.
Instructions(summary): ${instr}.
Target length: 200–300 words.
Output JSON: { "summary": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'briefDescriptionOfDrawings':
        return `
${roleToneHeader}
Task: Write the Brief Description of Drawings (BDOD).
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- One line per figure, format exactly as: "Fig. X — …".
- Each line ≤40 words.
- Mention only existing figures; no extras.
- No advantages or claim verbs.
- If there are N figures, provide N lines in order.
Context figures=[${figs}].
Instructions(briefDescriptionOfDrawings): ${instr}.
Target length: 40–80 words total (≤40 per line).
Output JSON: { "briefDescriptionOfDrawings": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'detailedDescription':
        return `
${roleToneHeader}
Task: Write the Detailed Description of the Invention.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 800–1200 words (±20%).
- Describe complete working of the invention referencing figures and numerals.
- Use numerals in parentheses; all must exist in ReferenceMap.
- No invented numerals/components.
 - Use ONLY the declared components and numerals from ReferenceMap: [${numerals}]. Do not rename, add, or infer any new component beyond this list.
 - Every component mention MUST include its numeral in parentheses on first mention and thereafter at reasonable frequency; do not mention components without numerals.
 - Reference ONLY existing figures: [${figs}]. Do not cite any other figure numbers.
 - Ensure all figure references correspond exactly to declared figures and each figure is cited at least once.
 - If a concept appears necessary but is not present in the declared components, describe behavior using existing components without introducing a new element.
- Use formal stepwise explanation.
- Avoid hedging ("may", "could", "might") unless technically required.
- Describe the technical effect or result produced by the interaction of major components, in neutral, factual terms.
- Frame the description broadly so that analogous embodiments in other technical fields remain encompassed.
- Use causal or sequential connectors to maintain logical flow.
- If applicable, conclude with an optional paragraph on alternative embodiments or permissible variations.
- Ensure all descriptions comply with Section 10(4)(a)–(c) and Rule 13(6) of the Indian Patents Act and Rules, maintaining clarity, sufficiency, and proper reference numerals.
- Maintain unity of invention as per Section 10(5) of the Indian Patents Act; all paragraphs must relate to a single inventive concept.
- Describe each figure's purpose briefly (e.g., "Fig. 1 illustrates system architecture"), ensuring figure references are consistent and sequential.
- Highlight the functional relationship between components using cause–effect phrasing (e.g., "When X occurs, Y is triggered, resulting in Z") to make technical logic clear.
- Include one paragraph describing the technical effect achieved by the cooperative action of key components, using neutral, factual language.
- If the invention involves computation or software, describe the hardware interaction or measurable technical effect to ensure compliance with Section 3(k) exclusions.
- If the invention involves chemical or biological processes, explain measurable outcomes (e.g., reaction rates, yields) without introducing unlisted materials.
- Avoid comparative, subjective, or promotional terms ("better", "improved", "advanced").
- Maintain consistent terminology across all paragraphs; do not alternate between synonyms for the same component.
- If multiple embodiments or use-cases exist, include an "Alternative Embodiments" paragraph to describe permissible modifications while retaining the core inventive concept.
- PARAGRAPH STRUCTURE (CRITICAL for patent formatting):
  • Break content into logical paragraphs of 50-120 words each.
  • Each paragraph should contain a complete thought or step in the description.
  • Use paragraph breaks (\n\n) to separate distinct concepts, components, or operational steps.
  • Ensure content is properly paragraphed for DOCX export processing.
Context numerals=[${numerals}] figures=[${figs}] variants=${idea?.variants||''}.
Instructions(detailedDescription): ${instr}.
Target length: 800–1200 words (±20%).
Output Format (MANDATORY):
Return ONLY a valid JSON object in this exact format:
{"detailedDescription": "paragraph1 content here.\n\nparagraph2 content here.\n\nparagraph3 content here."}
Do NOT include explanations, markdown, comments, or any text outside the JSON object.
The detailedDescription value should contain paragraphs separated by \n\n (double newlines).
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'bestMethod':
        return `
${roleToneHeader}
Task: Write the Best Method (Best Mode) of performing the invention.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- 200–350 words (±20%).
- Must include at least one numeric parameter or reproducible step.
- Avoid vague statements ("may", "could", "preferred", "ideally") unless accompanied by specific conditions.
- Describe the embodiment actually considered best by the inventor.
- PARAGRAPH STRUCTURE (CRITICAL for patent formatting):
  • Break content into logical paragraphs of 50-120 words each.
  • Each paragraph should contain a complete thought or step in the method.
  • Use paragraph breaks (\n\n) to separate distinct operational steps or concepts.
  • Ensure content is properly paragraphed for DOCX export processing.
Context numerals=[${numerals}] figures=[${figs}] variants=${idea?.variants||''}.
Instructions(bestMethod): ${instr}.
Target length: 200–350 words (±20%).
Output Format (MANDATORY):
Return ONLY a valid JSON object in this exact format:
{"bestMethod": "paragraph1 content here.\n\nparagraph2 content here.\n\nparagraph3 content here."}
Do NOT include explanations, markdown, comments, or any text outside the JSON object.
The bestMethod value should contain paragraphs separated by \n\n (double newlines).
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      case 'claims':
        return `
${roleToneHeader}
Task: Draft the Claims section.
Role: You are drafting this section as a professional Indian patent attorney trained in precision drafting under the Indian Patents Act and WIPO-PCT norms.

Rules:
- Structure and length:
  • 1 independent claim (≤150 words) defining the invention as a complete system, device, method, or composition, depending on the context.
  • 6–11 dependent claims (40–80 words each) elaborating specific structural or functional features.
  • Total length: 500–900 words.

- Claim hygiene (MANDATORY):
  • Avoid vague or relative terms such as "and/or", "etc.", "approximately", "substantially", "roughly", or "essentially".
  • Use SI units and closed numeric ranges (e.g., 5–10 °C, 2–4 GHz, 1–3 μm).
  • Maintain clear antecedent basis: first mention uses "a"/"an", all later references use "the" or "said".
  • Each dependent claim must refer directly to the immediately preceding claim (e.g., "The system of claim X, wherein ...").
  • Avoid multi-branch dependencies unless logically required; never create circular references.
  • Keep dependency depth ≤3.
  • Use only the components, steps, materials, numerals, or figures defined in the Detailed Description.
  • Do NOT introduce unlisted elements, undefined acronyms, or speculative functions.
  • Avoid marketing or advantage language ("improves", "enhances", "optimises", etc.).
  • Use technically neutral verbs: "configured to", "adapted to", "operable to", "arranged for", etc.

- Formatting and numbering:
  • Begin with an independent claim numbered "1." followed by dependent claims "2.", "3.", etc., each as a new paragraph.
  • Do not write "Claim (X)" or use parentheses in claim numbers.
  • Dependent claims must begin EXACTLY with: "The [system/device/method/composition] of claim X, wherein ..." using the correct subject from claim 1.
  • Never repeat the preamble verbatim within dependent claims.
  • Parentheses are reserved **only** for component numerals (e.g., sensor (100)); write all other numbers without parentheses or commas inside numeric ranges.

- Legal and structural constraints:
  • Select the most appropriate preamble term among system, device, method, apparatus, network, or composition based on invention context.
  • The independent claim may optionally use a two-part format: "A [system/device/method/composition] ... characterised in that ...".
  • Avoid mixed claim types; if claim 1 defines a "method", dependents must continue as "The method of claim X".
  • Ensure all features claimed have explicit support in the Detailed Description and correspond to declared numerals and figures.
  • Each dependent claim must introduce a new structural or functional limitation that contributes logically to the technical effect described in the invention objectives.
  • Express relationships using functional causality where possible ("configured to X so as to Y") to clarify the invention's technical contribution.
  • Maintain logical progression: start from broad architecture → key subsystems/steps → specific refinements → parameter ranges → implementation details.
  • For method claims, list steps using gerunds (e.g., "receiving", "processing", "transmitting") instead of component nouns.
  • For compositions or materials, focus on constituents, proportions, and functional relationships.
  • The final claim set must be self-contained, technically coherent, and free of redundancy.

Context numerals=[${numerals}] figures=[${figs}] objectives=${idea?.objectives||''}.
Instructions(claims): ${instr}.
Target length: 500–900 words total.
Output JSON: { "claims": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or text outside JSON.
Ensure total word count remains within ±20% of the target. If exceeding, compress secondary dependent claims instead of truncating definitions.
`
      case 'industrialApplicability':
        return `
${roleToneHeader}
Task: Write the Industrial Applicability statement.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy, WIPO-PCT compliance, and legal neutrality.
Rules:
- Output length: 50–100 words.
- Must begin exactly with the phrase: "The invention is industrially applicable to" (verbatim, lowercase "to").
- Mention only sectors that are contextually relevant to the given invention, derived from:
    field=${idea?.fieldOfRelevance||'general engineering'}; subfield=${idea?.subfield||'applied technology'}.
- Include a brief explanation of how the invention can be made or used in such industries (e.g., manufactured, deployed, or integrated).
- Maintain a legally neutral tone; do NOT mention benefits, advantages, or performance claims.
- Avoid listing unrelated sectors (e.g., medical or automotive) unless directly tied to the field context.
- Use a single cohesive paragraph; no bullet points or line breaks.
- Ensure grammatical completeness; if near word limit, compress phrasing rather than truncate mid-sentence.
- Word range tolerance ±20% of target.
Context:
title=${idea?.title||''}; abstract=${idea?.abstract||''}; field=${idea?.fieldOfRelevance||''}; subfield=${idea?.subfield||''}.
Instructions(industrialApplicability): ${instr}.
Target length: 50–100 words.
Output JSON: { "industrialApplicability": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, or text outside JSON.
`
      case 'listOfNumerals':
        return `
${roleToneHeader}
Task: Generate the List of Reference Numerals.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Rules:
- One line per component in ascending order.
- Format exactly: "(###) — Component Name".
- Use only declared numerals; no duplicates or missing entries.
Context numerals=[${numerals}].
Instructions(listOfNumerals): ${instr}.
Output JSON: { "listOfNumerals": "..." }
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
      default:
        return `
${roleToneHeader}
Task: ${section}.
Role: You are drafting this specific section as a professional Indian patent attorney trained in scientific accuracy and legal neutrality.
Output JSON with key "${section}".
Return ONLY a valid JSON object exactly matching the schema above. Do NOT include explanations, markdown, comments, or line breaks outside JSON.
Ensure total word count remains within ±20% of target length. If exceeding, truncate only closing descriptive sentences, not definitions.
`
    }
  }

  private static wrapMultiSectionPrompt(prompts: Record<string, string>): string {
    const entries = Object.entries(prompts).map(([k,v]) => `SECTION ${k.toUpperCase()}:\n${v}`).join('\n\n')
    return `You are a senior Indian Patent Attorney (IN, Form-2). Return a single JSON object with only the requested keys. No markdown, no commentary.\n\n${entries}`
  }

  private static guardrailCheck(section: string, text: string, referenceMap: any, figures: any[], approvedTitle?: string): { ok: boolean; reason?: string } {
    const onlyExistingFigures = (s: string) => {
      const set = new Set((figures||[]).map((f:any)=>String(f.figureNo)))
      const refs = Array.from(s.matchAll(/Fig\.?\s*(\d+)/gi)).map(m=>m[1])
      return refs.every(r=>set.has(String(r)))
    }
    if (section === 'title') {
      if (text.trim().split(/\s+/).length > 15) return { ok: false, reason: 'Title exceeds 15 words' }
    }
    if (section === 'abstract') {
      if (approvedTitle && !text.startsWith(approvedTitle)) return { ok: false, reason: 'Abstract must start with title' }
      if (text.split(/\s+/).length > 150) return { ok: false, reason: 'Abstract exceeds 150 words' }
      // Note: numerals/figure refs check relaxed for partial generation - will be enforced in full draft
      if (/(novel|inventive|best|unique|claim|claims)/i.test(text)) return { ok: false, reason: 'Improper tone in abstract' }
    }
    // claims-specific normalization should not be performed here; handled in minimalFix
    if (section === 'briefDescriptionOfDrawings') {
      if (!onlyExistingFigures(text)) return { ok: false, reason: 'BDOD references non-existing figure' }
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
      for (let i=0; i<blocks.length; i++) {
        const b = blocks[i]
        const m = b.match(/^(\d+)\./)
        if (!m) return { ok: false, reason: 'Claims must be numbered as \'N. ...\'' }
        const num = parseInt(m[1],10)
        if (num !== expected) return { ok: false, reason: 'Claims numbering not sequential' }
        if (i >= 1) {
          const dep = b.match(/^\d+\.\s*The\s+(system|device|method)\s+of\s+claim\s+(\d+)\b/i)
          if (!dep) return { ok: false, reason: 'Dependent claim must start with “The system of claim X, wherein …”' }
          const ref = parseInt(dep[2],10)
          if (ref !== expected - 1) return { ok: false, reason: 'Dependent claim must depend on immediately preceding claim' }
        }
        expected++
      }
    }
    if (section === 'listOfNumerals') {
      const allowed = new Set((referenceMap?.components||[]).map((c:any)=>c.numeral))
      const refs = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (refs.some(n=>!allowed.has(n))) return { ok: false, reason: 'List includes undeclared numeral' }
    }
    if (section === 'detailedDescription') {
      // Enforce: no undeclared numerals and only existing figure references
      const allowedNums = new Set((referenceMap?.components||[]).map((c:any)=>c.numeral))
      const usedNums = Array.from(text.matchAll(/\((\d{2,3})\)/g)).map(m=>parseInt(m[1],10))
      if (usedNums.some(n=>!allowedNums.has(n))) {
        return { ok: false, reason: 'Detailed Description uses undeclared numeral' }
      }
      if (!onlyExistingFigures(text)) {
        return { ok: false, reason: 'Detailed Description references non-existing figure' }
      }
    }
    if (section === 'industrialApplicability') {
      if (!text.toLowerCase().startsWith('the invention is industrially applicable to')) {
        return { ok: false, reason: 'Must start with "The invention is industrially applicable to"' }
      }
      if (text.split(/\s+/).length > 100) return { ok: false, reason: 'Industrial applicability exceeds 100 words' }
      if (text.split(/\s+/).length < 20) return { ok: false, reason: 'Industrial applicability too short (minimum 20 words)' }
    }
    return { ok: true }
  }

  private static minimalFix(
    section: string,
    text: string,
    ctx: { reason?: string; approvedTitle?: string; referenceMap?: any; figures?: any[] }
  ): string | null {
    let out = String(text || '')
    if (section === 'abstract') {
      // Remove prohibited tone words and claims language
      out = out.replace(/\b(novel|inventive|best|unique|claim|claims)\b/gi, '')
      // Note: numerals/figure refs allowed for partial generation
      // Collapse extra spaces and clean up
      out = out.replace(/\s{2,}/g, ' ').trim()
      // Enforce starts with title if available
      if (ctx.approvedTitle && !out.startsWith(ctx.approvedTitle)) {
        out = `${ctx.approvedTitle} ${out}`.trim()
      }
      // Enforce ≤150 words, and ensure it's meaningful
      const words = out.split(/\s+/).filter(w=>w.length>0)
      if (words.length > 150) out = words.slice(0,150).join(' ')
      if (words.length < 5) out = ctx.approvedTitle || 'Patent invention description.' // Fallback if too short
      return out
    }
    if (section === 'industrialApplicability') {
      // Ensure it starts with the required phrase
      if (!out.toLowerCase().startsWith('the invention is industrially applicable to')) {
        out = `The invention is industrially applicable to ${out}`.trim()
      }
      // Ensure reasonable length
      const words = out.split(/\s+/).filter(w=>w.length>0)
      if (words.length > 100) out = words.slice(0,100).join(' ')
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
      case 'detailedDescription':
        return 'The invention comprises several components working together.'
      case 'bestMethod':
        return 'The best method involves the following steps.'
      case 'claims':
        return '1. A system comprising: components as described.'
      case 'listOfNumerals':
        const nums = (referenceMap?.components || []).map((c: any) => `( ${c.numeral} ) — ${c.name}`).join('\n')
        return nums || '(100) — Main component'
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
      nodes[id] = { id, name: comp.name.trim(), description: comp.description || '', parentId: (comp as any).parentId || null, children: [] };
    }

    // Link children
    Object.values(nodes).forEach((n: any) => {
      if (n.parentId && nodes[n.parentId]) {
        nodes[n.parentId].children.push(n);
      } else {
        roots.push(n);
      }
    });

    // Assign numerals in 100-blocks per root to avoid overlap
    const usedNumerals = new Set<number>();
    let rootIndex = 1; // 100, 200, ... 900

    const assignBlock = (node: any, base: number) => {
      let cursor = base;

      const dfs = (n: any) => {
        if (cursor > base + 99) {
          errors.push(`Too many subcomponents under root block ${base}`);
          return;
        }
        // Assign numeral
        while (usedNumerals.has(cursor) && cursor <= base + 99) cursor++;
        n.numeral = cursor;
        usedNumerals.add(cursor);
        cursor++;
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
        type: 'OTHER',
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
    referenceMap: any
  ): Promise<PlantUMLGenerationResult> {
    try {
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
    requestHeaders?: Record<string, string>
  ): Promise<AnnexureDraftResult> {
    try {
      // Build comprehensive prompt
      const prompt = this.buildAnnexurePrompt(session, jurisdiction, filingType);

      // Execute through LLM gateway
      const request = { headers: requestHeaders || {} };
      const result = await llmGateway.executeLLMOperation(request, {
        taskCode: 'LLM2_DRAFT',
        prompt,
        parameters: { tenantId, jurisdiction, filingType },
        idempotencyKey: crypto.randomUUID()
      });

      if (!result.success || !result.response) {
        return {
          success: false,
          error: result.error?.message || 'Draft generation failed'
        };
      }

      // Parse and structure the draft
      const draftResult = this.parseDraftResponse(result.response.output);

      if (!draftResult.success) {
        return {
          success: false,
          error: draftResult.error
        };
      }

      // Validate draft consistency
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
   * Build comprehensive annexure generation prompt
   */
  private static buildAnnexurePrompt(session: any, jurisdiction: string, filingType: string): string {
    const idea = session.ideaRecord;
    const components: any[] = session.referenceMap?.components || [];
    // Merge planned figures with any uploaded image records to capture all figures
    const planFigures: any[] = session.figurePlans || [];
    const imageBacked: any[] = (session.diagramSources || [])
      .filter((d: any) => d?.imageUploadedAt)
      .map((d: any) => ({ figureNo: d.figureNo, title: planFigures.find((f:any)=>f.figureNo===d.figureNo)?.title || `Figure ${d.figureNo}` }))
    const mergedByNo = new Map<number, any>()
    for (const f of planFigures) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
    for (const f of imageBacked) mergedByNo.set(f.figureNo, { figureNo: f.figureNo, title: f.title })
    const figures: any[] = Array.from(mergedByNo.values()).sort((a,b)=>a.figureNo-b.figureNo)

    // Load selected prior art (Stage 3.5)
    const priorArtSelections: Array<{ patentNumber: string; title?: string; snippet?: string; score?: number; tags?: string[]; userNotes?: string }> = ((session as any).relatedArtSelections || (session as any).priorArt || [])

    let prompt = `Draft complete ${jurisdiction} patent specification.

INVENTION:
Title: ${idea.title}
Problem: ${idea.problem || 'Not specified'}
Objectives: ${idea.objectives || 'Not specified'}
Components: ${components.map(c => `${c.name} (${c.numeral})`).join(', ')}
Logic: ${idea.logic || 'Not specified'}
${figures.length > 0 ? `Figures: ${figures.map(f => `Fig.${f.figureNo}: ${f.title}`).join(', ')}` : ''}
${priorArtSelections.length > 0 ? `
PRIOR ART FOR BACKGROUND/COMPARISON (user-approved):
${priorArtSelections.slice(0,8).map((p,idx)=>{
  const aiContext = p.userNotes && p.userNotes.trim() ? ` | AI: ${p.userNotes.trim()}` : '';
  return `- ${p.patentNumber}${p.title?`: ${p.title}`:''}${typeof p.score==='number'?` (relevance ${(p.score * 100).toFixed(1)}%)`:''}${p.snippet?` — ${p.snippet.slice(0,150)}...`:''}${aiContext}`;
}).join('\n')}
` : ''}

REQUIRED SECTIONS:
1. TITLE (≤15 words)
2. FIELD OF INVENTION
3. BACKGROUND
4. SUMMARY
5. BRIEF DESCRIPTION OF DRAWINGS
6. DETAILED DESCRIPTION (include BEST METHOD subsection)
7. CLAIMS (independent + dependent)
8. ABSTRACT (≤150 words, start with title)
9. LIST OF REFERENCE NUMERALS

Use reference numerals consistently. Follow ${jurisdiction} format.`;

    return prompt;
  }

  /**
   * Parse LLM response into structured draft sections
   */
  private static parseDraftResponse(output: string): { success: boolean; draft?: any; error?: string } {
    try {
      // Split response into sections
      const sections = {
        title: '',
        fieldOfInvention: '',
        background: '',
        summary: '',
        briefDescriptionOfDrawings: '',
        detailedDescription: '',
        bestMethod: '',
        claims: '',
        abstract: '',
        listOfNumerals: ''
      };

      // Simple section extraction (in production, use more robust parsing)
      const sectionPatterns = {
        title: /TITLE:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        fieldOfInvention: /FIELD OF INVENTION:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        background: /BACKGROUND:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        summary: /SUMMARY:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        briefDescriptionOfDrawings: /BRIEF DESCRIPTION OF DRAWINGS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        detailedDescription: /DETAILED DESCRIPTION:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        bestMethod: /BEST METHOD:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        claims: /CLAIMS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        abstract: /ABSTRACT:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$)/i,
        listOfNumerals: /LIST OF.*NUMERALS:?\s*([\s\S]*?)(?=\n[A-Z ]+:|\n\n[A-Z]|$|$)/i
      };

      for (const [key, pattern] of Object.entries(sectionPatterns) as Array<[keyof typeof sectionPatterns, RegExp]>) {
        const match = output.match(pattern);
        if (match) {
          sections[key] = match[1].trim();
        }
      }

      // Validate critical sections
      if (!sections.title || !sections.claims || !sections.abstract) {
        return {
          success: false,
          error: 'Draft missing required sections (title, claims, abstract)'
        };
      }

      // Validate abstract word count
      const abstractWords = sections.abstract.split(/\s+/).length;
      if (abstractWords > 150) {
        sections.abstract = sections.abstract.split(/\s+/).slice(0, 150).join(' ') + '...';
      }

      // Build full text
      const fullText = Object.entries(sections as Record<string, string>)
        .filter(([key, value]) => value && key !== 'title')
        .map(([key, value]) => `${key.toUpperCase().replace(/([A-Z])/g, ' $1').trim()}:\n\n${value}`)
        .join('\n\n');

      return {
        success: true,
        draft: {
          ...sections,
          fullText
        }
      };

    } catch (error) {
      return {
        success: false,
        error: 'Failed to parse draft response'
      };
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
  static validateDraftExtended(draftObj: any, session: any): { valid: boolean; report: any } {
    const textNorm = (s: string) => (s || '').replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
    const wordCount = (s: string) => (textNorm(s).match(/\b\w+\b/g) || []).length

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

    // P0: Abstract discipline
    const normalizeTitle = (s: string) => s
      .toLowerCase()
      .replace(/[“”‘’"']/g, '') // strip quotes
      .replace(/\s+/g, ' ')
      .replace(/^[\s:–—-]+/, '') // strip leading punctuation/space
      .replace(/[.,;:!?]+$/,'')
      .trim()
    const abstractForbidden = /(\bnovel\b|\binventive\b|\bunique\b|\bbest\b|\badvantage\b|\bbenefit\b|\bclaim\b|\bclaims\b)/i
    const abstractDigits = /\d/
    const absLen = report.wordCounts.abstract
    const absStarts = normalizeTitle(abstract).startsWith(normalizeTitle(title))
    const absForbiddenHits = (abstractForbidden.test(abstract) ? ['lexicon'] : [])
    report.abstract = { startsWithTitle: absStarts, digits: abstractDigits.test(abstract), forbiddenHits: absForbiddenHits, length: absLen }
    if (absLen > 150 || !absStarts || absForbiddenHits.length > 0) { report.hardFail = true; report.complianceScore -= 10 }

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
      const m = l.match(/^Fig\.\s*(\d+)\s*[—-]/)
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
    const iaStarts = industrial.startsWith('The invention is industrially applicable to')
    const iaLen = report.wordCounts.industrialApplicability
    const iaForbidden = abstractForbidden.test(industrial)
    report.industrialApplicability = { present: iaPresent, startsWith: iaStarts, length: iaLen, forbiddenHits: iaForbidden?['lexicon']:[] }
    if (!iaPresent || !iaStarts || iaLen<50 || iaLen>100 || iaForbidden) { report.hardFail = true; report.complianceScore -= 10 }

    // P0: Numeral integrity expanded (treat only three-digit numerals 100–999 as reference numerals)
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
      antecedentFailures
    }
    if (totalClaims>12 || independentWords>150 || forbiddenHits.length>0) { report.hardFail = true; report.complianceScore -= 10 }

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
    if (wordCount(fieldOfInvention) < 40 || wordCount(fieldOfInvention) > 80) report.complianceScore -= 2

    // P1: List of numerals hygiene
    const listLines = numeralsList.split(/\n+/).map((l: string)=>l.trim()).filter(Boolean)
    const listNums = listLines.map((l: string) => { const m = l.match(/\((\d{1,5})\)\s*[—-]\s*/); return m?parseInt(m[1],10):null }).filter((n: number | null)=>n!==null) as number[]
    const ascending = listNums.every((n: number, i: number, arr: number[])=> i===0 || arr[i-1]<=n)
    const dupList = listNums.filter((n: number, i: number, arr: number[])=> arr.indexOf(n) !== i)
    report.numerals.list = { ascending, duplicates: dupList }
    if (!ascending || dupList.length>0) report.complianceScore -= 4

    // P1: Section 3 India red-flags (simple regex)
    const s3Flags: any[] = []
    const addFlag = (clause:string, phrase:string, location:string, severity:'warn'|'fail')=> s3Flags.push({ clause, phrase, location, severity })
    if (/algorithm\s+per\s*se/i.test(claims)) addFlag('3(k)','algorithm per se','claims','fail')
    if (/computer\s+program\s+product/i.test(claims)) addFlag('3(k)','computer program product','claims','warn')
    if (/diagnos|therapy/i.test(claims)) addFlag('3(i)','diagnosis/therapy','claims','warn')
    report.section3Flags = s3Flags
    if (s3Flags.some(f=>f.severity==='fail')) { report.hardFail = true; report.complianceScore -= 10 }

    // Final decision
    return { valid: !report.hardFail, report }
  }
}