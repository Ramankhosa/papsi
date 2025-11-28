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
  LayoutGrid
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'

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
        }
      } catch (e) {
        console.warn('Failed to load country profile for figures', e)
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

  // Automatically process diagrams when PlantUML code is available
  useEffect(() => {
    if (!stateInitialized) return

    diagramSources.forEach((d: any) => {
      if (d.plantumlCode && !uploaded[d.figureNo] && !d.imageUploadedAt && !rendering[d.figureNo] && !processingStatus[d.figureNo]) {
        autoProcessDiagram(d.figureNo, d.plantumlCode)
      }
    })
  }, [diagramSources, uploaded, rendering, processingStatus, stateInitialized])

  // Initialize state for new figures when diagramSources changes
  useEffect(() => {
    const newFigureNos = diagramSources.map((d: any) => d.figureNo)
    setUploaded((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) updated[no] = false
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

        // Create a custom prompt that incorporates the user-provided instructions
        const customPrompt = `You are generating PlantUML diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
Return a JSON array of ${overrideList.length} custom diagrams based on the user's specific instructions.
Each item must be: {"title":"Fig.X - descriptive title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"}.

User-provided instructions for each figure:
${overrideList.map((instruction, index) => `Fig.${index + 1}: ${instruction}`).join('\n')}

Strict content & labeling:
- Use only components and numerals: ${numeralsPreview}.
- Use labels with numerals exactly as assigned (e.g., C100). Avoid undefined references.
- Do NOT include !theme, !include, !import, skinparam, captions, figure numbers, or titles inside the PlantUML code.
- Figure label format: ${figureLabelFormat}. Use this for titles and any in-figure references.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'monochrome only (no color)'}; line style: ${lineStyle}.
- Reference numerals in drawings: ${refNumeralsMandatory ? 'MANDATORY' : 'Optional'}. Text size at least ${minTextSize} pt.
- Page size guidance (if applicable): ${allowedPageSizes || 'A4/Letter safe defaults'}.

Vertical layout policy (avoid horizontal sprawl):
- Think and draw in vertical LAYERS: Inputs (top) → Core Processing (middle) → Outputs (bottom).
- Group related nodes in frames/packages and LIST them in top-to-bottom order inside the group.
- Limit horizontal fan-out per layer to ≤ 3 siblings; overflow goes to a LOWER layer.
- Prefer downward arrows and avoid long horizontal cross-edges. If needed, re-insert relay nodes in the lower layer.

PNG/A4 export safety (exception rules):
- To keep PNG crisp on A4, you MAY use only these two rendering directives:
  1) scale max 1890x2917  (fits an A4 page at ~25 mm margins, 300 DPI)
  2) newpage               (start a second page if needed)
- Do NOT use any other style directives.

Code quality:
- Keep code minimal and syntactically valid PlantUML.
- No undefined aliases. No dangling arrows. Avoid duplicate edges.

Output: JSON only, no markdown fences.`

        const resp = await onComplete({
          action: 'generate_diagrams_llm',
          sessionId: session?.id,
          prompt: customPrompt
        })
        if (!resp) throw new Error('LLM did not return valid figure list')

        // Show the generated figures as proposed, similar to AI mode
        if (resp.figures && Array.isArray(resp.figures)) {
          setFigures(resp.figures.map((fig: LLMFigure, index: number) => ({
            ...fig,
            title: sanitizeFigureLabel(fig.title) || `Figure ${index + 1}`,
            purpose: overrideList[index] || fig.purpose || 'Custom figure based on your specifications'
          })))
        }

        setOverrideCount(0)
        setOverrideInputs([])
        await onRefresh()
        return
      }

      // Build concise context to nudge LLM
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

      const prompt = `You are generating PlantUML diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
Return a JSON array of ${diagramCount} simple, standard patent-style diagrams (no fancy rendering).
Each item must be: {"title":"Fig.X - title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"}.

Strict content & labeling:
- Use only components and numerals: ${numeralsPreview}.
- Use labels with numerals exactly as assigned (e.g., C100). Avoid undefined references.
- Do NOT include !theme, !include, !import, skinparam, captions, figure numbers, or titles inside the PlantUML code.
- Figure label format: ${figureLabelFormat}. Use this for titles and any in-figure references.
- Color policy: ${colorAllowed ? 'color permitted if essential' : 'monochrome only (no color)'}; line style: ${lineStyle}.
- Reference numerals in drawings: ${refNumeralsMandatory ? 'MANDATORY' : 'Optional'}. Text size at least ${minTextSize} pt.
- Page size guidance (if applicable): ${allowedPageSizes || 'A4/Letter safe defaults'}.

Diagram selection (prefer in this order):
- Fig.1: high-level block diagram (root modules).
- Fig.2: data/control flow across modules.
- Fig.3: internal view of a selected module. (Timing only if very short.)

Vertical layout policy (avoid horizontal sprawl):
- Think and draw in vertical LAYERS: Inputs (top) → Core Processing (middle) → Outputs (bottom).
- Group related nodes in frames/packages and LIST them in top-to-bottom order inside the group.
- Limit horizontal fan-out per layer to ≤ 3 siblings; overflow goes to a LOWER layer.
- Prefer downward arrows and avoid long horizontal cross-edges. If needed, re-insert relay nodes in the lower layer.

PNG/A4 export safety (exception rules):
- To keep PNG crisp on A4, you MAY use only these two rendering directives:
  1) scale max 1890x2917  (fits an A4 page at ~25 mm margins, 300 DPI)
  2) newpage               (start a second page if needed)
- Do NOT use any other style directives.

Complexity / pagination:
- If components > 12 OR horizontal width would exceed ~3 vertical stacks, split into multiple diagrams OR use "newpage" inside a single figure.
- Keep each diagram self-contained and legible without shrinking fonts.

Code quality:
- Keep code minimal and syntactically valid PlantUML.
- No undefined aliases. No dangling arrows. Avoid duplicate edges.

Output: JSON only, no markdown fences.`

      const res = await onComplete({
        action: 'generate_diagrams_llm',
        sessionId: session?.id,
        prompt
      })

      if (!res || !Array.isArray(res.figures)) {
        throw new Error('LLM did not return valid figure list')
      }

      setFigures(res.figures.map((fig: LLMFigure) => ({
        ...fig,
        title: sanitizeFigureLabel(fig.title) || fig.title
      })))
      // Refresh to pull saved plans and sources immediately
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSavePlantUML = async (figure: LLMFigure, index: number) => {
    try {
      const resp = await onComplete({
        action: 'save_plantuml',
        sessionId: session?.id,
        figureNo: index + 1,
        title: sanitizeFigureLabel(figure.title) || figure.title,
        plantumlCode: figure.plantuml,
        description: figure.purpose // Save the description/caption
      })

      if (resp?.diagramSource) {
        // ok
      }
    } catch (e) {
      setError('Failed to save PlantUML')
    }
  }

  // Intelligent automatic diagram processing
  const autoProcessDiagram = async (figureNo: number, plantumlCode: string) => {
    setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[0] }))
    setProcessingStep(prev => ({ ...prev, [figureNo]: 0 }))

    try {
      // Step 1: Analysis phase
      await new Promise(resolve => setTimeout(resolve, 800))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[1] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 1 }))

      // Step 2: Rendering phase
      await new Promise(resolve => setTimeout(resolve, 600))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[2] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 2 }))

      setRendering((prev) => ({ ...prev, [figureNo]: true }))
      setError(null)

      const resp = await fetch('/api/test/plantuml-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: plantumlCode, format: 'png' })
      })

      if (!resp.ok) {
        const info = await resp.json().catch(() => ({}))
        throw new Error(info.error || 'Render failed')
      }

      // Step 3: Validation phase
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[3] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 3 }))

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      setRenderPreview((prev) => ({ ...prev, [figureNo]: url }))

      // Step 4: Quality assurance
      await new Promise(resolve => setTimeout(resolve, 400))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[4] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 4 }))

      // Step 5: Final processing
      await new Promise(resolve => setTimeout(resolve, 500))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[5] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 5 }))

      // Step 6: Save automatically
      await new Promise(resolve => setTimeout(resolve, 300))
      setProcessingStatus(prev => ({ ...prev, [figureNo]: intelligentMessages[6] }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 6 }))

      setIsUploading(true)
      const file = new File([blob], `figure-${figureNo}.png`, { type: 'image/png' })
      await handleUploadImage(figureNo, file)

      // Clear processing status
      setProcessingStatus(prev => ({ ...prev, [figureNo]: '' }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: 0 }))

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      console.error(`Processing failed for figure ${figureNo}:`, errorMessage)
      setError(`Figure ${figureNo} processing failed: ${errorMessage}`)
      setProcessingStatus(prev => ({ ...prev, [figureNo]: `❌ Failed: ${errorMessage}` }))
      setProcessingStep(prev => ({ ...prev, [figureNo]: -1 })) // Mark as failed
    } finally {
      setRendering((prev) => ({ ...prev, [figureNo]: false }))
      setIsUploading(false)
    }
  }

  const handleUploadImage = async (figureNo: number, file: File) => {
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
      await onComplete({ action: 'upload_diagram', sessionId: session?.id, figureNo, filename: uploadedMeta.filename, checksum: uploadedMeta.checksum, imagePath: uploadedMeta.path })
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

        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
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
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Mode Selection Cards - Only show if no figures yet */}
      {figures.length === 0 && diagramSources.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${mode === 'ai' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            onClick={() => setMode('ai')}
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

          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${mode === 'manual' ? 'ring-2 ring-indigo-600 border-indigo-100 bg-indigo-50/30' : ''}`}
            onClick={() => setMode('manual')}
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

      {/* Generated Figures List */}
      {figures.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
               <Zap className="w-5 h-5 text-yellow-500" />
               Proposed Figures
             </h3>
             <Button variant="outline" size="sm" onClick={() => setFigures([])}>Clear Proposals</Button>
          </div>
          <div className="grid grid-cols-1 gap-6">
          {figures.map((f, i) => (
              <Card key={i} className="overflow-hidden border-indigo-100 shadow-sm hover:shadow-md transition-all">
                <CardHeader className="bg-indigo-50/30 border-b border-indigo-50">
                  <div className="flex items-start justify-between">
          <div>
                      <CardTitle className="text-base font-semibold text-indigo-900">{f.title || `Fig.${i + 1}`}</CardTitle>
                      <CardDescription className="mt-1">{f.purpose}</CardDescription>
                </div>
                    <Badge variant="outline" className="bg-white text-indigo-600 border-indigo-200">Proposed</Badge>
                </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 p-3 rounded-md border border-gray-100">
                    <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span>PlantUML code generated and ready for rendering.</span>
              </div>
                  
              {modifyIdx === i && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-4 pt-4 border-t"
                    >
                      <Label className="mb-2 block">Refinement Instructions</Label>
                      <Textarea 
                        value={modifyText}
                        onChange={(e) => setModifyText(e.target.value)}
                        placeholder="E.g., Make the arrow from A to B dashed..."
                        className="mb-2"
                      />
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                      onClick={async () => {
                        try {
                          const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: i + 1, instructions: modifyText })
                          if (resp?.diagramSource?.plantumlCode) {
                            const updated = [...figures]
                            updated[i] = { ...updated[i], plantuml: resp.diagramSource.plantumlCode }
                            setFigures(updated)
                            setModifyIdx(null)
                            setModifyText('')
                            await onRefresh()
                          }
                        } catch (e) {
                          setError('Failed to modify diagram')
                        }
                      }}
                    >
                      Apply Changes
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setModifyIdx(null); setModifyText('') }}>Cancel</Button>
          </div>
                    </motion.div>
                  )}
                </CardContent>
                <div className="bg-gray-50/50 flex items-center justify-end gap-2 p-4">
                  <Button variant="outline" size="sm" onClick={() => { setModifyIdx(i); setModifyText('') }}>
                    <Edit2 className="w-4 h-4 mr-2" />
                    Modify
                  </Button>
                  <Button onClick={() => handleSavePlantUML(f, i)} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                    <Check className="w-4 h-4 mr-2" />
                    Approve & Save
                  </Button>
            </div>
              </Card>
          ))}
          </div>
      </div>
      )}

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
                    <CardTitle className="text-base font-medium">
                      {figurePlans.find((f: any) => f.figureNo === d.figureNo)?.title || `Figure ${d.figureNo}`}
                    </CardTitle>
                    <Badge variant={uploaded[d.figureNo] || d.imageUploadedAt ? 'default' : 'secondary'}>
                      Fig {d.figureNo}
                    </Badge>
                      </div>
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
                           <p className="text-sm font-medium text-indigo-600 animate-pulse">{processingStatus[d.figureNo]}</p>
                </div>
                      ) : d.plantumlCode ? (
                        <div className="text-center">
                           <Code className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                           <p className="text-sm text-gray-500 mb-4">Code ready for processing</p>
                           <Button size="sm" onClick={() => autoProcessDiagram(d.figureNo, d.plantumlCode)}>
                             <RefreshCw className="w-4 h-4 mr-2" /> Render Image
                           </Button>
                </div>
                      ) : (
                        <p className="text-sm text-gray-400">No image data</p>
                      )}
                  </div>
                )}
                </CardContent>

                {/* Figure Caption - Academic Style */}
                {(() => {
                  const description = figurePlans.find((f: any) => f.figureNo === d.figureNo)?.description
                  return description ? (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                      <p className="text-sm text-gray-700 leading-relaxed text-justify">
                        <strong className="font-medium">Figure {d.figureNo}:</strong> {description}
                      </p>
                    </div>
                  ) : null
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
          const diagramSource = diagramSources.find(d => d.figureNo === expandedFigNo)
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
                {!diagramSource?.imageUploadedAt && (
                  <Button onClick={async () => {
                  try {
                    setIsUploading(true)
                      const imageSrc = renderPreview[expandedFigNo!] || `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(diagramSource?.imageFilename || '')}`
                      const res = await fetch(imageSrc)
                    const blob = await res.blob()
                    const file = new File([blob], `figure-${expandedFigNo}.png`, { type: 'image/png' })
                    await handleUploadImage(expandedFigNo!, file)
                    setExpandedFigNo(null)
                  } catch (e) {
                    setError('Approve failed')
                  } finally {
                    setIsUploading(false)
                  }
                  }}>Approve & Save to Project</Button>
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null
      })()}
      </AnimatePresence>
      
      <div className="hidden">
        {/* Helper for preserving existing logic not explicitly in UI but needed for compilation if any */}
      </div>
    </motion.div>
  )
}

  const normalizePageSizes = (input: any): string[] => {
    if (!input) return []
  if (Array.isArray(input)) return input.flatMap((val) => normalizePageSizes(val))
    if (typeof input === 'string') {
      const trimmed = input.trim()
      return trimmed ? [trimmed] : []
    }
  if (typeof input === 'object') return Object.values(input).flatMap((val) => normalizePageSizes(val))
    return []
  }
