/**
 * LLM-Powered Figure Generation Service
 * 
 * Uses configured LLM models (via Super Admin) to generate:
 * - Chart configurations (Chart.js) from natural language descriptions
 * - Mermaid diagram code from descriptions
 * - PlantUML code from descriptions
 * - AI-powered figure suggestions based on paper content
 * 
 * Stage Codes (for Super Admin model configuration):
 * - PAPER_FIGURE_SUGGESTION: AI suggestions for figures based on paper content
 * - PAPER_CHART_GENERATOR: Generate Chart.js configs from descriptions/data
 * - PAPER_DIAGRAM_GENERATOR: Generate Mermaid/PlantUML code from descriptions
 */

import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'
import type {
  FigureCategory,
  DataChartType,
  DiagramType,
  FigureSuggestion,
  DiagramStructuredSpec
} from './types'
import { normalizeFigurePreferences, type FigureSuggestionPreferences } from './preferences'
import { chooseDiagramRenderer } from './diagram-renderer-policy'

// =============================================================================
// TYPES
// =============================================================================

export interface ChartGenerationRequest {
  description: string
  chartType?: DataChartType
  title?: string
  data?: {
    labels?: string[]
    values?: number[]
    datasetLabel?: string
  }
  style?: 'academic' | 'nature' | 'ieee' | 'minimal' | 'modern'
}

export interface ChartGenerationResult {
  success: boolean
  config?: {
    type: string
    data: {
      labels: string[]
      datasets: Array<{
        label: string
        data: number[]
        backgroundColor?: string | string[]
        borderColor?: string | string[]
        borderWidth?: number
      }>
    }
    options?: Record<string, any>
  }
  error?: string
  tokensUsed?: number
  model?: string
}

export interface DiagramGenerationRequest {
  description: string
  diagramType?: DiagramType
  title?: string
  elements?: string[] // Optional list of elements to include
  style?: 'default' | 'forest' | 'dark' | 'neutral'
  diagramSpec?: DiagramStructuredSpec
  rendererPreference?: 'plantuml' | 'mermaid' | 'auto'
  hasRecentMermaidFailure?: boolean
  hasRecentPlantUMLFailure?: boolean
  specLooksMermaidLike?: boolean
}

export interface DiagramGenerationResult {
  success: boolean
  code?: string
  diagramType?: 'mermaid' | 'plantuml'
  error?: string
  tokensUsed?: number
  model?: string
  diagramSpec?: DiagramStructuredSpec
}

export interface FigureSuggestionRequest {
  paperTitle?: string
  paperAbstract?: string
  sections?: Record<string, string>
  researchType?: string
  datasetDescription?: string
  paperBlueprint?: {
    thesisStatement?: string
    centralObjective?: string
    keyContributions?: string[]
    sectionPlan?: Array<{
      sectionKey: string
      mustCover?: string[]
      mustAvoid?: string[]
    }>
  }
  preferences?: Partial<FigureSuggestionPreferences>
  existingFigures?: Array<{ title: string; type: string }>
  maxSuggestions?: number

  /**
   * When set, the suggestions are constrained to visualize THIS specific
   * text excerpt only. The LLM will use broader paper context for grounding
   * but every suggestion must directly illustrate the focused content.
   */
  focusText?: string
  /** Which section the focus text was selected from */
  focusSection?: string
  /** 'selection' = user highlighted text, 'section' = full section focus */
  focusMode?: 'selection' | 'section'
  /** Optional structured anchors extracted from focusText */
  focusHints?: {
    entities?: string[]
    metrics?: string[]
    verbs?: string[]
  }
}

export interface FigureSuggestionResult {
  success: boolean
  suggestions?: FigureSuggestion[]
  error?: string
  tokensUsed?: number
  model?: string
}

// =============================================================================
// PROMPTS
// =============================================================================

const CHART_GENERATION_PROMPT = `You are an expert data visualization designer specializing in publication-quality academic figures.

Your task: generate a valid Chart.js configuration object that produces a BEAUTIFUL, ACCURATE, PUBLICATION-READY chart.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown fences, no explanation, no comments in the JSON.
2. NEVER invent or hallucinate data. If the user provides specific data values, use them exactly. If no specific data is provided, use clearly labeled placeholder values (e.g., "Category A", "Category B") with values that form a realistic, visually balanced pattern - and set the dataset label to "Sample Data (replace with actual values)".
3. The chart MUST have:
   - A clear, descriptive title (using the user's title or a refined version)
   - Properly labeled axes with units where applicable (e.g., "Accuracy (%)", "Time (seconds)")
   - A legend with descriptive dataset labels
   - Colors from this academic palette: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7"]
4. For bar charts: use semi-transparent fills (rgba with 0.8 opacity), solid borders
5. For line charts: use solid lines (borderWidth: 2.5), small point radius (3-4px), no fill unless area chart
6. For pie/doughnut: use the full 8-color palette, add percentage labels via datalabels plugin
7. For scatter: use distinct markers per dataset, point radius 5-6px
8. Font sizes: title 16px bold, axis labels 13px, tick labels 11px, legend 12px
9. Use font family: "'Helvetica Neue', 'Arial', sans-serif"
10. Grid lines: light gray (#E5E7EB), width 0.5
11. White background (#FFFFFF) with clean spacing

OUTPUT FORMAT (return ONLY this JSON):
{
  "type": "bar|line|pie|scatter|radar|doughnut",
  "data": {
    "labels": ["Label1", "Label2", ...],
    "datasets": [{
      "label": "Dataset Name",
      "data": [value1, value2, ...],
      "backgroundColor": ["#color1", ...] or "rgba(r,g,b,0.8)",
      "borderColor": ["#color1", ...] or "#color",
      "borderWidth": 1.5
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": { "display": true, "text": "Chart Title", "font": { "size": 16, "weight": "bold", "family": "'Helvetica Neue', Arial, sans-serif" }, "color": "#1F2937", "padding": { "bottom": 16 } },
      "legend": { "position": "bottom", "labels": { "font": { "size": 12, "family": "'Helvetica Neue', Arial, sans-serif" }, "usePointStyle": true, "padding": 16 } }
    },
    "scales": {
      "y": { "beginAtZero": true, "title": { "display": true, "text": "Y-Axis Label", "font": { "size": 13 } }, "grid": { "color": "#E5E7EB" }, "ticks": { "font": { "size": 11 } } },
      "x": { "title": { "display": true, "text": "X-Axis Label", "font": { "size": 13 } }, "grid": { "color": "#E5E7EB" }, "ticks": { "font": { "size": 11 } } }
    }
  }
}

IMPORTANT: For pie, doughnut, radar, and polarArea charts, do NOT include the "scales" key in options.

USER REQUEST:
`

const DIAGRAM_GENERATION_PROMPT = `You are an expert at creating compact, publication-quality Mermaid diagrams for academic papers. The output must render reliably on Kroki (Mermaid renderer).

OUTPUT RULES (STRICT):
1) Return ONLY valid Mermaid code. No markdown fences, no explanations, no extra text.
2) Use ONLY Kroki-compatible Mermaid syntax. Avoid experimental or newer features.
3) Keep diagrams compact: target 8-12 nodes (15 max). Keep subgraphs 2-3 (4 max). Avoid deep nesting.
4) Labels must be short and safe: 2-4 words, max 28 characters, ASCII only; use letters/digits/spaces/hyphen only.
   - Avoid parentheses, brackets, commas, colons, math symbols in labels.
5) IDs must be valid and stable:
   - IDs must match: ^[A-Za-z][A-Za-z0-9_]*$
   - IDs must be unique.
   - Do not use single-letter IDs unless unavoidable; prefer short meaningful IDs (ingest, preprocess, model).
6) Prefer left-to-right layouts for pipelines/architectures/topology unless explicitly requested otherwise.
7) Do NOT chain arrows on one line if it causes ambiguity. Prefer one edge per line.
8) Do NOT add Mermaid init directives, themes, or CSS. Styling is handled externally.
9) TEMPLATE RULE: You MUST choose exactly ONE canonical template below that matches diagramType and ONLY fill/adjust its placeholders.
   - Do NOT mix templates.
   - Do NOT introduce syntax beyond what appears in the chosen template.
   - If the request is under-specified, use a minimal template with generic nodes.

SUPPORTED DIAGRAM TYPES (Mermaid fallback):
- flowchart (default for non-UML process/architecture)
- sequence
- state
- er
- gantt

CANONICAL TEMPLATES (choose exactly ONE; fill placeholders only):

[TEMPLATE 1: FLOWCHART / ARCHITECTURE (PIPELINE)]
flowchart LR
  subgraph Input
    dataSources[Data Sources]
    ingestion[Ingestion]
    dataSources --> ingestion
  end
  subgraph Core
    preprocess[Preprocess]
    model[Model]
    preprocess --> model
  end
  subgraph Output
    results[Results]
  end
  ingestion --> preprocess
  model --> results

[TEMPLATE 2: FLOWCHART / TOPOLOGY (HUB AND SPOKE)]
flowchart LR
  client[Client] --> gateway[Gateway]
  gateway --> serviceA[Service A]
  gateway --> serviceB[Service B]
  serviceA --> db[DB]
  serviceB --> db

[TEMPLATE 3: SEQUENCE]
sequenceDiagram
  participant UI as UI
  participant API as API
  participant SVC as Service
  participant DB as DB
  UI->>API: submit
  API->>SVC: process
  SVC->>DB: read
  DB-->>SVC: data
  SVC-->>API: result
  API-->>UI: response

[TEMPLATE 4: STATE]
stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Done: finish
  Done --> [*]

[TEMPLATE 5: ER]
erDiagram
  PAPER ||--o{ SECTION : has
  SECTION ||--o{ CITATION : cites
  PAPER {
    string title
  }
  SECTION {
    string heading
  }
  CITATION {
    string doi
  }

[TEMPLATE 6: GANTT]
gantt
  title Timeline
  dateFormat YYYY-MM-DD
  section Work
  Task A :a1, 2026-01-01, 10d
  Task B :a2, after a1, 7d

YOUR TASK:
- You will receive a diagramType and a short user request describing what the diagram should show.
- Choose exactly one template that matches diagramType:
  * flowchart -> TEMPLATE 1 (or TEMPLATE 2 if topology-like)
  * sequence  -> TEMPLATE 3
  * state     -> TEMPLATE 4
  * er        -> TEMPLATE 5
  * gantt     -> TEMPLATE 6
- Replace placeholder labels with compact, safe labels.
- Ensure all IDs are unique and valid.
- Add/remove nodes minimally to match the request while staying within compactness limits.
- Keep edge labels minimal; omit unless essential.
- Output only Mermaid code.

USER REQUEST:
`

const PLANTUML_GENERATION_PROMPT = `You are an expert at creating compact, publication-quality PlantUML diagrams for top-tier academic papers (IEEE/ACM/Springer/Elsevier). You must optimize for space efficiency and Kroki compatibility.

OUTPUT RULES (STRICT):
1) Return ONLY PlantUML code starting with @startuml and ending with @enduml.
2) No markdown fences, no explanations, no extra text.
3) Always include the exact GLOBAL COMPACT STYLE block provided below (verbatim) after @startuml.
4) Use ONLY the allowed palette and styling rules below. Do not invent new colors.
5) Keep diagrams compact: target 8-12 nodes (15 max). Keep groups/packages/nodes 2-3 (4 max). Avoid deep nesting.
6) Labels must be short and safe: 2-4 words, max 28 characters, ASCII only; use letters/digits/spaces/hyphen only.
   - Avoid parentheses, brackets, commas, colons, math symbols in labels.
   - Keep edge labels 0-2 words (optional; only if essential).
7) Prefer left-to-right layouts for pipelines/architectures/topology/deployment unless explicitly requested otherwise.
8) Do NOT chain arrows on one line (never write: A --> B --> C). Always write one edge per line.
9) Avoid advanced PlantUML features that may break on Kroki (no sprites, no includes, no external files, no macros).
10) TEMPLATE RULE: You MUST choose exactly ONE canonical template below that matches diagramType and ONLY fill/adjust its placeholders.
    - Do NOT mix templates.
    - Do NOT introduce syntax beyond what appears in the chosen template.
    - If the request is under-specified, use a minimal template with generic nodes.

SUPPORTED DIAGRAM TYPES (PlantUML-first):
- architecture (default for system overviews)
- topology (network/service interaction as compact architecture)
- deployment (edge/cloud/on-prem nodes)
- activity (workflow)
- sequence (interaction over time)
- class
- component
- state
- usecase
- er (conservative: entities as rectangles + labeled associations)

ALLOWED PALETTE (ONLY):
- BlueAccent:   #1F77B4
- OrangeAccent: #F28E2B
- DarkText:     #111111
- LineGray:     #5A5A5A
- PageWhite:    #FFFFFF
- SoftBlueBg:   #EEF5FF
- SoftOrangeBg: #FFF2E8
- SoftGroupBg:  #F3F4F6
- NodeBg:       #FBFBFC

GLOBAL COMPACT STYLE (ALWAYS include this exact block after @startuml):
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

CANONICAL TEMPLATES (choose exactly ONE; fill placeholders only):

[TEMPLATE 1: ARCHITECTURE / PIPELINE]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

left to right direction

package "Input" #EEF5FF {
  rectangle "Node A" as a
  rectangle "Node B" as b
}
package "Core" #FFF2E8 {
  rectangle "Node C" as c
  rectangle "Node D" as d
}
package "Output" #EEF5FF {
  rectangle "Node E" as e
}

a --> b
b --> c
c --> d
d --> e
@enduml

[TEMPLATE 2: TOPOLOGY (HUB AND SPOKE)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20
skinparam RectangleBackgroundColor #FBFBFC
skinparam RectangleBorderColor #5A5A5A
skinparam PackageBackgroundColor #F3F4F6
skinparam PackageBorderColor #7A7A7A

left to right direction

rectangle "Client" as C #EEF5FF
rectangle "Gateway" as G #FFF2E8
rectangle "Service A" as A #FBFBFC
rectangle "Service B" as B #FBFBFC
database "DB" as D #EEF5FF

C --> G : req
G --> A : route
G --> B : route
A --> D : read
B --> D : read
@enduml

[TEMPLATE 3: DEPLOYMENT (EDGE AND CLOUD)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20

left to right direction

node "Edge" as Edge #EEF5FF {
  artifact "App" as App
  database "Cache" as Cache
}
node "Cloud" as Cloud #FFF2E8 {
  artifact "API" as API
  artifact "Model" as ML
  database "DB" as DB
}

App --> API : send
API --> ML : infer
API --> DB : store
App --> Cache : buffer
@enduml

[TEMPLATE 4: ACTIVITY (WORKFLOW)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1
skinparam LineColor #3A3A3A
skinparam BoxPadding 5
skinparam NodeSpacing 16
skinparam RankSpacing 20

skinparam ActivityBackgroundColor #EEF5FF
skinparam ActivityBorderColor #1F77B4
skinparam ActivityFontColor #0F2A43
skinparam DiamondBackgroundColor #FFF2E8
skinparam DiamondBorderColor #F28E2B
skinparam DiamondFontColor #5A3A00

start
:Step One;
:Step Two;
if (Decision?) then (Yes)
  :Step Three;
else (No)
  :Fix Step;
endif
:Finish;
stop
@enduml

[TEMPLATE 5: SEQUENCE (INTERACTION)]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #2A6F97
skinparam ArrowThickness 1
skinparam maxMessageSize 70

skinparam participant {
  BackgroundColor #FBFBFC
  BorderColor #5A5A5A
  FontColor #1A1A1A
}

participant "UI" as UI
participant "API" as API
participant "Service" as SVC
database "DB" as DB

UI -> API : submit
API -> SVC : process
SVC -> DB : read
DB --> SVC : data
SVC --> API : result
API --> UI : response
@enduml

[TEMPLATE 6: CLASS]
@startuml
skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam dpi 180
skinparam Padding 6
skinparam roundcorner 12
skinparam defaultFontName "Helvetica"
skinparam defaultFontSize 13
skinparam ArrowColor #1F77B4
skinparam ArrowThickness 1

skinparam class {
  BackgroundColor #FBFBFC
  BorderColor #5A5A5A
  FontColor #1A1A1A
}

class "Entity A" as A {
  +field1
}
class "Entity B" as B {
  +field2
}
A --> B
@enduml

YOUR TASK:
- You will receive a diagramType and a short user request describing what the diagram should show.
- Choose exactly one template that matches diagramType:
  * architecture -> TEMPLATE 1
  * topology     -> TEMPLATE 2
  * deployment   -> TEMPLATE 3
  * activity     -> TEMPLATE 4
  * sequence     -> TEMPLATE 5
  * class        -> TEMPLATE 6
- Replace placeholder labels and IDs with compact, safe labels and IDs.
- Add/remove nodes minimally to match the request while staying within the compactness limits.
- Keep all rules above.

USER REQUEST:
`

const FIGURE_SUGGESTION_PROMPT = `You are an expert academic figure consultant. You analyze research papers and recommend the exact figures that would make the paper stronger, more publishable, and visually compelling.

Your job: suggest 5-8 specific, actionable figures grounded in the actual paper content below.

CRITICAL RULES:
1. Return ONLY a valid JSON array. No markdown fences, no explanation outside the JSON.
2. Every suggestion MUST directly relate to specific content from the paper (reference the section, methodology, or data described).
3. NEVER suggest generic/vague figures. Each must be specific to THIS paper.
4. For DATA_CHART suggestions: specify exact axis labels, what data goes where, and the chart type that best represents the data relationship.
5. For DIAGRAM suggestions: describe exact components/nodes and relationships from the paper.
6. The "description" field must be detailed enough (50-150 words) that someone could create the figure from it alone.
7. The "dataNeeded" field must specify exactly what data columns/variables the user needs to provide.
8. Suggest figures that are commonly expected in this type of academic paper.
9. Respect user preferences. If strictness is "strict", adhere tightly to preference constraints.
10. Each suggestedType must be one of: bar, line, pie, scatter, radar, doughnut, flowchart, sequence, architecture, class, component, usecase, state, activity, er, gantt, sketch-auto, sketch-guided
11. For every DIAGRAM suggestion, include "rendererPreference" = "plantuml" or "mermaid" using this policy:
    - Prefer "plantuml" for UML-ish intents (class/component/usecase/state/activity), architecture/deployment/topology/system-overview/pipeline/framework, or punctuation/math-heavy labels.
    - Use "mermaid" only when explicitly Mermaid-oriented, or for mermaid-native simple "gantt"/simple "er".
12. For every DIAGRAM suggestion, include a "diagramSpec" object with deterministic structure.
13. Complexity budget for diagramSpec: nodes <= 12 (hard max 15), edges <= 18.
14. If the likely diagram exceeds the budget, include "splitSuggestion" explaining how to split into Fig X(a)/X(b).
15. When outputMix is "include_sketches" or the paper would benefit from conceptual illustrations, include 1-2 SKETCH category suggestions using suggestedType "sketch-auto" or "sketch-guided".
16. For every SKETCH suggestion you MUST include these extra fields:
    - "sketchStyle": one of "academic", "scientific", "conceptual", "technical" (pick the best fit for the paper's field)
    - "sketchPrompt": a detailed visual-composition prompt (80-200 words) describing exactly what the AI image generator should create: subject, composition, visual elements, spatial layout, colors/style constraints. This is NOT the same as "description" -- it must read like a prompt for an image generation model.
    - "sketchMode": "SUGGEST" if AI should decide based on paper context, "GUIDED" if the description is specific enough for direct generation.
17. SKETCH suggestions are appropriate for: conceptual framework visualizations, abstract process illustrations, metaphorical/visual-summary figures, system overview illustrations that benefit from artistic rendering rather than formal diagram syntax.

IMPORTANCE GUIDELINES:
- "required": Figures that reviewers/readers will expect (e.g., results comparison, methodology overview)
- "recommended": Figures that significantly strengthen the paper
- "optional": Nice-to-have figures that add extra polish

OUTPUT FORMAT (return ONLY this JSON array):
[
  {
    "title": "Specific Figure Title Related to Paper Content",
    "description": "Detailed description grounded in paper content: what this figure shows, which variables/components are on each axis or in each node, how this relates to the paper's claims. Include specific labels and structure.",
    "category": "DATA_CHART|DIAGRAM|STATISTICAL_PLOT|SKETCH",
    "suggestedType": "bar|line|pie|scatter|flowchart|sequence|architecture|etc|sketch-auto|sketch-guided",
    "rendererPreference": "plantuml|mermaid (DIAGRAM only)",
    "relevantSection": "methodology|results|discussion|introduction|literature_review",
    "importance": "required|recommended|optional",
    "dataNeeded": "Specific data: e.g., 'Accuracy percentages for each model variant (baseline, proposed, ablation) across all test datasets'",
    "whyThisFigure": "One sentence explaining why this figure strengthens the paper",
    "diagramSpec": {
      "layout": "LR|TD",
      "nodes": [
        { "idHint": "dataInput", "label": "Data Input", "group": "Input" },
        { "idHint": "processor", "label": "Core Processor", "group": "Processing" }
      ],
      "edges": [
        { "fromHint": "dataInput", "toHint": "processor", "label": "feeds", "type": "solid" }
      ],
      "groups": [
        { "name": "Input", "nodeIds": ["dataInput"] },
        { "name": "Processing", "nodeIds": ["processor"] }
      ],
      "splitSuggestion": "Optional split suggestion when complexity exceeds limits"
    },
    "sketchStyle": "academic|scientific|conceptual|technical (SKETCH only)",
    "sketchPrompt": "A detailed visual prompt for the AI image generator: describe the subject, composition, visual elements, spatial layout, and style. E.g., 'A clean academic illustration showing a neural network architecture with three hidden layers, input nodes on the left flowing rightward through interconnected layers to output nodes, using a minimalist blue-and-white color palette with thin connecting lines and labeled layer dimensions.' (SKETCH only)",
    "sketchMode": "SUGGEST|GUIDED (SKETCH only)"
  }
]

PAPER CONTENT:
`

/**
 * Additional prompt block injected when the user has selected/focused on a
 * specific text excerpt. This constrains every suggestion to directly
 * illustrate the focused content while still using the broader paper
 * context for grounding (correct terminology, related variables, etc.).
 */
function buildFocusTextBlock(
  focusText: string,
  focusSection?: string,
  focusMode?: 'selection' | 'section',
  focusHints?: { entities?: string[]; metrics?: string[]; verbs?: string[] }
): string {
  const modeLabel = focusMode === 'selection'
    ? 'The user has selected the following excerpt from their paper'
    : 'The user wants figures specifically for the following content'
  const sectionHint = focusSection
    ? ` (from the "${focusSection}" section)`
    : ''
  const entities = (focusHints?.entities || []).slice(0, 10)
  const metrics = (focusHints?.metrics || []).slice(0, 10)
  const verbs = (focusHints?.verbs || []).slice(0, 8)
  const hintsBlock = (entities.length > 0 || metrics.length > 0 || verbs.length > 0)
    ? `
FOCUS HINTS (EXTRACTED ANCHORS - USE THESE TO STAY SPECIFIC):
- Entities: ${entities.length > 0 ? entities.join('; ') : 'none'}
- Metrics: ${metrics.length > 0 ? metrics.join('; ') : 'none'}
- Verbs/Actions: ${verbs.length > 0 ? verbs.join('; ') : 'none'}
`
    : ''

  return `
═══════════════════════════════════════════════════
FOCUS CONSTRAINT — READ CAREFULLY
═══════════════════════════════════════════════════
${modeLabel}${sectionHint}:

"""
${focusText.slice(0, 3000)}
"""
${hintsBlock}

STRICT RULES FOR THIS FOCUSED REQUEST:
1. EVERY suggestion MUST directly visualize, explain, or showcase the content in the excerpt above.
2. Do NOT suggest figures for other parts of the paper — only for the focused text.
3. Use the broader paper context (title, abstract, other sections) ONLY for grounding: correct variable names, terminology, methodology context. But each figure must illustrate the focused excerpt.
4. If the excerpt describes a process or workflow → suggest a flowchart/activity diagram.
5. If the excerpt contains comparisons, numbers, or measurements → suggest a chart (bar, line, scatter).
6. If the excerpt describes relationships or structures → suggest an architecture/class/ER diagram.
7. If the excerpt is conceptual or theoretical → suggest a sketch/illustration.
8. Suggest 2-4 figures (not more) since this is a targeted excerpt, not a full paper.
9. The "relevantSection" field must be "${focusSection || 'selected_content'}".
10. The "whyThisFigure" field must explain how this figure helps the reader understand the focused text specifically.
11. Prefer suggestions that explicitly mention at least one extracted entity or metric when available.
═══════════════════════════════════════════════════

`
}

const DIAGRAM_REPAIR_PROMPT = `You are a strict PlantUML syntax repair agent.

CRITICAL RULES:
1. Output ONLY valid PlantUML code.
2. Keep original structure and intent; fix syntax and rendering issues only.
3. Do NOT add unrelated nodes or edges.
4. Use ASCII labels and deterministic aliases.
5. Keep complexity within nodes <= 12, edges <= 18 whenever possible.

You are given:
- structured spec
- previous broken code
- Kroki error output

Return repaired PlantUML code that Kroki can render.

INPUT:
`

// =============================================================================
// LLM CALL HELPER
// =============================================================================

async function callLLM(
  prompt: string,
  stageCode: string,
  requestHeaders: Record<string, string>,
  metadata?: Record<string, any>
): Promise<{ response: string; tokensUsed: number; model: string }> {
  try {
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders },
      {
        taskCode: 'LLM2_DRAFT' as TaskCode, // Generic draft task
        stageCode, // Stage code for model resolution (e.g., PAPER_CHART_GENERATOR)
        prompt,
        parameters: {
          temperature: 0.3, // Lower temperature for more consistent code generation
        },
        idempotencyKey: `figure-gen-${stageCode}-${Date.now()}`,
        metadata: {
          module: 'paper-figures',
          stageCode,
          ...metadata
        }
      }
    )

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'LLM call failed')
    }

    return {
      response: result.response.output,
      tokensUsed: result.response.outputTokens || 0,
      model: result.response.modelClass || 'unknown'
    }
  } catch (error) {
    console.error(`[LLMFigureService] LLM call failed for ${stageCode}:`, error)
    throw error
  }
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Extract valid JSON from LLM response, stripping markdown artifacts
 */
function extractJSON(raw: string): string {
  let cleaned = raw.trim()

  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim()
  }

  // Remove any leading/trailing non-JSON text
  // Find the first { or [ and the last } or ]
  const firstBrace = cleaned.indexOf('{')
  const firstBracket = cleaned.indexOf('[')
  const startIdx = firstBrace === -1 ? firstBracket :
    firstBracket === -1 ? firstBrace :
    Math.min(firstBrace, firstBracket)

  if (startIdx > 0) {
    cleaned = cleaned.slice(startIdx)
  }

  const lastBrace = cleaned.lastIndexOf('}')
  const lastBracket = cleaned.lastIndexOf(']')
  const endIdx = Math.max(lastBrace, lastBracket)

  if (endIdx >= 0 && endIdx < cleaned.length - 1) {
    cleaned = cleaned.slice(0, endIdx + 1)
  }

  return cleaned
}

const MAX_SPEC_NODES = 15
const DEFAULT_SPEC_NODES = 12
const MAX_SPEC_EDGES = 18

function sanitizeAscii(input: string, keepNewlines: boolean = false): string {
  const normalized = (input || '').normalize('NFKD')
  return keepNewlines
    ? normalized.replace(/[^\x20-\x7E\n]/g, '')
    : normalized.replace(/[^\x20-\x7E]/g, '')
}

function sanitizeDiagramLabel(input: string): string {
  const cleaned = sanitizeAscii(input || '')
    .replace(/["'`[\]{}()<>:,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6)
  const clipped = words.join(' ').slice(0, 28).trim()
  return clipped || 'Node'
}

function sanitizeAlias(input: string, index: number): string {
  const base = sanitizeAscii(input || '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = base.split(' ').filter(Boolean)
  let alias = parts.map((p, i) => i === 0 ? p.toLowerCase() : `${p[0].toUpperCase()}${p.slice(1).toLowerCase()}`).join('')
  if (!alias) alias = `node${index + 1}`
  if (!/^[a-zA-Z]/.test(alias)) alias = `n${alias}`
  alias = alias.slice(0, 24)
  return alias || `node${index + 1}`
}

function sanitizeDiagramSpec(spec?: DiagramStructuredSpec | null): DiagramStructuredSpec | undefined {
  if (!spec || typeof spec !== 'object') return undefined

  const layout = spec.layout === 'LR' ? 'LR' : 'TD'
  const nodesInput = Array.isArray(spec.nodes) ? spec.nodes : []
  const groupsInput = Array.isArray(spec.groups) ? spec.groups : []
  const edgesInput = Array.isArray(spec.edges) ? spec.edges : []

  const nodes = nodesInput
    .slice(0, MAX_SPEC_NODES)
    .map((node, idx) => ({
      idHint: sanitizeAlias(node?.idHint || node?.label || `node${idx + 1}`, idx),
      label: sanitizeDiagramLabel(node?.label || node?.idHint || `Node ${idx + 1}`),
      group: node?.group ? sanitizeDiagramLabel(node.group).slice(0, 20) : undefined
    }))

  const aliasSet = new Set(nodes.map(n => n.idHint))
  const edges = edgesInput
    .slice(0, MAX_SPEC_EDGES)
    .map((edge, idx) => ({
      fromHint: sanitizeAlias(edge?.fromHint || `node${idx + 1}`, idx),
      toHint: sanitizeAlias(edge?.toHint || `node${idx + 2}`, idx + 1),
      label: edge?.label ? sanitizeDiagramLabel(edge.label) : undefined,
      type: edge?.type === 'dashed' || edge?.type === 'async' ? edge.type : 'solid' as const
    }))
    .filter(edge => aliasSet.has(edge.fromHint) && aliasSet.has(edge.toHint))

  const groups = groupsInput
    .slice(0, 8)
    .map((group) => ({
      name: sanitizeDiagramLabel(group?.name || 'Group'),
      nodeIds: Array.isArray(group?.nodeIds)
        ? group.nodeIds.map((id, idx) => sanitizeAlias(id, idx)).filter(id => aliasSet.has(id))
        : undefined,
      description: group?.description ? sanitizeDiagramLabel(group.description) : undefined
    }))
    .filter(group => (group.nodeIds?.length || 0) > 0)

  if (nodes.length === 0) return undefined

  return {
    layout,
    nodes: nodes.slice(0, DEFAULT_SPEC_NODES),
    edges,
    groups,
    splitSuggestion: spec.splitSuggestion ? sanitizeAscii(spec.splitSuggestion).slice(0, 140) : undefined
  }
}

function buildSpecPromptBlock(spec?: DiagramStructuredSpec): string {
  if (!spec) return 'StructuredSpec: none'
  return `StructuredSpec:\n${JSON.stringify(spec, null, 2)}`
}

/**
 * Build a visual-composition prompt for sketch/illustration generation
 * when the LLM didn't provide a sketchPrompt field.
 */
function buildSketchPromptFromDescription(
  title: string,
  description: string,
  style: 'academic' | 'scientific' | 'conceptual' | 'technical' = 'academic'
): string {
  const styleGuide: Record<string, string> = {
    academic: 'Clean, professional academic illustration with high contrast, simple lines, white background, and clear labels.',
    scientific: 'Precise scientific diagram with standard notation, consistent line weights, and standard scientific color coding.',
    conceptual: 'Conceptual illustration using visual hierarchy, simple shapes, clear relationships, and minimal text.',
    technical: 'Technical diagram with engineering precision, standard conventions, and accurate proportions.'
  }
  const guide = styleGuide[style] || styleGuide.academic
  return `Create an illustration titled "${title}". ${description} Style: ${guide} The illustration should be suitable for inclusion in an academic research paper, with no figure numbers, no watermarks, and no title text overlaid on the image.`
}

function buildFallbackSpecFromDescription(description: string, title?: string): DiagramStructuredSpec {
  const baseNodes = [
    { idHint: 'inputStage', label: 'Input Stage', group: 'Input' },
    { idHint: 'processingStage', label: 'Processing Stage', group: 'Processing' },
    { idHint: 'validationStage', label: 'Validation Stage', group: 'Processing' },
    { idHint: 'outputStage', label: 'Output Stage', group: 'Output' }
  ]
  const titleNode = title
    ? { idHint: 'context', label: sanitizeDiagramLabel(title), group: 'Input' }
    : null

  return sanitizeDiagramSpec({
    layout: 'LR',
    nodes: titleNode ? [titleNode, ...baseNodes] : baseNodes,
    edges: [
      ...(titleNode ? [{ fromHint: 'context', toHint: 'inputStage', label: 'context', type: 'solid' as const }] : []),
      { fromHint: 'inputStage', toHint: 'processingStage', label: 'feeds', type: 'solid' },
      { fromHint: 'processingStage', toHint: 'validationStage', label: 'checks', type: 'solid' },
      { fromHint: 'validationStage', toHint: 'outputStage', label: 'outputs', type: 'solid' }
    ],
    groups: [
      { name: 'Input', nodeIds: titleNode ? ['context', 'inputStage'] : ['inputStage'] },
      { name: 'Processing', nodeIds: ['processingStage', 'validationStage'] },
      { name: 'Output', nodeIds: ['outputStage'] }
    ]
  }) as DiagramStructuredSpec
}

function cleanPlantUMLResponse(raw: string): string {
  let cleaned = raw.trim()
  const pumlBlockMatch = cleaned.match(/```(?:plantuml|puml)?\s*\n?([\s\S]*?)```/i)
  if (pumlBlockMatch) cleaned = pumlBlockMatch[1].trim()

  const startIdx = cleaned.indexOf('@startuml')
  const endIdx = cleaned.lastIndexOf('@enduml')
  if (startIdx >= 0 && endIdx >= 0 && endIdx > startIdx) {
    cleaned = cleaned.slice(startIdx, endIdx + '@enduml'.length)
  } else {
    if (!cleaned.includes('@startuml')) cleaned = `@startuml\n${cleaned}`
    if (!cleaned.includes('@enduml')) cleaned = `${cleaned}\n@enduml`
  }

  cleaned = cleaned.replace(/(@startuml\s*\n)+/g, '@startuml\n')
  cleaned = cleaned.replace(/(\n\s*@enduml)+/g, '\n@enduml')
  cleaned = sanitizeAscii(cleaned, true)
  return cleaned
}

type CanonicalMermaidTemplateType =
  | 'flowchart'
  | 'sequence'
  | 'state'
  | 'er'
  | 'gantt'

type MermaidFlowchartVariant = 'pipeline' | 'topology'

function normalizeMermaidTemplateType(
  input?: string,
  description?: string
): {
  inputType: string
  templateType: CanonicalMermaidTemplateType
  flowchartVariant?: MermaidFlowchartVariant
  compatibilityNote?: string
} {
  const raw = sanitizeAscii((input || '').toLowerCase().trim())
  const context = sanitizeAscii(`${raw} ${description || ''}`.toLowerCase())
  const topologyLike = /(topology|network|hub|spoke|gateway|service mesh)/.test(context)

  if (!raw) {
    return {
      inputType: 'unspecified',
      templateType: 'flowchart',
      flowchartVariant: topologyLike ? 'topology' : 'pipeline',
      compatibilityNote: 'No diagram type provided; defaulted to flowchart fallback template.'
    }
  }

  const direct: Record<string, CanonicalMermaidTemplateType> = {
    flowchart: 'flowchart',
    sequence: 'sequence',
    state: 'state',
    er: 'er',
    gantt: 'gantt'
  }
  if (direct[raw]) {
    return {
      inputType: raw,
      templateType: direct[raw],
      flowchartVariant: direct[raw] === 'flowchart' ? (topologyLike ? 'topology' : 'pipeline') : undefined
    }
  }

  const compatibilityMap: Record<string, CanonicalMermaidTemplateType> = {
    architecture: 'flowchart',
    topology: 'flowchart',
    deployment: 'flowchart',
    activity: 'flowchart',
    class: 'flowchart',
    component: 'flowchart',
    usecase: 'flowchart',
    timeline: 'gantt',
    mindmap: 'flowchart',
    plantuml: 'flowchart'
  }

  if (compatibilityMap[raw]) {
    const mapped = compatibilityMap[raw]
    return {
      inputType: raw,
      templateType: mapped,
      flowchartVariant: mapped === 'flowchart'
        ? ((raw === 'topology' || topologyLike) ? 'topology' : 'pipeline')
        : undefined,
      compatibilityNote: `Mapped legacy diagramType "${raw}" to Mermaid fallback template "${mapped}".`
    }
  }

  return {
    inputType: raw,
    templateType: 'flowchart',
    flowchartVariant: topologyLike ? 'topology' : 'pipeline',
    compatibilityNote: `Unknown diagramType "${raw}" defaulted to Mermaid flowchart fallback template.`
  }
}

type CanonicalPlantUMLTemplateType =
  | 'architecture'
  | 'topology'
  | 'deployment'
  | 'activity'
  | 'sequence'
  | 'class'

function normalizePlantUMLTemplateType(input?: string): {
  inputType: string
  templateType: CanonicalPlantUMLTemplateType
  compatibilityNote?: string
} {
  const raw = sanitizeAscii((input || '').toLowerCase().trim())
  if (!raw) {
    return {
      inputType: 'unspecified',
      templateType: 'architecture',
      compatibilityNote: 'No diagram type provided; defaulted to architecture template.'
    }
  }

  const direct: Record<string, CanonicalPlantUMLTemplateType> = {
    architecture: 'architecture',
    topology: 'topology',
    deployment: 'deployment',
    activity: 'activity',
    sequence: 'sequence',
    class: 'class'
  }
  if (direct[raw]) {
    return { inputType: raw, templateType: direct[raw] }
  }

  const compatibilityMap: Record<string, CanonicalPlantUMLTemplateType> = {
    flowchart: 'activity',
    component: 'architecture',
    usecase: 'activity',
    state: 'activity',
    er: 'class',
    gantt: 'activity',
    timeline: 'activity',
    mindmap: 'architecture',
    plantuml: 'architecture'
  }

  if (compatibilityMap[raw]) {
    return {
      inputType: raw,
      templateType: compatibilityMap[raw],
      compatibilityNote: `Mapped legacy diagramType "${raw}" to template "${compatibilityMap[raw]}" for compatibility.`
    }
  }

  if (raw.includes('topology') || raw.includes('network')) {
    return {
      inputType: raw,
      templateType: 'topology',
      compatibilityNote: `Mapped inferred diagramType "${raw}" to topology template.`
    }
  }
  if (raw.includes('deploy') || raw.includes('infra') || raw.includes('cloud')) {
    return {
      inputType: raw,
      templateType: 'deployment',
      compatibilityNote: `Mapped inferred diagramType "${raw}" to deployment template.`
    }
  }

  return {
    inputType: raw,
    templateType: 'architecture',
    compatibilityNote: `Unknown diagramType "${raw}" defaulted to architecture template.`
  }
}

/**
 * Validate and repair a Chart.js configuration from LLM output
 */
function validateChartConfig(config: any): { valid: boolean; config?: any; error?: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Config is not an object' }
  }

  // Must have type and data
  if (!config.type) {
    return { valid: false, error: 'Missing chart type' }
  }

  if (!config.data || typeof config.data !== 'object') {
    return { valid: false, error: 'Missing data object' }
  }

  // Normalize type
  const validTypes = ['bar', 'horizontalBar', 'line', 'scatter', 'pie', 'doughnut', 'radar', 'polarArea', 'bubble']
  if (!validTypes.includes(config.type)) {
    config.type = 'bar' // Safe fallback
  }

  // Ensure labels array
  if (!Array.isArray(config.data.labels)) {
    config.data.labels = []
  }

  // Ensure datasets array
  if (!Array.isArray(config.data.datasets) || config.data.datasets.length === 0) {
    return { valid: false, error: 'No datasets in config' }
  }

  // Validate each dataset has a data array with numbers
  for (const ds of config.data.datasets) {
    if (!Array.isArray(ds.data)) {
      return { valid: false, error: 'Dataset missing data array' }
    }
    // Ensure all values are numbers
    ds.data = ds.data.map((v: any) => {
      const num = Number(v)
      return isNaN(num) ? 0 : num
    })
    // Ensure label
    if (!ds.label) ds.label = 'Data'
  }

  // For non-pie charts, ensure labels and data have matching lengths
  if (!['pie', 'doughnut', 'radar', 'polarArea'].includes(config.type)) {
    const maxDataLen = Math.max(...config.data.datasets.map((ds: any) => ds.data.length))
    if (config.data.labels.length === 0 && maxDataLen > 0) {
      config.data.labels = Array.from({ length: maxDataLen }, (_, i) => `Item ${i + 1}`)
    }
  }

  // Remove scales for pie/doughnut/radar/polarArea
  if (['pie', 'doughnut', 'radar', 'polarArea'].includes(config.type) && config.options?.scales) {
    delete config.options.scales
  }

  return { valid: true, config }
}

/**
 * Validate Mermaid code for common LLM errors
 */
function validateMermaidCode(code: string): { valid: boolean; code: string; error?: string } {
  let cleaned = code.trim()

  // Remove markdown fences
  const mermaidBlockMatch = cleaned.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/)
  if (mermaidBlockMatch) {
    cleaned = mermaidBlockMatch[1].trim()
  }

  // Remove Mermaid init/theme directives for deterministic external styling.
  cleaned = cleaned.replace(/^%%\{.*?\}%%\s*$/gm, '').trim()

  // Remove "graph" and replace with "flowchart" (graph is deprecated)
  cleaned = cleaned.replace(/^graph\s+(TD|TB|BT|RL|LR)/m, 'flowchart $1')

  // Check it starts with a valid Mermaid declaration
  const validStarts = [
    'flowchart', 'sequenceDiagram', 'stateDiagram-v2', 'stateDiagram',
    'erDiagram', 'gantt'
  ]

  const hasValidStart = validStarts.some(start => cleaned.startsWith(start) || cleaned.includes('\n' + start))
  if (!hasValidStart) {
    // Try to find a valid start within the text
    for (const start of validStarts) {
      const idx = cleaned.indexOf(start)
      if (idx >= 0) {
        cleaned = cleaned.slice(idx)
        break
      }
    }
  }

  // Remove any trailing explanatory text after the diagram
  const lines = cleaned.split('\n')
  const filteredLines: string[] = []
  let foundDiagramStart = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!foundDiagramStart) {
      if (validStarts.some(s => trimmed.startsWith(s))) {
        foundDiagramStart = true
      }
    }

    if (foundDiagramStart) {
      // Stop at lines that look like explanatory text (long sentences with periods)
      if (trimmed.length > 80 && trimmed.includes('. ') && !trimmed.includes('-->') && !trimmed.includes('---')) {
        break
      }
      filteredLines.push(line)
    }
  }

  cleaned = filteredLines.join('\n').trim()

  if (!cleaned || cleaned.length < 10) {
    return { valid: false, code: cleaned, error: 'Mermaid code is too short or empty' }
  }

  return { valid: true, code: cleaned }
}

// =============================================================================
// MAIN SERVICE FUNCTIONS
// =============================================================================

/**
 * Generate Chart.js configuration from natural language description.
 * Includes automatic retry (up to MAX_RETRIES) when the LLM returns
 * invalid JSON or a structurally invalid Chart.js config.
 */
const MAX_CHART_RETRIES = 1

export async function generateChartConfig(
  request: ChartGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<ChartGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0

  for (let attempt = 0; attempt <= MAX_CHART_RETRIES; attempt++) {
    try {
      // Build the prompt with all context
      let userRequest = request.description

      if (request.chartType) {
        userRequest += `\n\nPreferred chart type: ${request.chartType}`
      }

      if (request.title) {
        userRequest += `\n\nChart title: "${request.title}"`
      }

      if (request.data?.labels && request.data?.values) {
        userRequest += `\n\nACTUAL DATA PROVIDED (use these exact values):`
        userRequest += `\nLabels: ${JSON.stringify(request.data.labels)}`
        userRequest += `\nValues: ${JSON.stringify(request.data.values)}`
        if (request.data.datasetLabel) {
          userRequest += `\nDataset label: "${request.data.datasetLabel}"`
        }
      } else {
        userRequest += `\n\nNOTE: No actual data provided. Use realistic placeholder labels (e.g., "Method A", "Method B") with balanced placeholder values. Mark the dataset label as "Sample Data (replace with actual values)".`
      }

      if (request.style) {
        userRequest += `\n\nStyle preference: ${request.style}`
      }

      // On retry, append the previous error so the LLM can self-correct
      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID.\nError: ${lastError}\nPlease return ONLY valid JSON with no markdown fences, no comments, no trailing commas.`
      }

      const fullPrompt = CHART_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_CHART_GENERATOR',
        requestHeaders,
        { chartType: request.chartType, hasData: !!request.data, attempt }
      )
      totalTokensUsed += tokensUsed

      // Parse and validate the JSON response
      const cleanedResponse = extractJSON(response)
      let config: any

      try {
        config = JSON.parse(cleanedResponse)
      } catch (parseError) {
        lastError = 'Invalid JSON syntax - could not parse the response'
        console.warn(`[LLMFigureService] Chart JSON parse failed (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}):`, cleanedResponse.slice(0, 300))
        if (attempt < MAX_CHART_RETRIES) continue // retry
        return {
          success: false,
          error: 'LLM returned invalid JSON for chart configuration after retries'
        }
      }

      // Validate the config
      const validation = validateChartConfig(config)
      if (!validation.valid) {
        lastError = validation.error || 'Invalid chart structure'
        console.warn(`[LLMFigureService] Chart validation failed (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}): ${validation.error}`)
        if (attempt < MAX_CHART_RETRIES) continue // retry
        return {
          success: false,
          error: `Invalid chart configuration: ${validation.error}`
        }
      }

      return {
        success: true,
        config: validation.config,
        tokensUsed: totalTokensUsed,
        model
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[LLMFigureService] Chart generation error (attempt ${attempt + 1}/${MAX_CHART_RETRIES + 1}):`, lastError)
      if (attempt < MAX_CHART_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000)) // brief delay before retry
        continue
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Chart generation failed'
      }
    }
  }

  return { success: false, error: lastError || 'Chart generation failed after retries' }
}

/**
 * Generate Mermaid diagram code from natural language description.
 * Includes automatic retry (up to MAX_RETRIES) when the LLM returns
 * syntactically invalid Mermaid code.
 */
const MAX_DIAGRAM_RETRIES = 1

export async function generateMermaidCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0
  const sanitizedSpec = sanitizeDiagramSpec(request.diagramSpec)
  const sanitizedDescription = sanitizeAscii(request.description, true).trim()
  const templateSelection = normalizeMermaidTemplateType(request.diagramType as string | undefined, sanitizedDescription)

  for (let attempt = 0; attempt <= MAX_DIAGRAM_RETRIES; attempt++) {
    try {
      let userRequest = sanitizedDescription

      if (request.diagramType || templateSelection.inputType) {
        userRequest += `\n\nDiagram type (input): ${request.diagramType || templateSelection.inputType}`
      }

      userRequest += `\n\nDiagram type (template): ${templateSelection.templateType}`

      if (templateSelection.templateType === 'flowchart') {
        userRequest += `\n\nFlowchart variant: ${templateSelection.flowchartVariant || 'pipeline'}`
      }

      if (templateSelection.compatibilityNote) {
        userRequest += `\n\nCompatibility mapping: ${templateSelection.compatibilityNote}`
      }

      if (request.title) {
        userRequest += `\n\nDiagram title/topic: "${sanitizeDiagramLabel(request.title)}"`
      }

      if (request.elements && request.elements.length > 0) {
        userRequest += `\n\nKey elements that MUST appear as nodes: ${request.elements.map(sanitizeDiagramLabel).join(', ')}`
      }

      if (sanitizedSpec) {
        userRequest += `\n\n${buildSpecPromptBlock(sanitizedSpec)}`
      }

      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID MERMAID SYNTAX.\nError: ${lastError}\nUse exactly one canonical template and return ONLY Mermaid code with no markdown fences and no extra text.`
      }

      const fullPrompt = DIAGRAM_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_DIAGRAM_GENERATOR',
        requestHeaders,
        {
          diagramType: request.diagramType,
          mermaidTemplateType: templateSelection.templateType,
          mermaidFlowchartVariant: templateSelection.flowchartVariant || null,
          attempt
        }
      )
      totalTokensUsed += tokensUsed

      const validation = validateMermaidCode(response)
      if (!validation.valid) {
        lastError = validation.error || 'Generated Mermaid code was invalid'
        console.warn(`[LLMFigureService] Mermaid validation failed (attempt ${attempt + 1}/${MAX_DIAGRAM_RETRIES + 1}): ${lastError}`)
        if (attempt < MAX_DIAGRAM_RETRIES) continue
        return {
          success: false,
          error: lastError
        }
      }

      return {
        success: true,
        code: validation.code,
        diagramType: 'mermaid',
        tokensUsed: totalTokensUsed,
        model,
        diagramSpec: sanitizedSpec
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[LLMFigureService] Mermaid generation error (attempt ${attempt + 1}/${MAX_DIAGRAM_RETRIES + 1}):`, lastError)
      if (attempt < MAX_DIAGRAM_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Diagram generation failed'
      }
    }
  }

  return { success: false, error: lastError || 'Diagram generation failed after retries' }
}
const MAX_PLANTUML_RETRIES = 1

export async function generatePlantUMLCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  let lastError: string | null = null
  let totalTokensUsed = 0

  const sanitizedSpec = sanitizeDiagramSpec(request.diagramSpec)
  const fallbackSpec = sanitizedSpec || buildFallbackSpecFromDescription(request.description, request.title)
  const sanitizedDescription = sanitizeAscii(request.description, true).trim()
  const templateSelection = normalizePlantUMLTemplateType(request.diagramType as string | undefined)

  for (let attempt = 0; attempt <= MAX_PLANTUML_RETRIES; attempt++) {
    try {
      let userRequest = sanitizedDescription

      if (request.diagramType || templateSelection.inputType) {
        userRequest += `\n\nDiagram type (input): ${request.diagramType || templateSelection.inputType}`
      }

      userRequest += `\n\nDiagram type (template): ${templateSelection.templateType}`

      if (templateSelection.compatibilityNote) {
        userRequest += `\n\nCompatibility mapping: ${templateSelection.compatibilityNote}`
      }

      if (request.title) {
        userRequest += `\n\nDiagram title/topic: "${sanitizeDiagramLabel(request.title)}"`
      }

      if (request.elements && request.elements.length > 0) {
        userRequest += `\n\nKey elements that MUST appear: ${request.elements.map(sanitizeDiagramLabel).join(', ')}`
      }

      userRequest += `\n\n${buildSpecPromptBlock(fallbackSpec)}`

      if (attempt > 0 && lastError) {
        userRequest += `\n\nIMPORTANT - YOUR PREVIOUS RESPONSE WAS INVALID PLANTUML OR FAILED TO RENDER.\nError: ${lastError}\nReturn valid PlantUML only. Preserve structure, fix syntax.`
      }

      const fullPrompt = PLANTUML_GENERATION_PROMPT + userRequest

      const { response, tokensUsed, model } = await callLLM(
        fullPrompt,
        'PAPER_DIAGRAM_GENERATOR',
        requestHeaders,
        {
          diagramType: 'plantuml',
          inputDiagramType: request.diagramType || null,
          templateDiagramType: templateSelection.templateType,
          attempt
        }
      )
      totalTokensUsed += tokensUsed

      const cleanedCode = cleanPlantUMLResponse(response)

      if (!cleanedCode.includes('@startuml') || !cleanedCode.includes('@enduml')) {
        lastError = 'PlantUML wrapper missing after cleanup'
        if (attempt < MAX_PLANTUML_RETRIES) continue
        return { success: false, error: lastError }
      }

      return {
        success: true,
        code: cleanedCode,
        diagramType: 'plantuml',
        tokensUsed: totalTokensUsed,
        model,
        diagramSpec: fallbackSpec
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'PlantUML generation failed'
      console.warn(`[LLMFigureService] PlantUML generation error (attempt ${attempt + 1}/${MAX_PLANTUML_RETRIES + 1}):`, lastError)
      if (attempt < MAX_PLANTUML_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }
      return {
        success: false,
        error: lastError
      }
    }
  }

  return { success: false, error: lastError || 'PlantUML generation failed after retries' }
}

export async function repairDiagramCode(
  input: {
    brokenCode: string
    errorMessage: string
    diagramType?: DiagramType
    title?: string
    description?: string
    diagramSpec?: DiagramStructuredSpec
  },
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  try {
    const spec = sanitizeDiagramSpec(input.diagramSpec) || buildFallbackSpecFromDescription(input.description || '', input.title)
    const templateSelection = normalizePlantUMLTemplateType(input.diagramType as string | undefined)
    const payload = [
      `DiagramTypeInput: ${input.diagramType || 'unspecified'}`,
      `DiagramTypeTemplate: ${templateSelection.templateType}`,
      templateSelection.compatibilityNote ? `CompatibilityMapping: ${templateSelection.compatibilityNote}` : '',
      input.title ? `Title: ${sanitizeDiagramLabel(input.title)}` : '',
      input.description ? `Description: ${sanitizeAscii(input.description, true).slice(0, 800)}` : '',
      `KrokiError: ${sanitizeAscii(input.errorMessage || '').slice(0, 600)}`,
      `BrokenCode:\n${sanitizeAscii(input.brokenCode || '', true).slice(0, 3000)}`,
      buildSpecPromptBlock(spec)
    ].filter(Boolean).join('\n\n')

    const fullPrompt = DIAGRAM_REPAIR_PROMPT + payload
    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_DIAGRAM_REPAIR',
      requestHeaders,
      {
        diagramType: input.diagramType || 'plantuml',
        templateDiagramType: templateSelection.templateType,
        mode: 'repair'
      }
    )

    return {
      success: true,
      code: cleanPlantUMLResponse(response),
      diagramType: 'plantuml',
      tokensUsed,
      model,
      diagramSpec: spec
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Diagram repair failed'
    }
  }
}
export async function generateFigureSuggestions(
  request: FigureSuggestionRequest,
  requestHeaders: Record<string, string>
): Promise<FigureSuggestionResult> {
  try {
    const preferences = normalizeFigurePreferences(request.preferences)

    // Build paper context
    let paperContext = ''

    if (request.paperTitle) {
      paperContext += `Title: ${request.paperTitle}\n\n`
    }

    if (request.paperAbstract) {
      paperContext += `Abstract: ${request.paperAbstract}\n\n`
    }

    if (request.researchType) {
      paperContext += `Research Type: ${request.researchType}\n\n`
    }

    if (request.datasetDescription) {
      paperContext += `Dataset / Data Availability: ${request.datasetDescription}\n\n`
    }

    if (request.sections) {
      paperContext += 'Sections:\n'
      for (const [section, content] of Object.entries(request.sections)) {
        if (content && content.trim()) {
          // Truncate long sections to avoid token limits
          const truncated = content.length > 2000 
            ? content.slice(0, 2000) + '...' 
            : content
          paperContext += `\n--- ${section} ---\n${truncated}\n`
        }
      }
    }

    if (request.paperBlueprint) {
      const keyContributions = request.paperBlueprint.keyContributions?.slice(0, 5) || []
      const sectionPlan = request.paperBlueprint.sectionPlan?.slice(0, 8) || []

      paperContext += '\n\nBlueprint Context:\n'
      if (request.paperBlueprint.thesisStatement) {
        paperContext += `Thesis: ${request.paperBlueprint.thesisStatement}\n`
      }
      if (request.paperBlueprint.centralObjective) {
        paperContext += `Central Objective: ${request.paperBlueprint.centralObjective}\n`
      }
      if (keyContributions.length > 0) {
        paperContext += `Key Contributions:\n${keyContributions.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n`
      }
      if (sectionPlan.length > 0) {
        paperContext += 'Section Constraints:\n'
        sectionPlan.forEach((section) => {
          const mustCover = section.mustCover?.slice(0, 4).join('; ') || 'none'
          const mustAvoid = section.mustAvoid?.slice(0, 3).join('; ') || 'none'
          paperContext += `- ${section.sectionKey}: mustCover=${mustCover}; mustAvoid=${mustAvoid}\n`
        })
      }
    }

    paperContext += `\n\nVisualization Preferences:
- stylePreset: ${preferences.stylePreset}
- outputMix: ${preferences.outputMix}
- chartPreference: ${preferences.chartPreference}
- diagramPreference: ${preferences.diagramPreference}
- visualTone: ${preferences.visualTone}
- colorMode: ${preferences.colorMode}
- detailLevel: ${preferences.detailLevel}
- annotationDensity: ${preferences.annotationDensity}
- targetAudience: ${preferences.targetAudience}
- exportFormat: ${preferences.exportFormat}
- strictness: ${preferences.strictness}\n`

    if (request.existingFigures && request.existingFigures.length > 0) {
      paperContext += '\n\nExisting Figures (avoid duplicating these):\n'
      request.existingFigures.forEach((fig, i) => {
        paperContext += `${i + 1}. ${fig.title} (${fig.type})\n`
      })
    }

    // When focusText is provided, cap suggestions to 2-4 and inject the focus constraint
    const isFocused = !!request.focusText?.trim()
    const maxSuggestions = isFocused
      ? Math.min(request.maxSuggestions || 4, 4)
      : (request.maxSuggestions || 8)
    paperContext += `\n\nProvide up to ${maxSuggestions} figure suggestions.`

    // Inject the focus constraint block between the system prompt and paper context
    // so the LLM sees: system rules → focus constraint → paper content
    let fullPrompt: string
    if (isFocused) {
      const focusBlock = buildFocusTextBlock(
        request.focusText!,
        request.focusSection,
        request.focusMode,
        request.focusHints
      )
      fullPrompt = FIGURE_SUGGESTION_PROMPT + focusBlock + paperContext
    } else {
      fullPrompt = FIGURE_SUGGESTION_PROMPT + paperContext
    }

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_FIGURE_SUGGESTION',
      requestHeaders,
      { 
        hasSections: !!request.sections,
        existingFigureCount: request.existingFigures?.length || 0,
        focusMode: request.focusMode || 'full_paper'
      }
    )

    // Parse the JSON response with robust extraction
    const cleanedResponse = extractJSON(response)
    let suggestions: FigureSuggestion[]

    try {
      suggestions = JSON.parse(cleanedResponse) as FigureSuggestion[]
    } catch (parseError) {
      console.error('[LLMFigureService] Failed to parse suggestion JSON:', cleanedResponse.slice(0, 300))
      return {
        success: false,
        error: 'LLM returned invalid JSON for figure suggestions'
      }
    }

    if (!Array.isArray(suggestions)) {
      return {
        success: false,
        error: 'LLM returned non-array response for suggestions'
      }
    }

    const normalizeCategory = (value: string): FigureCategory => {
      const normalized = (value || '').trim().toUpperCase()
      if (
        normalized === 'DATA_CHART' ||
        normalized === 'DIAGRAM' ||
        normalized === 'STATISTICAL_PLOT' ||
        normalized === 'ILLUSTRATION' ||
        normalized === 'SKETCH' ||
        normalized === 'CUSTOM'
      ) {
        return normalized as FigureCategory
      }
      return 'DIAGRAM'
    }

    // Validate and limit suggestions
    const validSuggestions = suggestions
      .filter(s => s.title && s.description && s.category)
      .map((s, index) => {
        const category = normalizeCategory(s.category as unknown as string)
        const sanitizedTitle = sanitizeAscii(s.title).slice(0, 120).trim() || `Figure ${index + 1}`
        const sanitizedDescription = sanitizeAscii(s.description, true).slice(0, 1200).trim() || 'Diagram based on paper content'
        const normalized: FigureSuggestion = {
          ...s,
          title: sanitizedTitle,
          description: sanitizedDescription,
          category,
          rendererPreference: s.rendererPreference === 'mermaid' || s.rendererPreference === 'plantuml'
            ? s.rendererPreference
            : undefined,
          dataNeeded: s.dataNeeded ? sanitizeAscii(s.dataNeeded, true).slice(0, 500) : s.dataNeeded,
          whyThisFigure: s.whyThisFigure ? sanitizeAscii(s.whyThisFigure, true).slice(0, 220) : s.whyThisFigure
        }

        if (category === 'DIAGRAM') {
          const rendererDecision = chooseDiagramRenderer({
            diagramType: typeof s.suggestedType === 'string' ? s.suggestedType : undefined,
            title: sanitizedTitle,
            description: sanitizedDescription,
            rendererPreference: normalized.rendererPreference
          })
          normalized.rendererPreference = rendererDecision.renderer
          normalized.diagramSpec = sanitizeDiagramSpec(s.diagramSpec) || buildFallbackSpecFromDescription(sanitizedDescription, sanitizedTitle)
        }

        if (category === 'SKETCH') {
          // Ensure sketch-specific fields are populated
          const validStyles = ['academic', 'scientific', 'conceptual', 'technical'] as const
          normalized.sketchStyle = validStyles.includes(s.sketchStyle as any) ? s.sketchStyle : 'academic'
          normalized.sketchMode = s.sketchMode === 'GUIDED' ? 'GUIDED' : 'SUGGEST'
          // Ensure suggestedType is a valid sketch type
          if (!normalized.suggestedType?.startsWith('sketch-')) {
            normalized.suggestedType = normalized.sketchMode === 'GUIDED' ? 'sketch-guided' : 'sketch-auto'
          }
          // Build a visual prompt if the LLM didn't provide one
          normalized.sketchPrompt = s.sketchPrompt
            ? sanitizeAscii(s.sketchPrompt, true).slice(0, 800)
            : buildSketchPromptFromDescription(sanitizedTitle, sanitizedDescription, normalized.sketchStyle)
        }

        return normalized
      })
      .slice(0, maxSuggestions)

    return {
      success: true,
      suggestions: validSuggestions,
      tokensUsed,
      model
    }
  } catch (error) {
    console.error('[LLMFigureService] Figure suggestion failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Figure suggestion failed'
    }
  }
}

/**
 * High-level function to generate diagram code (auto-detects Mermaid vs PlantUML)
 */
export async function generateDiagramCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>,
  preferPlantUML: boolean = true,
  resolvedRenderer?: 'plantuml' | 'mermaid'
): Promise<DiagramGenerationResult> {
  const description = sanitizeAscii(request.description, true).toLowerCase()
  const spec = sanitizeDiagramSpec(request.diagramSpec) || buildFallbackSpecFromDescription(request.description, request.title)
  const normalizedRequest: DiagramGenerationRequest = {
    ...request,
    description: sanitizeAscii(request.description, true).slice(0, 2500),
    diagramSpec: spec
  }
  const rendererDecision = resolvedRenderer
    ? {
        renderer: resolvedRenderer,
        reason: 'Renderer resolved by caller.',
        plantUMLRequired: resolvedRenderer === 'plantuml'
      }
    : chooseDiagramRenderer({
        diagramType: normalizedRequest.diagramType as string | undefined,
        title: normalizedRequest.title,
        description,
        rendererPreference: normalizedRequest.rendererPreference,
        hasRecentMermaidFailure: normalizedRequest.hasRecentMermaidFailure,
        hasRecentPlantUMLFailure: normalizedRequest.hasRecentPlantUMLFailure,
        specLooksMermaidLike: normalizedRequest.specLooksMermaidLike
      })

  const allowMermaidByLegacyToggle =
    !resolvedRenderer &&
    !preferPlantUML &&
    /\bmermaid\b/.test(description) &&
    !rendererDecision.plantUMLRequired
  if (rendererDecision.renderer === 'mermaid' || allowMermaidByLegacyToggle) {
    return generateMermaidCode(normalizedRequest, requestHeaders)
  }

  return generatePlantUMLCode(normalizedRequest, requestHeaders)
}



