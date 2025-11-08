'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { PageLoadingBird } from '@/components/ui/loading-bird'

// Stage components
import IdeaEntryStage from '@/components/drafting/IdeaEntryStage'
import ComponentPlannerStage from '@/components/drafting/ComponentPlannerStage'
import FigurePlannerStage from '@/components/drafting/FigurePlannerStage'
import AnnexureDraftStage from '@/components/drafting/AnnexureDraftStage'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - file added dynamically during session; type generation will catch up
import RelatedArtStage from '@/components/drafting/RelatedArtStage'
import ReviewFixStage from '@/components/drafting/ReviewFixStage'
import ExportCenterStage from '@/components/drafting/ExportCenterStage'

interface DraftingSession {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  ideaRecord?: any
  referenceMap?: any
  figurePlans?: any[]
  diagramSources?: any[]
  annexureDrafts?: any[]
}

interface Patent {
  id: string
  title: string
  project: {
    id: string
    name: string
  }
}

const STAGE_COMPONENTS = {
  IDEA_ENTRY: IdeaEntryStage,
  COMPONENT_PLANNER: ComponentPlannerStage,
  FIGURE_PLANNER: FigurePlannerStage,
  RELATED_ART: RelatedArtStage,
  ANNEXURE_DRAFT: AnnexureDraftStage,
  REVIEW_FIX: ReviewFixStage,
  EXPORT_READY: ExportCenterStage,
  COMPLETED: ExportCenterStage
}

const STAGE_LABELS = {
  IDEA_ENTRY: 'Idea Entry',
  COMPONENT_PLANNER: 'Component Planner',
  FIGURE_PLANNER: 'Figure Planner',
  RELATED_ART: 'Related Art',
  ANNEXURE_DRAFT: 'Annexure Draft',
  REVIEW_FIX: 'Review & Fix',
  EXPORT_READY: 'Export Center',
  COMPLETED: 'Completed'
}

const STAGE_PROGRESS = {
  IDEA_ENTRY: 12.5,
  COMPONENT_PLANNER: 25,
  FIGURE_PLANNER: 37.5,
  RELATED_ART: 45,
  ANNEXURE_DRAFT: 55,
  REVIEW_FIX: 75,
  EXPORT_READY: 87.5,
  COMPLETED: 100
}

const STAGE_ORDER: Array<keyof typeof STAGE_COMPONENTS> = [
  'IDEA_ENTRY',
  'COMPONENT_PLANNER',
  'FIGURE_PLANNER',
  'RELATED_ART',
  'ANNEXURE_DRAFT',
  'REVIEW_FIX',
  'EXPORT_READY',
  'COMPLETED'
]

export default function PatentDraftingPage() {
  const { user, isLoading: authLoading, refreshUser, logout } = useAuth() as any
  const router = useRouter()
  const params = useParams()
  const patentId = params.patentId as string

  const [patent, setPatent] = useState<Patent | null>(null)
  const [session, setSession] = useState<DraftingSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      loadData()
    }
  }, [authLoading, user, router, patentId])

  const loadData = async () => {
    try {
      setIsLoading(true)

      // Load patent details
      const patentResponse = await fetch(`/api/patents/${patentId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (!patentResponse.ok) {
        throw new Error('Failed to load patent')
      }

      const patentData = await patentResponse.json()
      setPatent(patentData.patent)

      // Load drafting sessions
      const sessionResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json()
        const latest = sessionData.sessions?.[0] || null
        setSession(latest)

        // Auto-resume if no session exists yet
        if (!latest) {
          await resumeSession()
        }
      } else {
        // If GET fails, try resume to recover gracefully
        await resumeSession()
      }

    } catch (err) {
      console.error('Failed to load data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  const resumeSession = async () => {
    try {
      const response = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ action: 'resume' })
      })

      if (!response.ok) {
        throw new Error('Failed to resume drafting')
      }

      const data = await response.json()
      setSession(data.session)
      return data.session
    } catch (err) {
      console.error('Resume session error:', err)
      setError(err instanceof Error ? err.message : 'Failed to resume drafting')
      return null
    }
  }

  const handleStageComplete = async (stageData: any) => {
    const doRequest = async () => {
      return await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(stageData)
      })
    }
    try {
      // Call API to update stage
      let response = await doRequest()
      // Retry once on 401 by refreshing user/token
      if (response.status === 401) {
        try { await refreshUser(localStorage.getItem('auth_token') || undefined) } catch {}
        response = await doRequest()
      }

      if (!response.ok) {
        let message = 'Failed to update stage'
        try {
          const err = await response.json()
          console.log('API error response:', err)
          if (err?.error) message = err.error
        } catch (parseError) {
          console.log('Failed to parse error response:', parseError)
        }
        console.log('Stage update failed:', { status: response.status, message })
        if (response.status === 401) {
          try { logout() } catch {}
          router.push('/login')
          // Avoid throwing after redirect to prevent runtime error on this page
          return null
        }
        throw new Error(message)
      }

      const result = await response.json()

      // For read-only actions, avoid refreshing to preserve local UI state
      const action = stageData?.action
      const skipRefreshActions = [
        'generate_diagrams_llm', 
        'generate_sections', 
        'autosave_sections', 
        'run_review_checks', 
        'preview_export',
        'clear_related_art_selections',
        'related_art_select',
        'save_manual_prior_art'
      ]
      const skipRefresh = skipRefreshActions.includes(action)

      if (action === 'related_art_llm_review' || action === 'related_art_search') {
        // For related art actions, we need the updated session data with new search results/selections,
        // but we don't want to trigger a full `loadData()` which would cause the `RelatedArtStage`
        // to re-mount and lose its local state (filters, selections, etc.).
        // Instead, we'll fetch the latest session data directly.
        console.log('🔄 Handling related_art action: refreshing session data without full reload.')
        try {
          const sessionResponse = await fetch(`/api/patents/${patentId}/drafting`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            }
          })
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json()
            const latest = sessionData.sessions?.[0] || null
            if (latest) {
              setSession(latest) // Update with latest session data including idea bank suggestions
              console.log('✅ Updated session with idea bank suggestions')
            }
          }
        } catch (err) {
          console.error('Failed to refresh session data:', err)
        }
      } else if (!skipRefresh) {
        // Reload session data for other actions
        console.log('🔄 Reloading all data for action:', action)
        await loadData()
      }

      return result
    } catch (err) {
      console.error('Stage completion error:', err)
      throw err
    }
  }

  const getCurrentStage = () => {
    if (!session) return 'IDEA_ENTRY'
    return session.status
  }

  const getStageComponent = () => {
    const stage = getCurrentStage()
    const Component = STAGE_COMPONENTS[stage as keyof typeof STAGE_COMPONENTS]
    return Component || IdeaEntryStage
  }

  const getPrevNextStages = () => {
    const stage = getCurrentStage() as keyof typeof STAGE_COMPONENTS
    const idx = STAGE_ORDER.indexOf(stage)
    const prev = idx > 0 ? STAGE_ORDER[idx - 1] : null
    const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null
    return { prev, next }
  }

  if (authLoading || isLoading) {
    return <PageLoadingBird message="Loading patent drafting..." />
  }

  if (error || !patent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600 mb-4">{error || 'Patent not found'}</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const currentStage = getCurrentStage()
  const StageComponent = getStageComponent()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <Link
                href={`/projects/${patent.project.id}`}
                className="inline-flex items-center text-gray-600 hover:text-gray-900"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Project
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{patent.title}</h1>
                <p className="text-sm text-gray-600">Patent Drafting Workflow</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-gray-500">Stage: {STAGE_LABELS[currentStage as keyof typeof STAGE_LABELS]}</div>
                <div className="text-xs text-gray-400">Progress: {STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}%</div>
              </div>

              {/* Stage Navigation Buttons */}
              {session && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={async () => {
                      const { prev } = getPrevNextStages()
                      if (!prev || !session) return
                      console.log('Navigating to previous stage:', { prev, sessionId: session.id, currentPatentId: patentId })
                      await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: prev })
                    }}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-75 disabled:cursor-not-allowed"
                    disabled={!getPrevNextStages().prev}
                    title="Go to previous stage"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </button>

                  <button
                    onClick={async () => {
                      const { next } = getPrevNextStages()
                      if (!next || !session) return
                      console.log('Navigating to next stage:', { next, sessionId: session.id, currentPatentId: patentId })
                      await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: next })
                    }}
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-75 disabled:cursor-not-allowed"
                    disabled={!getPrevNextStages().next}
                    title="Go to next stage"
                  >
                    Next
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}

              <button
                onClick={resumeSession}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
                title="Resume the latest drafting session for this patent"
              >
                Resume Draft
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}%` }}
                ></div>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}% Complete
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {session ? (
            <StageComponent
              session={session}
              patent={patent}
              onComplete={handleStageComplete}
              onRefresh={loadData}
            />
          ) : (
            <div className="p-8 text-center">
              <div className="text-lg font-medium text-gray-900 mb-2">Loading...</div>
              <div className="text-sm text-gray-600">Please wait while we load your drafting session.</div>
            </div>
          )}
        </div>

        {/* Global Stage Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={async () => {
              const { prev } = getPrevNextStages()
              if (!prev || !session) return
              await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: prev })
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            disabled={!getPrevNextStages().prev}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Previous Stage
          </button>

          <button
            onClick={async () => {
              const { next } = getPrevNextStages()
              if (!next || !session) return
              await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: next })
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            disabled={!getPrevNextStages().next}
          >
            Next Stage
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </main>
    </div>
  )
}
