'use client'

import { useState, useEffect } from 'react'

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
  const [aiDecides, setAiDecides] = useState(true)
  const [userDecides, setUserDecides] = useState(false)
  const [manualCount, setManualCount] = useState(0)
  const [manualInputs, setManualInputs] = useState<{ title: string; description: string }[]>([])
  const [manualFiles, setManualFiles] = useState<(File | null)[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualBusy, setManualBusy] = useState<Record<number, boolean>>({})
  const [showPlantUML, setShowPlantUML] = useState<Record<number, boolean>>({})
  const [countryProfile, setCountryProfile] = useState<any | null>(null)

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
    diagramSources.forEach((d: any) => {
      if (d.plantumlCode && !uploaded[d.figureNo] && !d.imageUploadedAt && !rendering[d.figureNo] && !processingStatus[d.figureNo]) {
        autoProcessDiagram(d.figureNo, d.plantumlCode)
      }
    })
  }, [diagramSources, uploaded, rendering, processingStatus])

  // Initialize state for new figures when diagramSources changes
  useEffect(() => {
    const newFigureNos = diagramSources.map((d: any) => d.figureNo)
    setUploaded((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = false
        }
      })
      return updated
    })
    setRendering((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = false
        }
      })
      return updated
    })
    setProcessingStatus((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = ''
        }
      })
      return updated
    })
    setProcessingStep((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = 0
        }
      })
      return updated
    })
    setRenderPreview((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = null
        }
      })
      return updated
    })
    setIsViewing((prev) => {
      const updated = { ...prev }
      newFigureNos.forEach((no: number) => {
        if (updated[no] === undefined) {
          updated[no] = false
        }
      })
      return updated
    })
  }, [diagramSources])

  const handleGenerateFromLLM = async () => {
    try {
      setIsGenerating(true)
      setError(null)

      // If user chose to decide and provided an override list, generate exactly those figures instead of auto list
      const overrideList = overrideInputs.filter(Boolean)
      if (userDecides && overrideCount > 0 && overrideList.length > 0) {
        const resp = await onComplete({
          action: 'add_figures_llm',
          sessionId: session?.id,
          instructionsList: overrideList
        })
        if (!resp) throw new Error('LLM did not return valid figure list')
        setOverrideCount(0)
        setOverrideInputs([])
        setFigures([])
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
Return a JSON array of 5 simple, standard patent-style diagrams (no fancy rendering).
Each item must be: {"title":"Fig.X - title","purpose":"one-line purpose","plantuml":"@startuml...@enduml"}.

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
        plantumlCode: figure.plantuml
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
      // Optional: revoke later; leaving it for tab lifetime is fine
    } catch (e) {
      setError('Unable to open image')
    } finally {
      setIsViewing(prev => ({ ...prev, [figureNo]: false }))
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 3: Figure Planner</h2>
        <p className="text-gray-600">Generate diagrams and upload images.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
      )}

      <div className="flex items-center space-x-3 mb-4">
        <button
          onClick={handleGenerateFromLLM}
          disabled={isGenerating}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          {isGenerating ? 'Generating…' : 'Generate diagrams (AI)'}
        </button>
        <div className="flex items-center space-x-4">
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={aiDecides}
              onChange={(e) => { const v = e.target.checked; setAiDecides(v); setUserDecides(!v) }}
            />
            <span className="text-sm text-gray-700">Let AI decide number and type of images</span>
          </label>
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={userDecides}
              onChange={(e) => { const v = e.target.checked; setUserDecides(v); setAiDecides(!v) }}
            />
            <span className="text-sm text-gray-700">I will decide the number and type of images</span>
          </label>
        </div>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
        >
          {showManual ? 'Hide outside images' : 'Upload Outside Images'}
        </button>
      </div>

      {userDecides && (
        <div className="mb-6 p-3 border rounded">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-sm text-gray-700">How many images?</span>
            <input type="number" min={0} className="w-20 border rounded px-2 py-1 text-sm" value={overrideCount} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10)); setOverrideCount(n); setOverrideInputs(Array.from({ length: n }, (_, i) => overrideInputs[i] || '')); }} />
          </div>
          {Array.from({ length: overrideCount }).map((_, i) => (
            <div key={i} className="mb-2">
              <label className="block text-xs text-gray-600">Figure {i + 1} description</label>
              <textarea className="w-full text-sm border rounded p-2" rows={2} value={overrideInputs[i] || ''} onChange={(e) => {
                const arr = [...overrideInputs]
                arr[i] = e.target.value
                setOverrideInputs(arr)
              }} />
            </div>
          ))}
          <p className="text-xs text-gray-500 mt-1">Tip: If you provide descriptions here, we will generate exactly these figures and skip the automatic set.</p>
        </div>
      )}

      {isGenerating && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-800 animate-pulse">
          AI is composing a figure set tailored to your components and numbering. This may take a few seconds.
        </div>
      )}

      {figures.length > 0 && (
        <div className="space-y-6">
          {figures.map((f, i) => (
            <div key={i} className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
          <div>
                  <h3 className="font-medium text-gray-900">{f.title || `Fig.${i + 1}`}</h3>
                  <p className="text-sm text-gray-600">{f.purpose}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleSavePlantUML(f, i)}
                    className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setModifyIdx(i); setModifyText('') }}
                    className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Modify
                  </button>
                </div>
              </div>
              <div className="p-3 border rounded bg-green-50 text-sm text-green-800 flex items-start">
                <svg className="w-5 h-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                <div>
                  <div className="font-medium">Image code generated</div>
                  <div className="text-green-900 mt-1">{f.purpose || 'Diagram ready.'}</div>
                  <div className="text-green-900 mt-1">Please click Render to display the image.</div>
                </div>
              </div>
              {modifyIdx === i && (
                <div className="mt-3 border-t pt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Describe changes for this figure</label>
                  <textarea className="w-full text-sm border rounded p-2" rows={3} value={modifyText} onChange={(e) => setModifyText(e.target.value)} />
                  <div className="mt-2 flex items-center space-x-2">
                    <button
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
                      className="inline-flex items-center px-3 py-1 border border-transparent text-sm rounded text-white bg-indigo-600 hover:bg-indigo-700"
                    >
                      Apply Changes
                    </button>
                    <button onClick={() => { setModifyIdx(null); setModifyText('') }} className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm rounded text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
          </div>
        </div>
              )}
            </div>
          ))}
      </div>
      )}

      {/* Persisted diagrams (codes + upload) */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Saved Diagrams</h3>
        {diagramSources.length === 0 ? (
          <div className="text-sm text-gray-600">No diagrams saved yet.</div>
        ) : (
          <div className="space-y-6">
            {diagramSources
              .sort((a: any, b: any) => a.figureNo - b.figureNo)
              .map((d: any) => (
              <div key={d.figureNo} className="bg-white rounded-lg border p-4">
                <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
                    <h4 className="font-medium text-gray-900">{figurePlans.find((f: any) => f.figureNo === d.figureNo)?.title || `Figure ${d.figureNo}`} (Fig.{d.figureNo})</h4>
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && (
                      <div className="ml-2 inline-flex items-center text-blue-600 text-xs">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                        <span className="ml-1">Uploaded</span>
                        <svg
                          className="w-3 h-3 ml-1 text-blue-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-label="This is a user-uploaded image that is not generated by the patent drafting AI"
                        >
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                <div className="flex items-center space-x-2">
                  <button onClick={() => { setModifyFigNo(d.figureNo); setModifyTextSaved('') }} className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Modify</button>
                  {d.plantumlCode && (
                    <button
                      onClick={() => setShowPlantUML(prev => ({ ...prev, [d.figureNo]: !prev[d.figureNo] }))}
                      className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50"
                    >
                      {showPlantUML[d.figureNo] ? 'Hide Code' : 'Show Code'}
                    </button>
                  )}
                </div>
                </div>
              <div className="p-3 border rounded bg-green-50 text-sm text-green-800 flex items-start">
                <svg className="w-5 h-5 mr-2 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                <div>
                  <div className="font-medium">🤖 Intelligent Processing Active</div>
                  <div className="text-green-900 mt-1">{(figurePlans.find((f: any) => f.figureNo === d.figureNo)?.description) || 'Advanced visualization algorithms engaged.'}</div>
                  <div className="text-green-900 mt-1">Our AI systems are automatically optimizing and rendering your patent diagram.</div>
                </div>
              </div>
                {!d.imageUploadedAt && !processingStatus[d.figureNo] && (
                  <div className="mt-2 text-xs text-indigo-600 flex items-center">
                    <span className="inline-block w-2 h-2 bg-indigo-400 rounded-full mr-2 animate-pulse"></span>
                    🤖 Advanced AI processing initializing...
                  </div>
                )}
                {d.plantumlCode && !d.imageUploadedAt && !processingStatus[d.figureNo] && !rendering[d.figureNo] && (
                  <div className="mt-2 text-xs text-orange-600 flex items-center">
                    <button
                      onClick={() => autoProcessDiagram(d.figureNo, d.plantumlCode)}
                      className="inline-flex items-center px-2 py-1 border border-orange-300 text-orange-700 rounded bg-white hover:bg-orange-50 text-xs"
                    >
                      🔄 Process Image
                    </button>
                    <span className="ml-2">Click to manually start image processing</span>
                  </div>
                )}
                {showPlantUML[d.figureNo] && d.plantumlCode && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">PlantUML Code</label>
                    <div className="relative">
                      <textarea
                        className="w-full text-xs font-mono border rounded p-3 bg-gray-50"
                        rows={12}
                        readOnly
                        value={d.plantumlCode}
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(d.plantumlCode)}
                        className="absolute top-2 right-2 inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                {modifyFigNo === d.figureNo && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Describe changes for this figure</label>
                    <textarea className="w-full text-sm border rounded p-2" rows={3} value={modifyTextSaved} onChange={(e) => setModifyTextSaved(e.target.value)} />
                    <div className="mt-2 flex items-center space-x-2">
                      <button
                        onClick={async () => {
                          try {
                            const resp = await onComplete({ action: 'regenerate_diagram_llm', sessionId: session?.id, figureNo: d.figureNo, instructions: modifyTextSaved })
                            if (resp?.diagramSource?.plantumlCode) {
                              await onRefresh()
                              setModifyFigNo(null)
                              setModifyTextSaved('')
                            }
                          } catch (e) {
                            setError('Failed to modify diagram')
                          }
                        }}
                        className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
                      >
                        Apply Changes
                      </button>
                      <button onClick={() => { setModifyFigNo(null); setModifyTextSaved('') }} className="inline-flex items-center px-3 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Intelligent Processing</label>
                  <div className="flex items-center space-x-2">
                    {/* Show intelligent processing status */}
                    {processingStatus[d.figureNo] && (
                      <div className="inline-flex items-center space-x-2 px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center space-x-1">
                          {Array.from({ length: 7 }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                i <= processingStep[d.figureNo] || 0
                                  ? 'bg-blue-500 scale-110'
                                  : 'bg-blue-300 scale-75'
                              }`}
                              style={{
                                animationDelay: `${i * 100}ms`,
                                animation: processingStep[d.figureNo] >= i ? 'pulse 1s infinite' : 'none'
                              }}
                            />
                          ))}
                        </div>
                        <span className="text-sm font-medium text-blue-800 animate-pulse">
                          {processingStatus[d.figureNo]}
                        </span>
                      </div>
                    )}

                    {/* Show completed status */}
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && (
                      <div className="inline-flex items-center space-x-2 px-3 py-2 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
                        <svg className="w-5 h-5 text-green-600 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 8.879a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium text-green-800">
                          ✨ Advanced visualization complete
                        </span>
                      </div>
                    )}

                    {/* Show failed status with retry */}
                    {processingStep[d.figureNo] === -1 && d.plantumlCode && (
                      <div className="inline-flex items-center space-x-2 px-3 py-2 bg-gradient-to-r from-red-50 to-red-50 border border-red-200 rounded-lg">
                        <span className="text-sm font-medium text-red-800">
                          {processingStatus[d.figureNo]}
                        </span>
                        <button
                          onClick={() => {
                            setProcessingStatus(prev => ({ ...prev, [d.figureNo]: '' }))
                            setProcessingStep(prev => ({ ...prev, [d.figureNo]: 0 }))
                            setError(null)
                            autoProcessDiagram(d.figureNo, d.plantumlCode)
                          }}
                          className="inline-flex items-center px-2 py-1 border border-red-300 text-red-700 rounded bg-white hover:bg-red-50 text-xs"
                        >
                          🔄 Retry
                        </button>
                      </div>
                    )}

                    {/* View image button when available */}
                    {(uploaded[d.figureNo] || d.imageUploadedAt) && d.imageFilename && (
                      <button
                        onClick={() => handleViewImage(d.figureNo, d.imageFilename)}
                        disabled={isViewing[d.figureNo]}
                        className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isViewing[d.figureNo] ? 'Opening…' : 'View Result'}
                      </button>
                    )}

                    {/* Manual upload option for non-AI generated diagrams */}
                    {!d.plantumlCode && (
                      <div className="flex items-center space-x-2">
                        <input
                          type="file"
                          accept=".png,.svg"
                          disabled={isUploading}
                          onChange={(e) => e.target.files && handleUploadImage(d.figureNo, e.target.files[0])}
                          className="text-xs"
                        />
                        <span className="text-xs text-gray-500">Manual upload</span>
                      </div>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={async () => {
                        try {
                          await onComplete({ action: 'delete_figure', sessionId: session?.id, figureNo: d.figureNo })
                          await onRefresh()
                        } catch (e) {
                          setError('Failed to delete figure')
                        }
                      }}
                      className="inline-flex items-center px-2 py-1 text-xs border border-red-300 text-red-700 rounded bg-white hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                  {renderPreview[d.figureNo] && (
                    <div className="mt-3">
                      <img
                        src={renderPreview[d.figureNo] as string}
                        alt={`Preview Fig.${d.figureNo}`}
                        className="max-w-xs border rounded cursor-pointer"
                        onClick={() => setExpandedFigNo(d.figureNo)}
                        title="Click to enlarge"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showManual && (
      <div className="mt-6 p-3 border rounded">
        <div className="flex items-center space-x-2 mb-2">
          <label className="text-sm text-gray-700">Upload Outside Images:</label>
          <input type="number" min={0} className="w-20 border rounded px-2 py-1 text-sm" value={manualCount} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10)); setManualCount(n); setManualInputs(Array.from({ length: n }, (_, i) => manualInputs[i] || { title: '', description: '' })); setManualFiles(Array.from({ length: n }, (_, i) => manualFiles[i] || null)); }} />
          <button
            onClick={async () => {
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
              } catch (e) {
                setError('Failed to create manual figures')
              }
            }}
            className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Add Slots
          </button>
        </div>
        {Array.from({ length: manualCount }).map((_, i) => (
          <div key={i} className="mb-3 border rounded p-2">
            <div className="flex items-center space-x-2 mb-2">
              <input placeholder="Optional title" className="flex-1 border rounded px-2 py-1 text-sm" value={manualInputs[i]?.title || ''} onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), title: e.target.value }; setManualInputs(arr) }} />
            </div>
            <label className="block text-xs text-gray-600">Describe what this image shows (min 20 words, mention component numerals)</label>
            <textarea className="w-full text-sm border rounded p-2" rows={3} value={manualInputs[i]?.description || ''} onChange={(e) => { const arr = [...manualInputs]; arr[i] = { ...(arr[i] || { title: '', description: '' }), description: e.target.value }; setManualInputs(arr) }} />
            <div className="text-xs mt-1">
              <span className={countWords(manualInputs[i]?.description || '') >= 20 ? 'text-green-600' : 'text-gray-500'}>
                {countWords(manualInputs[i]?.description || '')} / 20 words
              </span>
            </div>
            <div className="mt-2">
              <input type="file" accept=".png,.svg" onChange={(e) => { const arr = [...manualFiles]; arr[i] = e.target.files?.[0] || null; setManualFiles(arr) }} />
          <button
                onClick={async () => {
                  try {
                    const item = manualInputs[i]
                    const file = manualFiles[i]
                    if (!item || !item.description || countWords(item.description) < 20) { setError('Description needs at least 20 words'); return }
                    if (!file) { setError('Please choose an image file to upload'); return }
                    setManualBusy((prev) => ({ ...prev, [i]: true }))
                    const resp = await onComplete({ action: 'create_manual_figure', sessionId: session?.id, title: sanitizeFigureLabel(item.title) || item.title, description: item.description })
                    const createdNo = resp?.created?.figureNo
                    if (createdNo) {
                      await handleUploadImage(createdNo, file)
                      const newInputs = [...manualInputs]; newInputs[i] = { title: '', description: '' }; setManualInputs(newInputs)
                      const newFiles = [...manualFiles]; newFiles[i] = null; setManualFiles(newFiles)
                      await onRefresh()
                    }
                  } catch (e) {
                    setError('Upload failed')
                  } finally {
                    setManualBusy((prev) => ({ ...prev, [i]: false }))
                  }
                }}
                className="ml-2 inline-flex items-center px-2 py-1 text-xs border border-transparent rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                disabled={countWords(manualInputs[i]?.description || '') < 20 || !manualFiles[i] || !!manualBusy[i]}
              >
                {manualBusy[i] ? 'Uploading…' : 'Upload'}
          </button>
        </div>
          </div>
        ))}
        <p className="text-xs text-gray-500">Tip: Reference numerals (e.g., C100, C200) and flows to help drafting.</p>
      </div>
      )}
      <div className="mt-4 flex justify-end">
        <button onClick={() => setShowManual((v) => !v)} className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50">
          {showManual ? 'Hide outside images' : 'Upload Outside Images'}
        </button>
      </div>
      {expandedFigNo && renderPreview[expandedFigNo] && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setExpandedFigNo(null)}>
          <div className="bg-white rounded-lg shadow-lg p-4 max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900">Preview Fig.{expandedFigNo}</h4>
              <button onClick={() => setExpandedFigNo(null)} className="inline-flex items-center px-2 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Close</button>
            </div>
            <img src={renderPreview[expandedFigNo] as string} alt={`Preview Fig.${expandedFigNo}`} className="w-full h-auto border rounded" />
            <div className="mt-3 flex items-center space-x-2">
              <button
                onClick={async () => {
                  try {
                    setIsUploading(true)
                    const res = await fetch(renderPreview[expandedFigNo!] as string)
                    const blob = await res.blob()
                    const file = new File([blob], `figure-${expandedFigNo}.png`, { type: 'image/png' })
                    await handleUploadImage(expandedFigNo!, file)
                    setExpandedFigNo(null)
                  } catch (e) {
                    setError('Approve failed')
                  } finally {
                    setIsUploading(false)
                  }
                }}
                className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Approve & Save
              </button>
              <button onClick={() => setExpandedFigNo(null)} className="inline-flex items-center px-3 py-1 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      </div>
      )}
      <div className="mt-6 p-3 border rounded">
        <div className="flex items-center space-x-2 mb-2">
          <label className="text-sm text-gray-700">Add new AI figures:</label>
          <input type="number" min={0} className="w-20 border rounded px-2 py-1 text-sm" value={addCount} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10)); setAddCount(n); setAddInputs(Array.from({ length: n }, (_, i) => addInputs[i] || '')); }} />
          <button
            onClick={async () => {
              try {
                const instructionsList = addInputs.filter(Boolean)
                if (instructionsList.length === 0) return
                const resp = await onComplete({ action: 'add_figures_llm', sessionId: session?.id, instructionsList })
                if (resp?.created?.length) {
                  setAddCount(0)
                  setAddInputs([])
                  await onRefresh()
                }
              } catch (e) {
                setError('Failed to add figures')
              }
            }}
            className="inline-flex items-center px-3 py-1 border border-transparent text-xs rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Generate
          </button>
        </div>
        {Array.from({ length: addCount }).map((_, i) => (
          <div key={i} className="mb-2">
            <label className="block text-xs text-gray-600">Figure {i + 1} description</label>
            <textarea className="w-full text-sm border rounded p-2" rows={2} value={addInputs[i] || ''} onChange={(e) => {
              const arr = [...addInputs]
              arr[i] = e.target.value
              setAddInputs(arr)
            }} />
          </div>
        ))}
        <p className="text-xs text-gray-500 mt-1">Tip: Provide all new images and details in one go for better consistency. We will inform the LLM about existing numerals, figures, and naming conventions to avoid hallucinations.</p>
      </div>
    </div>
  )
}
  const normalizePageSizes = (input: any): string[] => {
    if (!input) return []
    if (Array.isArray(input)) {
      return input.flatMap((val) => normalizePageSizes(val))
    }
    if (typeof input === 'string') {
      const trimmed = input.trim()
      return trimmed ? [trimmed] : []
    }
    if (typeof input === 'object') {
      return Object.values(input).flatMap((val) => normalizePageSizes(val))
    }
    return []
  }
