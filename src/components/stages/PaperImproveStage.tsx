'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'
import InlineTextDiff from '@/components/paper/InlineTextDiff'
import { PaperReviewModeSwitcher, PaperReviewPipelineStepper } from '@/components/stages/PaperReviewWorkflowControls'
import {
  applyPaperReviewFixOptimistically,
  getLatestPaperReviewByMode,
  resolvePaperReviewIssueOptimistically,
  revertPaperReviewFixOptimistically,
  updatePaperDraftSectionInSession,
  upsertPaperReviewIntoSession,
} from '@/lib/paper-review-utils'
import {
  formatPaperReviewDateTime,
  formatPaperReviewDimension,
  getPaperReviewFixTypeMeta,
  getPaperReviewSeverityMeta,
  persistPaperReviewMode,
  readPersistedPaperReviewMode,
} from '@/lib/paper-review-ui'
import type { PaperReviewIssue, PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
  onSectionSelect?: (sectionKey: string) => void
}

type FixPreview = {
  issueId: string
  reviewId: string
  sectionKey: string
  sectionLabel: string
  title: string
  originalContent: string
  fixedContent: string
}

function updateSession(
  session: any,
  review: PaperReviewRecord,
  onSessionUpdated?: (session: any) => void,
  sectionUpdate?: { sectionKey: string; content: string }
) {
  let nextSession = upsertPaperReviewIntoSession(session, review)
  if (sectionUpdate) {
    nextSession = updatePaperDraftSectionInSession(nextSession, sectionUpdate.sectionKey, sectionUpdate.content)
  }
  onSessionUpdated?.(nextSession)
  return nextSession
}

export default function PaperImproveStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
  onSectionSelect,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FixPreview | null>(null)
  const [previewingIssueId, setPreviewingIssueId] = useState<string | null>(null)
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null)
  const [resolvingIssueId, setResolvingIssueId] = useState<string | null>(null)
  const [revertingIssueId, setRevertingIssueId] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<PaperReviewMode>('quick')
  const [hasInitializedMode, setHasInitializedMode] = useState(false)

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return
    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load improvement workspace')
      setSession(data.session)
      onSessionUpdated?.(data.session)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load improvement workspace')
    } finally {
      setLoading(false)
    }
  }, [authToken, onSessionUpdated, sessionId])

  useEffect(() => {
    const persisted = readPersistedPaperReviewMode(sessionId)
    if (persisted) {
      setSelectedMode(persisted)
      setHasInitializedMode(true)
    }
  }, [sessionId])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  const handleModeChange = useCallback((mode: PaperReviewMode) => {
    setSelectedMode(mode)
    persistPaperReviewMode(sessionId, mode)
    setPreview(null)
  }, [sessionId])

  const quickReview = useMemo(() => getLatestPaperReviewByMode(session, 'quick'), [session]) as PaperReviewRecord | null
  const detailedReview = useMemo(() => getLatestPaperReviewByMode(session, 'section_by_section'), [session]) as PaperReviewRecord | null
  useEffect(() => {
    if (hasInitializedMode) return
    if (detailedReview) {
      handleModeChange('section_by_section')
      setHasInitializedMode(true)
      return
    }
    if (quickReview) {
      handleModeChange('quick')
      setHasInitializedMode(true)
    }
  }, [detailedReview, handleModeChange, hasInitializedMode, quickReview])

  const latestReview = selectedMode === 'section_by_section' ? detailedReview : quickReview
  const rewriteIssues = useMemo(() => latestReview?.issues.filter(issue => issue.fixType === 'rewrite_fixable' && issue.status === 'pending') || [], [latestReview])
  const manualIssues = useMemo(() => latestReview?.issues.filter(issue => issue.fixType !== 'rewrite_fixable' && issue.status === 'pending') || [], [latestReview])
  const resolvedIssues = useMemo(() => latestReview?.issues.filter(issue => issue.status !== 'pending') || [], [latestReview])
  const groupedRewriteIssues = useMemo(() => rewriteIssues.reduce<Record<string, { label: string; items: PaperReviewIssue[] }>>((acc, issue) => {
    if (!acc[issue.sectionKey]) acc[issue.sectionKey] = { label: issue.sectionLabel, items: [] }
    acc[issue.sectionKey].items.push(issue)
    return acc
  }, {}), [rewriteIssues])

  const jumpToSection = useCallback((sectionKey: string) => {
    onSectionSelect?.(sectionKey)
    onNavigateToStage?.('SECTION_DRAFTING')
  }, [onNavigateToStage, onSectionSelect])

  const previewFix = useCallback(async (issue: PaperReviewIssue) => {
    if (!sessionId || !authToken || !latestReview) return
    try {
      setPreviewingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'preview_review_fix',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to preview improvement')
      setPreview({
        issueId: issue.id,
        reviewId: latestReview.reviewId,
        sectionKey: issue.sectionKey,
        sectionLabel: issue.sectionLabel,
        title: issue.title,
        originalContent: String(data.originalContent || ''),
        fixedContent: String(data.fixedContent || ''),
      })
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview improvement')
    } finally {
      setPreviewingIssueId(null)
    }
  }, [authToken, latestReview, sessionId])

  const applyPreview = useCallback(async () => {
    if (!preview || !authToken || !sessionId || !latestReview || !session) return
    try {
      setApplyingIssueId(preview.issueId)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'apply_review_fix',
          sessionId,
          reviewId: preview.reviewId,
          issueId: preview.issueId,
          originalContent: preview.originalContent,
          fixedContent: preview.fixedContent,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to apply improvement')
      const nextReview = applyPaperReviewFixOptimistically(latestReview, preview.issueId, preview.originalContent, preview.fixedContent, data.appliedAt)
      setSession(updateSession(session, nextReview, onSessionUpdated, { sectionKey: preview.sectionKey, content: preview.fixedContent }))
      setPreview(null)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply improvement')
    } finally {
      setApplyingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, preview, session, sessionId])

  const resolveIssue = useCallback(async (issue: PaperReviewIssue, resolution: 'fixed' | 'ignored') => {
    if (!authToken || !latestReview || !sessionId || !session) return
    try {
      setResolvingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'resolve_review_issue',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
          resolution,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to update issue status')
      const nextReview = resolvePaperReviewIssueOptimistically(latestReview, issue.id, resolution, data.appliedAt)
      setSession(updateSession(session, nextReview, onSessionUpdated))
      if (preview?.issueId === issue.id) setPreview(null)
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Unable to update issue status')
    } finally {
      setResolvingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, preview?.issueId, session, sessionId])

  const revertFix = useCallback(async (issue: PaperReviewIssue) => {
    if (!authToken || !latestReview || !sessionId || !session) return
    try {
      setRevertingIssueId(issue.id)
      setError(null)
      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'revert_review_fix',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to revert fix')
      const nextReview = revertPaperReviewFixOptimistically(latestReview, issue.id, data.revertedAt)
      setSession(updateSession(session, nextReview, onSessionUpdated, { sectionKey: data.sectionKey, content: data.revertedContent }))
    } catch (revertError) {
      setError(revertError instanceof Error ? revertError.message : 'Unable to revert fix')
    } finally {
      setRevertingIssueId(null)
    }
  }, [authToken, latestReview, onSessionUpdated, session, sessionId])

  if (loading) {
    return <div className="flex min-h-[280px] items-center justify-center text-slate-600"><Loader2 className="mr-3 h-5 w-5 animate-spin" />Loading improvement workspace...</div>
  }

  if (error && !session) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{error}</div>
  }

  if (!latestReview) {
    return (
      <div className="space-y-6 p-6">
        <PaperReviewPipelineStepper currentStage="MANUSCRIPT_IMPROVE" onNavigateToStage={stage => onNavigateToStage?.(stage)} canAccessImprove={false} canAccessExport={false} />
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-2xl text-center">
            <Sparkles className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Improve depends on a saved review</h2>
            <p className="mt-2 text-sm text-slate-600">Run the Review stage first. Improve applies actions from the latest saved report in the selected review mode.</p>
            <button type="button" onClick={() => onNavigateToStage?.('MANUSCRIPT_REVIEW')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Go To Review<ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <PaperReviewPipelineStepper
        currentStage="MANUSCRIPT_IMPROVE"
        onNavigateToStage={stage => onNavigateToStage?.(stage)}
        canAccessImprove
        canAccessExport
      />

      <div className="rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(5,150,105,0.08),_transparent_45%),linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#ecfeff_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Wrench className="h-3.5 w-3.5" />Recommendation execution</div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Resolve the review queue without losing control</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">Preview AI rewrites before applying them, dismiss issues that should not block progress, mark evidence/manual items as resolved, and undo applied fixes when they are not good enough.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Review basis: {formatPaperReviewDateTime(latestReview.reviewedAt)}</div>
          </div>
          {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        </div>
      </div>

      <PaperReviewModeSwitcher
        selectedMode={selectedMode}
        onChange={handleModeChange}
        latestRunByMode={{ quick: quickReview?.reviewedAt, section_by_section: detailedReview?.reviewedAt }}
        noun="improvement pass"
      />

      {latestReview.summary.pendingIssues === 0 && (
        <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">All issues in this review are addressed</div>
              <p className="mt-1 text-sm leading-6 text-slate-600">The saved review queue is clear. Continue to Export for the final structural and citation checks.</p>
            </div>
            <button type="button" onClick={() => onNavigateToStage?.('REVIEW_EXPORT')} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Proceed To Export<ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Rewrite Queue</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{rewriteIssues.length}</div><div className="mt-2 text-sm text-slate-500">Preview and apply here</div></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Manual / Evidence</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{manualIssues.length}</div><div className="mt-2 text-sm text-slate-500">Need your decision or evidence</div></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resolved</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{resolvedIssues.length}</div><div className="mt-2 text-sm text-slate-500">Fixed or dismissed</div></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pending Total</div><div className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">{latestReview.summary.pendingIssues}</div><div className="mt-2 text-sm text-slate-500">Across every review dimension</div></div>
      </div>

      {preview && (
        <div className="rounded-[32px] border border-emerald-300 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-emerald-50 px-6 py-4">
            <div><div className="text-sm font-semibold text-emerald-800">Preview improvement</div><div className="mt-1 text-sm text-emerald-700">{preview.sectionLabel}: {preview.title}</div></div>
            <button type="button" onClick={() => setPreview(null)} className="rounded-lg px-2 py-1 text-sm text-emerald-700 hover:bg-emerald-100">Close</button>
          </div>
          <div className="p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><InlineTextDiff original={preview.originalContent} revised={preview.fixedContent} /></div>
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setPreview(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={applyPreview} disabled={applyingIssueId === preview.issueId} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                {applyingIssueId === preview.issueId && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply Improvement
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Rewrite-Fixable Issues</div><h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Preview before you apply</h2></div><div className="text-xs text-slate-500">No hidden caps: the full queue is shown below.</div></div>
          {rewriteIssues.length === 0 && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No AI-rewrite issues remain pending in this review.</div>}
          <div className="mt-5 max-h-[1100px] space-y-6 overflow-y-auto pr-1">
            {Object.entries(groupedRewriteIssues).map(([sectionKey, group]) => (
              <div key={sectionKey}>
                <div className="mb-3 flex items-center justify-between gap-3"><div className="text-sm font-semibold text-slate-900">{group.label}</div><button type="button" onClick={() => jumpToSection(sectionKey)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">Open Section</button></div>
                <div className="space-y-3">
                  {group.items.map(issue => {
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
                              <div className="mt-3 text-base font-semibold text-slate-900">{issue.title}</div>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{issue.diagnosis}</p>
                            </div>
                          </div>
                          {issue.recommendedAction && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{issue.recommendedAction}</div>}
                          <div className="flex flex-wrap justify-end gap-3">
                            <button type="button" onClick={() => resolveIssue(issue, 'ignored')} disabled={resolvingIssueId === issue.id || previewingIssueId === issue.id || applyingIssueId === issue.id} title="Dismiss this issue without changing manuscript text" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"><XCircle className="h-4 w-4" />Dismiss</button>
                            <button type="button" onClick={() => previewFix(issue)} disabled={previewingIssueId === issue.id || applyingIssueId === issue.id || resolvingIssueId === issue.id} title="Preview the AI rewrite before applying it" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                              {previewingIssueId === issue.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                              Preview Improvement
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Manual / Evidence Queue</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Resolve what AI should not rewrite</h2>
            <div className="mt-4 max-h-[540px] space-y-3 overflow-y-auto pr-1">
              {manualIssues.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No manual or evidence-dependent issues are pending.</div>}
              {manualIssues.map(issue => {
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
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">{fixTypeMeta.label}</span>
                          </div>
                          <div className="mt-3 text-base font-semibold text-slate-900">{issue.title}</div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{issue.recommendedAction || issue.diagnosis}</p>
                        </div>
                        <button type="button" onClick={() => jumpToSection(issue.sectionKey)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">Open Section</button>
                      </div>
                      <div className="flex flex-wrap justify-end gap-3">
                        <button type="button" onClick={() => resolveIssue(issue, 'ignored')} disabled={resolvingIssueId === issue.id} title="Dismiss this issue from the queue" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"><XCircle className="h-4 w-4" />Dismiss</button>
                        <button type="button" onClick={() => resolveIssue(issue, 'fixed')} disabled={resolvingIssueId === issue.id} title="Mark this issue as resolved after handling it manually" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                          {resolvingIssueId === issue.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Mark Resolved
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resolved From This Review</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Undo or inspect resolved items</h2>
            <div className="mt-4 max-h-[540px] space-y-3 overflow-y-auto pr-1">
              {resolvedIssues.length === 0 && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No issues have been resolved yet.</div>}
              {resolvedIssues.map(issue => {
                const statusTone = issue.status === 'fixed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'
                const canUndo = issue.status === 'fixed' && latestReview.appliedFixes.some(entry => entry.issueId === issue.id && entry.status === 'fixed' && typeof entry.beforeText === 'string')
                return (
                  <div key={issue.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><div className="font-semibold text-slate-900">{issue.title}</div></div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{issue.sectionLabel}</span><span>·</span><span className={`rounded-full border px-2 py-0.5 font-semibold ${statusTone}`}>{issue.status}</span></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => jumpToSection(issue.sectionKey)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">Open Section</button>
                        {canUndo && (
                          <button type="button" onClick={() => revertFix(issue)} disabled={revertingIssueId === issue.id} title="Restore the section text from before this AI fix was applied" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60">
                            {revertingIssueId === issue.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
