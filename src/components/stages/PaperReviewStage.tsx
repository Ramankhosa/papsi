'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
} from 'lucide-react'
import { PaperReviewModeSwitcher, PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'
import { getLatestPaperReviewByMode } from '@/lib/paper-review-utils'
import {
  formatPaperReviewDateTime,
  formatPaperReviewDimension,
  getPaperReviewFixTypeMeta,
  getPaperReviewReadinessMeta,
  getPaperReviewScoreMeta,
  getPaperReviewSeverityMeta,
  persistPaperReviewMode,
  readPersistedPaperReviewMode,
} from '@/lib/paper-review-ui'
import type { PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
  onSectionSelect?: (sectionKey: string) => void
}

type ReviewProgressState = {
  reviewMode: PaperReviewMode
  phase: 'prepare' | 'review' | 'summarize_context' | 'section_review' | 'aggregate' | 'persist' | 'complete'
  message: string
  totalSections?: number
  completedSections?: number
}

type IssueFilter = 'all' | 'critical' | 'major_plus' | 'rewrite' | 'manual'

function parseDraftSections(session: any): Record<string, string> {
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const paperDraft = drafts
    .filter((draft: any) => String(draft?.jurisdiction || '').toUpperCase() === 'PAPER')
    .sort((left: any, right: any) => (right?.version || 0) - (left?.version || 0))[0]
  if (!paperDraft?.extraSections) return {}
  if (typeof paperDraft.extraSections === 'string') {
    try {
      return JSON.parse(paperDraft.extraSections) as Record<string, string>
    } catch {
      return {}
    }
  }
  return typeof paperDraft.extraSections === 'object' ? paperDraft.extraSections as Record<string, string> : {}
}

function progressPercent(progress: ReviewProgressState | null) {
  if (!progress) return 0
  if (progress.reviewMode === 'section_by_section') {
    const total = Math.max(progress.totalSections || 1, 1)
    const completed = Math.min(progress.completedSections || 0, total)
    if (progress.phase === 'prepare') return 10
    if (progress.phase === 'summarize_context') return 14 + Math.round((completed / total) * 20)
    if (progress.phase === 'section_review') return 38 + Math.round((completed / total) * 42)
    if (progress.phase === 'aggregate') return 84
    if (progress.phase === 'persist') return 94
    return 100
  }
  if (progress.phase === 'prepare') return 20
  if (progress.phase === 'review') return 64
  if (progress.phase === 'persist') return 92
  return 100
}

function progressDetailText(progress: ReviewProgressState | null) {
  if (!progress) return ''
  if (progress.reviewMode !== 'section_by_section') {
    return 'The reviewer is working against the latest saved manuscript draft'
  }

  const total = progress.totalSections || 0
  const completed = progress.completedSections || 0

  if (progress.phase === 'summarize_context' && total > 0) {
    return `${completed} of ${total} neighboring-section context briefs prepared`
  }
  if (progress.phase === 'section_review' && total > 0) {
    return `${completed} of ${total} sections reviewed with full-text target analysis`
  }
  if (progress.phase === 'aggregate') {
    return 'Cross-section findings are being consolidated into one manuscript report'
  }
  if (progress.phase === 'persist') {
    return 'Saving the review report and issue queue'
  }
  return 'Preparing the section-by-section review workspace'
}

function progressBadgeLabel(progress: ReviewProgressState | null) {
  if (!progress) return 'Review'
  if (progress.reviewMode !== 'section_by_section') return 'Quick review'
  if (progress.phase === 'summarize_context') return 'Summarizing context'
  if (progress.phase === 'section_review') return 'Reviewing sections'
  if (progress.phase === 'aggregate') return 'Aggregating findings'
  if (progress.phase === 'persist') return 'Saving review'
  return 'Detailed review'
}

async function readSseStream(
  response: Response,
  onStatus: (payload: ReviewProgressState) => void,
  onError: (message: string) => void
) {
  const reader = response.body?.getReader()
  if (!reader) return false
  const decoder = new TextDecoder()
  let buffer = ''
  let ok = false
  let failed = false

  const parseChunk = (chunk: string) => {
    const lines = chunk.split('\n')
    let event = 'message'
    const data: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (!data.length) return
    const payload = JSON.parse(data.join('\n'))
    if (event === 'status') onStatus(payload)
    if (event === 'error') {
      failed = true
      onError(payload?.message || 'Review generation failed')
    }
    if (event === 'done') {
      ok = payload?.ok === true
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      parseChunk(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    parseChunk(buffer)
  }

  return ok && !failed
}

function ScoreRing({ score }: { score: number }) {
  const meta = getPaperReviewScoreMeta(score)
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference

  return (
    <div className={`relative flex h-16 w-16 items-center justify-center rounded-full ${meta.bg}`}>
      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 60 60" fill="none">
        <circle cx="30" cy="30" r={radius} className="stroke-slate-200" strokeWidth="5" />
        <circle
          cx="30"
          cy="30"
          r={radius}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={meta.ring}
        />
      </svg>
      <span className="absolute text-sm font-semibold text-slate-900">{Math.round(score)}</span>
    </div>
  )
}

export default function PaperReviewStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
  onSectionSelect,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [runningReview, setRunningReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<PaperReviewMode>('quick')
  const [progress, setProgress] = useState<ReviewProgressState | null>(null)
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all')
  const abortControllerRef = useRef<AbortController | null>(null)
  const hasInitializedModeRef = useRef(false)

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return
    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load review context')
      setSession(data.session)
      onSessionUpdated?.(data.session)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load review context')
    } finally {
      setLoading(false)
    }
  }, [authToken, onSessionUpdated, sessionId])

  useEffect(() => {
    const persisted = readPersistedPaperReviewMode(sessionId)
    if (persisted) {
      setSelectedMode(persisted)
      hasInitializedModeRef.current = true
    }
  }, [sessionId])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const handleModeChange = useCallback((mode: PaperReviewMode) => {
    setSelectedMode(mode)
    persistPaperReviewMode(sessionId, mode)
  }, [sessionId])

  const draftSections = useMemo(() => parseDraftSections(session), [session])
  const hasDraftContent = useMemo(() => Object.values(draftSections).some(value => String(value || '').trim()), [draftSections])
  const quickReview = useMemo(() => getLatestPaperReviewByMode(session, 'quick'), [session]) as PaperReviewRecord | null
  const detailedReview = useMemo(() => getLatestPaperReviewByMode(session, 'section_by_section'), [session]) as PaperReviewRecord | null
  useEffect(() => {
    if (hasInitializedModeRef.current) return
    if (detailedReview) {
      handleModeChange('section_by_section')
      hasInitializedModeRef.current = true
      return
    }
    if (quickReview) {
      handleModeChange('quick')
      hasInitializedModeRef.current = true
    }
  }, [detailedReview, handleModeChange, quickReview])

  const activeReview = selectedMode === 'section_by_section' ? detailedReview : quickReview
  const readinessMeta = getPaperReviewReadinessMeta(activeReview?.summary.overallReadiness || '')
  const pendingIssues = useMemo(() => (activeReview?.issues || []).filter(issue => issue.status === 'pending'), [activeReview])
  const criticalIssues = pendingIssues.filter(issue => issue.severity === 'critical').length
  const majorIssues = pendingIssues.filter(issue => issue.severity === 'major').length
  const filteredIssues = useMemo(() => {
    const issues = [...pendingIssues].sort((a, b) => {
      const rank = { critical: 0, major: 1, moderate: 2, minor: 3 }
      return rank[a.severity] - rank[b.severity] || a.sectionLabel.localeCompare(b.sectionLabel)
    })
    if (issueFilter === 'critical') return issues.filter(issue => issue.severity === 'critical')
    if (issueFilter === 'major_plus') return issues.filter(issue => issue.severity === 'critical' || issue.severity === 'major')
    if (issueFilter === 'rewrite') return issues.filter(issue => issue.fixType === 'rewrite_fixable')
    if (issueFilter === 'manual') return issues.filter(issue => issue.fixType !== 'rewrite_fixable')
    return issues
  }, [issueFilter, pendingIssues])

  const jumpToSection = useCallback((sectionKey: string) => {
    onSectionSelect?.(sectionKey)
    onNavigateToStage?.('SECTION_DRAFTING')
  }, [onNavigateToStage, onSectionSelect])

  const openImprove = useCallback(() => {
    persistPaperReviewMode(sessionId, selectedMode)
    onNavigateToStage?.('MANUSCRIPT_IMPROVE')
  }, [onNavigateToStage, selectedMode, sessionId])

  const cancelReview = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setRunningReview(false)
    setProgress(null)
    setError('Review run cancelled before completion.')
  }, [])

  const runReview = useCallback(async () => {
    if (!sessionId || !authToken) return
    if (activeReview && !window.confirm('Re-running the review will supersede the latest saved report for this mode. Continue?')) return
    const controller = new AbortController()
    abortControllerRef.current = controller
    setRunningReview(true)
    setError(null)
    setProgress({ reviewMode: selectedMode, phase: 'prepare', message: 'Preparing the review workspace' })
    persistPaperReviewMode(sessionId, selectedMode)
    try {
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action: 'run_manuscript_review',
          sessionId,
          reviewMode: selectedMode,
          stream: true,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Review generation failed')
      }
      let reviewCompleted = true
      if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
        reviewCompleted = await readSseStream(response, payload => setProgress(payload), message => setError(message))
      } else {
        const data = await response.json()
        if (!data.success) throw new Error(data.error || 'Review generation failed')
      }

      if (!reviewCompleted) return

      await loadSession()
      setProgress(current => current ? { ...current, phase: 'complete', message: 'Review report is ready' } : current)
    } catch (runError) {
      if (!controller.signal.aborted) {
        setError(runError instanceof Error ? runError.message : 'Review generation failed')
      }
    } finally {
      abortControllerRef.current = null
      setRunningReview(false)
    }
  }, [activeReview, authToken, loadSession, selectedMode, sessionId])

  if (loading) {
    return <div className="flex min-h-[280px] items-center justify-center text-slate-600"><Loader2 className="mr-3 h-5 w-5 animate-spin" />Loading review workspace...</div>
  }

  if (error && !session) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error}</div>
  }

  if (!hasDraftContent) {
    return (
      <div className="space-y-6 p-6">
        <PaperReviewPipelineStepper currentStage="MANUSCRIPT_REVIEW" onNavigateToStage={stage => onNavigateToStage?.(stage)} canAccessImprove={false} canAccessExport={false} />
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-2xl text-center">
            <BookOpenCheck className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Review starts after section drafting</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Draft at least one section first so the reviewer has enough manuscript context to evaluate structure, evidence, and publication risk.</p>
            <button type="button" onClick={() => onNavigateToStage?.('SECTION_DRAFTING')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Go To Section Drafting<ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <PaperReviewPipelineStepper
        currentStage="MANUSCRIPT_REVIEW"
        onNavigateToStage={stage => onNavigateToStage?.(stage)}
        canAccessImprove={Boolean(quickReview || detailedReview)}
        canAccessExport={Boolean(quickReview || detailedReview)}
      />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eef2ff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                <SearchCheck className="h-3.5 w-3.5" />
                Structured manuscript audit
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Review the manuscript before you revise it</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Run a fast whole-manuscript pass or a detailed section-by-section review. The saved report drives Improve and shows reject-risk drivers, section scores, and reviewer objections.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runReview}
                disabled={runningReview}
                title={activeReview ? 'Re-run this review mode and replace the latest report' : 'Generate a saved review report'}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {activeReview ? 'Re-run Review' : 'Run Review'}
              </button>
              {runningReview ? (
                <button type="button" onClick={cancelReview} title="Cancel this review request" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">
                  Cancel
                </button>
              ) : (
                <button type="button" onClick={openImprove} disabled={!activeReview} title="Open Improve with this review mode selected" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                  Open Improve
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        </div>
      </div>

      <PaperReviewModeSwitcher
        selectedMode={selectedMode}
        onChange={handleModeChange}
        latestRunByMode={{ quick: quickReview?.reviewedAt, section_by_section: detailedReview?.reviewedAt }}
      />

      {runningReview && progress && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Review Progress</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{progress.message}</div>
              <div className="mt-1 text-sm text-slate-500">{progressDetailText(progress)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{progressBadgeLabel(progress)}</div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-slate-900 via-sky-700 to-emerald-600 transition-all duration-500" style={{ width: `${progressPercent(progress)}%` }} />
          </div>
        </div>
      )}

      {!activeReview && (
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">No review report yet</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600">Run the {selectedMode === 'section_by_section' ? 'section-by-section' : 'quick'} review to create the saved report Improve and Export will use next.</p>
            </div>
          </div>
        </div>
      )}

      {activeReview && (
        <>
          <div className={`rounded-[28px] border px-5 py-4 shadow-sm ${pendingIssues.length === 0 ? 'border-emerald-200 bg-emerald-50' : criticalIssues > 0 ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {pendingIssues.length === 0 ? 'All issues in this review are resolved' : criticalIssues > 0 ? `${criticalIssues} critical issue${criticalIssues === 1 ? '' : 's'} should be addressed first` : `${majorIssues} major issue${majorIssues === 1 ? '' : 's'} should be addressed before final polish`}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {pendingIssues.length === 0 ? 'Move to Export once you are ready for final checks.' : `Open Improve to work the saved ${selectedMode === 'section_by_section' ? 'section-by-section' : 'quick'} issue queue without losing context.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={openImprove} title="Open Improve" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  {pendingIssues.length === 0 ? 'Review Improve Queue' : 'Start Fixing'}
                  <ArrowRight className="h-4 w-4" />
                </button>
                {pendingIssues.length === 0 && (
                  <button type="button" onClick={() => onNavigateToStage?.('REVIEW_EXPORT')} title="Open adaptive export" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">
                    Open Adaptive Export
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-4">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Readiness</div>
              <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${readinessMeta.tone}`}>
                {readinessMeta.icon === 'CheckCircle2' && <CheckCircle2 className="h-4 w-4" />}
                {readinessMeta.icon === 'AlertTriangle' && <AlertTriangle className="h-4 w-4" />}
                {readinessMeta.icon === 'ShieldAlert' && <ShieldAlert className="h-4 w-4" />}
                {readinessMeta.icon === 'Info' && <Info className="h-4 w-4" />}
                {readinessMeta.label}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{readinessMeta.description}</p>
              <div className="mt-3 text-xs text-slate-500">Reviewed {formatPaperReviewDateTime(activeReview.reviewedAt)}</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pending Queue</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{activeReview.summary.pendingIssues}</div><div className="mt-2 text-sm text-slate-500">Issues still requiring action</div></div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Critical + Major</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{activeReview.summary.severityCounts.critical + activeReview.summary.severityCounts.major}</div><div className="mt-2 text-sm text-slate-500">{activeReview.summary.severityCounts.critical} critical, {activeReview.summary.severityCounts.major} major</div></div>
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resolved</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{activeReview.summary.fixedIssues + activeReview.summary.ignoredIssues}</div><div className="mt-2 text-sm text-slate-500">{activeReview.summary.fixedIssues} fixed, {activeReview.summary.ignoredIssues} ignored</div></div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Executive Summary</div><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">What reviewers are likely to notice first</h2></div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {activeReview.summary.executiveSummary ? 'Executive summary' : activeReview.summary.readinessRationale ? 'Readiness rationale fallback' : 'No summary returned'}
                </div>
              </div>
              <p className="mt-4 text-sm leading-8 text-slate-700">{activeReview.summary.executiveSummary || activeReview.summary.readinessRationale || 'No executive summary was returned.'}</p>
              {activeReview.summary.rejectRiskDrivers.length > 0 && (
                <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Reject-Risk Drivers</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeReview.summary.rejectRiskDrivers.map(driver => <span key={driver} className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700">{driver}</span>)}
                  </div>
                </div>
              )}
              {activeReview.summary.aggregationSummary && selectedMode === 'section_by_section' && (
                <div className="mt-6 rounded-[28px] border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 text-emerald-800"><span className="font-semibold">Aggregation note:</span> {activeReview.summary.aggregationSummary}</div>
              )}
            </div>

            <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Action Plan</div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Recommended revision order</h2>
              <div className="mt-4 space-y-3">
                {activeReview.summary.actionPlan.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No explicit action plan items were returned.</div>}
                {activeReview.summary.actionPlan.map(item => (
                  <div key={`${item.priority}-${item.title}`} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3"><div className="font-semibold text-slate-900">{item.title}</div><span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{item.priority}</span></div>
                    {item.summary && <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Section Findings</div><h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Which sections need the most attention</h2></div><div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">Scores are rubric-based, not publication guarantees</div></div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeReview.summary.sectionSummaries.map(section => {
                const scoreMeta = getPaperReviewScoreMeta(section.score)
                return (
                  <div key={section.sectionKey} className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4"><div><div className="text-base font-semibold text-slate-900">{section.sectionLabel}</div><div className={`mt-2 text-sm font-medium ${scoreMeta.tone}`}>{scoreMeta.label}</div></div><ScoreRing score={section.score} /></div>
                    <div className="mt-4 space-y-2">{section.weaknesses.slice(0, 3).map(weakness => <div key={weakness} className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-600">{weakness}</div>)}</div>
                    <div className="mt-4 flex justify-end"><button type="button" onClick={() => jumpToSection(section.sectionKey)} title={`Open ${section.sectionLabel} in Section Drafting`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">Open In Editor</button></div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Prioritized Issues</div><h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Everything still requiring action</h2></div>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'all', label: `All (${pendingIssues.length})` },
                  { key: 'critical', label: `Critical (${criticalIssues})` },
                  { key: 'major_plus', label: `Critical + Major (${criticalIssues + majorIssues})` },
                  { key: 'rewrite', label: `AI Fixable (${pendingIssues.filter(issue => issue.fixType === 'rewrite_fixable').length})` },
                  { key: 'manual', label: `Manual / Evidence (${pendingIssues.filter(issue => issue.fixType !== 'rewrite_fixable').length})` },
                ] as const).map(filter => (
                  <button key={filter.key} type="button" onClick={() => setIssueFilter(filter.key)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${issueFilter === filter.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>{filter.label}</button>
                ))}
              </div>
            </div>
            <div className="mt-5 max-h-[980px] space-y-4 overflow-y-auto pr-1">
              {filteredIssues.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No pending issues match the current filter.</div>}
              {filteredIssues.map(issue => {
                const severityMeta = getPaperReviewSeverityMeta(issue.severity)
                const fixTypeMeta = getPaperReviewFixTypeMeta(issue.fixType)
                return (
                  <div key={issue.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                    <div className={`h-1.5 w-full ${severityMeta.rail}`} />
                    <div className="space-y-4 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${severityMeta.tone}`}>{severityMeta.label}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{formatPaperReviewDimension(issue.reviewDimension)}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">{fixTypeMeta.label}</span>
                          </div>
                          <h3 className="mt-3 text-base font-semibold text-slate-900">{issue.title}</h3>
                          <p className="mt-1 text-sm text-slate-500">{issue.sectionLabel}</p>
                        </div>
                        <button type="button" onClick={() => jumpToSection(issue.sectionKey)} title={`Open ${issue.sectionLabel} in Section Drafting`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">Open Section</button>
                      </div>
                      <p className="text-sm leading-7 text-slate-600">{issue.diagnosis}</p>
                      {(issue.impactExplanation || issue.recommendedAction) && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Why It Matters</div><p className="mt-2 text-sm leading-6 text-slate-600">{issue.impactExplanation || 'This issue weakens reviewer confidence and should be addressed before export.'}</p></div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recommended Action</div><p className="mt-2 text-sm leading-6 text-slate-700">{issue.recommendedAction || fixTypeMeta.helper}</p></div>
                        </div>
                      )}
                      <div className="flex justify-end"><button type="button" onClick={openImprove} title="Open Improve and keep this review mode selected" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Start Fixing<ArrowRight className="h-4 w-4" /></button></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <details className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer list-none px-6 py-5"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reviewer Objections</div><div className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{activeReview.summary.reviewerObjections.length} objection{activeReview.summary.reviewerObjections.length === 1 ? '' : 's'}</div></div><div className="text-sm text-slate-500">Expand to inspect the exact reviewer language</div></div></summary>
            <div className="border-t border-slate-100 px-6 pb-6 pt-4 space-y-3">
              {activeReview.summary.reviewerObjections.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No explicit reviewer objections were generated.</div>}
              {activeReview.summary.reviewerObjections.map(objection => {
                const severityMeta = getPaperReviewSeverityMeta(objection.severity)
                return <div key={`${objection.severity}-${objection.title}`} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2"><span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${severityMeta.tone}`}>{severityMeta.label}</span><div className="font-semibold text-slate-900">{objection.title}</div></div><p className="mt-3 text-sm leading-6 text-slate-600">{objection.objection}</p></div>
              })}
            </div>
          </details>

          {selectedMode === 'section_by_section' && (
            <details className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer list-none px-6 py-5"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Section Reviewer Traces</div><div className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{activeReview.summary.sectionReviewTraces.length} trace{activeReview.summary.sectionReviewTraces.length === 1 ? '' : 's'}</div></div><div className="text-sm text-slate-500">Expand to inspect per-section summaries</div></div></summary>
              <div className="border-t border-slate-100 px-6 pb-6 pt-4 grid gap-4 lg:grid-cols-2">
                {activeReview.summary.sectionReviewTraces.map(trace => {
                  const scoreMeta = getPaperReviewScoreMeta(trace.score)
                  return <div key={`${trace.sectionKey}-${trace.promptVariant}`} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{trace.sectionLabel}</div><div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{trace.reviewerType.replace(/_/g, ' ')} · {trace.promptVariant.replace(/_/g, ' ')}</div></div><div className={`text-xl font-semibold ${scoreMeta.tone}`}>{trace.score}</div></div>{trace.executiveSummary && <p className="mt-3 text-sm leading-6 text-slate-600">{trace.executiveSummary}</p>}<div className="mt-4 flex justify-end"><button type="button" onClick={() => jumpToSection(trace.sectionKey)} title={`Open ${trace.sectionLabel} in Section Drafting`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">Open In Editor</button></div></div>
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
