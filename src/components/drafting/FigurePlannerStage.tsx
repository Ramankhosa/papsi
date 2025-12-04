'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Bot, 
  User, 
  Sparkles, 
  Upload, 
  FileText, 
  Check, 
  Loader2, 
  Code, 
  Trash2, 
  Edit2, 
  Eye, 
  RefreshCw, 
  Image as ImageIcon, 
  Zap,
  LayoutGrid,
  Pencil,
  Star,
  StarOff,
  Wand2,
  Grid3X3,
  AlertCircle
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface FigurePlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type LLMFigure = {
  title: string
  purpose: string
  plantuml: string
}

// Helper function to normalize page sizes from country profiles
// IMPORTANT: This must be defined before the component to avoid TDZ (Temporal Dead Zone) errors
function normalizePageSizes(input: any): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap((val) => normalizePageSizes(val))
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed ? [trimmed] : []
  }
  if (typeof input === 'object') return Object.values(input).flatMap((val) => normalizePageSizes(val))
  return []
}

export default function FigurePlannerStage({ session, patent, onComplete, onRefresh }: FigurePlannerStageProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [figures, setFigures] = useState<LLMFigure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [diagramCount, setDiagramCount] = useState(5)

  // Helper for cleaning titles
  const sanitizeFigureLabel = (text?: string | null) => {
    const raw = typeof text === 'string' ? text : ''
    if (!raw.trim()) return ''
    const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
    let cleaned = raw.replace(cpcIpcPattern, '')
    cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
    cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
    return cleaned.trim()
  }

  const diagramSources = session?.diagramSources || []
  const figurePlans = (session?.figurePlans || []).map((plan: any) => ({
    ...plan,
    title: sanitizeFigureLabel(plan.title) || `Figure ${plan.figureNo}`
  }))

  const [isUploading, setIsUploading] = useState(false)
  const [uploaded, setUploaded] = useState<Record<number, boolean>>({})
  const [modifyIdx, setModifyIdx] = useState<number | null>(null)
  const [processingStatus, setProcessingStatus] = useState<Record<number, string>>({})
  const [processingStep, setProcessingStep] = useState<Record<number, number>>({})
  const [modifyText, setModifyText] = useState('')
  const [modifyFigNo, setModifyFigNo] = useState<number | null>(null)
  const [modifyTextSaved, setModifyTextSaved] = useState('')
  const [isViewing, setIsViewing] = useState<Record<number, boolean>>({})
  const [rendering, setRendering] = useState<Record<number, boolean>>({})
  const [renderPreview, setRenderPreview] = useState<Record<number, string | null>>({})
  const [expandedFigNo, setExpandedFigNo] = useState<number | null>(null)
  const [addCount, setAddCount] = useState(0)
  const [addInputs, setAddInputs] = useState<string[]>([])
  const [overrideCount, setOverrideCount] = useState(0)
  const [overrideInputs, setOverrideInputs] = useState<string[]>([])
  const [stateInitialized, setStateInitialized] = useState(false)

  // UI Mode state
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [includeExistingFigures, setIncludeExistingFigures] = useState(true)

  // Map legacy state to new mode
  const [aiDecides, setAiDecides] = useState(true)
  const [userDecides, setUserDecides] = useState(false)
  
  useEffect(() => {
    if (mode === 'ai') {
      setAiDecides(true)
      setUserDecides(false)
    } else {
      setAiDecides(false)
      setUserDecides(true)
    }
  }, [mode])

  const [manualCount, setManualCount] = useState(0)
  const [manualInputs, setManualInputs] = useState<{ title: string; description: string }[]>([])
  const [manualFiles, setManualFiles] = useState<(File | null)[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualBusy, setManualBusy] = useState<Record<number, boolean>>({})
  const [showPlantUML, setShowPlantUML] = useState<Record<number, boolean>>({})
  const [countryProfile, setCountryProfile] = useState<any | null>(null)
  const uploadSectionRef = useRef<HTMLDivElement>(null)
  const [highlightUpload, setHighlightUpload] = useState(false)
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve())

  // === FIGURE PLANNER TAB STATE ===
  const [activeTab, setActiveTab] = useState<'diagrams' | 'sketches'>('diagrams')
  
  // === SKETCH TAB STATE ===
  const [sketches, setSketches] = useState<any[]>([])
  const [sketchesLoading, setSketchesLoading] = useState(false)
  const [sketchError, setSketchError] = useState<string | null>(null)
  const [sketchGenerating, setSketchGenerating] = useState(false)
  const [sketchMode, setSketchMode] = useState<'auto' | 'guided' | 'refine'>('auto')
  const [sketchPrompt, setSketchPrompt] = useState('')
  const [sketchTitle, setSketchTitle] = useState('')
  const [sketchUploadFile, setSketchUploadFile] = useState<File | null>(null)
  const [sketchUploadPreview, setSketchUploadPreview] = useState<string | null>(null)
  const [expandedSketchId, setExpandedSketchId] = useState<string | null>(null)
  const [modifyingSketchId, setModifyingSketchId] = useState<string | null>(null)
  const [modifySketchPrompt, setModifySketchPrompt] = useState('')
  const sketchFileInputRef = useRef<HTMLInputElement>(null)

  const activeJurisdiction = (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN').toUpperCase()

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await fetch(`/api/country-profiles/${activeJurisdiction}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setCountryProfile(data?.profile || null)
        } else if (res.status === 404) {
          // Country profile not found, use defaults
          console.warn(`Country profile for ${activeJurisdiction} not found, using defaults`)
          setCountryProfile(null)
        } else {
          console.warn('Failed to load country profile for figures', res.status, res.statusText)
        }
      } catch (e) {
        console.warn('Failed to load country profile for figures', e)
        setCountryProfile(null)
      }
    }
    loadProfile()
  }, [activeJurisdiction])

  const countWords = (text: string) => (text || '').trim().split(/\s+/).filter(Boolean).length

  // Animated dots component for waiting states
  const AnimatedDots = () => (
    <span className="inline-flex">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
      <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
    </span>
  )

  // Handle upload button click with scroll and animation
  const handleUploadToggle = () => {
    const newShowManual = !showManual
    setShowManual(newShowManual)

    if (newShowManual) {
      // Scroll to upload section after a brief delay to allow animation to start
      setTimeout(() => {
        uploadSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
        // Trigger highlight animation
        setHighlightUpload(true)
        setTimeout(() => setHighlightUpload(false), 2000)
      }, 100)
    }
  }

  // Intelligent processing messages
  const intelligentMessages = [
    "🧠 Analyzing diagram architecture...",
    "⚡ Optimizing layout algorithms...",
    "🎨 Applying advanced rendering techniques...",
    "🔬 Validating technical specifications...",
    "✨ Generating high-resolution output...",
    "📊 Performing quality assurance checks...",
    "🎯 Finalizing patent-grade visualization..."
  ]

  // Track which figures have been queued for rendering to prevent duplicate calls
  const queuedForRenderRef = useRef<Set<number>>(new Set())

  // Automatically process diagrams when PlantUML code is available
  // This effect runs after state initialization and when diagramSources change
  useEffect(() => {
    if (!stateInitialized) return

    // Immediate processing without delay for better responsiveness
    diagramSources.forEach((d: any) => {
      const figNo = d.figureNo
      // Check all conditions for auto-rendering:
      // 1. Has PlantUML code
      // 2. Not already uploaded/rendered
      // 3. No existing image
      // 4. Not currently rendering
      // 5. No processing status (not in progress or failed)
      // 6. Not already queued for rendering (prevents duplicate calls)
      const shouldRender =
        d.plantumlCode &&
        !uploaded[figNo] &&
        !d.imageUploadedAt &&
        !rendering[figNo] &&
        !processingStatus[figNo] &&
        !queuedForRenderRef.current.has(figNo)

      if (shouldRender) {
        queuedForRenderRef.current.add(figNo)
        autoProcessDiagram(figNo, d.plantumlCode)
      }
    })
  }, [diagramSources, uploaded, rendering, processingStatus, stateInitialized])

  // Initialize state for new figures when diagramSources changes
  // Also reset uploaded state when image data is cleared (e.g., after regeneration)
  useEffect(() => {
    const newFigureNos = diagramSources.map((d: any) => d.figureNo)
    setUploaded((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        const source = diagramSources.find((d: any) => d.figureNo === no)
        // Reset to false if no image exists OR if imageUploadedAt is null (cleared after regeneration)
        if (updated[no] === undefined || (!source?.imageUploadedAt && updated[no] === true)) {
          updated[no] = false
          // Also clear from queued set to allow re-rendering
          queuedForRenderRef.current.delete(no)
        }
      })
      return updated
    })
    setRendering((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = false
      })
      return updated
    })
    setProcessingStatus((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = ''
      })
      return updated
    })
    setProcessingStep((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = 0
      })
      return updated
    })
    setRenderPreview((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = null
      })
      return updated
    })
    setIsViewing((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = false
      })
      return updated
    })
    setStateInitialized(true)
  }, [diagramSources])

  // === SKETCH TAB EFFECTS AND FUNCTIONS ===
  
  // Load sketches when tab changes to sketches
  useEffect(() => {
    if (activeTab === 'sketches' && session?.id) {
      loadSketches()
    }
  }, [activeTab, session?.id])

  const loadSketches = async () => {
    if (!session?.id) return
    
    try {
      setSketchesLoading(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'list_sketches',
          sessionId: session.id
        })
      })
      
      if (!res.ok) throw new Error('Failed to load sketches')
      
      const data = await res.json()
      setSketches(data.sketches || [])
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to load sketches')
    } finally {
      setSketchesLoading(false)
    }
  }

  const handleGenerateSketch = async () => {
    if (!session?.id) return
    
    // Validation
    if (sketchMode === 'guided' && sketchPrompt.trim().length < 10) {
      setSketchError('Please provide at least 10 characters of instructions')
      return
    }
    if (sketchMode === 'refine' && !sketchUploadFile) {
      setSketchError('Please upload a sketch to refine')
      return
    }
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      let action = 'generate_sketch'
      let body: any = {
        sessionId: session.id,
        title: sketchTitle || undefined,
        contextFlags: {
          useIdeaSummary: true,
          useClaims: true,
          useDiagrams: true,
          useComponents: true
        }
      }
      
      if (sketchMode === 'guided') {
        action = 'generate_sketch_guided'
        body.userPrompt = sketchPrompt
      } else if (sketchMode === 'refine') {
        action = 'refine_sketch'
        body.userPrompt = sketchPrompt || undefined
        
        // Convert file to base64
        if (sketchUploadFile) {
          const reader = new FileReader()
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string
              resolve(result.split(',')[1]) // Remove data URL prefix
            }
            reader.onerror = reject
            reader.readAsDataURL(sketchUploadFile)
          })
          body.uploadedImageBase64 = base64
          body.uploadedImageMimeType = sketchUploadFile.type
        }
      }
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({ action, ...body })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch generation failed')
      }
      
      // Refresh sketches list
      await loadSketches()
      
      // Reset form
      setSketchPrompt('')
      setSketchTitle('')
      setSketchUploadFile(null)
      setSketchUploadPreview(null)
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch generation failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleModifySketch = async (sketchId: string) => {
    if (!session?.id || !modifySketchPrompt.trim()) return
    
    try {
      setSketchGenerating(true)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'modify_sketch',
          sessionId: session.id,
          sourceSketchId: sketchId,
          userPrompt: modifySketchPrompt
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sketch modification failed')
      }
      
      // Refresh and close modify dialog
      await loadSketches()
      setModifyingSketchId(null)
      setModifySketchPrompt('')
      
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Sketch modification failed')
    } finally {
      setSketchGenerating(false)
    }
  }

  const handleDeleteSketch = async (sketchId: string) => {
    if (!confirm('Delete this sketch?')) return
    
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'delete_sketch',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to delete sketch')
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to delete sketch')
    }
  }

  const handleToggleFavorite = async (sketchId: string) => {
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'toggle_sketch_favorite',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to toggle favorite')
      
      const data = await res.json()
      setSketches(prev => prev.map(s => 
        s.id === sketchId ? { ...s, isFavorite: data.isFavorite } : s
      ))
    } catch (err) {
      console.error('Toggle favorite error:', err)
    }
  }

  const handleRetrySketch = async (sketchId: string) => {
    try {
      setSketchGenerating(true)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'retry_sketch',
          sketchId
        })
      })
      
      if (!res.ok) throw new Error('Failed to retry sketch')
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to retry sketch')
    } finally {
      setSketchGenerating(false)
    }
  }

  // Handle generating image from a SUGGESTED sketch
  const [generatingSuggestionId, setGeneratingSuggestionId] = useState<string | null>(null)
  
  const handleGenerateFromSuggestion = async (sketchId: string) => {
    try {
      setGeneratingSuggestionId(sketchId)
      setSketchError(null)
      
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_from_suggestion',
          sketchId
        })
      })
      
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate sketch')
      }
      
      await loadSketches()
    } catch (err) {
      setSketchError(err instanceof Error ? err.message : 'Failed to generate sketch from suggestion')
    } finally {
      setGeneratingSuggestionId(null)
    }
  }

  const handleSketchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      setSketchError('Please upload a PNG, JPEG, or WebP image')
      return
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setSketchError('Image must be less than 10MB')
      return
    }
    
    setSketchUploadFile(file)
    
    // Create preview
    const reader = new FileReader()
    reader.onload = () => setSketchUploadPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)

      // If user chose to decide and provided an override list, generate exactly those figures instead of auto list
      const overrideList = overrideInputs.filter(Boolean)
      if (mode === 'manual' && overrideCount > 0 && overrideList.length > 0) {
        // Build the same rich context and prompt as AI mode, but use user-provided instructions
        const components = session?.referenceMap?.components || []
        const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

        const drawingRules = countryProfile?.rules?.drawings || {}
        const figureLabelFormat = countryProfile?.profileData?.diagrams?.figureLabelFormat || countryProfile?.profileData?.rules?.drawings?.figureLabelFormat || 'Fig. {number}'
        const colorAllowed = drawingRules.colorAllowed !== undefined ? drawingRules.colorAllowed : false
        const lineStyle = drawingRules.lineStyle || 'black_and_white_solid'
        const refNumeralsMandatory = drawingRules.referenceNumeralsMandatoryWhenDrawings !== false
        const minTextSize = drawingRules.minReferenceTextSizePt || 8
        const allowedPageSizeList = [
          ...normalizePageSizes(drawingRules.allowedPageSizes),
          ...normalizePageSizes(drawingRules.paperSize)
        ]
        const allowedPageSizes = allowedPageSizeList.join(', ')

        // Determine next figure number based on existing figures
        const existingFigureCount = session?.figurePlans?.length || 0
        const startingFigNo = existingFigureCount + 1

        // Create a custom prompt that incorporates the user-provided instructions
        let customPrompt = `You are an expert patent illustrator generating PlantUML diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
Return a JSON array of exactly ${overrideList.length} custom diagrams based on the user's specific instructions.
Each item must be: {"title":"Fig.X - descriptive title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"}.

These new figures will be numbered starting from Fig.${startingFigNo}.

User-provided instructions for each NEW figure:
${overrideList.map((instruction, index) => `Fig.${startingFigNo + index}: ${instruction}`).join('\n')}`

        // Include existing figures context if checkbox is checked
        if (includeExistingFigures && session?.figurePlans?.length > 0) {
          const existingFigures = session.figurePlans
            .sort((a: any, b: any) => a.figureNo - b.figureNo)
            .map((f: any) => {
              const clean = sanitizeFigureLabel(f.title) || `Figure ${f.figureNo}`
              const description = f.description ? ` - ${f.description.slice(0, 100)}${f.description.length > 100 ? '...' : ''}` : ''
              return `Fig.${f.figureNo}: ${clean}${description}`
            })
            .join('\n')

          customPrompt += `

EXISTING FIGURES (already created - do NOT duplicate these, but ensure new figures logically follow them):
${existingFigures}

IMPORTANT: New figures should continue the "zoom-in" progression. If existing figures show the system overview, new figures should show deeper details.`
        }

        customPrompt += `

═══════════════════════════════════════════════════════════════════════════════
COMPONENTS & LABELING
═══════════════════════════════════════════════════════════════════════════════
- Use ONLY these components and numerals: ${numeralsPreview}.
- Use labels with numerals exactly as assigned (e.g., "Processor 100", not just "Processor").
- Every component referenced must exist in the list above. NO UNDEFINED REFERENCES.
- Figure label format: ${figureLabelFormat}.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'MONOCHROME ONLY (no color)'}.
- Line style: ${lineStyle}.
- Reference numerals: ${refNumeralsMandatory ? 'MANDATORY in all drawings' : 'Optional'}.
- Minimum text size: ${minTextSize} pt.

═══════════════════════════════════════════════════════════════════════════════
PLANTUML SYNTAX RULES (ERRORS TO AVOID)
═══════════════════════════════════════════════════════════════════════════════
FORBIDDEN (will cause render failure):
✗ !theme, !include, !import, !pragma directives
✗ skinparam blocks or statements
✗ title, caption, header, footer inside the diagram
✗ Mixing [hidden] with directions (wrong: "-[hidden]down-", correct: "-[hidden]-" OR "-down-")
✗ Incomplete connections (wrong: "500 --", correct: "500 --> 600")
✗ Unclosed blocks (every "if" needs "endif", every "note" needs "end note")
✗ Multiple or nested @startuml/@enduml pairs (exactly ONE pair per diagram)
✗ Undefined aliases or dangling arrows

ALLOWED (only these style directives):
✓ scale max 1890x2917 (for A4 fit)
✓ newpage (for multi-page diagrams)

═══════════════════════════════════════════════════════════════════════════════
LAYOUT PRINCIPLES
═══════════════════════════════════════════════════════════════════════════════
- Use VERTICAL flow: Inputs (top) → Processing (middle) → Outputs (bottom).
- Group related nodes in frames/packages, listed top-to-bottom.
- Max 3 horizontal siblings per layer; overflow goes to lower layer.
- Page size: ${allowedPageSizes || 'A4/Letter safe defaults'}.

═══════════════════════════════════════════════════════════════════════════════
SELF-VALIDATION (DO THIS BEFORE RESPONDING)
═══════════════════════════════════════════════════════════════════════════════
Before outputting, mentally verify:
1. ✓ All referenced components exist in the provided list?
2. ✓ No forbidden directives (!theme, skinparam, title, etc.)?
3. ✓ All connections have both endpoints?
4. ✓ All blocks are properly closed?
5. ✓ Exactly one @startuml/@enduml pair per diagram?

Output: JSON array only, no markdown fences, no explanations.`

        const resp = await onComplete({
          action: 'generate_diagrams_llm',
          sessionId: session?.id,
          prompt: customPrompt,
          // In manual AI mode, append to existing figures instead of replacing them
          replaceExisting: false
        })
        if (!resp) throw new Error('LLM did not return valid figure list')

        // Backend already saves figures with correct figure numbers (appended after existing)
        // No need to call handleSavePlantUML - it would overwrite with wrong figure numbers

        setOverrideCount(0)
        setOverrideInputs([])
        await onRefresh()
        return
      }

      // Build concise context to nudge LLM
      const components = session?.referenceMap?.components || []
      const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

      // Get frozen claims for claim-aware diagram generation
      const normalizedData = session?.ideaRecord?.normalizedData || {}
      const frozenClaims = normalizedData.claimsStructured || []
      const claimsText = normalizedData.claims || ''
      const hasClaimsContext = frozenClaims.length > 0 || claimsText

      // Build claims context for the prompt
      let claimsContext = ''
      if (hasClaimsContext) {
        if (frozenClaims.length > 0) {
          const claimsSummary = frozenClaims.slice(0, 5).map((c: any) => 
            `Claim ${c.number} (${c.type}${c.category ? `, ${c.category}` : ''}): ${(c.text || '').substring(0, 150)}...`
          ).join('\n')
          claimsContext = `\n\nFROZEN PATENT CLAIMS (diagrams should illustrate these):\n${claimsSummary}`
          if (frozenClaims.length > 5) {
            claimsContext += `\n(+ ${frozenClaims.length - 5} more claims)`
          }
        } else if (claimsText) {
          // Parse HTML claims text
          const plainClaims = claimsText.replace(/<[^>]*>/g, '').substring(0, 800)
          claimsContext = `\n\nFROZEN PATENT CLAIMS (diagrams should illustrate these):\n${plainClaims}...`
        }
      }

      const drawingRules = countryProfile?.rules?.drawings || {}
      const figureLabelFormat = countryProfile?.profileData?.diagrams?.figureLabelFormat || countryProfile?.profileData?.rules?.drawings?.figureLabelFormat || 'Fig. {number}'
      const colorAllowed = drawingRules.colorAllowed !== undefined ? drawingRules.colorAllowed : false
      const lineStyle = drawingRules.lineStyle || 'black_and_white_solid'
      const refNumeralsMandatory = drawingRules.referenceNumeralsMandatoryWhenDrawings !== false
      const minTextSize = drawingRules.minReferenceTextSizePt || 8
      const allowedPageSizeList = [
        ...normalizePageSizes(drawingRules.allowedPageSizes),
        ...normalizePageSizes(drawingRules.paperSize)
      ]
      const allowedPageSizes = allowedPageSizeList.join(', ')

      const prompt = `You are an expert patent illustrator generating PlantUML diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
Return a JSON array of exactly ${diagramCount} simple, standard patent-style diagrams (no fancy rendering).
Each item must be: {"title":"Fig.X - title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"}.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: SEQUENTIAL ZOOM-IN HIERARCHY (MANDATORY)
═══════════════════════════════════════════════════════════════════════════════
Figures MUST follow a "broad-to-specific" progression, like zooming into a photograph:

Fig.1 → SYSTEM OVERVIEW: Bird's-eye view showing ALL major components and their relationships.
         Shows: The complete invention as a single unified system.
         Detail level: Lowest (most abstract).

Fig.2 → PRIMARY SUBSYSTEM: Zoom into the most important functional block from Fig.1.
         Shows: Internal structure of the core processing unit.
         Detail level: Medium.

Fig.3 → DATA/CONTROL FLOW: How data or signals flow through the system.
         Shows: Sequence of operations, inputs → processing → outputs.
         Detail level: Medium.

Fig.4+ → COMPONENT DEEP-DIVES: Progressively zoom into specific components.
         Each subsequent figure should focus on a smaller, more specific aspect.
         Detail level: Increasing with each figure.

RULE: A reader viewing figures in order (1, 2, 3...) should experience a logical "drill-down" from whole system to specific details. Never show a detailed component before showing where it fits in the broader system.

═══════════════════════════════════════════════════════════════════════════════
COMPONENTS & LABELING
═══════════════════════════════════════════════════════════════════════════════
- Use ONLY these components and numerals: ${numeralsPreview}.
- Use labels with numerals exactly as assigned (e.g., "Processor 100", not just "Processor").
- Every component referenced must exist in the list above. NO UNDEFINED REFERENCES.
- Figure label format: ${figureLabelFormat}.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'MONOCHROME ONLY (no color)'}.
- Line style: ${lineStyle}.
- Reference numerals: ${refNumeralsMandatory ? 'MANDATORY in all drawings' : 'Optional'}.
- Minimum text size: ${minTextSize} pt.
${claimsContext ? `
═══════════════════════════════════════════════════════════════════════════════
CLAIM-AWARE DIAGRAM GENERATION
═══════════════════════════════════════════════════════════════════════════════
The following claims define the legal scope of this patent. Design figures that:
- Illustrate the method steps described in method claims
- Show the system architecture described in system/apparatus claims
- Highlight the key inventive features that distinguish this invention
${claimsContext}
` : ''}
═══════════════════════════════════════════════════════════════════════════════
PLANTUML SYNTAX RULES (ERRORS TO AVOID)
═══════════════════════════════════════════════════════════════════════════════
FORBIDDEN (will cause render failure):
✗ !theme, !include, !import, !pragma directives
✗ skinparam blocks or statements
✗ title, caption, header, footer inside the diagram
✗ Mixing [hidden] with directions (wrong: "-[hidden]down-", correct: "-[hidden]-" OR "-down-")
✗ Incomplete connections (wrong: "500 --", correct: "500 --> 600")
✗ Unclosed blocks (every "if" needs "endif", every "note" needs "end note")
✗ Multiple or nested @startuml/@enduml pairs (exactly ONE pair per diagram)
✗ Undefined aliases or dangling arrows

ALLOWED (only these style directives):
✓ scale max 1890x2917 (for A4 fit)
✓ newpage (for multi-page diagrams)

═══════════════════════════════════════════════════════════════════════════════
LAYOUT PRINCIPLES
═══════════════════════════════════════════════════════════════════════════════
- Use VERTICAL flow: Inputs (top) → Processing (middle) → Outputs (bottom).
- Group related nodes in frames/packages, listed top-to-bottom.
- Max 3 horizontal siblings per layer; overflow goes to lower layer.
- Prefer downward arrows; avoid long horizontal cross-edges.
- Page size: ${allowedPageSizes || 'A4/Letter safe defaults'}.
- If >12 components, split into multiple diagrams or use "newpage".

═══════════════════════════════════════════════════════════════════════════════
SELF-VALIDATION (DO THIS BEFORE RESPONDING)
═══════════════════════════════════════════════════════════════════════════════
Before outputting, mentally verify:
1. ✓ Figures are ordered broad→specific (zoom-in sequence)?
2. ✓ All referenced components exist in the provided list?
3. ✓ No forbidden directives (!theme, skinparam, title, etc.)?
4. ✓ All connections have both endpoints?
5. ✓ All blocks are properly closed?
6. ✓ Exactly one @startuml/@enduml pair per diagram?${claimsContext ? `
7. ✓ Diagrams illustrate the frozen claims where applicable?` : ''}

Output: JSON array only, no markdown fences, no explanations.`

      const res = await onComplete({
        action: 'generate_diagrams_llm',
        sessionId: session?.id,
        prompt,
        // In autopilot mode, we intentionally replace the existing figure set
        replaceExisting: true
      })

      if (!res || !Array.isArray(res.figures)) {
        throw new Error('LLM did not return valid figure list')
      }

      // Backend already saves figures with correct figure numbers (1, 2, 3... for replace mode)
      // No need to call handleSavePlantUML - it would be redundant

      setFigures([]) // Clear proposed figures since they're now automatically approved

      // Refresh to pull saved plans and sources immediately
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const runSingleRender = async (figureNo: number, plantumlCode: string) => {
    setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[0] }))
    setProcessingStep(prev => ({ ...prev, [figureNo]: 0 }))

    try {
      // Minimal delay for UI feedback
      await new Promise(resolve => setTimeout(resolve, 100))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[1] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 1 }))

      setRendering((prev) => ({ ...prev, [figureNo]: true }))
      setError(null)

      const resp = await fetch('/api/test/plantuml-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: plantumlCode,
          format: 'png',
          figureNo,
          patentId: patent?.id,
          sessionId: session?.id
        })
      })

      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}))
        throw new Error(info.error || 'Render failed')
      }

      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[2] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 2 }))

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setRenderPreview((prev) => ({ ...prev, [figureNo]: url }))

      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[3] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 3 }))

      setIsUploading(true)
      const filename = `figure_${figureNo}_${Date.now()}.png`
      const file = new File([blob], filename, { type: 'image/png' })
      await handleUploadImage(figureNo, file, filename)

      // Clear processing status
      setProcessingStatus(prev => ({ ...prev, [figureNo]: '' }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 0 }))

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      console.error(`Processing failed for figure ${figureNo}:`, errorMessage)
      setError(`Figure ${figureNo} processing failed: ${errorMessage}`)
      setProcessingStatus(prev => ({ ...prev, [figureNo]: `❌ Failed: ${errorMessage}` }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: -1 })) // Mark as failed
      // Clear from queued set so user can retry
      queuedForRenderRef.current.delete(figureNo)
    } finally {
      setRendering((prev) => ({ ...prev, [figureNo]: false }))
      setIsUploading(false)
    }
  }

  // Intelligent automatic diagram processing with serialized queue and reduced gap between requests
  const autoProcessDiagram = (figureNo: number, plantumlCode: string) => {
    renderQueueRef.current = renderQueueRef.current.then(async () => {
      // Reduced gap between render requests for better responsiveness
      await new Promise(resolve => setTimeout(resolve, 500))
      await runSingleRender(figureNo, plantumlCode)
    })
    return renderQueueRef.current
  }

  const handleUploadImage = async (figureNo: number, file: File, customFilename?: string) => {
    try {
      setIsUploading(true)
      setError(null)
      const form = new FormData()
      form.append('file', file)
      const uploadResp = await fetch(`/api/projects/${patent.project.id}/patents/${patent.id}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: form
      })
      if (!uploadResp.ok) {
        let message = 'Upload failed'
        try {
          const j = await uploadResp.json()
          if (j?.error) message = j.error
        } catch {}
        throw new Error(message)
      }
      const uploadedMeta = await uploadResp.json()
      // Use custom filename if provided, otherwise use the filename from response
      const filename = customFilename || uploadedMeta.filename
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, filename, checksum: uploadedMeta.checksum, imagePath: uploadedMeta.path })
      setUploaded((prev) => ({ ...prev, [figureNo]: true }))
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleViewImage = async (figureNo: number, filename?: string) => {
    if (!filename) return
    try {
      setIsViewing(prev => ({ ...prev, [figureNo]: true }))
      setError(null)
      const url = `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(filename)}`
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
      if (!resp.ok) throw new Error('Failed to load image')
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)
      window.open(blobUrl, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError('Unable to open image')
    } finally {
      setIsViewing(prev => ({ ...prev, [figureNo]: false }))
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <LayoutGrid className="w-6 h-6 text-indigo-600" />
            </div>
            Figure Planner
          </h2>
          <p className="text-gray-500 mt-2 text-lg">Design and generate intelligent patent diagrams.</p>
      </div>

      </div>

      {/* Main Tab Bar: Diagrams vs Sketches */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8" aria-label="Figure Planner Tabs">
          <button
            onClick={() => setActiveTab('diagrams')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'diagrams'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Code className="w-4 h-4" />
            Diagrams (PlantUML)
            {diagramSources.length > 0 && (
              <Badge variant="secondary" className="ml-1">{diagramSources.length}</Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sketches')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'sketches'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Pencil className="w-4 h-4" />
            Sketches (AI Generated)
            {sketches.length > 0 && (
              <Badge variant="secondary" className="ml-1">{sketches.length}</Badge>
            )}
          </button>
        </nav>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'diagrams' && (
        <>
          {/* Diagrams Mode Selector */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              onClick={() => setMode('ai')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'ai' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Bot className="w-4 h-4" />
              AI Autopilot
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                mode === 'manual' 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <User className="w-4 h-4" />
              Manual Control
            </button>
          </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Mode Selection Cards - Only show if no figures yet */}
      {figures.length === 0 && diagramSources.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            className="text-left"
            onClick={() => setMode('ai')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'ai' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                AI-Driven Generation
              </CardTitle>
              <CardDescription>
                Let our intelligent agent analyze your patent claims and description to automatically propose and generate the perfect set of figures.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Automatic figure count optimization</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Context-aware component labeling</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Standard patent diagram styles</li>
              </ul>
            </CardContent>
          </Card>
          </button>

          <button
            className="text-left"
            onClick={() => setMode('manual')}
          >
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${mode === 'manual' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-600" />
                Manual Specification
              </CardTitle>
              <CardDescription>
                You know your invention best. Define exactly how many figures you need and what each one should depict.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Custom figure counts</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Specific descriptions for each view</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Full control over the output</li>
              </ul>
            </CardContent>
          </Card>
          </button>
          </div>
      )}

      {/* Actions Area */}
      <AnimatePresence mode="wait">
        {mode === 'ai' ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="diagram-count" className="text-sm font-medium text-gray-700">
                  Number of Diagrams:
                </Label>
                <Input
                  id="diagram-count"
                  type="number"
                  min={1}
                  max={10}
                  value={diagramCount}
                  onChange={(e) => setDiagramCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                  className="w-20 text-center"
                  disabled={isGenerating}
                />
              </div>
            </div>
            <Button 
              size="lg"
              onClick={handleGenerateFromLLM}
              disabled={isGenerating}
              className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white gap-2 h-12 px-8 text-lg shadow-lg shadow-indigo-200"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing Patent Structure<AnimatedDots />
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Diagram Set
                </>
              )}
            </Button>
            {isGenerating && (
              <p className="text-sm text-gray-500 animate-pulse">
                Our AI is reading your specification and designing the optimal figure set...
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 bg-gray-50 p-6 rounded-xl border border-gray-200"
          >
            <div className="flex items-center gap-4 mb-4">
              <Label className="whitespace-nowrap">Number of Figures:</Label>
              <Input
                type="number"
                min={1}
                max={20}
                className="w-24 bg-white"
                value={overrideCount}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value || '0', 10))
                  setOverrideCount(n)
                  setOverrideInputs(Array.from({ length: n }, (_, i) => overrideInputs[i] || ''))
                }}
              />
            </div>

            <div className="flex items-center space-x-2 mb-4">
              <Checkbox
                id="include-existing"
                checked={includeExistingFigures}
                onCheckedChange={setIncludeExistingFigures}
              />
              <Label htmlFor="include-existing" className="text-sm text-gray-700">
                Tell AI about existing figures to avoid duplicates
              </Label>
            </div>
            
            <div className="space-y-4">
          {Array.from({ length: overrideCount }).map((_, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <Label className="mb-2 block text-xs uppercase text-gray-500 font-semibold">Figure {i + 1} Description</Label>
                  <Textarea 
                    placeholder="Describe what this figure should show..."
                    className="resize-none"
                    value={overrideInputs[i] || ''}
                    onChange={(e) => {
                const arr = [...overrideInputs]
                arr[i] = e.target.value
                setOverrideInputs(arr)
                    }}
                  />
                </motion.div>
          ))}
        </div>
            
            {overrideCount > 0 && (
              <Button 
                onClick={handleGenerateFromLLM}
                disabled={isGenerating}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700"
              >
                {isGenerating ? <>Generating<AnimatedDots /></> : `Generate ${overrideCount} Custom Figures`}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>


      {/* Saved Diagrams Grid */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-gray-600" />
            Project Diagrams
          </h3>
          <motion.div
            animate={showManual ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 0.5, repeat: showManual ? Infinity : 0, repeatDelay: 2 }}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={handleUploadToggle}
              className={showManual ? 'border-indigo-400 text-indigo-700' : ''}
            >
              {showManual ? 'Hide External Uploads' : 'Upload External Image'}
            </Button>
          </motion.div>
        </div>

        {diagramSources.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No diagrams created yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {diagramSources
              .sort((a: any, b: any) => a.figureNo - b.figureNo)
              .map((d: any) => (
              <Card key={d.figureNo} className="overflow-hidden hover:shadow-lg transition-all duration-300">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant={uploaded[d.figureNo] || d.imageUploadedAt ? 'default' : 'secondary'} className="shrink-0">
                      Fig. {d.figureNo}
                    </Badge>
                    <Badge variant="outline" className="text-xs text-gray-500">
                      {d.imageUploadedAt ? 'Rendered' : d.plantumlCode ? 'Code Ready' : 'Pending'}
                    </Badge>
                  </div>
                  {/* Caption (Title) - shown prominently */}
                  <CardTitle className="text-base font-semibold text-gray-900 mt-2 line-clamp-2">
                    {(() => {
                      const plan = figurePlans.find((f: any) => f.figureNo === d.figureNo)
                      const caption = plan?.title || `Figure ${d.figureNo}`
                      // Remove redundant "Fig. X" prefix from caption if present
                      return caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim() || caption
                    })()}
                  </CardTitle>
                </CardHeader>
                
                <CardContent className="p-0 relative bg-gray-100 min-h-[200px] flex items-center justify-center group">
                  {/* Preview Image */}
                  {(renderPreview[d.figureNo] || (d.imageFilename && !processingStatus[d.figureNo])) ? (
                    <>
                      <img 
                        src={(renderPreview[d.figureNo] as string) || `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(d.imageFilename)}`} 
                        alt={`Fig ${d.figureNo}`}
                        className="w-full h-64 object-contain bg-white"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setExpandedFigNo(d.figureNo)}>
                          <Eye className="w-4 h-4 mr-2" /> Expand
                        </Button>
                  </div>
                    </>
                  ) : (
                  <div className="flex flex-col items-center p-6 text-center">
                    {processingStatus[d.figureNo] ? (
                      <div className="space-y-3">
                        <div className="relative w-16 h-16 mx-auto">
                          <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                          <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
                          <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-indigo-500 animate-pulse" />
                        </div>
                        <p className="text-sm font-medium text-indigo-600 animate-pulse">
                          {processingStatus[d.figureNo]}
                        </p>
                        {processingStep[d.figureNo] === -1 && d.plantumlCode && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => {
                              // Clear states and re-queue for rendering
                              setProcessingStatus(prev => ({ ...prev, [d.figureNo]: '' }))
                              setProcessingStep(prev => ({ ...prev, [d.figureNo]: 0 }))
                              queuedForRenderRef.current.delete(d.figureNo) // Allow re-queueing
                              autoProcessDiagram(d.figureNo, d.plantumlCode)
                            }}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" /> Retry Render
                          </Button>
                        )}
                      </div>
                    ) : d.plantumlCode ? (
                      <div className="text-center">
                        <Code className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 mb-4">Code ready for processing</p>
                        <Button size="sm" onClick={() => {
                          queuedForRenderRef.current.delete(d.figureNo) // Ensure it can be queued
                          autoProcessDiagram(d.figureNo, d.plantumlCode)
                        }}>
                          <RefreshCw className="w-4 h-4 mr-2" /> Render Image
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No image data</p>
                    )}
                  </div>
                )}
                </CardContent>

                {/* Figure Caption & Description - Academic Style */}
                {(() => {
                  const plan = figurePlans.find((f: any) => f.figureNo === d.figureNo)
                  const caption = plan?.title || ''
                  const description = plan?.description || ''
                  // Clean caption: remove "Fig. X -" prefix if present
                  const cleanCaption = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
                  
                  // Only show this section if there's either a caption or description
                  if (!cleanCaption && !description) return null
                  
                  return (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
                      {/* Caption Line - for draft export (one line max) */}
                      {cleanCaption && (
                        <p className="text-sm font-medium text-gray-800 truncate" title={cleanCaption}>
                          <span className="text-indigo-600">Fig. {d.figureNo}:</span> {cleanCaption}
                        </p>
                      )}
                      {/* Description - detailed explanation */}
                      {description && (
                        <p className="text-xs text-gray-600 leading-relaxed text-justify">
                          <span className="font-medium text-gray-700">Description:</span> {description}
                        </p>
                      )}
                    </div>
                  )
                })()}

                <div className="p-3 bg-white border-t grid grid-cols-2 gap-2">
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => { setModifyFigNo(d.figureNo); setModifyTextSaved('') }}>
                    <Edit2 className="w-4 h-4 mr-2" /> Modify
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" 
                    onClick={async () => {
                      if(!confirm('Delete this figure?')) return
                      try {
                        await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: d.figureNo })
                        await onRefresh()
                      } catch (e) { setError('Failed to delete') }
                    }}>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                  
                  {d.plantumlCode && (
                    <div className="col-span-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full text-xs text-gray-500"
                          onClick={() => setShowPlantUML(prev => ({ ...prev, [d.figureNo]: !prev[d.figureNo] }))}
                        >
                          {showPlantUML[d.figureNo] ? 'Hide Source Code' : 'View Source Code'}
                        </Button>
                        {showPlantUML[d.figureNo] && (
                           <div className="mt-2 relative">
                             <Textarea 
                        readOnly
                        value={d.plantumlCode}
                               className="font-mono text-xs h-32 bg-gray-50"
                      />
                             <Button 
                               size="sm" 
                               variant="secondary"
                               className="absolute top-2 right-2 h-6 text-xs"
                        onClick={() => navigator.clipboard.writeText(d.plantumlCode)}
                      >
                        Copy
                             </Button>
                    </div>
                        )}
                  </div>
                )}

                  {/* Modification Panel */}
                {modifyFigNo === d.figureNo && (
                    <div className="col-span-2 mt-2 pt-2 border-t">
                      <Label className="text-xs mb-1 block">Describe changes:</Label>
                      <Textarea 
                        className="text-sm mb-2"
                        value={modifyTextSaved}
                        onChange={(e) => setModifyTextSaved(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={async () => {
                          try {
                            const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: d.figureNo, instructions: modifyTextSaved })
                            if (resp?.diagramSource?.plantumlCode) {
                              await onRefresh()
                              setModifyFigNo(null)
                              setModifyTextSaved('')
                            }
                           } catch (e) { setError('Failed to modify') }
                        }}>Apply</Button>
                        <Button size="sm" variant="outline" onClick={() => setModifyFigNo(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
                </div>
              </Card>
            ))}
                      </div>
                    )}
                      </div>

      {/* Manual Upload Section (Collapsible) */}
      <div ref={uploadSectionRef}>
        <AnimatePresence>
          {showManual && (
            <motion.div
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{
                opacity: 1,
                height: 'auto',
                scale: highlightUpload ? [1, 1.02, 1] : 1,
                boxShadow: highlightUpload
                  ? ['0 1px 3px 0 rgb(0 0 0 / 0.1)', '0 10px 25px -5px rgb(99 102 241 / 0.1)', '0 1px 3px 0 rgb(0 0 0 / 0.1)']
                  : '0 1px 3px 0 rgb(0 0 0 / 0.1)'
              }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{
                duration: highlightUpload ? 0.6 : 0.3,
                scale: {
                  repeat: highlightUpload ? 2 : 0,
                  duration: 0.2
                }
              }}
              className={`bg-white border border-gray-200 rounded-xl p-6 shadow-sm mt-6 ${highlightUpload ? 'ring-2 ring-indigo-400 ring-opacity-50' : ''}`}
            >
            <div className="mb-4">
              <h4 className="font-semibold flex items-center gap-2 mb-2">
                <Upload className="w-5 h-5 text-indigo-600" />
                Upload External Images
                {highlightUpload && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="inline-flex items-center px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-100 rounded-full"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Ready to upload!
                  </motion.span>
                )}
              </h4>
              <p className="text-sm text-gray-600">
                Upload your own patent diagrams or images. Each image needs a detailed description (minimum 20 words)
                so our AI can understand and integrate it into your patent specification.
              </p>
                      </div>
            
            <div className="flex gap-4 mb-6">
              <Input 
                type="number" 
                min={1} 
                className="w-24"
                value={manualCount}
                onChange={(e) => { 
                  const n = Math.max(0, parseInt(e.target.value || '0', 10)); 
                  setManualCount(n); 
                  setManualInputs(Array.from({ length: n }, (_, i) => manualInputs[i] || { title: '', description: '' })); 
                  setManualFiles(Array.from({ length: n }, (_, i) => manualFiles[i] || null)); 
                }} 
              />
              <Button onClick={async () => {
                // Bulk add slots logic
              try {
                for (let i = 0; i < manualCount; i++) {
                  const item = manualInputs[i]
                  if (!item || !item.description || item.description.trim().split(/\s+/).length < 20) {
                    setError('Each image needs at least 20 words description')
                    return
                  }
                }
                for (let i = 0; i < manualCount; i++) {
                  const item = manualInputs[i]
                            const resp = await onComplete({ action: 'create_manual_figure', sessionId: session?.id, title: sanitizeFigureLabel(item.title) || item.title, description: item.description })
                  const createdNo = resp?.created?.figureNo
                  if (createdNo && manualFiles[i]) {
                    await handleUploadImage(createdNo, manualFiles[i] as File)
                  }
                }
                setManualCount(0)
                setManualInputs([])
                setManualFiles([])
                await onRefresh()
                } catch (e) { setError('Failed to create manual figures') }
              }}>
                Add {manualCount} Upload Slots
              </Button>
        </div>

            <div className="space-y-4">
        {Array.from({ length: manualCount }).map((_, i) => (
                <div key={i} className="border rounded-lg p-4 bg-gray-50">
                  <div className="grid gap-4">
                    <Input 
                      placeholder="Figure Title (Optional)" 
                      value={manualInputs[i]?.title || ''} 
                      onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), title: e.target.value }; setManualInputs(arr) }} 
                    />
                    <div>
                      <Label className="text-xs text-gray-500 mb-1">Description (min 20 words)</Label>
                      <Textarea 
                        placeholder="Describe the image content..."
                        value={manualInputs[i]?.description || ''} 
                        onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), description: e.target.value }; setManualInputs(arr) }} 
                      />
                       <div className="text-xs mt-1 text-right">
              <span className={countWords(manualInputs[i]?.description || '') >= 20 ? 'text-green-600' : 'text-gray-500'}>
                {countWords(manualInputs[i]?.description || '')} / 20 words
              </span>
            </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Input 
                        type="file" 
                        accept=".png,.svg" 
                        className="bg-white"
                        onChange={(e) => { const arr = [...manualFiles]; arr[i] = e.target.files?.[0] || null; setManualFiles(arr) }} 
                      />
                      {manualFiles[i] && countWords(manualInputs[i]?.description || '') >= 20 && (
                         <Badge variant="default" className="bg-green-500">Ready</Badge>
                      )}
                    </div>
        </div>
          </div>
        ))}
      </div>
          </motion.div>
      )}
      </AnimatePresence>
      </div>

      {/* Expanded Image Modal */}
      <AnimatePresence>
        {(() => {
          const diagramSource = diagramSources.find((d: any) => d.figureNo === expandedFigNo)
          const hasImage = expandedFigNo && (renderPreview[expandedFigNo] || (diagramSource?.imageFilename && !processingStatus[expandedFigNo]))

          return hasImage ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setExpandedFigNo(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30,
                duration: 0.3
              }}
              className="bg-white rounded-xl shadow-2xl p-2 max-w-6xl w-full max-h-[90vh] flex flex-col will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h4 className="text-lg font-semibold text-gray-900">Figure {expandedFigNo} Preview</h4>
                <Button variant="ghost" size="icon" onClick={() => setExpandedFigNo(null)}>
                  <span className="sr-only">Close</span>
                  <span className="text-2xl">&times;</span>
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center">
                <motion.img
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                  src={renderPreview[expandedFigNo] || `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(diagramSource?.imageFilename || '')}`}
                  alt={`Preview Fig.${expandedFigNo}`}
                  className="max-w-full h-auto shadow-lg"
                  style={{ willChange: 'transform, opacity' }}
                />
              </div>
              <div className="p-4 border-t flex justify-end gap-3">
                <Button variant="outline" onClick={() => setExpandedFigNo(null)}>Close</Button>
                {/* Approval is now automatic - this button removed */}
              </div>
            </motion.div>
          </motion.div>
        ) : null
      })()}
      </AnimatePresence>
        </>
      )}

      {/* SKETCHES TAB CONTENT */}
      {activeTab === 'sketches' && (
        <div className="space-y-6">
          {/* Sketch Error Alert */}
          {sketchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{sketchError}</AlertDescription>
            </Alert>
          )}

          {/* Sketch Generation Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                Generate Patent Sketch
              </CardTitle>
              <CardDescription>
                Create patent-style black-and-white line art sketches from your invention context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Selector */}
              <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg w-fit">
                <button
                  onClick={() => setSketchMode('auto')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'auto'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Auto Generate
                </button>
                <button
                  onClick={() => setSketchMode('guided')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'guided'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Edit2 className="w-4 h-4" />
                  With Instructions
                </button>
                <button
                  onClick={() => setSketchMode('refine')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                    sketchMode === 'refine'
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Refine Upload
                </button>
              </div>

              {/* Mode-specific inputs */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="sketch-title">Title (Optional)</Label>
                  <Input
                    id="sketch-title"
                    placeholder="e.g., System Block Diagram"
                    value={sketchTitle}
                    onChange={(e) => setSketchTitle(e.target.value)}
                    disabled={sketchGenerating}
                  />
                </div>

                {sketchMode !== 'auto' && (
                  <div>
                    <Label htmlFor="sketch-prompt">
                      {sketchMode === 'guided' ? 'Instructions' : 'Refinement Instructions (Optional)'}
                    </Label>
                    <Textarea
                      id="sketch-prompt"
                      placeholder={
                        sketchMode === 'guided'
                          ? "Describe what the sketch should show, layout preferences, focus areas..."
                          : "Optional: Specify how to refine the uploaded sketch..."
                      }
                      value={sketchPrompt}
                      onChange={(e) => setSketchPrompt(e.target.value)}
                      disabled={sketchGenerating}
                      rows={3}
                    />
                  </div>
                )}

                {sketchMode === 'refine' && (
                  <div className="space-y-2">
                    <Label>Upload Your Sketch</Label>
                    <input
                      ref={sketchFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={handleSketchFileChange}
                      className="hidden"
                    />
                    <div
                      onClick={() => sketchFileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                        sketchUploadPreview
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
                      }`}
                    >
                      {sketchUploadPreview ? (
                        <div className="space-y-2">
                          <img
                            src={sketchUploadPreview}
                            alt="Upload preview"
                            className="max-h-32 mx-auto rounded"
                          />
                          <p className="text-sm text-green-600">{sketchUploadFile?.name}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSketchUploadFile(null)
                              setSketchUploadPreview(null)
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-8 h-8 mx-auto text-gray-400" />
                          <p className="text-sm text-gray-500">Click to upload a sketch</p>
                          <p className="text-xs text-gray-400">PNG, JPEG, WebP up to 10MB</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={handleGenerateSketch}
                disabled={sketchGenerating || (sketchMode === 'refine' && !sketchUploadFile)}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
              >
                {sketchGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Sketch...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    {sketchMode === 'auto' && 'Generate from Context'}
                    {sketchMode === 'guided' && 'Generate with Instructions'}
                    {sketchMode === 'refine' && 'Refine Uploaded Sketch'}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Sketch Suggestions Section - shown first if there are suggestions from diagram generation */}
          {(() => {
            const suggestions = sketches.filter(s => s.status === 'SUGGESTED')
            if (suggestions.length === 0) return null
            
            return (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    AI-Suggested Sketches
                    <Badge variant="secondary" className="ml-2">{suggestions.length}</Badge>
                  </h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  These sketch ideas were generated alongside your diagrams. Click &quot;Generate Image&quot; to create the actual sketch.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {suggestions.map((suggestion) => (
                    <motion.div
                      key={suggestion.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group"
                    >
                      <Card className="overflow-hidden transition-shadow hover:shadow-lg border-amber-200 bg-amber-50/50">
                        <div className="relative aspect-[4/3] bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center p-4">
                          {generatingSuggestionId === suggestion.id ? (
                            <div className="flex flex-col items-center">
                              <Loader2 className="w-10 h-10 animate-spin text-amber-600 mb-2" />
                              <p className="text-sm text-amber-700">Generating sketch...</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <Wand2 className="w-12 h-12 mx-auto text-amber-400 mb-3" />
                              <p className="text-xs text-amber-600 uppercase tracking-wide font-medium">Suggested Sketch</p>
                            </div>
                          )}
                        </div>
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-gray-900 text-sm mb-2">{suggestion.title}</h4>
                          {suggestion.description && (
                            <p className="text-xs text-gray-600 mb-3 line-clamp-3">
                              {suggestion.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                              onClick={() => handleGenerateFromSuggestion(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              {generatingSuggestionId === suggestion.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Generating...
                                </>
                              ) : (
                                <>
                                  <Wand2 className="w-3 h-3 mr-1" />
                                  Generate Image
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleDeleteSketch(suggestion.id)}
                              disabled={generatingSuggestionId !== null}
                            >
                              <Trash2 className="w-4 h-4 text-gray-400" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Generated Sketches Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Grid3X3 className="w-5 h-5" />
                Generated Sketches
              </h3>
              <Button variant="outline" size="sm" onClick={loadSketches} disabled={sketchesLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${sketchesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {sketchesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              </div>
            ) : sketches.filter(s => s.status !== 'SUGGESTED').length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Pencil className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">No generated sketches yet</h4>
                  <p className="text-gray-500 mb-4">
                    {sketches.some(s => s.status === 'SUGGESTED') 
                      ? 'Generate sketches from the suggestions above, or create a new one using the controls.'
                      : 'Generate your first patent-style sketch using the controls above.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sketches.filter(s => s.status !== 'SUGGESTED').map((sketch) => (
                  <motion.div
                    key={sketch.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="group"
                  >
                    <Card className={`overflow-hidden transition-shadow hover:shadow-lg ${
                      sketch.status === 'FAILED' ? 'border-red-200' : ''
                    }`}>
                      {/* Image Preview */}
                      <div
                        className="relative aspect-square bg-gray-100 cursor-pointer"
                        onClick={() => sketch.imagePath && setExpandedSketchId(sketch.id)}
                      >
                        {sketch.status === 'PENDING' ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                          </div>
                        ) : sketch.status === 'FAILED' ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                            <p className="text-sm text-red-600 text-center">{sketch.errorMessage || 'Generation failed'}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetrySketch(sketch.id)
                              }}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry
                            </Button>
                          </div>
                        ) : sketch.imagePath ? (
                          <img
                            src={sketch.imagePath}
                            alt={sketch.title}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-gray-300" />
                          </div>
                        )}

                        {/* Hover overlay */}
                        {sketch.imagePath && sketch.status === 'SUCCESS' && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="sm" variant="secondary">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </div>
                        )}

                        {/* Favorite badge */}
                        {sketch.isFavorite && (
                          <div className="absolute top-2 right-2">
                            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                          </div>
                        )}

                        {/* Mode badge */}
                        <div className="absolute top-2 left-2">
                          <Badge variant="secondary" className="text-xs">
                            {sketch.mode}
                          </Badge>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <CardContent className="p-3">
                        <h4 className="font-medium text-gray-900 truncate text-sm">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2" title={sketch.description}>
                            {sketch.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(sketch.createdAt).toLocaleDateString()}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center gap-1 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => handleToggleFavorite(sketch.id)}
                          >
                            {sketch.isFavorite ? (
                              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                            ) : (
                              <StarOff className="w-4 h-4 text-gray-400" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              setModifyingSketchId(sketch.id)
                              setModifySketchPrompt('')
                            }}
                            disabled={sketch.status !== 'SUCCESS'}
                          >
                            <Edit2 className="w-4 h-4 text-gray-400" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => handleDeleteSketch(sketch.id)}
                          >
                            <Trash2 className="w-4 h-4 text-gray-400" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Sketch Expanded Modal */}
          <AnimatePresence>
            {expandedSketchId && (() => {
              const sketch = sketches.find(s => s.id === expandedSketchId)
              if (!sketch?.imagePath) return null

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setExpandedSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-2 max-w-4xl w-full max-h-[90vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 border-b">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">{sketch.title}</h4>
                        {sketch.description && (
                          <p className="text-sm text-gray-600 mt-1 max-w-xl">{sketch.description}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setExpandedSketchId(null)}>
                        <span className="text-2xl">&times;</span>
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center">
                      <img
                        src={sketch.imagePath}
                        alt={sketch.title}
                        className="max-w-full h-auto shadow-lg"
                      />
                    </div>
                    <div className="p-4 border-t flex justify-between items-center">
                      <div className="text-sm text-gray-500">
                        Mode: {sketch.mode} • Created: {new Date(sketch.createdAt).toLocaleString()}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setExpandedSketchId(null)
                            setModifyingSketchId(sketch.id)
                          }}
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Modify
                        </Button>
                        <Button variant="outline" onClick={() => setExpandedSketchId(null)}>
                          Close
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>

          {/* Modify Sketch Modal */}
          <AnimatePresence>
            {modifyingSketchId && (() => {
              const sketch = sketches.find(s => s.id === modifyingSketchId)
              if (!sketch) return null

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                  onClick={() => setModifyingSketchId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Modify Sketch</h4>
                    <p className="text-sm text-gray-500 mb-4">
                      Describe the changes you want to make to "{sketch.title}"
                    </p>
                    
                    {sketch.imagePath && (
                      <div className="mb-4 p-2 bg-gray-100 rounded">
                        <img
                          src={sketch.imagePath}
                          alt={sketch.title}
                          className="max-h-32 mx-auto"
                        />
                      </div>
                    )}

                    <Textarea
                      placeholder="e.g., Add more detail to the control module, rotate the layout 90 degrees..."
                      value={modifySketchPrompt}
                      onChange={(e) => setModifySketchPrompt(e.target.value)}
                      rows={3}
                      disabled={sketchGenerating}
                    />

                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="outline"
                        onClick={() => setModifyingSketchId(null)}
                        disabled={sketchGenerating}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => handleModifySketch(sketch.id)}
                        disabled={sketchGenerating || !modifySketchPrompt.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        {sketchGenerating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Modifying...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 mr-2" />
                            Create Modified Sketch
                          </>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                </motion.div>
              )
            })()}
          </AnimatePresence>
        </div>
      )}
      
      <div className="hidden">
        {/* Helper for preserving existing logic not explicitly in UI but needed for compilation if any */}
      </div>
    </motion.div>
  )
}
