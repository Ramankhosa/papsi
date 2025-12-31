/**
 * Figure Generation Types
 * 
 * Defines the types and interfaces for the multi-service figure generation system.
 * Supports: QuickChart.io, Mermaid/Kroki, Python charts, and AI illustrations.
 */

// ============================================================================
// Figure Type Categories
// ============================================================================

export type FigureCategory = 
  | 'DATA_CHART'        // Bar, line, scatter, pie - via QuickChart.io
  | 'DIAGRAM'           // Flowcharts, sequences - via PlantUML/Mermaid
  | 'STATISTICAL_PLOT'  // Complex stats - via Python execution
  | 'ILLUSTRATION'      // Conceptual - via AI image generation
  | 'TABLE'             // Data tables - via HTML/LaTeX rendering
  | 'EQUATION'          // Math equations - via MathJax/KaTeX
  | 'CUSTOM'            // User-uploaded figures

export type DataChartType = 
  | 'bar'
  | 'horizontalBar'
  | 'line'
  | 'scatter'
  | 'pie'
  | 'doughnut'
  | 'radar'
  | 'polarArea'
  | 'bubble'
  | 'area'

export type DiagramType = 
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'           // Entity-relationship
  | 'gantt'
  | 'mindmap'
  | 'timeline'
  | 'architecture'
  | 'plantuml'     // Raw PlantUML

export type StatisticalPlotType = 
  | 'histogram'
  | 'boxplot'
  | 'violin'
  | 'heatmap'
  | 'correlation_matrix'
  | 'regression'
  | 'distribution'
  | 'kde'          // Kernel Density Estimation
  | 'pairplot'
  | 'errorbar'
  | 'custom_matplotlib'

export type IllustrationType = 
  | 'concept_diagram'
  | 'system_architecture'
  | 'process_flow'
  | 'comparison'
  | 'infographic'

// ============================================================================
// Figure Generation Request
// ============================================================================

export interface FigureGenerationRequest {
  // Core identifiers
  paperId?: string
  sessionId?: string
  
  // Figure metadata
  title: string
  caption?: string
  figureNumber?: number
  
  // Category and type
  category: FigureCategory
  chartType?: DataChartType
  diagramType?: DiagramType
  plotType?: StatisticalPlotType
  illustrationType?: IllustrationType
  
  // Generation mode
  mode: 'AI_ASSISTED' | 'CODE_BASED' | 'MANUAL'
  
  // Data/content for generation
  data?: FigureData
  code?: string           // PlantUML, Mermaid, or Python code
  prompt?: string         // Natural language description for AI
  
  // Output preferences
  outputFormat?: 'png' | 'svg' | 'pdf'
  width?: number
  height?: number
  dpi?: number            // For print quality (300 recommended)
  theme?: FigureTheme
  
  // Academic styling
  academicStyle?: AcademicFigureStyle
}

// ============================================================================
// Figure Data Structures
// ============================================================================

export interface FigureData {
  // For charts
  labels?: string[]
  datasets?: ChartDataset[]
  
  // For tables
  headers?: string[]
  rows?: (string | number)[][]
  
  // For statistical plots (raw data)
  values?: number[]
  xValues?: number[]
  yValues?: number[]
  groups?: Record<string, number[]>
  
  // Correlation/matrix data
  matrix?: number[][]
  matrixLabels?: string[]
}

export interface ChartDataset {
  label: string
  data: number[]
  backgroundColor?: string | string[]
  borderColor?: string | string[]
  borderWidth?: number
  fill?: boolean
}

// ============================================================================
// Styling Options
// ============================================================================

export interface FigureTheme {
  // Color palette
  primaryColor?: string
  secondaryColors?: string[]
  backgroundColor?: string
  gridColor?: string
  textColor?: string
  
  // Typography
  fontFamily?: string
  titleFontSize?: number
  labelFontSize?: number
  
  // Style presets
  preset?: 'academic' | 'modern' | 'minimal' | 'colorful' | 'grayscale'
}

export interface AcademicFigureStyle {
  // Journal-specific requirements
  journalStyle?: 'nature' | 'ieee' | 'elsevier' | 'springer' | 'acs' | 'apa'
  
  // Figure requirements
  maxWidth?: number       // in mm or inches
  maxHeight?: number
  singleColumn?: boolean  // vs double column
  
  // Font requirements
  minFontSize?: number    // Usually 6-8pt minimum
  useSerif?: boolean
  
  // Color mode
  colorMode?: 'color' | 'grayscale' | 'cmyk'
  
  // Label style
  labelPrefix?: string    // e.g., "Fig." or "Figure"
  labelPosition?: 'above' | 'below'
}

// ============================================================================
// Figure Generation Response
// ============================================================================

export interface FigureGenerationResult {
  success: boolean
  
  // Generated figure
  figureId?: string
  imageUrl?: string
  imagePath?: string
  imageBase64?: string
  
  // Metadata
  width?: number
  height?: number
  format?: string
  fileSize?: number
  
  // For code-based generation
  generatedCode?: string
  
  // Error handling
  error?: string
  errorCode?: FigureErrorCode
  
  // Usage tracking
  provider?: FigureProvider
  tokensUsed?: number
  apiCallDuration?: number
}

export type FigureErrorCode = 
  | 'INVALID_DATA'
  | 'RENDERING_FAILED'
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_TYPE'
  | 'CODE_EXECUTION_ERROR'

export type FigureProvider = 
  | 'quickchart'
  | 'kroki'
  | 'plantuml'
  | 'python_matplotlib'
  | 'gemini'
  | 'manual_upload'

// ============================================================================
// Figure Record (Database Schema)
// ============================================================================

export interface FigureRecord {
  id: string
  paperId?: string
  sessionId?: string
  
  // Display info
  figureNumber: number
  title: string
  caption?: string
  
  // Generation info
  category: FigureCategory
  subType?: string
  provider: FigureProvider
  
  // Source/code
  sourceCode?: string
  sourceData?: FigureData
  prompt?: string
  
  // Output
  imagePath?: string
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  imageFormat?: string
  imageChecksum?: string
  
  // Status
  status: 'SUGGESTED' | 'PENDING' | 'SUCCESS' | 'FAILED'
  errorMessage?: string
  
  // Metadata
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  isFavorite: boolean
  
  // Academic styling
  academicStyle?: AcademicFigureStyle
}

// ============================================================================
// AI Figure Planning
// ============================================================================

export interface FigureSuggestion {
  title: string
  description: string
  category: FigureCategory
  suggestedType?: string
  relevantSection?: string      // Which paper section it relates to
  dataSources?: string[]        // What data it would visualize
  importance: 'required' | 'recommended' | 'optional'
}

export interface FigurePlan {
  suggestions: FigureSuggestion[]
  totalFigures: number
  byCategory: Record<FigureCategory, number>
  estimatedGenerationTime: number  // in seconds
}

// ============================================================================
// QuickChart.io Specific Types
// ============================================================================

export interface QuickChartConfig {
  type: DataChartType
  data: {
    labels: string[]
    datasets: ChartDataset[]
  }
  options?: {
    title?: { display: boolean; text: string }
    scales?: any
    legend?: any
    plugins?: any
    responsive?: boolean
    maintainAspectRatio?: boolean
  }
}

// ============================================================================
// Mermaid/Kroki Specific Types
// ============================================================================

export interface MermaidConfig {
  diagramType: DiagramType
  code: string
  theme?: 'default' | 'dark' | 'forest' | 'neutral'
}

export interface KrokiRequest {
  diagramType: string
  diagramSource: string
  outputFormat: 'svg' | 'png' | 'pdf'
}

// ============================================================================
// Python Execution Types
// ============================================================================

export interface PythonChartRequest {
  plotType: StatisticalPlotType
  data: FigureData
  customCode?: string
  styleOptions?: {
    figsize?: [number, number]
    dpi?: number
    style?: string  // matplotlib style: 'seaborn', 'ggplot', etc.
    colorPalette?: string
  }
}

export interface PythonExecutionResult {
  success: boolean
  imageBase64?: string
  stdout?: string
  stderr?: string
  executionTime?: number
}

// ============================================================================
// Color Palettes for Academic Papers
// ============================================================================

export const ACADEMIC_COLOR_PALETTES = {
  // Nature-style muted palette
  nature: ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7'],
  
  // IEEE blue-focused palette
  ieee: ['#003366', '#0066CC', '#3399FF', '#66B2FF', '#99CCFF', '#CCE5FF'],
  
  // Colorblind-friendly palette (Wong)
  colorblind: ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
  
  // Grayscale for print
  grayscale: ['#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#E5E5E5'],
  
  // Viridis-inspired
  viridis: ['#440154', '#482878', '#3E4A89', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725'],
  
  // Seaborn default
  seaborn: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
} as const

// ============================================================================
// Default Figure Dimensions (in pixels, 300 DPI)
// ============================================================================

export const FIGURE_DIMENSIONS = {
  // Single column (typical journal width ~85mm)
  singleColumn: { width: 1000, height: 750 },
  
  // Double column (typical journal width ~170mm)  
  doubleColumn: { width: 2000, height: 1200 },
  
  // Square format
  square: { width: 1000, height: 1000 },
  
  // Wide format (for timelines, gantt charts)
  wide: { width: 2000, height: 600 },
  
  // Tall format (for hierarchies, trees)
  tall: { width: 800, height: 1400 }
} as const

