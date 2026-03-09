'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { getLatestPaperReviewByMode } from '@/lib/paper-review-utils'
import type { PaperReviewMode, PaperReviewRecord } from '@/types/paper-review'

type StageProps = {
  sessionId: string
  authToken: string | null
  onSessionUpdated?: (session: any) => void
  onNavigateToStage?: (stage: string) => void
}

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

  return typeof paperDraft.extraSections === 'object'
    ? paperDraft.extraSections as Record<string, string>
    : {}
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

function readinessTone(readiness: string) {
  if (readiness === 'near_submission_ready') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (readiness === 'requires_moderate_revision') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (readiness === 'requires_major_revision') return 'text-orange-700 bg-orange-50 border-orange-200'
  return 'text-rose-700 bg-rose-50 border-rose-200'
}

export default function PaperReviewStage({
  sessionId,
  authToken,
  onSessionUpdated,
  onNavigateToStage,
}: StageProps) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [runningReview, setRunningReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        throw new Error(data.error || 'Failed to load review context')
      }

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
    void loadSession()
  }, [loadSession])

  const draftSections = useMemo(() => parseDraftSections(session), [session])
  const hasDraftContent = useMemo(
    () => Object.values(draftSections).some(value => String(value || '').trim().length > 0),
    [draftSections]
  )
  const quickReview = useMemo(() => getLatestPaperReviewByMode(session, 'quick'), [session]) as PaperReviewRecord | null
  const detailedReview = useMemo(() => getLatestPaperReviewByMode(session, 'section_by_section'), [session]) as PaperReviewRecord | null
  const activeReview = selectedMode === 'section_by_section' ? detailedReview : quickReview

  const runReview = useCallback(async () => {
    if (!sessionId || !authToken) return

    try {
      setRunningReview(true)
      setError(null)

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
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Review generation failed')
      }

      await loadSession()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Review generation failed')
    } finally {
      setRunningReview(false)
    }
  }, [authToken, loadSession, selectedMode, sessionId])

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading review workspace...</span>
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
            <div className="font-semibold">Unable to load manuscript review</div>
            <div className="mt-1 text-sm">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!hasDraftContent) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto max-w-2xl text-center">
          <BookOpenCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Review starts after section drafting</h2>
          <p className="mt-2 text-sm text-slate-600">
            This stage audits the current manuscript and generates a structured report for revision planning.
            Draft at least one section first.
          </p>
          <button
            type="button"
            onClick={() => onNavigateToStage?.('SECTION_DRAFTING')}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go To Section Drafting
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
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              <BookOpenCheck className="h-3.5 w-3.5" />
              Structured manuscript audit
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Review</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              This stage runs a structured manuscript review across sections, cross-section consistency,
              citations, rigor, positioning, language quality, and figure alignment where figure data exists.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runReview}
              disabled={runningReview}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {activeReview ? 'Re-run Review' : 'Run Review'}
            </button>
            {activeReview && (
              <button
                type="button"
                onClick={() => onNavigateToStage?.('MANUSCRIPT_IMPROVE')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                Open Improve
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
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
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">Quick Review</div>
          <div className="mt-2 text-lg font-semibold">Whole-manuscript fast pass</div>
          <p className={`mt-2 text-sm leading-6 ${selectedMode === 'quick' ? 'text-slate-200' : 'text-slate-600'}`}>
            Single-pass review across the full paper. Faster and useful for broad diagnostics.
          </p>
          {quickReview && (
            <div className={`mt-3 text-xs ${selectedMode === 'quick' ? 'text-slate-300' : 'text-slate-500'}`}>
              Latest run: {new Date(quickReview.reviewedAt).toLocaleString()}
            </div>
          )}
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
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">Section-By-Section Review</div>
          <div className="mt-2 text-lg font-semibold">Detailed per-section reviewers + aggregation</div>
          <p className={`mt-2 text-sm leading-6 ${selectedMode === 'section_by_section' ? 'text-emerald-50' : 'text-slate-600'}`}>
            Specialized prompts review each section individually, then an aggregation pass produces manuscript-level findings.
          </p>
          {detailedReview && (
            <div className={`mt-3 text-xs ${selectedMode === 'section_by_section' ? 'text-emerald-100' : 'text-slate-500'}`}>
              Latest run: {new Date(detailedReview.reviewedAt).toLocaleString()}
            </div>
          )}
        </button>
      </div>

      {!activeReview && (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="max-w-2xl">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">No review report yet</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Run the {selectedMode === 'section_by_section' ? 'section-by-section' : 'quick'} review to generate a structured report with findings, objections, readiness assessment, and a prioritized action plan.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeReview && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Overall Readiness</div>
              <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-sm font-medium ${readinessTone(activeReview.summary.overallReadiness)}`}>
                {activeReview.summary.overallReadiness.replace(/_/g, ' ')}
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Reviewed {new Date(activeReview.reviewedAt).toLocaleString()}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Issues</div>
              <div className="mt-3 text-3xl font-semibold text-slate-900">{activeReview.summary.totalIssues}</div>
              <div className="mt-1 text-sm text-slate-500">
                {activeReview.summary.pendingIssues} pending
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Critical + Major</div>
              <div className="mt-3 text-3xl font-semibold text-slate-900">
                {activeReview.summary.severityCounts.critical + activeReview.summary.severityCounts.major}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {activeReview.summary.severityCounts.critical} critical, {activeReview.summary.severityCounts.major} major
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Resolved</div>
              <div className="mt-3 text-3xl font-semibold text-slate-900">{activeReview.summary.fixedIssues}</div>
              <div className="mt-1 text-sm text-slate-500">
                {activeReview.summary.ignoredIssues} ignored
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Executive Summary</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {activeReview.summary.executiveSummary || activeReview.summary.readinessRationale || 'No executive summary was returned.'}
              </p>

              {activeReview.summary.rejectRiskDrivers.length > 0 && (
                <div className="mt-6">
                  <div className="text-sm font-semibold text-slate-900">Reject-risk drivers</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeReview.summary.rejectRiskDrivers.map(driver => (
                      <span
                        key={driver}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700"
                      >
                        {driver}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {activeReview.summary.revisionPriorities.length > 0 && (
                <div className="mt-6">
                  <div className="text-sm font-semibold text-slate-900">Revision priorities</div>
                  <div className="mt-3 space-y-2">
                    {activeReview.summary.revisionPriorities.map(priority => (
                      <div key={priority} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {priority}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeReview.summary.aggregationSummary && selectedMode === 'section_by_section' && (
                <div className="mt-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <span className="font-semibold">Aggregation note:</span> {activeReview.summary.aggregationSummary}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Action Plan</h2>
              <div className="mt-4 space-y-3">
                {activeReview.summary.actionPlan.length === 0 && (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No explicit action plan items were returned.
                  </div>
                )}
                {activeReview.summary.actionPlan.map(item => (
                  <div key={`${item.priority}-${item.title}`} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-900">{item.title}</div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                        {item.priority}
                      </span>
                    </div>
                    {item.summary && (
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>
                    )}
                    {item.issueIds.length > 0 && (
                      <div className="mt-3 text-xs text-slate-500">
                        Linked issues: {item.issueIds.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-900">Section Findings</h2>
              <div className="text-xs text-slate-500">Scores are rubric-based, not publication guarantees.</div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeReview.summary.sectionSummaries.length === 0 && (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No section summaries were returned.
                </div>
              )}
              {activeReview.summary.sectionSummaries.map(section => (
                <div key={section.sectionKey} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{section.sectionLabel}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{section.status}</div>
                    </div>
                    <div className="text-2xl font-semibold text-slate-900">{section.score}</div>
                  </div>
                  {section.weaknesses.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weaknesses</div>
                      <div className="mt-2 space-y-2">
                        {section.weaknesses.slice(0, 3).map(weakness => (
                          <div key={weakness} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            {weakness}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {selectedMode === 'section_by_section' && activeReview.summary.sectionReviewTraces.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Section Reviewer Traces</h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {activeReview.summary.sectionReviewTraces.map(trace => (
                  <div key={`${trace.sectionKey}-${trace.promptVariant}`} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{trace.sectionLabel}</div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                          {trace.reviewerType.replace(/_/g, ' ')} · {trace.promptVariant.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <div className="text-2xl font-semibold text-slate-900">{trace.score}</div>
                    </div>
                    {trace.executiveSummary && (
                      <p className="mt-3 text-sm leading-6 text-slate-600">{trace.executiveSummary}</p>
                    )}
                    {trace.issueIds.length > 0 && (
                      <div className="mt-3 text-xs text-slate-500">
                        Linked issues: {trace.issueIds.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Prioritized Issues</h2>
              <div className="mt-4 space-y-3">
                {activeReview.issues.length === 0 && (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No review issues were returned.
                  </div>
                )}
                {activeReview.issues.slice(0, 12).map(issue => (
                  <div key={issue.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityTone(issue.severity)}`}>
                        {issue.severity}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                        {issue.reviewDimension.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-slate-500">{issue.sectionLabel}</span>
                    </div>
                    <div className="mt-3 font-medium text-slate-900">{issue.title}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{issue.diagnosis}</p>
                    {issue.recommendedAction && (
                      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <span className="font-medium">Recommended action:</span> {issue.recommendedAction}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Reviewer Objections</h2>
              <div className="mt-4 space-y-3">
                {activeReview.summary.reviewerObjections.length === 0 && (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No explicit reviewer objections were generated.
                  </div>
                )}
                {activeReview.summary.reviewerObjections.map(objection => (
                  <div key={`${objection.severity}-${objection.title}`} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityTone(objection.severity)}`}>
                        {objection.severity}
                      </span>
                      <div className="font-medium text-slate-900">{objection.title}</div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{objection.objection}</p>
                    {objection.impact && (
                      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <span className="font-medium">Impact:</span> {objection.impact}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
