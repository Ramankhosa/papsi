'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Download, FileCheck2, Loader2 } from 'lucide-react'
import BibliographyPreview from '@/components/paper/BibliographyPreview'
import { PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'

type ReviewExportStageProps = {
  sessionId: string
  authToken: string | null
  onNavigateToStage?: (stage: string) => void
}

export default function ReviewExportStage({ sessionId, authToken, onNavigateToStage }: ReviewExportStageProps) {
  const [structure, setStructure] = useState<any | null>(null)
  const [wordCounts, setWordCounts] = useState<any | null>(null)
  const [unused, setUnused] = useState<any[]>([])
  const [bibtex, setBibtex] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [citationCheck, setCitationCheck] = useState<any | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [exporting, setExporting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadChecks = useCallback(async () => {
    if (!authToken) return
    setMessage(null)
    const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }
    const [structureRes, wordRes, unusedRes] = await Promise.all([
      fetch(`/api/papers/${sessionId}/drafting`, { method: 'POST', headers, body: JSON.stringify({ action: 'analyze_structure' }) }),
      fetch(`/api/papers/${sessionId}/drafting`, { method: 'POST', headers, body: JSON.stringify({ action: 'word_count' }) }),
      fetch(`/api/papers/${sessionId}/citations/unused`, { headers }),
    ])

    if (structureRes.ok) setStructure(await structureRes.json())
    if (wordRes.ok) setWordCounts(await wordRes.json())
    if (unusedRes.ok) {
      const data = await unusedRes.json()
      setUnused(data.citations || [])
    }
  }, [authToken, sessionId])

  const loadDraftContent = useCallback(async () => {
    if (!authToken) return
    try {
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json()
      const drafts = Array.isArray(data.session?.annexureDrafts) ? data.session.annexureDrafts : []
      const paperDraft = drafts
        .filter((draft: any) => String(draft?.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((a: any, b: any) => (b?.version || 0) - (a?.version || 0))[0]
      const extraSections = typeof paperDraft?.extraSections === 'string'
        ? JSON.parse(paperDraft.extraSections)
        : paperDraft?.extraSections
      setDraftContent(Object.values(extraSections || {}).join('\n\n'))
    } catch {
      setDraftContent('')
    }
  }, [authToken, sessionId])

  const checkCitations = async () => {
    if (!draftContent.trim()) {
      setCitationCheck({ total: 0, missing: [], found: [] })
      return
    }
    const response = await fetch(`/api/papers/${sessionId}/drafting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: 'check_citations', content: draftContent }),
    })
    const data = await response.json()
    if (!response.ok) {
      setMessage(data.error || 'Failed to check citations')
      return
    }
    setCitationCheck(data)
  }

  const downloadFile = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const handleExport = async (format: 'docx' | 'latex' | 'bibtex') => {
    if (!authToken) return
    try {
      setExporting(format)
      setMessage(null)
      const response = await fetch(`/api/papers/${sessionId}/export?format=${format}`, { headers: { Authorization: `Bearer ${authToken}` } })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Export failed')
      }
      const disposition = response.headers.get('Content-Disposition') || ''
      const match = /filename=\"?([^\";]+)\"?/i.exec(disposition)
      const fallback = `paper_${sessionId}.${format === 'bibtex' ? 'bib' : format}`
      const filename = match?.[1] || fallback
      if (format === 'docx') {
        downloadFile(await response.blob(), filename)
        return
      }
      const text = await response.text()
      if (format === 'bibtex') setBibtex(text)
      downloadFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    if (!sessionId || !authToken) return
    setLoading(true)
    Promise.all([loadChecks(), loadDraftContent()]).finally(() => setLoading(false))
  }, [authToken, loadChecks, loadDraftContent, sessionId])

  return (
    <div className="space-y-6 p-6">
      <PaperReviewPipelineStepper currentStage="REVIEW_EXPORT" onNavigateToStage={stage => onNavigateToStage?.(stage)} canAccessImprove canAccessExport />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eff6ff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700"><FileCheck2 className="h-3.5 w-3.5" />Final validation and export</div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Run the final checks, then export</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">Use this stage as the final gate after Review and Improve. Refresh pre-export checks, validate citations across the full manuscript, and download the paper package in the format you need.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={loadChecks} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">Refresh Checks</button>
              <button type="button" onClick={() => onNavigateToStage?.('MANUSCRIPT_IMPROVE')} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Back To Improve<ArrowRight className="h-4 w-4" /></button>
            </div>
          </div>
          {message && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>}
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-slate-600"><Loader2 className="mr-3 h-5 w-5 animate-spin" />Loading export checks...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Missing Required Sections</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{structure?.validation?.missingRequiredSections?.length || 0}</div><div className="mt-2 text-sm text-slate-500">Must be zero before final submission</div></div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total Word Count</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{wordCounts?.total || 0}</div><div className="mt-2 text-sm text-slate-500">Use this to check venue fit</div></div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unused Citations</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{unused.length}</div><div className="mt-2 text-sm text-slate-500">Candidates to prune before export</div></div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pre-Export Checks</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What still blocks a clean export</h2>
                <div className="mt-4 space-y-3">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    Missing required sections: {structure?.validation?.missingRequiredSections?.length || 0}
                    {structure?.validation?.missingRequiredSections?.length > 0 && (
                      <div className="mt-2 text-rose-700">{structure.validation.missingRequiredSections.join(', ')}</div>
                    )}
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    Citation validation: {citationCheck ? `${citationCheck.missing?.length || 0} missing keys` : 'Not run yet'}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={checkCitations} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Check Citations</button>
                    <button type="button" onClick={loadChecks} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">Refresh Checks</button>
                  </div>
                </div>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Disclosure</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Academic integrity reminder</h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">Before exporting, confirm citation accuracy, institutional AI-use policy, and originality requirements for your venue or program.</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Export</div>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Download the paper package</h2>
                <div className="mt-4 flex flex-wrap gap-3">
                  {([
                    { key: 'docx', label: 'Export DOCX' },
                    { key: 'latex', label: 'Export LaTeX' },
                    { key: 'bibtex', label: 'Export BibTeX' },
                  ] as const).map(option => (
                    <button key={option.key} type="button" onClick={() => handleExport(option.key)} disabled={exporting !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                      {exporting === option.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {exporting === option.key ? `Exporting ${option.label.replace('Export ', '')}...` : option.label}
                    </button>
                  ))}
                </div>
                <textarea value={bibtex} readOnly rows={8} className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 outline-none" placeholder="BibTeX export appears here after generation." />
              </div>

              <BibliographyPreview sessionId={sessionId} authToken={authToken} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
