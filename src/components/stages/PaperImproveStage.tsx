'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wrench,
} from 'lucide-react'
import InlineTextDiff from '@/components/paper/InlineTextDiff'
import { getLatestPaperReviewByMode } from '@/lib/paper-review-utils'
import type { PaperReviewIssue, PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
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

function severityTone(severity: string) {
  switch (severity) {
    case 'critical':
      return 'bg-rose-50 text-rose-700 border-rose-200'
    case 'major':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'moderate':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200'
  }
}

function fixTypeTone(fixType: string) {
  switch (fixType) {
    case 'rewrite_fixable':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'evidence_fixable':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200'
  }
}

export default function PaperImproveStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FixPreview | null>(null)
  const [previewingIssueId, setPreviewingIssueId] = useState<string | null>(null)
  const [applyingIssueId, setApplyingIssueId] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<PaperReviewMode>('quick')

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return

    try {
      setLoading(true)
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load improvement workspace')
      }

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
    void loadSession()
  }, [loadSession])

  const quickReview = useMemo(() => getLatestPaperReviewByMode(session, 'quick'), [session]) as PaperReviewRecord | null
  const detailedReview = useMemo(() => getLatestPaperReviewByMode(session, 'section_by_section'), [session]) as PaperReviewRecord | null
  const latestReview = selectedMode === 'section_by_section' ? detailedReview : quickReview

  useEffect(() => {
    if (selectedMode === 'section_by_section' && !detailedReview && quickReview) {
      setSelectedMode('quick')
    }
  }, [selectedMode, detailedReview, quickReview])
  const rewriteIssues = useMemo(
    () => latestReview?.issues.filter(issue => issue.fixType === 'rewrite_fixable' && issue.status === 'pending') || [],
    [latestReview]
  )
  const nonRewriteIssues = useMemo(
    () => latestReview?.issues.filter(issue => issue.fixType !== 'rewrite_fixable' && issue.status === 'pending') || [],
    [latestReview]
  )
  const resolvedIssues = useMemo(
    () => latestReview?.issues.filter(issue => issue.status !== 'pending') || [],
    [latestReview]
  )

  const groupedRewriteIssues = useMemo(() => {
    return rewriteIssues.reduce<Record<string, { label: string; items: PaperReviewIssue[] }>>((accumulator, issue) => {
      if (!accumulator[issue.sectionKey]) {
        accumulator[issue.sectionKey] = {
          label: issue.sectionLabel,
          items: [],
        }
      }
      accumulator[issue.sectionKey].items.push(issue)
      return accumulator
    }, {})
  }, [rewriteIssues])

  const previewFix = useCallback(async (issue: PaperReviewIssue) => {
    if (!sessionId || !authToken || !latestReview) return

    try {
      setPreviewingIssueId(issue.id)
      setError(null)

      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action: 'preview_review_fix',
          sessionId,
          reviewId: latestReview.reviewId,
          issueId: issue.id,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to preview improvement')
      }

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
    if (!preview || !authToken || !sessionId) return

    try {
      setApplyingIssueId(preview.issueId)
      setError(null)

      const response = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
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
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to apply improvement')
      }

      setPreview(null)
      await loadSession()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply improvement')
    } finally {
      setApplyingIssueId(null)
    }
  }, [authToken, loadSession, preview, sessionId])

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading improvement workspace...</span>
        </div>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5" />
          <div>
            <div className="font-semibold">Unable to load manuscript improvement</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!latestReview) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto max-w-2xl text-center">
          <Sparkles className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Improve depends on a saved review</h2>
          <p className="mt-2 text-sm text-slate-600">
            Run the Review stage first. Improve only applies recommendations from the latest persisted review report.
          </p>
          <button
            type="button"
            onClick={() => onNavigateToStage?.('MANUSCRIPT_REVIEW')}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go To Review
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <Wrench className="h-3.5 w-3.5" />
              Recommendation execution
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Improve</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This stage executes the latest review recommendations on the manuscript. Rewrite-fixable issues can
              be previewed and applied section by section; evidence-dependent issues remain visible for manual follow-up.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Review basis: {new Date(latestReview.reviewedAt).toLocaleString()}
          </div>
        </div>
        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setSelectedMode('quick')}
          className={`rounded-3xl border p-5 text-left shadow-sm transition ${
            selectedMode === 'quick'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">Quick Review Improve</div>
          <div className="mt-2 text-lg font-semibold">Use the quick review issue queue</div>
          <p className={`mt-2 text-sm leading-6 ${selectedMode === 'quick' ? 'text-slate-200' : 'text-slate-600'}`}>
            Good for broad cleanup from the fast whole-manuscript reviewer.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedMode('section_by_section')}
          className={`rounded-3xl border p-5 text-left shadow-sm transition ${
            selectedMode === 'section_by_section'
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">Detailed Improve</div>
          <div className="mt-2 text-lg font-semibold">Use the section-by-section reviewer remarks</div>
          <p className={`mt-2 text-sm leading-6 ${selectedMode === 'section_by_section' ? 'text-emerald-50' : 'text-slate-600'}`}>
            Tied directly to the detailed section reviewers and aggregation report.
          </p>
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rewrite Queue</div>
          <div className="mt-3 text-3xl font-semibold text-slate-900">{rewriteIssues.length}</div>
          <div className="mt-1 text-sm text-slate-500">Actionable in this stage</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Manual / Evidence</div>
          <div className="mt-3 text-3xl font-semibold text-slate-900">{nonRewriteIssues.length}</div>
          <div className="mt-1 text-sm text-slate-500">Need evidence or author decision</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Resolved</div>
          <div className="mt-3 text-3xl font-semibold text-slate-900">{resolvedIssues.length}</div>
          <div className="mt-1 text-sm text-slate-500">Fixed or ignored</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending Total</div>
          <div className="mt-3 text-3xl font-semibold text-slate-900">{latestReview.summary.pendingIssues}</div>
          <div className="mt-1 text-sm text-slate-500">Across all review dimensions</div>
        </div>
      </div>

      {preview && (
        <div className="rounded-3xl border-2 border-emerald-300 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-emerald-50 px-6 py-4">
            <div>
              <div className="text-sm font-semibold text-emerald-800">Preview improvement</div>
              <div className="mt-1 text-sm text-emerald-700">
                {preview.sectionLabel}: {preview.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-lg px-2 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
            >
              Close
            </button>
          </div>
          <div className="p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <InlineTextDiff original={preview.originalContent} revised={preview.fixedContent} />
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyPreview}
                disabled={applyingIssueId === preview.issueId}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applyingIssueId === preview.issueId && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply Improvement
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Rewrite-Fixable Issues</h2>
            <div className="text-xs text-slate-500">Preview before applying to the draft.</div>
          </div>

          {rewriteIssues.length === 0 && (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              No rewrite-fixable issues remain pending in the latest review.
            </div>
          )}

          <div className="mt-4 space-y-6">
            {Object.entries(groupedRewriteIssues).map(([sectionKey, group]) => (
              <div key={sectionKey}>
                <div className="mb-3 text-sm font-semibold text-slate-900">{group.label}</div>
                <div className="space-y-3">
                  {group.items.map(issue => (
                    <div key={issue.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityTone(issue.severity)}`}>
                          {issue.severity}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${fixTypeTone(issue.fixType)}`}>
                          {issue.fixType.replace(/_/g, ' ')}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                          {issue.reviewDimension.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-3 font-medium text-slate-900">{issue.title}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{issue.diagnosis}</p>
                      {issue.recommendedAction && (
                        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <span className="font-medium">Recommended action:</span> {issue.recommendedAction}
                        </div>
                      )}
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => previewFix(issue)}
                          disabled={previewingIssueId === issue.id || applyingIssueId === issue.id}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {previewingIssueId === issue.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          Preview Improvement
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Needs Manual Follow-Up</h2>
            <div className="mt-4 space-y-3">
              {nonRewriteIssues.length === 0 && (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No evidence-dependent or manual-only issues are pending.
                </div>
              )}
              {nonRewriteIssues.map(issue => (
                <div key={issue.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityTone(issue.severity)}`}>
                      {issue.severity}
                    </span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${fixTypeTone(issue.fixType)}`}>
                      {issue.fixType.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="mt-3 font-medium text-slate-900">{issue.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{issue.recommendedAction || issue.diagnosis}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Resolved From This Review</h2>
            <div className="mt-4 space-y-3">
              {resolvedIssues.length === 0 && (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No issues have been resolved yet.
                </div>
              )}
              {resolvedIssues.slice(0, 10).map(issue => (
                <div key={issue.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <div className="font-medium text-slate-900">{issue.title}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {issue.sectionLabel} · {issue.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
