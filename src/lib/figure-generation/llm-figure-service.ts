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
import type { FigureCategory, DataChartType, DiagramType, FigureSuggestion } from './types'

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
}

export interface DiagramGenerationResult {
  success: boolean
  code?: string
  diagramType?: 'mermaid' | 'plantuml'
  error?: string
  tokensUsed?: number
  model?: string
}

export interface FigureSuggestionRequest {
  paperTitle?: string
  paperAbstract?: string
  sections?: Record<string, string>
  researchType?: string
  existingFigures?: Array<{ title: string; type: string }>
  maxSuggestions?: number
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

const CHART_GENERATION_PROMPT = `You are an expert at creating Chart.js configurations for academic figures.

Given a description of what chart the user wants, generate a valid Chart.js configuration object.

RULES:
1. Return ONLY valid JSON - no markdown, no explanation, just the JSON config
2. Use academic-friendly colors (blue, green, orange, gray tones)
3. Include clear axis labels and titles
4. For pie/doughnut charts, use distinct but harmonious colors
5. Always include a legend
6. Use appropriate scales (linear for most data, logarithmic if values span orders of magnitude)

OUTPUT FORMAT (return ONLY this JSON structure):
{
  "type": "bar|line|pie|scatter|radar|doughnut",
  "data": {
    "labels": ["Label1", "Label2", ...],
    "datasets": [{
      "label": "Dataset Name",
      "data": [value1, value2, ...],
      "backgroundColor": ["#color1", ...] or "#color",
      "borderColor": ["#color1", ...] or "#color",
      "borderWidth": 1
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": { "display": true, "text": "Chart Title" },
      "legend": { "position": "top" }
    },
    "scales": {
      "y": { "beginAtZero": true, "title": { "display": true, "text": "Y-Axis Label" } },
      "x": { "title": { "display": true, "text": "X-Axis Label" } }
    }
  }
}

USER REQUEST:
`

const DIAGRAM_GENERATION_PROMPT = `You are an expert at creating diagrams using Mermaid syntax for academic papers.

Given a description of what diagram the user wants, generate valid Mermaid code.

RULES:
1. Return ONLY the Mermaid code - no markdown code blocks, no explanation
2. Use clear, descriptive node labels
3. For flowcharts, use appropriate shapes: [] for process, {} for decision, () for start/end
4. For sequence diagrams, use proper participant names
5. Keep diagrams readable (not too many elements)
6. Use appropriate diagram type based on what user describes

MERMAID SYNTAX EXAMPLES:

Flowchart:
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E

Sequence Diagram:
sequenceDiagram
    participant U as User
    participant S as Server
    U->>S: Request
    S-->>U: Response

Class Diagram:
classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    Animal <|-- Dog

State Diagram:
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : start
    Processing --> Complete : done
    Complete --> [*]

Architecture/Block Diagram:
flowchart LR
    subgraph Frontend
        A[Web App]
        B[Mobile App]
    end
    subgraph Backend
        C[API Server]
        D[Database]
    end
    A --> C
    B --> C
    C --> D

Gantt Chart:
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Task 1 :a1, 2024-01-01, 30d
    Task 2 :after a1, 20d

USER REQUEST:
`

const PLANTUML_GENERATION_PROMPT = `You are an expert at creating PlantUML diagrams for technical documentation and academic papers.

Given a description, generate valid PlantUML code.

RULES:
1. Return ONLY the PlantUML code starting with @startuml and ending with @enduml
2. No markdown, no explanation
3. Use clear labels and appropriate diagram elements
4. For complex systems, use packages and groupings

PLANTUML EXAMPLES:

Sequence:
@startuml
actor User
participant "System" as S
User -> S: Request
S --> User: Response
@enduml

Activity:
@startuml
start
:Initialize;
if (Condition?) then (yes)
  :Process A;
else (no)
  :Process B;
endif
:Complete;
stop
@enduml

Component:
@startuml
package "Frontend" {
  [Web Client]
  [Mobile App]
}
package "Backend" {
  [API Gateway]
  [Service Layer]
  database "Database"
}
[Web Client] --> [API Gateway]
[Mobile App] --> [API Gateway]
[API Gateway] --> [Service Layer]
[Service Layer] --> [Database]
@enduml

USER REQUEST:
`

const FIGURE_SUGGESTION_PROMPT = `You are an expert academic writing consultant specializing in scientific visualization and figure design.

Analyze the provided paper content and suggest appropriate figures that would enhance the manuscript.

RULES:
1. Return ONLY valid JSON array - no markdown, no explanation
2. Suggest 5-6 figures maximum
3. Each suggestion should be actionable and specific
4. Consider the research type when suggesting figure types
5. Prioritize figures that add value to the narrative
6. Include a mix of data visualizations and diagrams where appropriate

OUTPUT FORMAT (return ONLY this JSON array):
[
  {
    "title": "Figure title",
    "description": "Detailed description of what the figure should show",
    "category": "DATA_CHART|DIAGRAM|STATISTICAL_PLOT|ILLUSTRATION",
    "suggestedType": "bar|line|pie|scatter|flowchart|sequence|architecture|etc",
    "relevantSection": "methodology|results|discussion|introduction",
    "importance": "required|recommended|optional",
    "dataNeeded": "Description of data needed to create this figure"
  }
]

CATEGORIES:
- DATA_CHART: Bar, line, pie, scatter, radar charts for quantitative data
- DIAGRAM: Flowcharts, sequence diagrams, architecture diagrams for processes/systems
- STATISTICAL_PLOT: Histograms, box plots, heatmaps for statistical analysis
- ILLUSTRATION: Conceptual diagrams, schematics (usually require manual creation)

PAPER CONTENT:
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
// MAIN SERVICE FUNCTIONS
// =============================================================================

/**
 * Generate Chart.js configuration from natural language description
 */
export async function generateChartConfig(
  request: ChartGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<ChartGenerationResult> {
  try {
    // Build the prompt
    let userRequest = request.description

    if (request.chartType) {
      userRequest += `\n\nPreferred chart type: ${request.chartType}`
    }

    if (request.title) {
      userRequest += `\n\nChart title: ${request.title}`
    }

    if (request.data?.labels && request.data?.values) {
      userRequest += `\n\nData provided:`
      userRequest += `\nLabels: ${request.data.labels.join(', ')}`
      userRequest += `\nValues: ${request.data.values.join(', ')}`
      if (request.data.datasetLabel) {
        userRequest += `\nDataset label: ${request.data.datasetLabel}`
      }
    }

    if (request.style) {
      userRequest += `\n\nStyle preference: ${request.style} (use appropriate color palette)`
    }

    const fullPrompt = CHART_GENERATION_PROMPT + userRequest

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_CHART_GENERATOR',
      requestHeaders,
      { chartType: request.chartType, hasData: !!request.data }
    )

    // Parse the JSON response
    const cleanedResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const config = JSON.parse(cleanedResponse)

    return {
      success: true,
      config,
      tokensUsed,
      model
    }
  } catch (error) {
    console.error('[LLMFigureService] Chart generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Chart generation failed'
    }
  }
}

/**
 * Generate Mermaid diagram code from natural language description
 */
export async function generateMermaidCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  try {
    let userRequest = request.description

    if (request.diagramType) {
      userRequest += `\n\nPreferred diagram type: ${request.diagramType}`
    }

    if (request.title) {
      userRequest += `\n\nDiagram title: ${request.title}`
    }

    if (request.elements && request.elements.length > 0) {
      userRequest += `\n\nElements to include: ${request.elements.join(', ')}`
    }

    if (request.style) {
      userRequest += `\n\nStyle: ${request.style}`
    }

    const fullPrompt = DIAGRAM_GENERATION_PROMPT + userRequest

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_DIAGRAM_GENERATOR',
      requestHeaders,
      { diagramType: request.diagramType }
    )

    // Clean up the response (remove any markdown artifacts)
    const cleanedCode = response
      .replace(/```mermaid\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    return {
      success: true,
      code: cleanedCode,
      diagramType: 'mermaid',
      tokensUsed,
      model
    }
  } catch (error) {
    console.error('[LLMFigureService] Mermaid generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Diagram generation failed'
    }
  }
}

/**
 * Generate PlantUML code from natural language description
 */
export async function generatePlantUMLCode(
  request: DiagramGenerationRequest,
  requestHeaders: Record<string, string>
): Promise<DiagramGenerationResult> {
  try {
    let userRequest = request.description

    if (request.diagramType) {
      userRequest += `\n\nDiagram type: ${request.diagramType}`
    }

    if (request.title) {
      userRequest += `\n\nDiagram title: ${request.title}`
    }

    if (request.elements && request.elements.length > 0) {
      userRequest += `\n\nElements to include: ${request.elements.join(', ')}`
    }

    const fullPrompt = PLANTUML_GENERATION_PROMPT + userRequest

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_DIAGRAM_GENERATOR',
      requestHeaders,
      { diagramType: 'plantuml' }
    )

    // Clean up the response
    let cleanedCode = response
      .replace(/```plantuml\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    // Ensure it has proper PlantUML wrapper
    if (!cleanedCode.startsWith('@startuml')) {
      cleanedCode = '@startuml\n' + cleanedCode
    }
    if (!cleanedCode.endsWith('@enduml')) {
      cleanedCode = cleanedCode + '\n@enduml'
    }

    return {
      success: true,
      code: cleanedCode,
      diagramType: 'plantuml',
      tokensUsed,
      model
    }
  } catch (error) {
    console.error('[LLMFigureService] PlantUML generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'PlantUML generation failed'
    }
  }
}

/**
 * Generate AI-powered figure suggestions based on paper content
 */
export async function generateFigureSuggestions(
  request: FigureSuggestionRequest,
  requestHeaders: Record<string, string>
): Promise<FigureSuggestionResult> {
  try {
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

    if (request.existingFigures && request.existingFigures.length > 0) {
      paperContext += '\n\nExisting Figures (avoid duplicating these):\n'
      request.existingFigures.forEach((fig, i) => {
        paperContext += `${i + 1}. ${fig.title} (${fig.type})\n`
      })
    }

    const maxSuggestions = request.maxSuggestions || 6
    paperContext += `\n\nProvide up to ${maxSuggestions} figure suggestions.`

    const fullPrompt = FIGURE_SUGGESTION_PROMPT + paperContext

    const { response, tokensUsed, model } = await callLLM(
      fullPrompt,
      'PAPER_FIGURE_SUGGESTION',
      requestHeaders,
      { 
        hasSections: !!request.sections,
        existingFigureCount: request.existingFigures?.length || 0
      }
    )

    // Parse the JSON response
    const cleanedResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()

    const suggestions = JSON.parse(cleanedResponse) as FigureSuggestion[]

    // Validate and limit suggestions
    const validSuggestions = suggestions
      .filter(s => s.title && s.description && s.category)
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
  preferPlantUML: boolean = false
): Promise<DiagramGenerationResult> {
  // PlantUML is better for UML diagrams, Mermaid for flowcharts and modern diagrams
  const plantUMLTypes = ['class', 'component', 'usecase', 'activity', 'state']
  
  const shouldUsePlantUML = preferPlantUML || 
    (request.diagramType && plantUMLTypes.includes(request.diagramType)) ||
    request.description.toLowerCase().includes('uml') ||
    request.description.toLowerCase().includes('class diagram') ||
    request.description.toLowerCase().includes('component diagram')

  if (shouldUsePlantUML) {
    return generatePlantUMLCode(request, requestHeaders)
  }

  return generateMermaidCode(request, requestHeaders)
}

