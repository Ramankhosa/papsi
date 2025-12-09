>         let customPrompt = `You are an expert patent illustrator generating block diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
  Return a JSON array of exactly ${overrideList.length} custom diagrams based on the user's specific instructions.
  Each item must be: {"title":"Fig.X - descriptive title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"} (use diagram markup between @startuml and @enduml).
  
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
DIAGRAM SYNTAX RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
To ensure the diagrams render correctly, please follow these rules:

1. ARROW DIRECTIONS: Use "-down->", "-up->", "-left->", "-right->" for layout control.
   - CORRECT: A -down-> B
   - CORRECT: A -[hidden]- B
   - INCORRECT: A -[hidden]down- B (Do not mix [hidden] with direction)

2. CONNECTIONS: Always specify both endpoints.
   - CORRECT: 500 --> 600
   - INCORRECT: 500 -- (Dangling connection)

3. BLOCKS: Close all blocks properly.
   - matching "endif" for every "if"
   - matching "end" for every "start"

4. STRUCTURE:
   - Exactly ONE @startuml and ONE @enduml per diagram.
   - NO "note" elements (they create visual clutter).
   - NO comments on components.

5. CONTENT:
   - Use ONLY provided components/numerals.
   - Do not invent new components.

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
Before outputting, mentally COMPILE AND VALIDATE your code:
1. ✓ All referenced components exist in the provided list?
2. ✓ No forbidden directives (!theme, skinparam, title, note, etc.)?
3. ✓ All connections have both endpoints?
4. ✓ All blocks are properly closed?
5. ✓ Exactly one @startuml/@enduml pair per diagram?
6. ✓ NO "note" statements of any kind (no yellow comment boxes)?
7. ✓ Mentally trace through code line-by-line to verify syntax correctness?

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
  
>       const prompt = `You are an expert patent illustrator generating block diagrams for a patent specification in jurisdiction ${activeJurisdiction}.
  Return a JSON array of exactly ${diagramCount} simple, standard patent-style diagrams (no fancy rendering).
  Each item must be: {"title":"Fig.X - title","purpose":"brief explanation of what this shows","plantuml":"@startuml...@enduml"} (use diagram markup between @startuml and @enduml).
  
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
  DIAGRAM SYNTAX RULES (ERRORS TO AVOID)
  ═══════════════════════════════════════════════════════════════════════════════
  FORBIDDEN (will cause render failure or visual clutter):
  ✗ !theme, !include, !import, !pragma directives
  ✗ skinparam blocks or statements
  ✗ title, caption, header, footer inside the diagram
  ✗ Mixing [hidden] with directions (wrong: "-[hidden]down-", correct: "-[hidden]-" OR "-down-")
  ✗ Incomplete connections (wrong: "500 --", correct: "500 --> 600")
  ✗ Unclosed blocks (every "if" needs "endif", every "note" needs "end note")
  ✗ Multiple or nested @startuml/@enduml pairs (exactly ONE pair per diagram)
  ✗ Undefined aliases or dangling arrows
  ✗ ANY "note" elements - no notes, no floating notes, no notes attached to components (these render as yellow boxes and clutter the diagram)
  ✗ Comments or annotations on components
  
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
  Before outputting, mentally COMPILE AND VALIDATE your code:
  1. ✓ Figures are ordered broad→specific (zoom-in sequence)?
  2. ✓ All referenced components exist in the provided list?
  3. ✓ No forbidden directives (!theme, skinparam, title, note, etc.)?
  4. ✓ All connections have both endpoints?
  5. ✓ All blocks are properly closed?
  6. ✓ Exactly one @startuml/@enduml pair per diagram?
  7. ✓ NO "note" statements of any kind (no yellow comment boxes)?
  8. ✓ Mentally trace through code line-by-line to verify syntax correctness?${claimsContext ? `
  9. ✓ Diagrams illustrate the frozen claims where applicable?` : ''}
  
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
