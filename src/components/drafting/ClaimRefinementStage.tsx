'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, CheckCircle2, Sparkles, Lock } from 'lucide-react'

interface ClaimRefinementStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ClaimRow = { number: number; text: string }

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

const parseClaims = (html: string, structured?: any[]): ClaimRow[] => {
  if (Array.isArray(structured) && structured.length > 0) {
    return structured.map((c: any) => ({ number: Number(c.number) || 0, text: c.text || '' }))
  }
  if (!html) return []
  const blocks = html.split(/<\/p>/i)
  const rows: ClaimRow[] = []
  blocks.forEach((b) => {
    const plain = stripTags(b)
    if (!plain) return
    const match = plain.match(/^(\d+)\.\s*(.+)$/)
    if (match) {
      rows.push({ number: Number(match[1]), text: match[2] })
    }
  })
  return rows
}

type DiffPart = { type: 'same' | 'add' | 'del'; text: string }

const diffWords = (oldText: string, newText: string): DiffPart[] => {
  const a = (oldText || '').split(/\s+/)
  const b = (newText || '').split(/\s+/)
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      parts.push({ type: 'same', text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: 'del', text: a[i] })
      i++
    } else {
      parts.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) { parts.push({ type: 'del', text: a[i++] }) }
  while (j < n) { parts.push({ type: 'add', text: b[j++] }) }
  return parts
}

const renderDiff = (oldText: string, newText: string) => {
  if (!newText || oldText === newText) return <span className="text-gray-800">{oldText || newText}</span>
  const parts = diffWords(oldText, newText)
  return (
    <div className="flex flex-wrap gap-1 text-sm leading-6">
      {parts.map((p, idx) => {
        if (p.type === 'same') return <span key={idx}>{p.text}</span>
        if (p.type === 'add') return <span key={idx} className="bg-green-100 text-green-800 px-1 rounded">{p.text}</span>
        return <span key={idx} className="bg-red-100 text-red-800 line-through px-1 rounded">{p.text}</span>
      })}
    </div>
  )
}

export default function ClaimRefinementStage({ session, onComplete, onRefresh }: ClaimRefinementStageProps) {
  // Debug: Log session data to diagnose data flow issues
  console.log('🔍 ClaimRefinementStage - Session received:', {
    sessionId: session?.id,
    hasPriorArtConfig: !!session?.priorArtConfig,
    priorArtConfig: session?.priorArtConfig,
    claimRefinementConfig: (session?.priorArtConfig as any)?.claimRefinementConfig,
    selectedPatentsCount: (session?.priorArtConfig as any)?.claimRefinementConfig?.selectedPatents?.length || 0
  })

  const normalized = (session?.ideaRecord?.normalizedData as any) || {}
  const structured = normalized.claimsStructured || normalized.claimsStructuredProvisional || normalized.claimsStructuredFinal || []
  const currentClaimsHtml = normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || ''
  const provisionalClaimsHtml = normalized.claimsProvisional || currentClaimsHtml
  const claimRefConfig = (session?.priorArtConfig as any)?.claimRefinementConfig || {}
  const claimRefManualText = typeof claimRefConfig?.manualText === 'string' ? claimRefConfig.manualText : ''
  const claimRefSelectedPatentsFromConfig: any[] = Array.isArray(claimRefConfig?.selectedPatents) ? claimRefConfig.selectedPatents : []
  
  // Debug: Log extracted config values
  console.log('🔍 ClaimRefinementStage - Config extracted:', {
    claimRefConfig,
    claimRefManualText,
    claimRefSelectedPatentsFromConfig
  })

  const baseClaims = useMemo(() => parseClaims(provisionalClaimsHtml, structured), [provisionalClaimsHtml, structured])
  const [preview, setPreview] = useState<any>(normalized.claimsRefinementPreview || null)
  const normalizePatentId = (p: any) => {
    const pn = p?.patentNumber || p?.pn || p?.publication_number || p?.publicationNumber || p?.id
    return typeof pn === 'string' ? pn.trim() : ''
  }
  const resolveThreat = (tags?: string[], novelty?: string) => {
    const tagThreat = (tags || []).find((t) => ['AI_ANTICIPATES', 'AI_OBVIOUS', 'AI_ADJACENT', 'AI_REMOTE'].includes(t))
    if (novelty) return novelty
    if (tagThreat === 'AI_ANTICIPATES') return 'anticipates'
    if (tagThreat === 'AI_OBVIOUS') return 'obvious'
    if (tagThreat === 'AI_ADJACENT') return 'adjacent'
    if (tagThreat === 'AI_REMOTE') return 'remote'
    return 'unknown'
  }
  // Patents for claim refinement should ONLY come from the claim refinement config
  // DO NOT fall back to relatedArtSelections as those are for prior art drafting, not claim refinement
  const optionsFromConfig = claimRefSelectedPatentsFromConfig
    .map((p: any) => {
      const id = normalizePatentId(p)
      if (!id) return null
      return {
        id,
        title: p.title || 'Untitled',
        threat: resolveThreat(p.tags, (p as any).noveltyThreat),
        source: 'config' as const
      }
    })
    .filter(Boolean) as Array<{ id: string; title: string; threat: string; source: 'config' }>

  const configIdsKey = optionsFromConfig.map((p) => p.id).join('|')
  // Only use patents explicitly selected for claim refinement - no fallback to prior art selections
  const priorArtOptions = optionsFromConfig
  const initialMode = claimRefConfig.mode || 'ai'
  const [useAuto, setUseAuto] = useState(initialMode !== 'manual')
  const [useManual, setUseManual] = useState(initialMode === 'manual' || initialMode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
  const [selectedPatents, setSelectedPatents] = useState<string[]>(priorArtOptions.map((p) => p.id))
  const [acceptMap, setAcceptMap] = useState<Record<number, boolean>>({})
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [applying, setApplying] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdditionalInstructions, setShowAdditionalInstructions] = useState(false)
  const [additionalInstructions, setAdditionalInstructions] = useState('')

  useEffect(() => {
    const mode = claimRefConfig.mode || 'ai'
    // Only use patents from claim refinement config - not fallback to prior art
    const nextSelected = optionsFromConfig.map((p) => p.id)
    setUseAuto(mode !== 'manual')
    setUseManual(mode === 'manual' || mode === 'hybrid' || !!claimRefManualText || !!session?.manualPriorArt)
    setSelectedPatents(nextSelected)
  }, [claimRefConfig.mode, claimRefManualText, session?.manualPriorArt, configIdsKey])

  useEffect(() => {
    if (preview?.refinedClaims) {
      const defaults: Record<number, boolean> = {}
      preview.refinedClaims.forEach((c: any) => {
        if (c.refined_text) defaults[Number(c.number)] = true
      })
      setAcceptMap(defaults)
    }
  }, [preview])

  const handlePreview = async () => {
    if (!session?.id) return
    try {
      setLoadingPreview(true)
      setError(null)
      const resp = await onComplete({
        action: 'claim_refinement_preview',
        sessionId: session.id,
        useAuto,
        useManual,
        selectedPatents,
        additionalInstructions: showAdditionalInstructions ? additionalInstructions : ''
      })
      if (resp?.preview) {
        setPreview(resp.preview)
      }
    } catch (e) {
      console.error('Preview failed', e)
      setError('Failed to generate refinement preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleApply = async () => {
    if (!session?.id) return
    try {
      setApplying(true)
      setError(null)
      const accepted = Object.entries(acceptMap).filter(([, v]) => v).map(([k]) => Number(k))
      await onComplete({
        action: 'claim_refinement_apply',
        sessionId: session.id,
        acceptedClaimNumbers: accepted
      })
      await onRefresh()
    } catch (e) {
      console.error('Apply failed', e)
      setError('Failed to apply refinements.')
    } finally {
      setApplying(false)
    }
  }

  const handleFreeze = async () => {
    if (!session?.id) return
    try {
      setFreezing(true)
      setError(null)
      await onComplete({
        action: 'freeze_claims',
        sessionId: session.id,
        claims: normalized.claims || normalized.claimsFinal || normalized.claimsProvisional || currentClaimsHtml,
        claimsStructured: structured && structured.length ? structured : undefined,
        jurisdiction: (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
      })
      await onComplete({
        action: 'set_stage',
        sessionId: session.id,
        stage: 'COMPONENT_PLANNER'
      })
      await onRefresh()
    } catch (e) {
      console.error('Freeze failed', e)
      setError('Failed to freeze claims.')
    } finally {
      setFreezing(false)
    }
  }

  const refinedClaims = preview?.refinedClaims || []

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-600" />
            Refine Claims based on prior art findings
          </h2>
          <p className="text-gray-600 text-sm mt-1">
            Kisho will refine the claims to establish novelty against patents from the Obvious and Anticipates categories.
          </p>
        </div>
        <Badge variant={normalized.claimsApprovedAt ? 'default' : 'secondary'}>
          {normalized.claimsApprovedAt ? 'Frozen' : 'Provisional'}
        </Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Current / Provisional Claims</h3>
            <Badge variant="outline">{baseClaims.length} claims</Badge>
          </div>
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {baseClaims.map((c) => (
              <div key={c.number} className="border border-gray-100 rounded-md p-3">
                <div className="text-xs text-gray-500 mb-1">Claim {c.number}</div>
                <div className="text-sm text-gray-800">{c.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Prior art inputs</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={useAuto}
                onChange={(e) => setUseAuto(e.target.checked)}
                className="rounded border-gray-300"
              />
              Use automatic prior-art findings
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={useManual}
                onChange={(e) => setUseManual(e.target.checked)}
                className="rounded border-gray-300"
              />
              Use my manual prior-art notes
            </label>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">Patents selected for claim refinement</div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {priorArtOptions.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
                  <p className="text-sm text-amber-800">No patents selected for claim refinement.</p>
                  <p className="text-xs text-amber-600 mt-1">Go back to Related Art stage and select patents in the "Patents for Claim Refinement" tab.</p>
                </div>
              )}
              {priorArtOptions.map((p: { id: string; title: string; threat: string }) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={selectedPatents.includes(p.id)}
                    onChange={(e) => {
                      setSelectedPatents((prev) => {
                        if (e.target.checked) return Array.from(new Set([...prev, p.id]))
                        return prev.filter((x) => x !== p.id)
                      })
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="font-medium">{p.id}</span>
                  <span className="text-gray-500 truncate">{p.title}</span>
                  <Badge variant="outline" className="text-xs">{p.threat.replace('AI_', '')}</Badge>
                </label>
              ))}
            </div>
            {useManual && (claimRefManualText || (session?.manualPriorArt as any)?.manualPriorArtText || (session?.manualPriorArt as any)?.text) && (
              <div className="text-xs text-gray-500">
                Using manual notes from claim refinement setup.
              </div>
            )}
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAdditionalInstructions}
                  onChange={(e) => setShowAdditionalInstructions(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium">Additional Instructions</span>
              </label>
              {showAdditionalInstructions && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                    <AlertCircle className="w-3 h-3" />
                    <span>These instructions are treated as MANDATORY. The LLM must follow them or explicitly fail.</span>
                  </div>
                  <textarea
                    className="w-full border border-indigo-200 rounded-md text-sm p-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-indigo-50"
                    rows={3}
                    placeholder="Example: Ensure claims emphasize safety interlocks and exclude battery charging. Focus on novelty over patent XYZ."
                    value={additionalInstructions}
                    onChange={(e) => setAdditionalInstructions(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={handlePreview} disabled={loadingPreview} className="w-full">
              {loadingPreview ? 'Generating refined objectives…' : 'Generate Refined Objectives'}
            </Button>
            <Button variant="outline" onClick={handleApply} disabled={applying || !preview} className="w-full">
              {applying ? 'Applying...' : 'Apply selected refinements'}
            </Button>
            <Button variant="outline" onClick={handleFreeze} disabled={freezing} className="w-full bg-emerald-600 text-white hover:bg-emerald-700">
              <Lock className="w-4 h-4 mr-2" />
              {freezing ? 'Freezing...' : 'Freeze Final Claims'}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Refinement preview</h3>
          {preview && <Badge variant="secondary">Generated</Badge>}
        </div>
        {!preview && (
          <p className="text-sm text-gray-600">Generate refinement suggestions to compare against your current claims.</p>
        )}
        {preview && (
          <div className="space-y-3">
            {baseClaims.map((c) => {
              const refined = refinedClaims.find((r: any) => Number(r.number) === Number(c.number))
              const refinedText = refined?.refined_text || ''
              const originalText = refined?.original_text || c.text
              const accepted = acceptMap[c.number] ?? Boolean(refinedText)
              return (
                <div key={c.number} className="border border-gray-100 rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm text-gray-900">
                      <span className="font-semibold">Claim {c.number}</span>
                      {refinedText ? (
                        <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-200 bg-emerald-50">Refined</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-gray-600 border-gray-200">Keep as is</Badge>
                      )}
                    </div>
                    {refinedText && (
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(e) => setAcceptMap((prev) => ({ ...prev, [c.number]: e.target.checked }))}
                          className="rounded border-gray-300"
                        />
                        Accept refinement
                      </label>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">Diff</div>
                    {refinedText ? renderDiff(originalText, refinedText) : <div className="text-sm text-gray-700">{originalText}</div>}
                    {refined?.change_reason && (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        {refined.change_reason}
                      </div>
                    )}
                    {refined?.prior_art_refs && refined.prior_art_refs.length > 0 && (
                      <div className="text-xs text-gray-500">Refs: {refined.prior_art_refs.join(', ')}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
