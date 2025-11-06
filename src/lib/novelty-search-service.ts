import { BasePatentService, LLMResult, User } from './base-patent-service';
import { llmGateway } from './metering/gateway';
import { prisma } from './prisma';
import { TaskCode, NoveltySearchStatus, NoveltySearchStage } from '@prisma/client';
import { PDFReportService } from './pdf-report-service';
import crypto from 'crypto';

// LLM Prompt Specification for Novelty Search (enhanced versions)
export const NOVELTY_SEARCH_NORMALIZATION_PROMPT = `

You are a patent search strategist. Analyze the invention and return ONLY a JSON object.

INVENTION TITLE: {title}

INVENTION DESCRIPTION:

{rawIdea}

OUTPUT FORMAT — Return ONLY valid JSON (one object). No markdown fences, no pre/post text, no explanations.

{

  "searchQuery": "plain-English query ≤35 words describing what the invention is and how it works, suitable for patent database search",

  "invention_features": ["feature 1", "feature 2", "feature 3"]

}

GLOBAL RULES

- Output must be valid JSON (double-quoted keys/values, comma-separated).

- Return only the JSON object; nothing else.

- Use ASCII characters only.

- Do not repeat identical phrases between "searchQuery" and any item in "invention_features".

- Avoid speculative claims, performance metrics, marketing language, or legal claim phrasing.

SEARCH QUERY (field: "searchQuery")

- ≤35 words, plain English, no boolean operators, no special query syntax.

- Convey the core technical concept and the key operating mechanism(s); ignore business use cases and background context.

- Use general technical terms that maximize recall while preserving the invention's distinctive mechanism(s).

FEATURE LIST (field: "invention_features")

- Return 3–8 items; each 3–8 words.

- Each item must be a distinct technical mechanism, structure, configuration, process step, or algorithmic control—not a benefit, result, or application context.

- Phrase features broadly enough to capture synonyms and domain-equivalent terms; avoid proprietary names.

- No overlap or near-duplicates across items.

GENERIC COMPONENT HANDLING

- Do NOT list trivial, everyday components (e.g., processor, memory, sensor, transceiver, database, display, battery, network module, housing, server, API) as standalone features.

- Include such elements ONLY when they play a non-obvious role or participate in a novel configuration/interaction/control logic/material property.

- Prefer integrating generics into higher-level mechanisms (e.g., "feedback-controlled microfluidic delivery" rather than separate "controller" and "pump").

QUALITY FILTERS (apply to both fields)

- Avoid outcome/benefit-only phrases (e.g., "real-time monitoring", "smart control") unless coupled to a concrete mechanism.

- Prefer integrative/feedback mechanisms that tie sensing ↔ processing ↔ actuation (or domain equivalents).

- Remove filler adjectives (e.g., smart, efficient, robust) unless technically specific.

- Keep nouns/noun-phrases primary; verbs only where they define a process step or control logic.

DOMAIN ADAPTATION (choose expressions appropriate to the invention's field)

- Mechanical/Civil/Materials: express mechanisms as configurations, load/flow/thermal paths, material-geometry relationships, joining/fabrication processes, kinematics/actuation.

- Electronics/Embedded/Comms: express data paths, control logic, signal processing chains, power/latency/energy mechanisms, protocol/architecture specifics where non-obvious.

- Software/AI/Data: express model class/learning or inference mechanism, control policy, data structures/flows, algorithmic pipelines; avoid "software module" generics.

- Medical Devices/Biomed: express biosensing/transduction principles, closed-loop control, delivery/actuation mechanisms, physiological interfacing, packaging/form factor integrations.

- Biotech/Pharma/Chem: express molecular structures/classes, formulation components/ratios, binding/interaction mechanisms, reaction pathways, process steps, release profiles, scaffold/vehicle properties.

CONSTRAINTS & VALIDATION

- If the invention has fewer than 3 core mechanisms, return fewer items (do not pad with generic or redundant features).

- Do not include citations, references, or prior-art IDs.

- Do not include units, claims language ("comprising/wherein"), or legal boilerplate.

FAIL-SAFES

- If uncertain, prioritize the most distinctive mid-level mechanisms (integration, control loop, configuration, interaction) over lists of generic parts or high-level benefits.

`;

// Legacy prompts moved to bottom of file

export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT = `You are a patent analyst mapping invention features to prior-art patents.

Return ONLY one valid JSON object.

INPUTS
FEATURES: {invention_features}
PATENTS: {patent_batch} (objects with pn, title, abstract, optional claims, link)

TASK
For every patent and feature, decide:
- "Present" → mechanism clearly described in the text
- "Partial" → related but missing a key element
- "Absent" → not supported by the text

Use title/abstract/claims text only.
Match by meaning (synonyms, paraphrases) but require concrete evidence; generic words like "AI", "sensor", "module", "controller" don't qualify unless they implement the full mechanism.

When Present/Partial, quote ≤25 words from the patent as evidence (direct quote + optional short paraphrase ≤ 20 words).
If Absent, give a ≤20 word reason.

OUTPUT
Return JSON only:

{
  "feature_map": [
    {
      "pn": "string",
      "link": "string|null",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract|claims",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"string",
         "quote":"≤25-word verbatim excerpt",
         "field":"title|abstract|claims",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"string",
         "reason":"≤12 words"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Present = 1.0, Partial = 0.5, Absent = 0 → average → coverage_score.
- Quote required for Present/Partial; reason required for Absent.
- No invented text or assumptions; rely only on given fields.
- Keep ASCII; no markdown, comments, or explanations.`;

// V2: Compact, semantic-aware feature mapping prompt for Stage 3.5a
export const PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V2 = `You are a patent analyst mapping invention FEATURES to prior-art PATENTS. Return ONE JSON object only.

INPUTS
FEATURES: {invention_features}  (array of strings; copy each feature verbatim)
PATENTS: {patent_batch}  (repeated blocks with lines: PN, Title, Abstract)

TASK
For each patent PN, classify EVERY feature EXACTLY ONCE as:
- Present = mechanism clearly described with concrete wording
- Partial = related but missing a required element/constraint
- Absent = no concrete evidence in Title/Abstract

Use Title/Abstract text only.

SEMANTIC MATCHING
- Treat synonyms/paraphrases/hypernyms/hyponyms as matches if they implement the same mechanism.
- Example equivalences:
  - "AI-based image analysis" ~= "computer vision", "intelligent image processing", "image recognition", "machine vision".
  - "object detection" ~= "detecting objects", "localizing targets".
  - "classify images" ~= "image classification", "recognition via ML/CNN model".
- Present when the quote shows the mechanism in action (verb + object). Avoid generic mentions like "AI module" without the image mechanism.
- Partial when related terms appear but a required element/constraint is missing (e.g., the real-time or edge aspect).
- Absent only when no concrete evidence for the mechanism exists in Title/Abstract.

EVIDENCE AND CONFIDENCE
- Quotes must be verbatim and <= 18 words from Title/Abstract; include the decisive mechanism phrase.
- Confidence rubric: 0.9-1.0 explicit phrase match; 0.6-0.8 clear paraphrase; 0.3-0.5 weak/indirect hint.

OUTPUT (JSON only)
{
  "feature_map": [
    {
      "pn": "string",
      "link": "https://patents.google.com/patent/<pn>",
      "coverage": {"present":0,"partial":0,"absent":0},
      "present": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "partial": [
        {"feature":"<copy from FEATURES>",
         "quote":"up to 18 words verbatim",
         "field":"title|abstract",
         "confidence":0.0}
      ],
      "absent": [
        {"feature":"<copy from FEATURES>",
         "reason":"no direct evidence in title/abstract"}
      ]
    }
  ],
  "stats":{"patents_analyzed":0,"features_considered":0}
}

RULES
- Copy FEATURES strings exactly as given (no paraphrase); each feature appears exactly once across present/partial/absent.
- Do not add extra features; do not invent text; rely only on given fields.
- Quotes must be verbatim and <= 18 words; absent reasons <= 8 words.
- ASCII only; JSON only; no markdown, comments, or explanations.
- Output must be valid JSON (double-quoted keys/values, comma-separated).`;

// Legacy prompts moved to bottom to avoid redeclaration

export const PR_35B_NOVELTY_RATIONALE_PROMPT = `You are drafting the analytical narrative for a novelty assessment report.

INPUTS:
- Deterministic metrics (novelty_score, coverage_ratios, uniqueness_per_feature)
- Integration_check (true/false + top_pn)
- Confidence_level
- Invention_features with uniqueness %

STRUCTURE your response:
1️⃣ Integration Analysis – whether any patent integrates most features
2️⃣ Feature Insights – which features remain unique or partially known
3️⃣ Verdict Explanation – how the data supports the decision ("Novel", "Partially Novel", or "Not Novel")

TONE:
- Analytical but concise (3 short paragraphs)
- Avoid repeating numbers already shown in tables
- Use action verbs: "demonstrates", "indicates", "reveals"

Return JSON:
{"structured_narrative": {"integration": "...", "feature_insights": "...", "verdict": "..."}}`;

export const NOVELTY_REPORT_PROMPT = `You are preparing a professional, attorney-grade novelty assessment report with detailed patent-by-patent analysis.

INPUTS:
- invention_features: Array of key invention features
- selected_patents: Intersecting patents (with ≥1 Present/Partial feature), optionally capped to top 1–2 when all features are covered
- search_metadata: Search ID, date, parameters
- patent_details: Full patent information including abstracts, CPC codes, filing dates
- feature_analysis_matrix: Feature overlap percentages for each patent
- structured_narrative: Integration insights and verdict

TASK: Generate a comprehensive report with Table of Contents, hyperlinks, and detailed patent analysis.

OUTPUT JSON STRUCTURE:

{
  "table_of_contents": {
    "title": "Table Of Contents",
    "sections": [
      {"number": "01", "title": "Report", "page": "3", "link": "#report"},
      {"number": "1.1", "title": "Search Metadata Index", "page": "3", "link": "#metadata"},
      {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
      {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
      {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
      {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
      {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
    ]
  },
 "report_metadata": {
   "title": "Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
   "analyst": "SpotIPR AI",
    "total_patents_analyzed": "TOTAL_COUNT",
    "selected_patents_count": "SELECTED_COUNT"
  },
  "section_1_1_search_metadata": {
    "anchor": "metadata",
    "search_id": "SEARCH_ID",
    "search_date": "SEARCH_DATE",
    "jurisdiction": "SEARCH_JURISDICTION",
    "total_patents_found": "TOTAL_COUNT",
    "selection_criteria": "Intersecting references (≥1 Present/Partial feature); if multiple cover all features, top 1–2 by PQAI relevance"
 },
  "section_1_2_key_features": {
    "anchor": "key-features",
    "title": "Key Features Generated from Search Query",
    "features_table": [
      {"number": 1, "description": "FEATURE_TEXT_1"},
      {"number": 2, "description": "FEATURE_TEXT_2"}
    ]
  },
  "section_1_3_summary": {
    "anchor": "summary",
    "title": "Summary",
    "description": "Based on the details of the invention, relevant patent citations are mapped. Further, [COUNT] other patent citations are also shortlisted. Only one patent per family is being mapped and other family members of the family are incorporated by reference. Summary of the citations is presented in the tables below. Clicking on the hyperlinks (Citation No. Column) will open the patent record in Xlpat with full text, family and legal data and the possibility to download the original document.",
    "citations_table": [
      {
        "s_no": 1,
        "citation_no": "PATENT_NUMBER",
        "title": "PATENT_TITLE",
        "publication_date": "YYYYMMDD",
        "link": "https://patents.google.com/patent/PATENT_NUMBER"
   }
    ]
 },
  "section_1_4_feature_analysis": {
    "anchor": "feature-analysis",
    "title": "Key Feature Analysis",
    "description": "The broad key features are prepared based on the details of the invention and information provided by the client. The analysis of the references has been done based on one or more features overlapping with the key features of the invention to form a relevant prior art.",
    "feature_matrix": {
      "patent_numbers": ["PATENT_1", "PATENT_2"],
      "features": [
        {"name": "KF1", "description": "FEATURE_DESC_1"},
        {"name": "KF2", "description": "FEATURE_DESC_2"}
      ],
      "overlap_data": [
        {"patent": "PATENT_1", "kf1": "85.5%", "kf2": "92.3%"},
        {"patent": "PATENT_2", "kf1": "78.9%", "kf2": "88.7%"}
      ]
    }
  },
  "section_2_1_patent_details": {
    "anchor": "patent-details",
    "title": "Details of Relevant Patent Citations",
    "patents": [
      {
        "patent_number": "PATENT_NUMBER",
        "anchor": "patent_PATENT_NUMBER",
        "basic_info": {
          "title": "PATENT_TITLE",
          "publication_number": "PUBLICATION_NUMBER",
          "filing_date": "FILING_DATE",
          "publication_date": "PUBLICATION_DATE",
          "applicant": "APPLICANT_NAME",
          "inventor": "INVENTOR_NAME",
          "cpc_codes": ["CPC1", "CPC2"],
          "abstract": "FULL_ABSTRACT_TEXT"
        },
        "feature_comparison": {
          "title": "Feature-by-Feature Analysis",
          "comparisons": [
            {
              "feature": "FEATURE_NAME",
              "patent_implementation": "How the patent implements this feature",
              "searched_idea": "How the searched idea implements this feature",
              "similarity": "High/Medium/Low",
              "novelty_impact": "Description of what makes the searched idea novel"
            }
          ]
        },
        "attorney_analysis": {
          "title": "Patent Attorney Analysis",
          "relation_to_idea": "How this patent relates to the overall searched idea",
          "existing_coverage": "What aspects are already covered by this patent",
          "novel_elements": "What novel elements exist in the proposed idea",
          "recommendations": "Strategic recommendations for claim drafting"
        }
      }
    ]
 },
  "concluding_remarks": {
    "title": "Final Concluding Remarks",
    "overall_novelty_assessment": "High/Medium/Low novelty assessment",
    "key_strengths": ["Strength 1", "Strength 2"],
    "key_risks": ["Risk 1", "Risk 2"],
    "strategic_recommendations": ["Recommendation 1", "Recommendation 2"],
    "filing_advice": "Specific advice for patent filing strategy"
  }
}

GUIDELINES:
- Generate detailed attorney-style analysis for each selected patent
- Include feature-by-feature comparisons with technical depth
- Provide strategic insights for patent prosecution
- Ensure all hyperlinks work for navigation
- Format tables cleanly with proper alignment
- Use professional legal terminology appropriate for patent analysis`


// V2: Compact Stage 4 prompt aligned to the Stage 4 UI.
// Focuses on a small, JSON-only output without per‑patent tables to reduce tokens.
export const NOVELTY_REPORT_PROMPT_V2 = `You are a patent analyst generating a compact JSON payload for the Stage 4 Novelty UI.

Use the following inputs only for reasoning — do not repeat or dump them back:
- invention_features: {invention_features}
- selected_patents: {selected_patents}
- search_metadata: {search_metadata}
- feature_analysis_matrix: {feature_analysis_matrix}
- structured_narrative: {structured_narrative}

Goal:
- Produce a concise executive-level summary and focused concluding remarks aligned with the Stage 4 UI.
- Keep output minimal; avoid large tables and per‑patent writeups (these are handled by the app/PDF generator).

Strict instructions:
- Do NOT include: tables, table_of_contents, per‑patent sections, citations, hyperlinks, CPC codes, or copied abstracts.
- Do NOT restate numeric matrices or lists already provided in inputs.
- Ground the summary in the feature_analysis_matrix and selected_patents; do not invent metrics.
- Keep the executive summary ≤ 160 words. Keep each bullet ≤ 18 words.
- Return valid JSON only with the exact shape below. No prose or backticks.

Output JSON shape:
{
  "report_metadata": {
    "title": "Novelty Assessment Report",
    "search_id": "SEARCH_ID",
    "date": "GENERATION_DATE",
    "analyst": "SpotIPR AI"
  },
  "executive_summary": {
    "summary": "One tight paragraph on why novelty exists, the role of combinations, and next focus."
  },
  "concluding_remarks": {
    "overall_novelty_assessment": "Novel | Partially Novel | Not Novel",
    "key_strengths": ["...", "...", "..."],
    "key_risks": ["...", "..."],
    "strategic_recommendations": ["...", "...", "..."],
    "filing_advice": "Actionable single sentence"
  },
  "structured_narrative": {
    "integration": "Prefer reusing the provided narrative; compress to 1–2 sentences.",
    "feature_insights": "Prefer reusing the provided narrative; compress to 1–2 sentences.",
    "verdict": "Prefer reusing the provided narrative; compress to 1 sentence."
  }
}
`;

export interface NoveltySearchConfig {
  jurisdiction: string;
  filingType: string;
  tenantId?: string;
  stage0: {
    customPrompt?: string;
    extractionRules?: Record<string, any>;
  };
  stage1: {
    maxPatents: number;
    relevanceThresholds: { high: number; medium: number };
    customPrompt?: string;
  };
  stage35a: {
    batchSize: number;
    maxRefsTotal: number;
    thresholdPresent: number;
    thresholdPartial: number;
    criticalFeatures: string[];
    modelPreference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-pro';
    customPrompt?: string;
  };
  stage35b: {
    // Deterministic - no config needed
  };
  stage4: {
    reportFormat: 'PDF' | 'JSON' | 'HTML';
    includeExecutiveSummary: boolean;
    includeTechnicalDetails: boolean;
    colorCoding: boolean;
    maxRefsForReportMain: number;
    maxRefsForUI: number;
    modelPreference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-pro';
  };
}

export interface NoveltySearchRequest {
  patentId?: string; // Optional - can create standalone search
  projectId?: string; // Optional - can associate with a project
  jwtToken: string;
  inventionDescription: string;
  title: string;
  jurisdiction?: string;
  config?: Partial<NoveltySearchConfig>;
}

export interface NoveltySearchResponse {
  success: boolean;
  searchId?: string;
  status?: NoveltySearchStatus;
  currentStage?: NoveltySearchStage;
  results?: any;
  error?: string;
}

export interface NormalizedIdea {
  searchQuery: string;
  inventionFeatures?: string[];
}

export interface ScreeningResult {
  overall_determination: 'NOVEL' | 'NOT_NOVEL' | 'DOUBT';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning_summary: string;
  patent_assessments: Array<{
    publication_number: string;
    relevance: 'HIGH' | 'MEDIUM' | 'LOW';
    reasoning: string;
    key_differences: string;
    novelty_threat: string;
  }>;
  recommended_next_steps: string;
  search_expansion_needed: boolean;
}

export interface AssessmentResult {
  determination: 'NOVEL' | 'NOT_NOVEL' | 'PARTIALLY_NOVEL';
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  novelty_analysis: {
    anticipated_elements: string[];
    novel_elements: string[];
    key_differences: string[];
  };
  non_obviousness_analysis: {
    obviousness_risks: string[];
    inventive_aspects: string[];
    prior_art_combinations: string[];
  };
  scope_analysis: {
    claim_breadth: 'NARROW' | 'MEDIUM' | 'BROAD';
    infringement_risk: 'LOW' | 'MEDIUM' | 'HIGH';
    workaround_options: string[];
  };
  commercial_analysis: {
    freedom_to_operate: 'CLEAR' | 'RISKY' | 'BLOCKED';
    licensing_opportunities: string[];
    market_impact: string;
  };
  recommendations: {
    prosecution_strategy: string[];
    freedom_to_operate: string[];
    next_steps: string[];
  };
  executive_summary: string;
}

// New interfaces for Stage 3.5a and 3.5b
export interface FeatureMapCell {
  feature: string;
  status: 'Present' | 'Partial' | 'Absent' | 'Unknown';
  confidence?: number;
  quote?: string;
  field?: string;
  reason?: string;
  evidence?: string | {
    quote: string;
    field: string;
  };
}

export interface PatentCoverage {
  present: number;
  partial: number;
  absent: number;
  coverage_score?: number; // Computed on our side
}

export interface PatentFeatureMap {
  pn: string;
  title?: string;
  link?: string | null;
  coverage?: PatentCoverage;
  present?: FeatureMapCell[];
  partial?: FeatureMapCell[];
  absent?: FeatureMapCell[];
  feature_analysis: FeatureMapCell[]; // For backward compatibility - always present after validation
}

export interface FeatureMapBatchResult {
  feature_map: PatentFeatureMap[];
  quality_flags: {
    low_evidence: boolean;
    ambiguous_abstracts: boolean;
    language_mismatch: boolean;
  };
  stats: {
    patents_analyzed: number;
    avg_abstract_length_words: number;
  };
}

export interface PerPatentCoverage {
  pn: string;
  present_count: number;
  partial_count: number;
  absent_count: number;
  coverage_ratio: number;
}

export interface PerFeatureUniqueness {
  feature: string;
  present_in: number;
  partial_in: number;
  absent_in: number;
  uniqueness: number;
}

export interface IntegrationCheck {
  any_single_patent_covers_majority: boolean;
  integration_pn?: string;
  explanation: string;
}

export interface FeatureMatrixCell {
  patentNumber: string;
  feature: string;
  status: 'Present' | 'Partial' | 'Absent';
  confidence?: number;
  evidence?: string;
  reason?: string;
}

export interface FeatureMatrix {
  patents: string[];
  features: string[];
  cells: FeatureMatrixCell[];
  patentTitles: Record<string, string>;
  llmUsage: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
}

export interface AggregationResult {
  idea_id: string;
  per_patent_coverage: PerPatentCoverage[];
  per_feature_uniqueness: PerFeatureUniqueness[];
  integration_check: IntegrationCheck;
  novelty_score: number;
  decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';
  confidence: 'High' | 'Medium' | 'Low';
  risk_factors: string[];
  feature_matrix?: FeatureMatrix;
  structured_narrative?: any;
}

export class NoveltySearchService extends BasePatentService {

  private defaultConfig: NoveltySearchConfig = {
    jurisdiction: 'IN',
    filingType: 'utility',
    stage0: {},
    stage1: {
      maxPatents: 60, // Increased for more comprehensive analysis
      relevanceThresholds: { high: 0.8, medium: 0.5 }
    },
    stage35a: {
      batchSize: 8,
      maxRefsTotal: 60,
      thresholdPresent: 0.70,
      thresholdPartial: 0.40,
      criticalFeatures: [],
      modelPreference: 'gemini-2.0-flash-lite'
    },
    stage35b: {},
    stage4: {
      reportFormat: 'PDF',
      includeExecutiveSummary: true,
      includeTechnicalDetails: true,
      colorCoding: true,
      maxRefsForReportMain: 10,
      maxRefsForUI: 12,
      modelPreference: 'gpt-4o-mini'
    }
  };

  /**
   * Start a complete novelty search workflow
   */
  async startNoveltySearch(request: NoveltySearchRequest): Promise<NoveltySearchResponse> {
    try {
      // Validate user
      const user = await this.validateUser(request.jwtToken);

      // Merge config with defaults
      const config = { ...this.defaultConfig, ...request.config };

      // Validate patent access if provided
      if (request.patentId) {
        await this.validatePatentAccess(request.patentId, user.id);
      }

      // Validate project access if provided
      if (request.projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: request.projectId,
            userId: user.id
          }
        });
        if (!project) {
          throw new Error('Project not found or access denied');
        }
      }

      // Create search run record
      const searchRun = await prisma.noveltySearchRun.create({
        data: {
          patentId: request.patentId,
          projectId: request.projectId,
          userId: user.id,
          status: NoveltySearchStatus.PENDING,
          currentStage: NoveltySearchStage.STAGE_0,
          config: config,
          inventionDescription: request.inventionDescription,
          title: request.title,
          jurisdiction: config.jurisdiction,
          filingType: config.filingType,
        },
      });

      // Start Stage 0: Idea Normalization
      const stage0Result = await this.performStage0(searchRun.id, request, config, user, request.jwtToken ? { authorization: `Bearer ${request.jwtToken}` } : {});

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchRun.id },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchRun.id },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId: searchRun.id,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Novelty search start error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start novelty search'
      };
    }
  }

  /**
   * Execute Stage 1: Initial Screening
   */
  async executeStage1(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_1) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;

      // Perform Stage 1 screening using PQAI only; return raw results for UI display
      const stage1Result = await this.performStage1(searchId, stage0Data, config);

      if (!stage1Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage1Result.error };
      }

      // Determine next stage based on results
      const screeningData = stage1Result.data as any;
      const hasResults = Array.isArray(screeningData?.pqaiResults) && screeningData.pqaiResults.length > 0;
      const nextStage: NoveltySearchStage = hasResults ? NoveltySearchStage.STAGE_3_5 : NoveltySearchStage.STAGE_4;
      const status: NoveltySearchStatus = NoveltySearchStatus.STAGE_1_COMPLETED;

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: nextStage,
          status: status,
          stage1CompletedAt: new Date(),
          stage1Results: screeningData as any
        }
      });

      return {
        success: true,
        searchId,
        status,
        currentStage: nextStage,
        results: screeningData
      };

    } catch (error) {
      console.error('Stage 1 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 1 execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5a: Feature Mapping Engine
   */
  async executeStage35a(
    searchId: string,
    userId: string,
    requestHeaders?: Record<string, string>,
    selectedPublicationNumbers?: string[]
  ): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      let stage1Data = searchRun.stage1Results as unknown as any;

      console.log('[Stage3.5a][Service] selectedPublicationNumbers:', Array.isArray(selectedPublicationNumbers) ? selectedPublicationNumbers.length : 'n/a');
      console.log('[Stage3.5a][Service] stage1Results keys:', stage1Data ? Object.keys(stage1Data) : 'no stage1Results');
      console.log('[Stage3.5a][Service] stage1 pqai count:', Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults.length : 'n/a');

      // Check if Stage 1 results are available - manual progression requires explicit stage execution
      if (!stage1Data || !Array.isArray(stage1Data.pqaiResults) || stage1Data.pqaiResults.length === 0) {
        console.warn('[Stage3.5a][Service] Missing or empty Stage 1 results. Stage 3.5a requires Stage 1 to be completed first.');
        return {
          success: false,
          error: 'Stage 1 must be completed before running Stage 3.5a. Please execute Stage 1 first to fetch patent search results.'
        };
      }

      // If client provided a list of selected publication numbers, filter Stage 1 PQAI results to those
      if (Array.isArray(selectedPublicationNumbers) && selectedPublicationNumbers.length > 0 && Array.isArray(stage1Data?.pqaiResults)) {
        const pnSet = new Set(selectedPublicationNumbers);
        const before = stage1Data.pqaiResults.length;
        stage1Data.pqaiResults = stage1Data.pqaiResults.filter((p: any) => {
          const pn = p.publicationNumber || p.pn || p.patent_number || p.publication_number || p.id;
          return pn && pnSet.has(pn);
        });
        console.log('[Stage3.5a][Service] Filtered PQAI results by selection:', { before, after: stage1Data.pqaiResults.length });
      }

      // Perform Stage 3.5a feature mapping
      const stage35aResult = await this.performStage35a(
        searchId,
        stage0Data,
        stage1Data,
        config,
        requestHeaders
      );

      if (!stage35aResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35aResult.error };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed to STAGE_3_5A in enum
          status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed to STAGE_3_5A_COMPLETED
          stage35CompletedAt: new Date(),
          stage35Results: stage35aResult.data as any,
          stage4Results: undefined // Will be filled by stage 3.5b
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_3_5_COMPLETED, // Will be renamed
        currentStage: NoveltySearchStage.STAGE_3_5, // Will be renamed
        results: stage35aResult.data
      };

    } catch (error) {
      console.error('Stage 3.5a execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a execution failed'
      };
    }
  }

  /**
   * Execute Stage 3.5b: Aggregation & Risk Analysis
   */
  async executeStage35b(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      const stage35aData = searchRun.stage35Results as unknown as FeatureMapBatchResult;

      // Perform Stage 3.5b aggregation
      const stage35bResult = await this.performStage35b(searchId, stage0Data, stage35aData, config, requestHeaders);

      if (!stage35bResult.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage35bResult.error };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          currentStage: NoveltySearchStage.STAGE_4,
          status: NoveltySearchStatus.COMPLETED, // Stage 3.5b completes the analysis
          stage4CompletedAt: new Date(),
          stage4Results: stage35bResult.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.COMPLETED,
        currentStage: NoveltySearchStage.STAGE_4,
        results: stage35bResult.data
      };

    } catch (error) {
      console.error('Stage 3.5b execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b execution failed'
      };
    }
  }

  // Legacy method for backward compatibility - now delegates to 3.5a + 3.5b
  async executeStage35(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    // First execute 3.5a
    const stage35aResult = await this.executeStage35a(searchId, userId, requestHeaders);
    if (!stage35aResult.success) {
      return stage35aResult;
    }

    // Then execute 3.5b
    return await this.executeStage35b(searchId, userId, requestHeaders);
  }

  /**
   * Get novelty search history for a user, optionally filtered by project
   */
  async getNoveltySearchHistory(userId: string, projectId?: string): Promise<any[]> {
    try {
      const whereClause: any = {
        userId,
        status: NoveltySearchStatus.COMPLETED
      };

      if (projectId) {
        whereClause.projectId = projectId;
      }

      const searches = await prisma.noveltySearchRun.findMany({
        where: whereClause,
        include: {
          project: {
            select: {
              id: true,
              name: true
            }
          },
          patent: {
            select: {
              id: true,
              title: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to last 50 searches
      });

      // Format the results for the frontend
      return searches.map(search => ({
        id: search.id,
        title: search.title,
        inventionDescription: search.inventionDescription.substring(0, 200) + (search.inventionDescription.length > 200 ? '...' : ''),
        status: search.status,
        currentStage: search.currentStage,
        createdAt: search.createdAt,
        completedAt: search.stage4CompletedAt,
        project: search.project,
        patent: search.patent,
        hasReport: !!search.reportUrl,
        reportUrl: search.reportUrl,
        results: {
          stage0: search.stage0Results,
          stage1: search.stage1Results ? {
            patentCount: Array.isArray((search.stage1Results as any).pqaiResults) ? (search.stage1Results as any).pqaiResults.length : 0
          } : null,
          stage35: search.stage35Results ? {
            assessmentCount: Array.isArray(search.stage35Results) ? search.stage35Results.length : 0
          } : null,
          stage4: search.stage4Results
        }
      }));

    } catch (error) {
      console.error('Error fetching novelty search history:', error);
      return [];
    }
  }

  /**
   * Execute Stage 4: Report Generation
   */
  /**
   * Resume a failed novelty search from the last completed stage
   */
  async resumeNoveltySearch(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run with all results
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Check if search can be resumed (not completed and not actively running)
      if (searchRun.status === NoveltySearchStatus.COMPLETED) {
        return { success: false, error: 'Search is already completed' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Determine which stage to resume from based on current status
      let resumeFromStage: NoveltySearchStage;
      let newStatus: NoveltySearchStatus;

      switch (searchRun.status) {
        case NoveltySearchStatus.FAILED:
        case NoveltySearchStatus.PENDING:
          resumeFromStage = NoveltySearchStage.STAGE_0;
          newStatus = NoveltySearchStatus.PENDING;
          break;
        case NoveltySearchStatus.STAGE_0_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_1;
          newStatus = NoveltySearchStatus.STAGE_0_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_1_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_3_5;
          newStatus = NoveltySearchStatus.STAGE_1_COMPLETED;
          break;
        case NoveltySearchStatus.STAGE_3_5_COMPLETED:
          resumeFromStage = NoveltySearchStage.STAGE_4;
          newStatus = NoveltySearchStatus.STAGE_3_5_COMPLETED;
          break;
        default:
          return { success: false, error: 'Invalid search state for resume' };
      }

      // Reset the search to resumable state
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: newStatus,
          currentStage: resumeFromStage,
          // Clear any error state
          ...(resumeFromStage === NoveltySearchStage.STAGE_0 && { stage0Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_1 && { stage1Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_3_5 && { stage35Results: undefined }),
          ...(resumeFromStage === NoveltySearchStage.STAGE_4 && { stage4Results: undefined }),
        }
      });

      // Execute the stage to resume from
      return await this.executeStage(searchId, resumeFromStage, userId, requestHeaders);

    } catch (error) {
      console.error('Resume search error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Resume search failed'
      };
    }
  }

  /**
   * Execute a specific stage (used for resume functionality)
   */
  async executeStage(searchId: string, stage: NoveltySearchStage, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    switch (stage) {
      case NoveltySearchStage.STAGE_0:
        return await this.executeStage0(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_1:
        return await this.executeStage1(searchId, userId, requestHeaders);
      case NoveltySearchStage.STAGE_3_5:
        return await this.executeStage35(searchId, userId, requestHeaders); // This now does 3.5a + 3.5b
      case NoveltySearchStage.STAGE_4:
        return await this.executeStage4(searchId, userId, requestHeaders);
      default:
        return { success: false, error: 'Invalid stage' };
    }
  }

  /**
   * Execute Stage 0: Idea Normalization
   */
  async executeStage0(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Create a minimal user object for stage 0 execution
      // Since we already validated the userId, we can create a basic user object
      const user = { id: userId } as User;

      // Create a request-like object from search data
      // For resume, we don't have the original JWT token, but since we validated userId,
      // we can create a minimal request object
      const request = {
        title: searchRun.title,
        inventionDescription: searchRun.inventionDescription,
        jurisdiction: searchRun.jurisdiction,
        jwtToken: '', // Will be handled by requestHeaders in LLM call
      } as NoveltySearchRequest;

      // Execute stage 0
      const stage0Result = await this.performStage0(searchId, request, config, user, requestHeaders);

      if (!stage0Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage0Result.error };
      }

      // Update with stage 0 results
      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.STAGE_0_COMPLETED,
          currentStage: NoveltySearchStage.STAGE_1,
          stage0CompletedAt: new Date(),
          stage0Results: stage0Result.data as any
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.STAGE_0_COMPLETED,
        currentStage: NoveltySearchStage.STAGE_1,
        results: stage0Result.data
      };

    } catch (error) {
      console.error('Stage 0 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 0 execution failed'
      };
    }
  }

  async executeStage4(searchId: string, userId: string, requestHeaders?: Record<string, string>): Promise<NoveltySearchResponse> {
    try {
      // Get search run with all results
      const searchRun = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId }
      });

      if (!searchRun) {
        return { success: false, error: 'Novelty search not found' };
      }

      // Allow resuming from any previous stage (don't enforce strict sequential progression for resume)
      // if (searchRun.currentStage !== NoveltySearchStage.STAGE_4) {
      //   return { success: false, error: 'Invalid stage progression' };
      // }

      const config = searchRun.config as unknown as NoveltySearchConfig;

      // Perform Stage 4 report generation
      const stage4Result = await this.performStage4(searchRun, config, requestHeaders);

      if (!stage4Result.success) {
        await prisma.noveltySearchRun.update({
          where: { id: searchId },
          data: { status: NoveltySearchStatus.FAILED }
        });
        return { success: false, error: stage4Result.error };
      }

      await prisma.noveltySearchRun.update({
        where: { id: searchId },
        data: {
          status: NoveltySearchStatus.COMPLETED,
          stage4CompletedAt: new Date(),
          stage4Results: stage4Result.data as any,
          reportUrl: stage4Result.reportUrl
        }
      });

      // Increment user's successful novelty searches count
      await prisma.user.update({
        where: { id: userId },
        data: {
          noveltySearchesCompleted: {
            increment: 1
          }
        }
      });

      return {
        success: true,
        searchId,
        status: NoveltySearchStatus.COMPLETED,
        results: stage4Result.data
      };

    } catch (error) {
      console.error('Stage 4 execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 execution failed'
      };
    }
  }

  // Implementation of individual stages below...

  /**
   * Filter patents for relevance to invention before including in report
   * Uses Gemini 2.5 Flash-Lite model to assess if each patent is actually related to the invention
   */
  private async filterRelevantPatentsForReport(
    stage0Data: NormalizedIdea,
    stage35Data: AssessmentResult[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<AssessmentResult[]> {
    if (!Array.isArray(stage35Data) || stage35Data.length === 0) {
      return [];
    }

    console.log(`🔍 Assessing relevance of ${stage35Data.length} patents to invention...`);

    const relevantPatents: AssessmentResult[] = [];

    // Process patents in batches to avoid overwhelming the LLM
    const batchSize = 3;
    for (let i = 0; i < stage35Data.length; i += batchSize) {
      const batch = stage35Data.slice(i, i + batchSize);
      console.log(`📋 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(stage35Data.length / batchSize)} (${batch.length} patents)`);

      for (const patent of batch) {
        try {
          const isRelevant = await this.assessPatentRelevance(
            stage0Data,
            patent,
            config,
            requestHeaders
          );

          if (isRelevant) {
            relevantPatents.push(patent);
            console.log(`✅ Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is relevant - included in report`);
          } else {
            console.log(`❌ Patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'} is not relevant - excluded from report`);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to assess relevance for patent ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}, including by default:`, error);
          relevantPatents.push(patent); // Include by default if assessment fails
        }
      }

      // Removed intentional delay between batches for faster processing
    }

    return relevantPatents;
  }

  /**
   * Assess if a patent is relevant to the invention using Gemini 2.5 Flash-Lite
   */
  private async assessPatentRelevance(
    stage0Data: NormalizedIdea,
    patent: AssessmentResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<boolean> {
    // Build relevance assessment prompt
    const relevancePrompt = `You are a patent attorney conducting a novelty-oriented relevance review.

INVENTION FEATURES (from user idea):
${JSON.stringify(stage0Data.inventionFeatures || [])}

PATENT TO ASSESS:
- Publication Number: ${(patent as any).publicationNumber || (patent as any).patentNumber || 'Unknown'}
- Title: ${(patent as any).title || 'Not available'}
- Abstract: ${(patent as any).abstract || 'Not available'}

TASK:
Determine if this patent is RELEVANT to the invention by identifying overlap between the patent's title/abstract and the invention features.

RELEVANCE CRITERIA:
- Patent title/abstract indicates presence of at least one invention feature with technical proximity
- If none of the features appear present, mark as not relevant

OUTPUT FORMAT:
Respond with ONLY a JSON object:
{
  "is_relevant": boolean,
  "confidence": "HIGH|MEDIUM|LOW",
  "reasoning": "brief explanation (max 50 words)"
}

RESPONSE:`;

    try {
      // Use Gemini 2.5 Flash-Lite model directly for relevance assessment
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS, // Reuse existing task code
          prompt: relevancePrompt,
          modelClass: 'gemini-2.0-flash-lite'
        }
      );

      if (!llmResult.success) {
        console.warn('Relevance assessment failed, defaulting to relevant');
        return true; // Default to relevant if assessment fails
      }

      if (!llmResult.response) {
        console.warn('No response from relevance assessment, defaulting to relevant');
        return true; // Default to relevant if no response
      }

      const response = this.parseLLMResponse(llmResult.response.output);

      // Check if the response indicates relevance
      if (response && typeof response.is_relevant === 'boolean') {
        return response.is_relevant;
      }

      // If parsing fails, check for keywords in the response
      const output = llmResult.response.output.toLowerCase();
      if (output.includes('"is_relevant": true') || output.includes('"is_relevant":true')) {
        return true;
      }
      if (output.includes('"is_relevant": false') || output.includes('"is_relevant":false')) {
        return false;
      }

      // Default to relevant if we can't determine
      console.warn('Could not parse relevance response, defaulting to relevant');
      return true;

    } catch (error) {
      console.warn('Relevance assessment error, defaulting to relevant:', error instanceof Error ? error.message : String(error));
      return true; // Default to relevant if assessment fails
    }
  }


  private async performStage0(
    searchId: string,
    request: NoveltySearchRequest,
    config: NoveltySearchConfig,
    user: User,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: NormalizedIdea; error?: string }> {
    try {
      console.log('🧠 Starting Stage 0: Idea Normalization');

      // Build prompt
      console.log('📝 Stage 0 Input - Title:', request.title, 'Description length:', request.inventionDescription?.length);

      const prompt = config.stage0.customPrompt || NOVELTY_SEARCH_NORMALIZATION_PROMPT
        .replace('{title}', request.title || 'Untitled Invention')
        .replace('{rawIdea}', request.inventionDescription || 'No description provided');

      console.log('📝 Stage 0 Final Prompt:', prompt);

      // Execute LLM call for feature extraction
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt,
          modelClass: 'gemini-2.0-flash-lite'
        }
      );

      if (!llmResult.success) {
        return { success: false, error: llmResult.error instanceof Error ? llmResult.error.message : String(llmResult.error) };
      }

      // Parse response
      console.log('Stage 0 LLM response:', llmResult.response?.output);
      const normalizedData = this.parseLLMResponse(llmResult.response?.output || '');
      console.log('Stage 0 parsed data:', normalizedData);

      // Extract search query and invention features
      const extractedFields: NormalizedIdea = {
        searchQuery: normalizedData?.searchQuery || normalizedData?.query || '',
        inventionFeatures: Array.isArray(normalizedData?.invention_features)
          ? (normalizedData.invention_features as string[]).filter(Boolean)
          : undefined
      };

      if (!extractedFields.searchQuery) {
        console.warn('No search query found in LLM response, using fallback');
        extractedFields.searchQuery = `${request.title} related technology`.substring(0, 25);
      }

      if (!extractedFields.inventionFeatures || extractedFields.inventionFeatures.length === 0) {
        // Heuristic fallback: split title/idea into candidate tokens
        const seed = `${request.title} ${request.inventionDescription}`.toLowerCase();
        const tokens = seed.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 3);
        extractedFields.inventionFeatures = Array.from(new Set(tokens)).slice(0, 8);
      }

      console.log('✅ Stage 0 completed successfully');
      return { success: true, data: extractedFields };

    } catch (error) {
      console.error('Stage 0 error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Stage 0 failed: ${errorMessage}`
      };
    }
  }

  private async performStage1(
    searchId: string,
    stage0Data: NormalizedIdea,
    config: NoveltySearchConfig
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      console.log('🔍 Starting Stage 1: Initial Screening');

      // Get patents from PQAI API using searchQuery
      console.log(`🔍 STAGE 1: Starting PQAI search with query: "${stage0Data.searchQuery}"`);
      console.log(`📊 Requesting up to ${config.stage1.maxPatents} patents from PQAI`);

      const pqaiResults = await this.searchPQAI(stage0Data.searchQuery, config.stage1.maxPatents);

      // Return raw PQAI results for UI
      console.log('✅ Stage 1 completed successfully - found', pqaiResults.length, 'patents');
      return { success: true, data: { pqaiResults } };

    } catch (error) {
      console.error('Stage 1 PQAI search failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PQAI search failed'
      };
    }
  }

  private async performStage35a(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage1Data: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: FeatureMapBatchResult; error?: string }> {
    try {
      console.log('🔬 Starting Stage 3.5a: Feature Mapping Engine');

      const pqaiResults = Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : [];
      const inventionFeatures = stage0Data.inventionFeatures || [];

      if (pqaiResults.length === 0) {
        return { success: false, error: 'No PQAI results available for feature mapping' };
      }

      if (inventionFeatures.length === 0) {
        return { success: false, error: 'No invention features available for mapping' };
      }

      // Sort patents by PQAI relevance score (already sorted in searchPQAI function)
      // Select top 50% of patents (min 10, max 20) for feature analysis
      const totalPatents = pqaiResults.length;
      const targetCount = Math.ceil(totalPatents * 0.5); // Top 50%
      const selectedCount = Math.min(
        Math.max(targetCount, 10), // At least 10 patents
        Math.min(totalPatents, 20) // At most 20 patents, but not more than available
      );

      console.log(`🎯 PATENT SELECTION LOGIC:`);
      console.log(`   - Total patents available: ${totalPatents}`);
      console.log(`   - Target selection (50%): ${targetCount} patents`);
      console.log(`   - Constrained selection: min(10, max(50%, 20)) = ${selectedCount} patents`);
      console.log(`   - Selection percentage: ${((selectedCount/totalPatents)*100).toFixed(1)}%`);

      const selectedPatents = pqaiResults.slice(0, selectedCount);

      console.log(`\n📋 SELECTED PATENTS FOR STAGE 3.5a ANALYSIS:`);
      selectedPatents.forEach((patent: any, index: number) => {
        const score = patent.relevanceScore;
        const scorePercent = score ? `${(score * 100).toFixed(1)}%` : 'N/A';
        console.log(`   ${index + 1}. ${patent.publicationNumber} - Relevance: ${scorePercent}`);
        console.log(`      Title: "${patent.title?.substring(0, 60)}${patent.title?.length > 60 ? '...' : ''}"`);
      });

      // Log relevance scores statistics for selected patents
      const scores = selectedPatents.map((p: any) => p.relevanceScore || 0).filter((s: number) => s > 0);
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum: number, score: number) => sum + score, 0) / scores.length;
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);

        console.log(`\n📊 SELECTED PATENTS STATISTICS:`);
        console.log(`   - Average relevance score: ${(avgScore * 100).toFixed(1)}%`);
        console.log(`   - Score range: ${(minScore * 100).toFixed(1)}% - ${(maxScore * 100).toFixed(1)}%`);
        console.log(`   - Score distribution: ${scores.map((s: number) => (s * 100).toFixed(1) + '%').join(', ')}`);
      }

      console.log(`\n🚀 PROCEEDING TO STAGE 3.5a FEATURE MAPPING WITH ${selectedCount} PATENTS`);

      // Normalize and canonicalize selected patents
      const normalizedPatents = this.normalizePatentsForFeatureMapping(selectedPatents, selectedCount);

      // Process in batches with concurrency
      const batchSize = config.stage35a.batchSize;
      const batches = this.createBatches(normalizedPatents, batchSize);

      console.log(`📦 Processing ${normalizedPatents.length} patents in ${batches.length} batches of ${batchSize}`);

      const allFeatureMaps: PatentFeatureMap[] = [];
      const concurrencyLimit = 2; // As specified in requirements

      // Process batches with controlled concurrency
      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const batchSlice = batches.slice(i, i + concurrencyLimit);
        console.log(`🔄 Processing batch group ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(batches.length / concurrencyLimit)}`);

        const batchPromises = batchSlice.map(async (batch, batchIndex) => {
          const batchNumber = i + batchIndex;
          return await this.processFeatureMappingBatch(
            searchId,
            batch,
            inventionFeatures,
            config,
            requestHeaders,
            batchNumber
          );
        });

        const batchResults = await Promise.all(batchPromises);

        // Collect successful results
        for (const result of batchResults) {
          if (result.success && result.featureMaps) {
            allFeatureMaps.push(...result.featureMaps);
          }
        }
      }

      // Store results in database
      await this.storeFeatureMapResults(searchId, allFeatureMaps);

      // Calculate quality flags and stats
      const qualityFlags = this.calculateQualityFlags(allFeatureMaps, normalizedPatents);
      const stats = this.calculateFeatureMappingStats(allFeatureMaps, normalizedPatents);

      const result: FeatureMapBatchResult = {
        feature_map: allFeatureMaps,
        quality_flags: qualityFlags,
        stats: stats
      };

      console.log(`✅ Stage 3.5a completed: mapped ${allFeatureMaps.length} patents to ${inventionFeatures.length} features`);
      return { success: true, data: result };

    } catch (error) {
      console.error('Stage 3.5a error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5a failed'
      };
    }
  }

  private async performStage35b(
    searchId: string,
    stage0Data: NormalizedIdea,
    stage35aData: FeatureMapBatchResult,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: AggregationResult; error?: string }> {
    try {
      console.log('📊 Starting Stage 3.5b: Aggregation & Risk Analysis');

      const inventionFeatures = stage0Data.inventionFeatures || [];
      const featureMaps = stage35aData.feature_map;
      const qualityFlags = stage35aData.quality_flags;

      if (featureMaps.length === 0) {
        return { success: false, error: 'No feature mapping data available for aggregation' };
      }

      // Compute per-patent coverage
      const perPatentCoverage = this.computePerPatentCoverage(featureMaps, inventionFeatures);

      // Compute per-feature uniqueness
      const perFeatureUniqueness = this.computePerFeatureUniqueness(featureMaps, inventionFeatures);

      // Integration check
      const integrationCheck = this.performIntegrationCheck(featureMaps, inventionFeatures, config.stage35a.criticalFeatures);

      // Compute novelty score
      const noveltyScore = this.computeNoveltyScore(perFeatureUniqueness, config.stage35a.criticalFeatures);

      // Determine decision and confidence
      const { decision, confidence } = this.computeDecisionAndConfidence(
        noveltyScore,
        integrationCheck,
        perFeatureUniqueness,
        featureMaps.length,
        qualityFlags,
        config.stage35a.criticalFeatures
      );

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(
        featureMaps,
        perFeatureUniqueness,
        qualityFlags,
        inventionFeatures
      );

      const aggregationResult: AggregationResult = {
        idea_id: searchId,
        per_patent_coverage: perPatentCoverage,
        per_feature_uniqueness: perFeatureUniqueness,
        integration_check: integrationCheck,
        novelty_score: noveltyScore,
        decision,
        confidence,
        risk_factors: riskFactors
      };

      // Generate computational feature matrix
      console.log('📊 Generating computational feature matrix...');
      const featureMatrix = this.generateFeatureMatrix(
        featureMaps,
        inventionFeatures,
        stage35aData.stats
      );

      if (featureMatrix) {
        // Add matrix to aggregation result for Stage 4
        aggregationResult.feature_matrix = featureMatrix;
        console.log('✅ Feature matrix generated with', featureMatrix.cells.length, 'cells');
      }

      // Store aggregation snapshot
      await this.storeAggregationSnapshot(searchId, aggregationResult, stage35aData.stats, qualityFlags);

      console.log(`✅ Stage 3.5b completed: ${decision} (score: ${noveltyScore.toFixed(2)}, confidence: ${confidence})`);
      return { success: true, data: aggregationResult };

    } catch (error) {
      console.error('Stage 3.5b error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 3.5b aggregation failed'
      };
    }
  }

  /**
   * Generate computational feature matrix from Stage 3.5a results
   */
  private generateFeatureMatrix(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    stage35aStats: any
  ): FeatureMatrix | null {
    try {
      console.log('🔢 Building feature matrix for', featureMaps.length, 'patents and', inventionFeatures.length, 'features');

      const cells: FeatureMatrixCell[] = [];
      const patents: string[] = [];
      const patentTitles: Record<string, string> = {};

      // Process each patent
      for (const patentMap of featureMaps) {
        const patentNumber = patentMap.pn;
        patents.push(patentNumber);
        patentTitles[patentNumber] = patentMap.title || 'Unknown Title';

        // Process each feature for this patent
        for (const feature of inventionFeatures) {
          const featureCell = patentMap.feature_analysis?.find(cell => cell.feature === feature);

          if (featureCell) {
            // Use the new format if available, fallback to old format
            const status = featureCell.status === 'Unknown' ? 'Absent' : featureCell.status;
            const evidence = typeof featureCell.evidence === 'string'
              ? featureCell.evidence
              : featureCell.quote || '';
            const reason = featureCell.reason || '';
            const confidence = featureCell.confidence;

            cells.push({
              patentNumber,
              feature,
              status,
              confidence,
              evidence,
              reason
            });
          } else {
            // No analysis available for this feature-patent combination
            cells.push({
              patentNumber,
              feature,
              status: 'Absent',
              reason: 'No analysis available'
            });
          }
        }
      }

      // Calculate LLM usage from Stage 3.5a stats
      const llmUsage = {
        totalCalls: stage35aStats?.patents_analyzed || featureMaps.length,
        totalInputTokens: 0, // Would need to aggregate from actual LLM calls
        totalOutputTokens: 0, // Would need to aggregate from actual LLM calls
        totalCost: 0 // Would need to calculate based on model and tokens
      };

      const matrix: FeatureMatrix = {
        patents,
        features: inventionFeatures,
        cells,
        patentTitles,
        llmUsage
      };

      console.log('📊 Matrix generated:', {
        patents: patents.length,
        features: inventionFeatures.length,
        totalCells: cells.length,
        presentCount: cells.filter(c => c.status === 'Present').length,
        partialCount: cells.filter(c => c.status === 'Partial').length,
        absentCount: cells.filter(c => c.status === 'Absent').length
      });

      return matrix;

    } catch (error) {
      console.error('❌ Error generating feature matrix:', error);
      return null;
    }
  }

  /**
   * Generate fallback narrative when LLM fails
   */
  private generateFallbackNarrative(
    aggregationResult: AggregationResult,
    perFeatureUniqueness: any[],
    integrationCheck: any,
    decision: string
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const uniqueFeatures = perFeatureUniqueness.filter(f => f.uniqueness > 0.8).length;
    const totalFeatures = perFeatureUniqueness.length;

    return {
      integration: integrationCheck.any_single_patent_covers_majority === false
        ? "None of the reviewed patents integrate more than 60% of the identified features, indicating the combination is novel rather than the individual components."
        : "Some patents show significant feature integration, suggesting moderate novelty at the system level.",

      feature_insights: `Analysis reveals ${uniqueFeatures} of ${totalFeatures} features with high uniqueness (>80%). Features related to core functionality show ${(uniqueFeatures/totalFeatures * 100).toFixed(0)}% uniqueness across the patent landscape.`,

      verdict: `The data supports a ${decision.toLowerCase()} determination with ${score}% novelty score and ${aggregationResult.confidence.toLowerCase()} confidence. The feature-level analysis demonstrates strong technical differentiation.`
    };
  }

  /**
   * Prepare inputs for report generation
   */
  private prepareReportInputs(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMapCells: any[],
    config: NoveltySearchConfig
  ): any {
    // Get top patents by coverage for metadata
    const topPatents = aggregationResult.per_patent_coverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, 10);

    const patent_metadata = topPatents.map(patent => {
      const cell = featureMapCells.find(c => c.publicationNumber === patent.pn);
      return {
        publication_number: patent.pn,
        title: cell?.title || 'Unknown Title',
        abstract: (cell?.abstract || '').substring(0, 300),
        year: cell?.year || '',
        country: patent.pn.substring(0, 2),
        inventors: cell?.inventors || []
      };
    });

    return {
      patent_metadata,
      feature_map_cells: featureMapCells,
      stage0_data: stage0Data
    };
  }

  /**
   * Generate fallback report data when LLM fails
   */
  private generateFallbackReportData(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    config: NoveltySearchConfig,
    selectedPatents?: any[]
  ): any {
    const score = (aggregationResult.novelty_score * 100).toFixed(1);
    const uniqueFeatures = aggregationResult.per_feature_uniqueness.filter(f => f.uniqueness > 0.8).length;
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const selectedCount = selectedPatents?.length || 0;

    // Generate citations table from selected patents
    const citationsTable = selectedPatents?.map((patent, index) => ({
      s_no: index + 1,
      citation_no: patent.patentNumber,
      title: `Patent ${patent.patentNumber}`, // Fallback title
      publication_date: "Unknown",
      link: `https://patents.google.com/patent/${patent.patentNumber}`
    })) || [];

    return {
      // Include search query from stage 0 data
      search_query: stage0Data?.searchQuery || '',
      table_of_contents: {
        title: "Table Of Contents",
        sections: [
          {"number": "01", "title": "Report", "page": "3", "link": "#report"},
          {"number": "1.1", "title": "Search Metadata Index", "page": "3", "link": "#metadata"},
          {"number": "1.2", "title": "Key Features", "page": "4", "link": "#key-features"},
          {"number": "1.3", "title": "Summary", "page": "5", "link": "#summary"},
          {"number": "1.4", "title": "Key Feature Analysis", "page": "6", "link": "#feature-analysis"},
          {"number": "02", "title": "Citations Details", "page": "7", "link": "#citations"},
          {"number": "2.1", "title": "Details of Relevant Patent Citations", "page": "7", "link": "#patent-details"}
        ]
      },
      report_metadata: {
        title: "Novelty Assessment Report",
        search_id: searchRun.id,
        date: new Date().toISOString().split('T')[0],
        analyst: "SpotIPR AI",
        total_patents_analyzed: aggregationResult.per_patent_coverage.length.toString(),
        selected_patents_count: selectedCount.toString()
      },
      section_1_1_search_metadata: {
        anchor: "metadata",
        search_id: searchRun.id,
        search_date: searchRun.createdAt,
        jurisdiction: config.jurisdiction,
        total_patents_found: aggregationResult.per_patent_coverage.length,
        selection_criteria: `Top 25% most relevant patents selected for detailed analysis (${selectedCount} patents)`
      },
      section_1_2_key_features: {
        anchor: "key-features",
        title: "Key Features Generated from Search Query",
        features_table: (stage0Data.inventionFeatures || []).map((feature, index) => ({
          number: index + 1,
          description: feature
        }))
      },
      section_1_3_summary: {
        anchor: "summary",
        title: "Summary",
        description: `Based on the details of the invention, relevant patent citations are mapped. Further, ${selectedCount} other patent citations are also shortlisted. Only one patent per family is being mapped and other family members of the family are incorporated by reference. Summary of the citations is presented in the tables below.`,
        citations_table: citationsTable
      },
      section_1_4_feature_analysis: {
        anchor: "feature-analysis",
        title: "Key Feature Analysis",
        description: "The broad key features are prepared based on the details of the invention and information provided by the client. The analysis of the references has been done based on one or more features overlapping with the key features of the invention to form a relevant prior art.",
        feature_matrix: {
          patent_numbers: selectedPatents?.map(p => p.patentNumber) || [],
          features: (stage0Data.inventionFeatures || []).map((feature, index) => ({
            name: `KF${index + 1}`,
            description: feature
          })),
          overlap_data: selectedPatents?.map(patent => ({
            patent: patent.patentNumber,
            ...Object.fromEntries(
              (stage0Data.inventionFeatures || []).map((feature, index) => [
                `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage ?
                `${(patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0).toFixed(1)}%` :
                  "0.0%"
              ])
            )
          })) || []
        }
      },
      section_2_1_patent_details: {
        anchor: "patent-details",
        title: "Details of Relevant Patent Citations",
        patents: selectedPatents?.map(patent => ({
          patent_number: patent.patentNumber,
          anchor: `patent_${patent.patentNumber}`,
          basic_info: {
            title: `Patent ${patent.patentNumber}`,
            publication_number: patent.patentNumber,
            filing_date: "Unknown",
            publication_date: "Unknown",
            applicant: "Unknown",
            inventor: "Unknown",
            cpc_codes: [],
            abstract: "Patent details not available in fallback mode"
          },
          feature_comparison: {
            title: "Feature-by-Feature Analysis",
            comparisons: (stage0Data.inventionFeatures || []).map(feature => ({
              feature: feature,
              patent_implementation: "Analysis not available in fallback mode",
              searched_idea: feature,
              similarity: "Unknown",
              novelty_impact: "Analysis not available in fallback mode"
            }))
          },
          attorney_analysis: {
            title: "Patent Attorney Analysis",
            relation_to_idea: "Detailed analysis not available in fallback mode",
            existing_coverage: `Coverage ratio: ${(patent.coverageRatio * 100).toFixed(1)}%`,
            novel_elements: "Analysis not available in fallback mode",
            recommendations: "Please regenerate report for detailed analysis"
          }
        })) || []
      },
      concluding_remarks: {
        title: "Final Concluding Remarks",
        overall_novelty_assessment: aggregationResult.decision,
        key_strengths: [
          `Novelty score: ${score}%`,
          `${uniqueFeatures} out of ${totalFeatures} features show high uniqueness`
        ],
        key_risks: [
          "Limited patent details in fallback mode",
          "Detailed analysis not available"
        ],
        strategic_recommendations: aggregationResult.decision === 'Novel' ?
          ["Proceed with patent filing", "Consider broad claim scope"] :
          ["Narrow claims to unique features", "Consider alternative IP protection"],
        filing_advice: aggregationResult.decision === 'Novel' ?
          "Strong patentability prospects - proceed with filing" :
          "Moderate patentability - review claims and consider amendments"
      }
    };
  }

  /**
   * Enhance LLM-generated report with deterministic data
   */
  private enhanceReportWithDeterministicData(
    llmReport: any,
    aggregationResult: AggregationResult,
    reportInputs: any
  ): any {
    // Build deterministic summary explaining why novelty exists
    const totalFeatures = aggregationResult.per_feature_uniqueness.length;
    const highlyUnique = aggregationResult.per_feature_uniqueness
      .filter(f => f.uniqueness > 0.8)
      .sort((a, b) => b.uniqueness - a.uniqueness);
    const topUniqueNames = highlyUnique.slice(0, 3).map(f => f.feature);
    const integration = aggregationResult.integration_check;
    const integrationLine = integration?.any_single_patent_covers_majority === false
      ? 'No single prior-art patent integrates a majority of the key features, indicating system-level novelty arises from their specific combination.'
      : (integration?.explanation || 'Several references show partial overlap; novelty depends on claim focus and specific combinations.');

    const deterministicSummary = `Based on feature-level mapping of the shortlisted prior art, ${highlyUnique.length} of ${totalFeatures} key features show high uniqueness (>80%). ` +
      (topUniqueNames.length > 0 ? `The strongest differentiators include ${topUniqueNames.join(', ')}. ` : '') +
      `${integrationLine} Overall determination: ${aggregationResult.decision} with ${(aggregationResult.novelty_score * 100).toFixed(1)}% novelty and ${aggregationResult.confidence.toLowerCase()} confidence.`;

    const existingExec = llmReport?.executive_summary || {};
    const finalExec = {
      ...existingExec,
      summary: existingExec.summary || existingExec.text || deterministicSummary,
      novelty_score: (aggregationResult.novelty_score * 100).toFixed(1) + "%",
      confidence: aggregationResult.confidence,
      visual_cards: {
        "Novelty Score": (aggregationResult.novelty_score * 100).toFixed(1) + "%",
        "Patents Analyzed": aggregationResult.per_patent_coverage.length.toString(),
        "Unique Features": `${highlyUnique.length} of ${totalFeatures}`,
        "Confidence": aggregationResult.confidence
      }
    };

    // Concluding remarks with explicit "why novelty exists"
    const existingRemarks = llmReport?.concluding_remarks || {};
    const whyNovel = `Novelty is primarily supported by the high-uniqueness features (${topUniqueNames.join(', ') || 'several key features'}) and the lack of a single prior-art reference integrating a majority of the invention’s features. The inventive contribution lies in the specific configuration and interaction of these features.`;
    const finalRemarks = {
      ...existingRemarks,
      overall_novelty_assessment: existingRemarks.overall_novelty_assessment || aggregationResult.decision,
      why_novelty_exists: existingRemarks.why_novelty_exists || whyNovel
    };

    // Ensure deterministic data overrides any LLM hallucinations
    return {
      ...llmReport,
      // Include search query from stage 0 data
      search_query: reportInputs.stage0_data?.searchQuery || '',
      executive_summary: finalExec,
      feature_uniqueness_table: aggregationResult.per_feature_uniqueness.map(f => ({
        feature: f.feature,
        uniqueness: (f.uniqueness * 100).toFixed(1) + "%",
        color: f.uniqueness > 0.8 ? "#4CAF50" : f.uniqueness > 0.6 ? "#FFC107" : "#E53935"
      })),
      concluding_remarks: finalRemarks,
      // Add patent metadata
      relevant_patent_summaries: reportInputs.patent_metadata
    };
  }

  // Stage 4 Helper Methods

  private async getFeatureMapCellsWithOverrides(searchId: string): Promise<any[]> {
    // Get cells with overrides applied
    const cells = await (prisma as any).featureMapCell.findMany({
      where: { searchId },
      include: {
        overrides: true // Include any overrides
      }
    });

    // Apply overrides
    return cells.map((cell: any) => {
      const override = cell.overrides?.[0]; // Latest override if any
      if (override) {
        return {
          ...cell,
          status: override.overriddenStatus,
          evidence: override.evidence || cell.evidence,
          overridden: true,
          overrideReason: override.reason
        };
      }
      return { ...cell, overridden: false };
    });
  }

  private selectTopPatentsForDetailedAnalysis(
    perPatentCoverage: PerPatentCoverage[],
    featureMapCells: any[],
    inventionFeatures: string[],
    stage1PQAI?: any[]
  ): any[] {
    // Compute global feature scarcity to prioritize patents covering rarer features
    const featureStats = new Map<string, { present: number; partial: number }>();
    for (const cell of featureMapCells || []) {
      const f = (cell.feature_text || cell.feature || '').toLowerCase();
      if (!f) continue;
      const s = (cell.status || '').toString();
      const entry = featureStats.get(f) || { present: 0, partial: 0 };
      if (s === 'Present') entry.present += 1;
      else if (s === 'Partial') entry.partial += 1;
      featureStats.set(f, entry);
    }
    const scarcityWeight = (feat: string): number => {
      const key = (feat || '').toLowerCase();
      const st = featureStats.get(key) || { present: 0, partial: 0 };
      // Rarer features get higher weight; clamp to [0.2, 1.0]
      const raw = 1 / (1 + st.present + 0.5 * st.partial);
      return Math.max(0.2, Math.min(1.0, raw));
    };
    // Pre-index PQAI results by publication number for relevance/abstract lookup
    const pqaiByPn = new Map<string, any>();
    if (Array.isArray(stage1PQAI)) {
      for (const r of stage1PQAI) {
        const pn = r.publicationNumber || r.pn || r.patent_number || r.publication_number;
        if (pn) pqaiByPn.set(pn, r);
      }
    }

    // Calculate relevance score for each patent based on coverage ratio and feature overlap
    const featureCount = inventionFeatures.length || 0;

    const scored = perPatentCoverage
      // Filter to only patents with at least one Present or Partial feature
      .filter(p => (p.present_count || 0) + (p.partial_count || 0) > 0)
      .map(patent => {
      // Find feature mappings for this patent
      const patentMappings = featureMapCells.filter(cell =>
        (cell.patent_publication_number || cell.publicationNumber) === patent.pn
      );

      // Calculate average feature overlap percentage
      const featureOverlaps = inventionFeatures.map(feature => {
        const mapping = patentMappings.find((m: any) =>
          m.feature_text?.toLowerCase() === feature.toLowerCase()
        );
        return mapping ? (mapping.overlap_percentage || 0) : 0;
      });

      const avgFeatureOverlap = featureOverlaps.reduce((sum, overlap) => sum + overlap, 0) / featureOverlaps.length;

      // Combine coverage ratio and feature overlap for final score
      const relevanceScore = (patent.coverage_ratio * 0.6) + (avgFeatureOverlap * 0.4);

      const pq = pqaiByPn.get(patent.pn) || {};
      const pqaiRelevance = pq.relevanceScore || pq.score || pq.relevance || 0;
      const abstract = pq.abstract || pq.snippet || pq.description || '';

      const presentPartial = (patent.present_count || 0) + (patent.partial_count || 0);
      const allFeaturesCovered = featureCount > 0 && presentPartial >= featureCount;

      return {
        patentNumber: patent.pn,
        coverageRatio: patent.coverage_ratio,
        avgFeatureOverlap: avgFeatureOverlap,
        relevanceScore: relevanceScore,
        pqaiRelevance,
        abstract,
        allFeaturesCovered,
        mappings: patentMappings
      };
    });

    // If multiple patents cover all features, keep only top 2 by PQAI relevance to save tokens
    const fullCover = scored.filter(s => s.allFeaturesCovered);
    if (fullCover.length >= 2) {
      const topByPQAI = [...fullCover].sort((a, b) => (b.pqaiRelevance || 0) - (a.pqaiRelevance || 0)).slice(0, 2);
      console.log(`🎯 All-feature coverage detected. Limiting to top ${topByPQAI.length} by PQAI relevance.`);
      return topByPQAI;
    }

    // Otherwise, if we have > 2 intersecting patents, select up to 2 that maximize unique feature coverage (Present>Partial)
    if (scored.length > 2) {
      const featureSet = new Set(inventionFeatures.map(f => f.toLowerCase()));
      const covered = new Set<string>();

      // Helper to compute marginal gain for a patent given currently covered features
      const marginalGain = (pat: any): number => {
        let gain = 0;
        for (const m of pat.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat || !featureSet.has(feat) || covered.has(feat)) continue;
          const status = (m.status || '').toString();
          const w = scarcityWeight(feat);
          if (status === 'Present') gain += 1.0 * w;
          else if (status === 'Partial') gain += 0.5 * w;
        }
        // Lightly include PQAI relevance as tie-breaker signal
        gain += (pat.pqaiRelevance || 0) * 0.05;
        return gain;
      };

      const pool = [...scored].sort((a, b) => b.relevanceScore - a.relevanceScore);
      const chosen: any[] = [];
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        // Pick patent with highest marginal coverage gain; tie-break by relevance
        pool.sort((a, b) => {
          const ga = marginalGain(a), gb = marginalGain(b);
          if (gb !== ga) return gb - ga;
          return (b.relevanceScore || 0) - (a.relevanceScore || 0);
        });
        const pick = pool.shift();
        if (!pick) break;
        chosen.push(pick);
        // Update covered features with this pick
        for (const m of pick.mappings as any[]) {
          const feat = (m.feature_text || '').toLowerCase();
          if (!feat) continue;
          const status = (m.status || '').toString();
          if (status === 'Present' || status === 'Partial') covered.add(feat);
        }
      }
      console.log(`🧠 Greedy selection picked ${chosen.length} patents to maximize evidence coverage.`);
      return chosen;
    }

    // If 1–2 intersecting patents, return them as-is
    const patentScores = scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`📊 Passing ${patentScores.length} intersecting patents to Stage 4 (out of filtered set).`);
    return patentScores;
  }

  private buildFeaturePatentMatrix(
    inventionFeatures: string[],
    featureMapCells: any[],
    maxRefs: number
  ): any {
    // Group cells by publication number and sort by coverage
    const patentGroups: { [pn: string]: any } = {};

    for (const cell of featureMapCells) {
      if (!patentGroups[cell.publicationNumber]) {
        patentGroups[cell.publicationNumber] = {
          pn: cell.publicationNumber,
          cells: [],
          presentCount: 0,
          totalCount: inventionFeatures.length
        };
      }

      patentGroups[cell.publicationNumber].cells.push({
        feature: cell.feature,
        status: cell.status,
        evidence: cell.evidence
      });

      if (cell.status === 'Present') {
        patentGroups[cell.publicationNumber].presentCount++;
      }
    }

    // Sort patents by coverage ratio and take top N
    const sortedPatents = Object.values(patentGroups)
      .map((p: any) => ({
        ...p,
        coverageRatio: p.presentCount / p.totalCount
      }))
      .sort((a: any, b: any) => b.coverageRatio - a.coverageRatio)
      .slice(0, maxRefs);

    return {
      rows: inventionFeatures,
      cols: sortedPatents.map((p: any) => p.pn),
      cells: sortedPatents.map((p: any) =>
        inventionFeatures.map(feature => {
          const cell = p.cells.find((c: any) => c.feature === feature);
          return cell ? cell.status : 'Unknown';
        })
      ),
      coverageRatios: sortedPatents.map((p: any) => p.coverageRatio)
    };
  }

  private getTopReferences(perPatentCoverage: PerPatentCoverage[], maxRefs: number): any[] {
    return perPatentCoverage
      .sort((a, b) => b.coverage_ratio - a.coverage_ratio)
      .slice(0, maxRefs)
      .map(coverage => ({
        pn: coverage.pn,
        coverage_ratio: coverage.coverage_ratio,
        year: '2023', // Would need to get from PQAI data
        country: 'US', // Would need to get from PQAI data
        assignee: 'Unknown' // Would need to get from PQAI data
      }));
  }

  private async generateReportContent(
    searchRun: any,
    stage0Data: NormalizedIdea,
    aggregationResult: AggregationResult,
    featureMatrix: any,
    topReferences: any[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<any> {
    const reportData = {
      idea_id: searchRun.id,
      report: {
        executive_summary: `Novelty assessment completed with ${aggregationResult.decision} determination (score: ${aggregationResult.novelty_score.toFixed(2)}, confidence: ${aggregationResult.confidence}).`,
        metrics: {
          novelty_score: aggregationResult.novelty_score,
          decision: aggregationResult.decision,
          confidence: aggregationResult.confidence
        },
        feature_matrix: featureMatrix,
        top_references: topReferences,
        final_remarks: `Analysis based on title/abstract review of ${aggregationResult.per_patent_coverage.length} references.`,
        appendices: {
          prior_art_metadata: [], // Would populate from PQAI data
          methodology: `Feature mapping used Present/Partial/Absent assessment with ${config.stage35a.batchSize} patents per batch.`,
          quality_flags: aggregationResult.integration_check
        }
      }
    };

    return reportData;
  }

  private buildReportProsePrompt(searchRun: any, aggregationResult: AggregationResult, reportData: any): string {
    return `Generate a brief executive summary and final remarks for this novelty assessment report.

INPUT DATA:
- Decision: ${aggregationResult.decision}
- Novelty Score: ${aggregationResult.novelty_score}
- Confidence: ${aggregationResult.confidence}
- Risk Factors: ${aggregationResult.risk_factors.join(', ')}
- Integration Check: ${aggregationResult.integration_check.any_single_patent_covers_majority ?
    `Patent ${aggregationResult.integration_check.integration_pn} covers majority` :
    aggregationResult.integration_check.explanation}

OUTPUT JSON:
{
  "executive_summary": "2-3 sentence summary of findings",
  "final_remarks": "1-2 sentence conclusion",
  "recommendations": {
    "prosecution_strategy": ["2-3 key recommendations"],
    "next_steps": ["1-2 immediate actions"]
  }
}`;
  }

  // Stage 3.5b Helper Methods

  private computePerPatentCoverage(featureMaps: PatentFeatureMap[], inventionFeatures: string[]): PerPatentCoverage[] {
    return featureMaps.map(patentMap => {
      const cells = patentMap.feature_analysis;
      const presentCount = cells.filter(c => c.status === 'Present').length;
      const partialCount = cells.filter(c => c.status === 'Partial').length;
      const absentCount = cells.filter(c => c.status === 'Absent' || c.status === 'Unknown').length;
      const coverageRatio = inventionFeatures.length > 0 ? presentCount / inventionFeatures.length : 0;

      return {
        pn: patentMap.pn,
        present_count: presentCount,
        partial_count: partialCount,
        absent_count: absentCount,
        coverage_ratio: Math.round(coverageRatio * 100) / 100
      };
    });
  }

  private computePerFeatureUniqueness(featureMaps: PatentFeatureMap[], inventionFeatures: string[]): PerFeatureUniqueness[] {
    return inventionFeatures.map(feature => {
      const totalPatents = featureMaps.length;
      const presentIn = featureMaps.filter(p => p.feature_analysis.find(c => c.feature === feature)?.status === 'Present').length;
      const partialIn = featureMaps.filter(p => p.feature_analysis.find(c => c.feature === feature)?.status === 'Partial').length;
      const absentIn = totalPatents - presentIn - partialIn;

      const uniqueness = totalPatents > 0 ? 1 - (presentIn / totalPatents) : 1;

      return {
        feature,
        present_in: presentIn,
        partial_in: partialIn,
        absent_in: absentIn,
        uniqueness: Math.round(uniqueness * 100) / 100
      };
    });
  }

  private performIntegrationCheck(
    featureMaps: PatentFeatureMap[],
    inventionFeatures: string[],
    criticalFeatures: string[]
  ): IntegrationCheck {
    const majorityThreshold = Math.ceil(inventionFeatures.length * 0.8);

    for (const patentMap of featureMaps) {
      const presentFeatures = patentMap.feature_analysis.filter(c => c.status === 'Present').length;

      if (presentFeatures >= majorityThreshold) {
        // Check if it mentions same use-case intent
        const hasUseCaseLanguage = this.checkUseCaseIntent(patentMap, inventionFeatures);
        if (hasUseCaseLanguage) {
          return {
            any_single_patent_covers_majority: true,
            integration_pn: patentMap.pn,
            explanation: `Patent ${patentMap.pn} covers ${presentFeatures}/${inventionFeatures.length} features with matching use-case language`
          };
        }
      }
    }

    return {
      any_single_patent_covers_majority: false,
      explanation: 'No single patent covers a majority of features with consistent use-case language'
    };
  }

  private checkUseCaseIntent(patentMap: PatentFeatureMap, inventionFeatures: string[]): boolean {
    // Simple heuristic: check if patent title/abstract contains words that suggest same application context
    // This is a simplified version - in practice might use more sophisticated NLP
    const patentText = `${patentMap.title} ${patentMap.feature_analysis.map(c => c.evidence).join(' ')}`.toLowerCase();

    // Look for common use-case words that suggest same technical field
    const useCaseWords = ['system', 'method', 'apparatus', 'device', 'process', 'using', 'for', 'to'];

    return useCaseWords.some(word => patentText.includes(word));
  }

  private computeNoveltyScore(perFeatureUniqueness: PerFeatureUniqueness[], criticalFeatures: string[]): number {
    const featureWeights = perFeatureUniqueness.map(uniqueness => {
      const isCritical = criticalFeatures.includes(uniqueness.feature);
      const weight = isCritical ? 2 : 1;
      return {
        uniqueness: uniqueness.uniqueness,
        weight
      };
    });

    const totalWeight = featureWeights.reduce((sum, fw) => sum + fw.weight, 0);
    if (totalWeight === 0) return 1;

    const weightedSum = featureWeights.reduce((sum, fw) => sum + (fw.uniqueness * fw.weight), 0);
    const noveltyScore = weightedSum / totalWeight;

    return Math.round(noveltyScore * 100) / 100;
  }

  private computeDecisionAndConfidence(
    noveltyScore: number,
    integrationCheck: IntegrationCheck,
    perFeatureUniqueness: PerFeatureUniqueness[],
    patentsAnalyzed: number,
    qualityFlags: any,
    criticalFeatures: string[]
  ): { decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence'; confidence: 'High' | 'Medium' | 'Low' } {

    // Low Evidence takes precedence
    if (qualityFlags.low_evidence || patentsAnalyzed < 5) {
      return { decision: 'Low Evidence', confidence: 'Low' };
    }

    let decision: 'Novel' | 'Partially Novel' | 'Not Novel' | 'Low Evidence';

    if (integrationCheck.any_single_patent_covers_majority) {
      // Integration passes - check if coverage is dense
      const denseCoverage = this.checkDenseCoverage(perFeatureUniqueness);
      decision = denseCoverage ? 'Not Novel' : 'Partially Novel';
    } else {
      // Integration fails - check for high uniqueness on critical features
      const hasHighUniquenessCritical = criticalFeatures.some(feature => {
        const uniqueness = perFeatureUniqueness.find(u => u.feature === feature)?.uniqueness || 0;
        return uniqueness >= 0.7;
      });

      const hasAnyHighUniqueness = perFeatureUniqueness.some(u => u.uniqueness >= 0.6);

      if (hasHighUniquenessCritical) {
        decision = 'Novel';
      } else if (hasAnyHighUniqueness) {
        decision = 'Partially Novel';
      } else {
        decision = 'Not Novel';
      }
    }

    // Compute confidence
    let confidence: 'High' | 'Medium' | 'Low' = 'Medium';

    if (patentsAnalyzed >= 20 && perFeatureUniqueness.filter(u => u.partial_in > 0).length <= patentsAnalyzed * 0.1) {
      confidence = 'High';
    } else if (qualityFlags.ambiguous_abstracts || qualityFlags.language_mismatch) {
      confidence = 'Low';
    }

    return { decision, confidence };
  }

  private checkDenseCoverage(perFeatureUniqueness: PerFeatureUniqueness[]): boolean {
    // Dense coverage: ≥70% of features have present count ≥40% of patents
    const totalFeatures = perFeatureUniqueness.length;
    const denseFeatures = perFeatureUniqueness.filter(u =>
      (u.present_in / (u.present_in + u.partial_in + u.absent_in)) >= 0.4
    ).length;

    return (denseFeatures / totalFeatures) >= 0.7;
  }

  private identifyRiskFactors(
    featureMaps: PatentFeatureMap[],
    perFeatureUniqueness: PerFeatureUniqueness[],
    qualityFlags: any,
    inventionFeatures: string[]
  ): string[] {
    const risks: string[] = [];

    // Keyword echo risk
    const highKeywordEcho = perFeatureUniqueness.filter(u => u.uniqueness < 0.3).length > inventionFeatures.length * 0.5;
    if (highKeywordEcho) {
      risks.push('High keyword echo risk in multiple references');
    }

    // Generic features
    const genericFeatures = perFeatureUniqueness.filter(u => u.present_in > featureMaps.length * 0.8).length;
    if (genericFeatures > 0) {
      risks.push(`${genericFeatures} features are generic phrasing`);
    }

    // Quality flags
    if (qualityFlags.ambiguous_abstracts) {
      risks.push('Many references have ambiguous or short abstracts');
    }

    if (qualityFlags.language_mismatch) {
      risks.push('Multiple references appear to be in non-English languages');
    }

    // Domain saturation
    const lowUniquenessFeatures = perFeatureUniqueness.filter(u => u.uniqueness < 0.2).length;
    if (lowUniquenessFeatures > inventionFeatures.length * 0.3) {
      risks.push('Domain appears saturated with similar technology');
    }

    return risks;
  }

  private async storeAggregationSnapshot(
    searchId: string,
    aggregationResult: AggregationResult,
    stats: any,
    qualityFlags: any
  ): Promise<void> {
    await (prisma as any).aggregationSnapshot.upsert({
      where: { searchId },
      update: {
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
        updatedAt: new Date()
      },
      create: {
        searchId,
        noveltyScore: aggregationResult.novelty_score,
        decision: aggregationResult.decision,
        confidence: aggregationResult.confidence,
        perPatentCoverage: aggregationResult.per_patent_coverage as any,
        perFeatureUniqueness: aggregationResult.per_feature_uniqueness as any,
        integrationCheck: aggregationResult.integration_check as any,
        qualityFlags,
        riskFactors: aggregationResult.risk_factors,
        stats,
      }
    });
  }


  private async performStage4(
    searchRun: any,
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>
  ): Promise<{ success: boolean; data?: any; reportUrl?: string; error?: string }> {
    try {
      console.log('📄 Starting Stage 4: Report Generation');

      // Validate required data for Stage 4 report generation
      const stage0Data = searchRun.stage0Results as unknown as NormalizedIdea;
      if (!stage0Data || !stage0Data.inventionFeatures || stage0Data.inventionFeatures.length === 0) {
        return {
          success: false,
          error: 'Stage 0 results are required for report generation. Please ensure Stage 0 is completed.'
        };
      }

      const stage1Data = searchRun.stage1Results as unknown as any;
      if (!stage1Data || !Array.isArray(stage1Data.pqaiResults) || stage1Data.pqaiResults.length === 0) {
        return {
          success: false,
          error: 'Stage 1 results are required for report generation. Please ensure Stage 1 is completed.'
        };
      }

      let aggregationResult = searchRun.stage4Results as unknown as AggregationResult | null;
      const featureMapData = searchRun.stage35Results as unknown as FeatureMapBatchResult | null;
      if (!featureMapData && !aggregationResult) {
        return {
          success: false,
          error: 'Stage 3.5 results are required for report generation. Please ensure Stage 3.5a is completed.'
        };
      }

      // If aggregation was not persisted earlier (no stage4Results), compute it now from 3.5a data
      if (!aggregationResult && featureMapData) {
        const agg = await this.performStage35b(searchRun.id, stage0Data, featureMapData, config, requestHeaders);
        if (!agg.success || !agg.data) {
          return { success: false, error: agg.error || 'Failed to aggregate feature mapping for report' };
        }
        aggregationResult = agg.data;
      }

      if (!aggregationResult) {
        return { success: false, error: 'Aggregation data missing. Please re-run Stage 3.5a.' };
      }

      const aggRes = aggregationResult as AggregationResult;

      // Get feature map cells from database (including any overrides)
      const featureMapCells = await this.getFeatureMapCellsWithOverrides(searchRun.id);

      // Select top patents for detailed analysis, filtered to those with ≥1 matching feature
      const selectedPatents = this.selectTopPatentsForDetailedAnalysis(
        aggRes.per_patent_coverage,
        featureMapCells,
        stage0Data.inventionFeatures || [],
        Array.isArray(stage1Data?.pqaiResults) ? stage1Data.pqaiResults : undefined
      );

      console.log(`📊 Generating report with ${aggRes.decision} decision, score ${aggRes.novelty_score}`);

      // Build the feature-patent matrix for the report
      const featureMatrix = this.buildFeaturePatentMatrix(
        stage0Data.inventionFeatures || [],
        featureMapCells,
        config.stage4.maxRefsForReportMain
      );

      // Get top references sorted by coverage ratio
      const topReferences = this.getTopReferences(
        aggRes.per_patent_coverage,
        config.stage4.maxRefsForReportMain
      );

      // Prepare report inputs
      const reportInputs = this.prepareReportInputs(
        searchRun,
        stage0Data,
        aggRes,
        featureMapCells,
        config
      );

      // Prepare enhanced report inputs with selected patents
      const selectedPatentsSummary = selectedPatents.map(p => {
        const present = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Present').length : 0;
        const partial = Array.isArray(p.mappings) ? p.mappings.filter((m: any) => (m.status || '').toString() === 'Partial').length : 0;
        return {
          patent_number: p.patentNumber,
          coverage_ratio: p.coverageRatio,
          avg_feature_overlap: Number((p.avgFeatureOverlap || 0).toFixed(3)),
          pqai_relevance: p.pqaiRelevance || 0,
          present_count: present,
          partial_count: partial
        };
      });

      const enhancedReportInputs = {
        invention_features: stage0Data.inventionFeatures || [],
        selected_patents: selectedPatentsSummary,
        search_metadata: {
          search_id: searchRun.id,
          search_date: searchRun.createdAt,
          jurisdiction: config.jurisdiction,
          total_patents_found: aggregationResult.per_patent_coverage.length,
          selected_patents_count: selectedPatents.length
        },
        patent_details: selectedPatents.map(patent => ({
          patent_number: patent.patentNumber,
          coverage_ratio: patent.coverageRatio,
          avg_feature_overlap: patent.avgFeatureOverlap,
          pqai_relevance: patent.pqaiRelevance || 0,
          abstract: ('' + (patent.abstract || '')).substring(0, 1800),
          mappings: patent.mappings
        })),
        feature_analysis_matrix: selectedPatents.map(patent => ({
          patent: patent.patentNumber,
          ...Object.fromEntries(
            (stage0Data.inventionFeatures || []).map((feature, index) => [
              `kf${index + 1}`,
              patent.mappings.find((m: any) => m.feature_text?.toLowerCase() === feature.toLowerCase())?.overlap_percentage || 0
            ])
          )
        })),
        structured_narrative: aggRes.structured_narrative || {}
      };

      // Execute LLM call for enhanced analytical report generation using compact V2 prompt
      let basePrompt = NOVELTY_REPORT_PROMPT_V2
        .replace('{invention_features}', JSON.stringify(enhancedReportInputs.invention_features))
        .replace('{selected_patents}', JSON.stringify(enhancedReportInputs.selected_patents))
        .replace('{search_metadata}', JSON.stringify(enhancedReportInputs.search_metadata))
        .replace('{feature_analysis_matrix}', JSON.stringify(enhancedReportInputs.feature_analysis_matrix))
        .replace('{structured_narrative}', JSON.stringify(enhancedReportInputs.structured_narrative))
        .replace(/SEARCH_ID/g, enhancedReportInputs.search_metadata.search_id)
        .replace(/GENERATION_DATE/g, new Date().toISOString().split('T')[0])
        .replace(/TOTAL_COUNT/g, enhancedReportInputs.search_metadata.total_patents_found.toString())
        .replace(/SELECTED_COUNT/g, enhancedReportInputs.search_metadata.selected_patents_count.toString())
        .replace(/SEARCH_DATE/g, enhancedReportInputs.search_metadata.search_date)
        .replace(/SEARCH_JURISDICTION/g, enhancedReportInputs.search_metadata.jurisdiction);

      // Request 3-5 new patent ideas for the Idea Bank (consistent with drafting flow JSON shape)
      basePrompt += `\n\nAdditionally, generate 3 to 5 new patent ideas based on uncovered gaps and combinations. Return them in JSON under key 'idea_bank_suggestions' as an array of objects with fields: title, core_principle, expected_advantage, tags (array of short strings), non_obvious_extension.`;

      // If no intersecting patents, add explicit instruction for the report
      if (!selectedPatents || selectedPatents.length === 0) {
        basePrompt += `\n\nNOTE_TO_MODEL: No prior art with intersecting features (Present/Partial) was found in Stage 3.5. Generate the report focusing on Stage 0 features, uniqueness rationale, and explain that no overlapping evidence was identified.`;
      }

      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt: basePrompt,
          modelClass: (config.stage4?.modelPreference || 'gemini-2.5-pro') as any
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.warn('LLM report generation failed, using fallback structure');
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggregationResult, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Parse the modern report structure (robust to truncation/non-JSON wrappers)
      let reportData: any;
      try {
        reportData = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn('LLM report JSON parse failed, falling back to deterministic report:', parseError);
        return {
          success: true,
          data: this.generateFallbackReportData(searchRun, stage0Data, aggRes, config, selectedPatents),
          reportUrl: undefined
        };
      }

      // Domain validation: if LLM content appears off-topic vs Stage 0, drop LLM prose and use deterministic
      if (!this.validateReportDomain(stage0Data, reportData)) {
        console.warn('⚠️ LLM report appears off-topic. Using deterministic report content.');
        reportData = {};
      }

      // Enhance with deterministic data
      // Normalize and extract idea bank suggestions if present
      const extractIdeas = (data: any): Array<any> => {
        const raw = data?.idea_bank_suggestions || data?.new_ideas || data?.ideas || [];
        if (!Array.isArray(raw)) return [];
        return raw.map((ib: any) => ({
          title: String(ib.title || ib.ideaTitle || '').slice(0, 200),
          core_principle: String(ib.core_principle || ib.corePrinciple || '').slice(0, 2000),
          expected_advantage: String(ib.expected_advantage || '').slice(0, 500),
          tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
          non_obvious_extension: String(ib.non_obvious_extension || '').slice(0, 1000)
        })).filter((x: any) => x.title);
      };
      const ideaBank = extractIdeas(reportData);

      const finalReportData = {
        ...this.enhanceReportWithDeterministicData(reportData, aggRes, reportInputs),
        idea_bank_suggestions: ideaBank
      };

      // Persist Idea Bank suggestions like drafting flow (if a drafting session exists for this patent)
      try {
        if (Array.isArray(ideaBank) && ideaBank.length > 0 && searchRun.patentId && searchRun.userId) {
          const draftingSession = await (prisma as any).draftingSession.findFirst({
            where: { patentId: searchRun.patentId, userId: searchRun.userId },
            orderBy: { createdAt: 'desc' }
          });

          if (draftingSession) {
            // Create a RelatedArtRun anchor for idea bank suggestions
            const relatedArtRun = await (prisma as any).relatedArtRun.create({
              data: {
                sessionId: draftingSession.id,
                queryText: String(stage0Data.searchQuery || searchRun.title || '').slice(0, 500),
                paramsJson: reportInputs || {},
                resultsJson: { noveltyScore: aggRes.novelty_score, decision: aggRes.decision },
                ranBy: searchRun.userId
              }
            });

            console.log('🔄 Persisting', ideaBank.length, 'Stage 4 idea bank suggestions…');
            const avgRelevance = (aggRes.per_patent_coverage || []).reduce((s, p) => s + (p.coverage_ratio || 0), 0) / Math.max(1, (aggRes.per_patent_coverage || []).length);

            for (let i = 0; i < ideaBank.length; i++) {
              const ib = ideaBank[i] || {};
              try {
                await (prisma as any).ideaBankSuggestion.create({
                  data: {
                    relatedArtRunId: relatedArtRun.id,
                    modelVersion: (llmResult as any)?.response?.modelClass || (llmResult as any)?.response?.metadata?.model || null,
                    ideaTitle: String(ib.title || '').slice(0, 200),
                    corePrinciple: String(ib.core_principle || '').slice(0, 2000),
                    expectedAdvantage: String(ib.expected_advantage || '').slice(0, 500),
                    tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
                    nonObviousExtension: String(ib.non_obvious_extension || '').slice(0, 1000),
                    sourceBatchIndex: i,
                    confidenceScore: avgRelevance || null
                  }
                });
              } catch (e) {
                console.error('❌ Failed to persist Stage 4 idea bank suggestion:', ib.title, e);
              }
            }
            console.log('✅ Stage 4 idea bank suggestions persisted');
          } else {
            // If a patentId exists, create a minimal drafting session to anchor Idea Bank without schema changes
            if (searchRun.patentId) {
              try {
                console.log('ℹ️ Creating minimal drafting session to persist ideas…');
                const newSession = await (prisma as any).draftingSession.create({
                  data: {
                    patentId: searchRun.patentId,
                    userId: searchRun.userId,
                    tenantId: searchRun.tenantId || null
                  }
                });

                const relatedArtRun = await (prisma as any).relatedArtRun.create({
                  data: {
                    sessionId: newSession.id,
                    queryText: String(stage0Data.searchQuery || searchRun.title || '').slice(0, 500),
                    paramsJson: reportInputs || {},
                    resultsJson: { noveltyScore: aggRes.novelty_score, decision: aggRes.decision },
                    ranBy: searchRun.userId
                  }
                });

                const avgRelevance = (aggRes.per_patent_coverage || []).reduce((s, p) => s + (p.coverage_ratio || 0), 0) / Math.max(1, (aggRes.per_patent_coverage || []).length);

                for (let i = 0; i < ideaBank.length; i++) {
                  const ib = ideaBank[i] || {};
                  try {
                    await (prisma as any).ideaBankSuggestion.create({
                      data: {
                        relatedArtRunId: relatedArtRun.id,
                        modelVersion: (llmResult as any)?.response?.modelClass || (llmResult as any)?.response?.metadata?.model || null,
                        ideaTitle: String(ib.title || '').slice(0, 200),
                        corePrinciple: String(ib.core_principle || '').slice(0, 2000),
                        expectedAdvantage: String(ib.expected_advantage || '').slice(0, 500),
                        tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
                        nonObviousExtension: String(ib.non_obvious_extension || '').slice(0, 1000),
                        sourceBatchIndex: i,
                        confidenceScore: avgRelevance || null
                      }
                    });
                  } catch (e) {
                    console.error('❌ Failed to persist Stage 4 idea bank suggestion:', ib.title, e);
                  }
                }
                console.log('✅ Stage 4 idea bank suggestions persisted via new drafting session');
              } catch (createErr) {
                console.warn('⚠️ Failed to create drafting session for idea persistence. Ideas remain in Stage 4 results.', createErr);
              }
            } else {
              // No patentId provided: create a lightweight anchor (Project -> Patent -> DraftingSession)
              try {
                console.log('ℹ️ No patentId available; creating lightweight project/patent/session to anchor ideas.');
                // Find or create a user project for Idea Bank
                let project = await (prisma as any).project.findFirst({ where: { userId: searchRun.userId, name: 'Idea Bank (Auto)' } });
                if (!project) {
                  project = await (prisma as any).project.create({ data: { userId: searchRun.userId, name: 'Idea Bank (Auto)' } });
                }

                // Create a minimal patent under this project to comply with schema
                const patent = await (prisma as any).patent.create({
                  data: {
                    projectId: project.id,
                    title: `Idea Bank (Novelty) - ${new Date().toISOString().slice(0,10)}`,
                    createdBy: searchRun.userId
                  }
                });

                const newSession = await (prisma as any).draftingSession.create({
                  data: {
                    patentId: patent.id,
                    userId: searchRun.userId,
                    tenantId: searchRun.tenantId || null
                  }
                });

                const relatedArtRun = await (prisma as any).relatedArtRun.create({
                  data: {
                    sessionId: newSession.id,
                    queryText: String(stage0Data.searchQuery || searchRun.title || '').slice(0, 500),
                    paramsJson: reportInputs || {},
                    resultsJson: { noveltyScore: aggRes.novelty_score, decision: aggRes.decision },
                    ranBy: searchRun.userId
                  }
                });

                const avgRelevance = (aggRes.per_patent_coverage || []).reduce((s, p) => s + (p.coverage_ratio || 0), 0) / Math.max(1, (aggRes.per_patent_coverage || []).length);
                for (let i = 0; i < ideaBank.length; i++) {
                  const ib = ideaBank[i] || {};
                  try {
                    await (prisma as any).ideaBankSuggestion.create({
                      data: {
                        relatedArtRunId: relatedArtRun.id,
                        modelVersion: (llmResult as any)?.response?.modelClass || (llmResult as any)?.response?.metadata?.model || null,
                        ideaTitle: String(ib.title || '').slice(0, 200),
                        corePrinciple: String(ib.core_principle || '').slice(0, 2000),
                        expectedAdvantage: String(ib.expected_advantage || '').slice(0, 500),
                        tags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
                        nonObviousExtension: String(ib.non_obvious_extension || '').slice(0, 1000),
                        sourceBatchIndex: i,
                        confidenceScore: avgRelevance || null
                      }
                    });
                  } catch (e) {
                    console.error('❌ Failed to persist Stage 4 idea bank suggestion:', ib.title, e);
                  }
                }
                console.log('✅ Stage 4 idea bank suggestions persisted via auto-created project/patent/session');
              } catch (anchorErr) {
                console.warn('⚠️ Failed to auto-create anchor for idea persistence. Ideas remain in Stage 4 results.', anchorErr);
              }
            }
          }
        }
      } catch (persistErr) {
        console.warn('⚠️ Idea bank persistence failed:', persistErr);
      }

      // Generate PDF report if requested
      let reportUrl: string | undefined;
      if (config.stage4.reportFormat === 'PDF') {
        try {
          reportUrl = await PDFReportService.generateComprehensiveNoveltyReport(searchRun.id);
          console.log('✅ Comprehensive PDF report generated successfully');
        } catch (pdfError) {
          console.warn('⚠️ PDF report generation failed:', pdfError);
          // Don't fail the entire stage if PDF generation fails
        }
      }

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId: searchRun.id,
          stage: NoveltySearchStage.STAGE_4,
          taskCode: TaskCode.LLM6_REPORT_GENERATION,
          prompt: this.buildReportProsePrompt(searchRun, aggregationResult, reportData),
          response: llmResult.response?.output,
          tokensUsed: llmResult.response?.outputTokens,
          modelClass: llmResult.response?.modelClass,
        },
      });

      console.log('✅ Stage 4 completed successfully');
      return { success: true, data: finalReportData, reportUrl };

    } catch (error) {
      console.error('Stage 4 error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stage 4 failed'
      };
    }
  }

  // Stage 3.5a Helper Methods
  /**
   * Validate that LLM report content is on-topic with Stage 0 invention
   */
  private validateReportDomain(stage0Data: NormalizedIdea, llmReport: any): boolean {
    try {
      const title = (stage0Data as any)?.title || '';
      const query = stage0Data?.searchQuery || '';
      const features: string[] = Array.isArray(stage0Data?.inventionFeatures) ? stage0Data.inventionFeatures : [];
      const topicTokens = (title + ' ' + query + ' ' + features.join(' ')).toLowerCase();

      // If no topic info, skip validation
      if (!topicTokens.trim()) return true;

      const text = JSON.stringify(llmReport || {}).toLowerCase();

      // Require at least two topic tokens to appear
      const topicHints = features.slice(0, 6).concat((query || '').split(/\s+/).slice(0, 6));
      const topicMatchCount = topicHints.filter(h => !!h && h.length > 3 && text.includes(h.toLowerCase())).length;

      // Flag common off-topic domains
      const offTopicKeywords = ['vehicle', 'autonomous vehicle', 'traffic', 'ride-share', 'road', 'fleet'];
      const offTopicHits = offTopicKeywords.filter(k => text.includes(k)).length;

      // Heuristic: if off-topic hits are high and topic matches are low => invalid
      if (offTopicHits >= 2 && topicMatchCount < 2) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  private normalizePatentsForFeatureMapping(pqaiResults: any[], maxRefsTotal: number): any[] {
    // Canonicalize PN (strip kind code), deduplicate, trim abstracts, drop entries without title/abstract
    const seen = new Set<string>();
    const normalized: any[] = [];

    for (const patent of pqaiResults.slice(0, maxRefsTotal)) {
      const pn = patent.publicationNumber || patent.publication_number || '';
      const canonicalPn = pn.replace(/[A-Z]\d*$/, ''); // Strip kind code for grouping

      if (!seen.has(canonicalPn) && patent.title && patent.abstract) {
        seen.add(canonicalPn);
        normalized.push({
          ...patent,
          canonicalPn,
          title: patent.title.substring(0, 200), // Truncate long titles
          abstract: patent.abstract.substring(0, 180) // Trim abstracts to ≤180 words
        });
      }
    }

    return normalized;
  }

  private createBatches(patents: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < patents.length; i += batchSize) {
      batches.push(patents.slice(i, i + batchSize));
    }
    return batches;
  }

  private async processFeatureMappingBatch(
    searchId: string,
    batch: any[],
    inventionFeatures: string[],
    config: NoveltySearchConfig,
    requestHeaders?: Record<string, string>,
    batchNumber: number = 0
  ): Promise<{ success: boolean; featureMaps?: PatentFeatureMap[]; error?: string }> {
    try {
      // Check cache first
      const batchHash = this.createBatchHash(batch, inventionFeatures);
      const ideaHash = this.createIdeaHash(inventionFeatures);
      const cached = await this.checkFeatureMappingCache(searchId, ideaHash, batchHash);

      if (cached) {
        console.log(`💾 Using cached results for batch ${batchNumber}`);
        return { success: true, featureMaps: cached };
      }

      // Format patent batch for prompt
      const patentBatchText = batch.map((patent, idx) => `
Patent ${idx + 1}:
PN: ${patent.canonicalPn}
Title: ${patent.title}
Abstract: ${patent.abstract}
---
      `).join('\n');

      // Build prompt
      const prompt = PR_35A_FEATURE_MAPPING_BATCH_PROMPT_V2
        .replace('{invention_features}', JSON.stringify(inventionFeatures))
        .replace('{patent_batch}', patentBatchText);

      // Call LLM
      const llmResult = await llmGateway.executeLLMOperation(
        { headers: requestHeaders || {} },
        {
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt,
          modelClass: config.stage35a.modelPreference as any
        }
      );

      if (!llmResult.success || !llmResult.response) {
        console.warn(`LLM call failed for batch ${batchNumber}`);
        return { success: false, error: 'LLM call failed' };
      }

      // Parse and validate response
      let parsedResult: FeatureMapBatchResult;
      try {
        parsedResult = this.parseLLMResponse(llmResult.response.output);
      } catch (parseError) {
        console.warn(`JSON parse failed for batch ${batchNumber}, attempting repair`);
        // Try one repair pass
        const repaired = this.repairFeatureMappingJSON(llmResult.response.output);
        if (repaired) {
          parsedResult = repaired;
        } else {
          // Mark cells as Unknown
          parsedResult = this.createUnknownFeatureMap(batch, inventionFeatures);
        }
      }

      // Validate and repair feature maps
      const validatedFeatureMaps = this.validateAndRepairFeatureMaps(parsedResult.feature_map, batch, inventionFeatures);

      // Cache the results
      await this.cacheFeatureMappingResults(searchId, ideaHash, batchHash, validatedFeatureMaps);

      // Record LLM call
      await prisma.noveltySearchLLMCall.create({
        data: {
          searchId,
          stage: NoveltySearchStage.STAGE_3_5, // Will be renamed in enum later
          taskCode: TaskCode.LLM5_NOVELTY_ASSESS,
          prompt,
          response: parsedResult as any,
          tokensUsed: llmResult.response.outputTokens,
          modelClass: llmResult.response.modelClass,
        },
      });

      return { success: true, featureMaps: validatedFeatureMaps };

    } catch (error) {
      console.error(`Batch ${batchNumber} processing error:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Batch processing failed' };
    }
  }

  private async storeFeatureMapResults(searchId: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    const cells: any[] = [];

    for (const patentMap of featureMaps) {
      for (const cell of patentMap.feature_analysis) {
        cells.push({
          searchId,
          publicationNumber: patentMap.pn,
          feature: cell.feature,
          status: cell.status,
          evidence: cell.evidence,
          confidence: 0.8 // Default confidence
        });
      }
    }

    // Bulk insert
    if (cells.length > 0) {
      await (prisma as any).featureMapCell.createMany({
        data: cells,
        skipDuplicates: true
      });
    }
  }

  private calculateQualityFlags(featureMaps: PatentFeatureMap[], originalPatents: any[]): { low_evidence: boolean; ambiguous_abstracts: boolean; language_mismatch: boolean } {
    const patentsAnalyzed = featureMaps.length;
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);
    const avgAbstractLength = patentsAnalyzed > 0 ? totalAbstractWords / patentsAnalyzed : 0;

    // Check for non-English abstracts (simple heuristic)
    const nonEnglishCount = originalPatents.filter(p =>
      /[^\x00-\x7F]/.test(p.abstract) || // Non-ASCII characters
      /^[^\w\s]*$/.test(p.abstract.replace(/\s/g, '')) // Very few word characters
    ).length;

    const languageMismatch = nonEnglishCount > originalPatents.length * 0.5;

    return {
      low_evidence: patentsAnalyzed < 5,
      ambiguous_abstracts: avgAbstractLength < 60,
      language_mismatch: languageMismatch
    };
  }

  private calculateFeatureMappingStats(featureMaps: PatentFeatureMap[], originalPatents: any[]): { patents_analyzed: number; avg_abstract_length_words: number } {
    const totalAbstractWords = originalPatents.reduce((sum, p) => sum + (p.abstract?.split(/\s+/).length || 0), 0);

    return {
      patents_analyzed: featureMaps.length,
      avg_abstract_length_words: featureMaps.length > 0 ? Math.round(totalAbstractWords / featureMaps.length) : 0
    };
  }

  private createBatchHash(batch: any[], inventionFeatures: string[]): string {
    const batchData = batch.map(p => `${p.canonicalPn}:${p.title}`).join('|');
    const featuresData = inventionFeatures.join('|');
    return crypto.createHash('md5').update(`${batchData}||${featuresData}`).digest('hex');
  }

  private createIdeaHash(inventionFeatures: string[]): string {
    return crypto.createHash('md5').update(inventionFeatures.join('|')).digest('hex');
  }

  private async checkFeatureMappingCache(searchId: string, ideaHash: string, batchHash: string): Promise<PatentFeatureMap[] | null> {
    try {
      const cacheEntry = await (prisma as any).featureMappingCache.findFirst({
        where: {
          ideaHash,
          batchHash,
          promptVersion: 'v1.0',
          expiresAt: {
            gt: new Date() // Not expired
          }
        }
      });

      if (cacheEntry) {
        console.log(`💾 Cache hit for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
        return cacheEntry.featureMaps as PatentFeatureMap[];
      }

      return null;
    } catch (error) {
      console.warn('Cache check failed:', error);
      return null;
    }
  }

  private async cacheFeatureMappingResults(searchId: string, ideaHash: string, batchHash: string, featureMaps: PatentFeatureMap[]): Promise<void> {
    try {
      // Cache for 24 hours
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await (prisma as any).featureMappingCache.upsert({
        where: {
          ideaHash_batchHash_promptVersion: {
            ideaHash,
            batchHash,
            promptVersion: 'v1.1'
          }
        },
        update: {
          featureMaps: featureMaps as any,
          expiresAt
        },
        create: {
          ideaHash,
          batchHash,
          promptVersion: 'v1.1',
          featureMaps: featureMaps as any,
          expiresAt
        }
      });

      console.log(`💾 Cached results for idea ${ideaHash.substring(0, 8)}, batch ${batchHash.substring(0, 8)}`);
    } catch (error) {
      console.warn('Cache storage failed:', error);
      // Don't fail the operation if caching fails
    }
  }

  private repairFeatureMappingJSON(responseText: string): FeatureMapBatchResult | null {
    try {
      // Simple repair: try to extract JSON from markdown or add missing brackets
      let repaired = responseText.trim();

      // Remove markdown code blocks
      repaired = repaired.replace(/^```json\s*/, '').replace(/\s*```$/, '');

      // Try to parse
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  private createUnknownFeatureMap(batch: any[], inventionFeatures: string[]): FeatureMapBatchResult {
    const featureMaps: PatentFeatureMap[] = batch.map(patent => ({
      pn: patent.canonicalPn,
      title: patent.title,
      feature_analysis: inventionFeatures.map(feature => ({
        feature,
        status: 'Unknown' as const,
        evidence: 'LLM parsing failed'
      }))
    }));

    return {
      feature_map: featureMaps,
      quality_flags: { low_evidence: true, ambiguous_abstracts: false, language_mismatch: false },
      stats: { patents_analyzed: batch.length, avg_abstract_length_words: 0 }
    };
  }

  private validateAndRepairFeatureMaps(featureMaps: PatentFeatureMap[], batch: any[], inventionFeatures: string[]): PatentFeatureMap[] {
    const validated: PatentFeatureMap[] = [];

    for (const patentMap of featureMaps) {
      // Find corresponding patent in batch
      const patent = batch.find(p => p.canonicalPn === patentMap.pn);
      if (!patent) continue;

      const validatedCells: FeatureMapCell[] = [];

      // Handle new format (separate present/partial/absent arrays)
      if (patentMap.present || patentMap.partial || patentMap.absent) {
        // Convert new format to old format for backward compatibility
        const allFeatures = [
          ...(patentMap.present || []).map(cell => ({ ...cell, status: 'Present' as const })),
          ...(patentMap.partial || []).map(cell => ({ ...cell, status: 'Partial' as const })),
          ...(patentMap.absent || []).map(cell => ({ ...cell, status: 'Absent' as const }))
        ];

        for (const feature of inventionFeatures) {
          const cell = allFeatures.find(c => c.feature === feature);
          if (cell) {
            const convertedCell: FeatureMapCell = {
              feature: cell.feature,
              status: cell.status,
              confidence: cell.confidence,
              quote: cell.quote,
              field: cell.field,
              reason: cell.reason
            };
            validatedCells.push(convertedCell);
          } else {
            // Create Unknown cell for missing features
            validatedCells.push({
              feature,
              status: 'Unknown',
              reason: 'Analysis not provided'
            });
          }
        }
      } else if (patentMap.feature_analysis) {
        // Handle old format (single feature_analysis array)
        for (const feature of inventionFeatures) {
          const cell = patentMap.feature_analysis.find(c => c.feature === feature);
          if (cell && ['Present', 'Partial', 'Absent'].includes(cell.status)) {
            validatedCells.push(cell);
          } else {
            // Create Unknown cell
            validatedCells.push({
              feature,
              status: 'Unknown',
              reason: 'Analysis not provided'
            });
          }
        }
      } else {
        // No valid data
        for (const feature of inventionFeatures) {
          validatedCells.push({
            feature,
            status: 'Unknown',
            reason: 'Invalid or missing analysis'
          });
        }
      }

      // Calculate coverage score if not provided
      let coverage = patentMap.coverage;
      if (!coverage && validatedCells.length > 0) {
        const present = validatedCells.filter(c => c.status === 'Present').length;
        const partial = validatedCells.filter(c => c.status === 'Partial').length;
        const absent = validatedCells.filter(c => c.status === 'Absent').length;
        const totalScore = validatedCells.reduce((sum, cell) => {
          if (cell.status === 'Present') return sum + 1.0;
          if (cell.status === 'Partial') return sum + 0.5;
          return sum;
        }, 0);
        const coverageScore = validatedCells.length > 0 ? totalScore / validatedCells.length : 0;

        coverage = { present, partial, absent, coverage_score: coverageScore };
      }

      validated.push({
        pn: patentMap.pn,
        title: patent.title,
        link: patentMap.link,
        coverage: coverage,
        present: patentMap.present,
        partial: patentMap.partial,
        absent: patentMap.absent,
        feature_analysis: validatedCells
      });
    }

    return validated;
  }

  // Helper methods

  private async searchPQAI(query: string, maxResults: number = 50): Promise<any[]> {
    // EXACT COPY from drafting stage 3.5 implementation
    const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || '90b423ac4fd243c790c068e3a9309cd7'
    if (!token) throw new Error('No PQAI API token configured. Set PQAI_API_TOKEN.')

    // PQAI endpoint: GET /search/102 with query parameters
    const baseUrl = 'https://api.projectpq.ai/search/102'

    // Simple normalization for PQAI (keep it compact as per Stage 1 design)
    let safeQuery = query
      .replace(/[\u2013\u2014]/g, '-')       // en/em dash → hyphen
      .replace(/[\u2018\u2019\u201C\u201D]/g, '"') // curly quotes → plain
      .replace(/[^\w\s-]/g, ' ')             // strip punctuation except hyphen
      .replace(/-/g, ' ')                      // turn hyphens into spaces to avoid tokenization issues
      .replace(/\s+/g, ' ')                   // collapse whitespace
      .trim()
    // Constrain to first 20 words (keep it compact per Stage 1 design and avoid PQAI server 500s)
    const words = safeQuery.split(/\s+/)
    if (words.length > 20) safeQuery = words.slice(0, 20).join(' ')

    const params = new URLSearchParams({
      q: safeQuery,
      n: String(Math.min(Math.max(10, maxResults), 50)),
      type: 'patent' // Only return patents, not research papers (NPL)
    })

    // Add token as query parameter for direct API
    params.set('token', token)

    const url = `${baseUrl}?${params.toString()}`

    // Debug: Log the final URL components
    console.log('PQAI Request Debug:', {
      baseUrl,
      queryLength: safeQuery.length,
      originalQueryLength: query.length,
      paramsCount: Array.from(params.entries()).length,
      hasToken: !!token,
      finalUrlLength: url.length,
      filters: 'type=patent' // Confirm patent-only filtering
    })

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    console.log('PQAI search:', {
      url: url.substring(0, 120) + '...',
      queryPreview: safeQuery.substring(0, 100) + '...',
      maxResults,
      hasToken: !!token,
      tokenLength: token.length
    })

    // Single API call per search with fetch + tighter headers and timeout
    let resp: Response | null = null
    try {
      const controller = new AbortController()
      const to = setTimeout(() => controller.abort(), 15000)

      // Configure fetch options to handle SSL certificate issues in development
      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store'
      }

      // In Node.js environment, we can configure HTTPS agent for self-signed certificates
      if (typeof window === 'undefined') {
        // Server-side: Use Node.js HTTPS agent to handle self-signed certificates
        const https = require('https')
        fetchOptions.agent = new https.Agent({
          rejectUnauthorized: false // Allow self-signed certificates for development
        })
      }

      resp = await fetch(url, fetchOptions)
      clearTimeout(to)
      console.log('PQAI search result:', { status: resp.status, url: url.substring(0, 120) + '...' })
    } catch (e) {
      console.log('PQAI search network error:', e)
      throw new Error(`Network error contacting PQAI API: ${String(e)}`)
    }

    if (!resp || !resp.ok) {
      let errorMsg = 'PQAI API request failed'
      let details: string | undefined

      if (resp) {
        errorMsg += ` (HTTP ${resp.status})`

        if (resp.status === 500) {
          errorMsg = 'PQAI API server error - the service may be temporarily unavailable'
        } else if (resp.status === 401 || resp.status === 403) {
          errorMsg = 'PQAI API authentication failed - please check your API token'
        } else if (resp.status === 429) {
          errorMsg = 'PQAI API rate limit exceeded - please try again later'
        }
        try {
          const errorText = await resp.text()
          details = errorText || undefined
          if (errorText.includes('Server error while handling request')) {
            errorMsg = 'PQAI API is currently experiencing server issues. Please try again later.'
          }
        } catch {}
      }

      console.log('PQAI API error:', { status: resp?.status, error: errorMsg, details })
      throw new Error(errorMsg)
    }

    let dataJson: any = {}
    try { dataJson = await resp.json() } catch (e) { console.log('Failed to parse JSON response:', e) }

    console.log('PQAI API full response:', JSON.stringify(dataJson, null, 2))

    // Try multiple possible result locations
    let results = []
    if (Array.isArray(dataJson?.results)) {
      results = dataJson.results
    } else if (Array.isArray(dataJson?.data)) {
      results = dataJson.data
    } else if (Array.isArray(dataJson)) {
      results = dataJson
    }

    console.log('PQAI API success - results count:', results.length, 'response keys:', Object.keys(dataJson))
    console.log('First result sample:', results[0] ? Object.keys(results[0]) : 'No results')
    if (results[0]) {
      console.log('First result data:', JSON.stringify(results[0], null, 2))
      console.log('Patent number fields in first result:', {
        pn: results[0].pn,
        patent_number: results[0].patent_number,
        publication_number: results[0].publication_number,
        publication_id: results[0].publication_id,
        publicationId: results[0].publicationId,
        patentId: results[0].patentId,
        patent_id: results[0].patent_id,
        id: results[0].id
      })
    }

    // Check for unique patent numbers
    const patentNumbers = results.map((r: any) => r.publication_number || r.patent_number || r.pn || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || 'N/A').filter((pn: any) => pn !== 'N/A')
    const uniquePatentNumbers = Array.from(new Set(patentNumbers))
    console.log('Patent numbers found:', patentNumbers.length, 'unique:', uniquePatentNumbers.length)
    if (patentNumbers.length !== uniquePatentNumbers.length) {
      console.log('WARNING: Duplicate patent numbers detected!')
    }

    // Normalize the results to a consistent format and extract actual relevance scores
    const normalizedResults = results.map((result: any) => {
      // Extract relevance score using the same pattern as drafting pipeline
      const relevanceScore = typeof result.score === 'number' ? result.score :
                            (typeof result.relevance === 'number' ? result.relevance : null)

      return {
        title: result.title || result.snippet?.split('.')[0] || 'Untitled Patent',
        publicationNumber: result.publication_number || result.patent_number || result.pn || result.id || 'Unknown',
        abstract: result.snippet || result.abstract || result.description || '',
        year: result.year || result.filing_date?.substring(0, 4) || result.publication_date?.substring(0, 4) || null,
        inventors: Array.isArray(result.inventors) ? result.inventors : (result.inventors ? [result.inventors] : []),
        assignees: Array.isArray(result.assignees) ? result.assignees : (result.assignees ? [result.assignees] : []),
        cpcCodes: Array.isArray(result.cpc_codes) ? result.cpc_codes : [],
        ipcCodes: Array.isArray(result.ipc_codes) ? result.ipc_codes : [],
        relevanceScore: relevanceScore,
        rawScore: result.score || result.relevance // Keep raw value for debugging
      }
    })

    console.log('🔄 Before sorting - first 5 relevance scores:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    // Sort by relevance score (highest first) - PQAI may not return perfectly sorted results
    normalizedResults.sort((a: any, b: any) => {
      const scoreA = a.relevanceScore || 0
      const scoreB = b.relevanceScore || 0
      return scoreB - scoreA // Higher scores first
    })

    console.log('✅ After sorting by relevance - top 5:')
    normalizedResults.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.publicationNumber} - Score: ${r.relevanceScore} (${r.relevanceScore ? (r.relevanceScore * 100).toFixed(1) + '%' : 'none'})`)
    })

    return normalizedResults
  }

  private async getPatentDetails(publicationNumber: string): Promise<{
    title?: string;
    abstract?: string;
    claims?: string;
  }> {
    try {
      // Try to get from database first
      const patent = await prisma.priorArtPatent.findUnique({
        where: { publicationNumber },
        include: { details: true }
      });

      if (patent) {
        return {
          title: patent.title || undefined,
          abstract: patent.abstract || undefined,
          claims: patent.details?.claims as string || undefined
        };
      }

      // TODO: Fetch from PQAI or other patent databases
      return {};
    } catch (error) {
      console.error(`Failed to get patent details for ${publicationNumber}:`, error);
      return {};
    }
  }

  private async callLLMWithPreferredModel(
    prompt: string,
    preference: 'gpt-4o' | 'gpt-4o-mini' | 'claude-2.5' | 'gemini-2.0-flash-lite' | 'gemini-2.5-pro',
    requestHeaders?: Record<string, string>
  ): Promise<LLMResult> {
    // Implement model preference logic
    // Priority: Gemini 2.5 Pro > Gemini 2.0 Flash-Lite > GPT-4o > Claude 2.5 > GPT-4o mini

    const modelPriority = ['gemini-2.5-pro', 'gemini-2.0-flash-lite', 'gpt-4o', 'claude-2.5', 'gpt-4o-mini'];
    const preferredIndex = modelPriority.indexOf(preference);

    // Try preferred model first, then fallbacks
    for (let i = preferredIndex; i < modelPriority.length; i++) {
      try {
        const model = modelPriority[i];
        console.log(`🤖 Trying model: ${model}`);

        // Use the gateway with model specification
        const result = await llmGateway.executeLLMOperation(
          { headers: requestHeaders || {} },
          {
            taskCode: TaskCode.LLM6_REPORT_GENERATION,
            prompt,
            modelClass: model
          }
        );

        if (result.success) {
          return result;
        }

        console.warn(`Model ${model} failed, trying next...`);
      } catch (error) {
        console.warn(`Model attempt failed:`, error);
      }
    }

    return { success: false, error: 'All preferred models failed' };
  }
}
