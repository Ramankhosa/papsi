'use client'


import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PageLoadingBird } from '@/components/ui/loading-bird'

// Stage components
import IdeaEntryStage from '@/components/drafting/IdeaEntryStage'
import ComponentPlannerStage from '@/components/drafting/ComponentPlannerStage'
import FigurePlannerStage from '@/components/drafting/FigurePlannerStage'
import AnnexureDraftStage from '@/components/drafting/AnnexureDraftStage'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - file added dynamically during session; type generation will catch up
import RelatedArtStage from '@/components/drafting/RelatedArtStage'
import CountryWiseDraftStage from '@/components/drafting/CountryWiseDraftStage'
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

interface PatentUsageMetrics {
  patent_id: string
  total_input_tokens: number
  total_output_tokens: number
  tokens_by_model: Array<{ model: string; inputTokens: number; outputTokens: number }>
  tokens_by_task: Array<{ task: string; inputTokens: number; outputTokens: number }>
}

const STAGE_COMPONENTS = {
  IDEA_ENTRY: IdeaEntryStage,
  COMPONENT_PLANNER: ComponentPlannerStage,
  FIGURE_PLANNER: FigurePlannerStage,
  RELATED_ART: RelatedArtStage,
  COUNTRY_WISE_DRAFTING: CountryWiseDraftStage,
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
  COUNTRY_WISE_DRAFTING: 'Country-wise Drafting',
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
  COUNTRY_WISE_DRAFTING: 50,
  ANNEXURE_DRAFT: 60,
  REVIEW_FIX: 80,
  EXPORT_READY: 87.5,
  COMPLETED: 100
}

const STAGE_ORDER: Array<keyof typeof STAGE_COMPONENTS> = [
  'IDEA_ENTRY',
  'COMPONENT_PLANNER',
  'FIGURE_PLANNER',
  'RELATED_ART',
  'COUNTRY_WISE_DRAFTING',
  'ANNEXURE_DRAFT',
  'REVIEW_FIX',
  'EXPORT_READY',
  'COMPLETED'
]

export default function PatentDraftingPage() {
  const { user, isLoading: authLoading, refreshUser, logout } = useAuth() as any
  const router = useRouter()
  const params = useParams()
  const patentId = params?.patentId as string

  const [patent, setPatent] = useState<Patent | null>(null)
  const [session, setSession] = useState<DraftingSession | null>(null)
  const [styleStatus, setStyleStatus] = useState<{ enabled: boolean; sections: string[]; profile?: { version: number; status: string; updatedAt: string } | null } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<PatentUsageMetrics | null>(null)

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

        // Fetch style integration status (best-effort)
        try {
          const ss = await fetch(`/api/patents/${patentId}/drafting/style-status`, {
            headers: {
              "Authorization": `Bearer ${localStorage.getItem('auth_token')}`
            }
          })
          if (ss.ok) {
            const data = await ss.json()
            setStyleStatus(data)
          } else {
            setStyleStatus(null)
          }
        } catch {
          setStyleStatus(null)
        }
        // Auto-resume if no session exists yet
        if (!latest) {
          await resumeSession()
        }
      } else {
        // If GET fails, try resume to recover gracefully
        await resumeSession()
      }

      // Load per-patent LLM usage (best-effort; non-blocking)
      try {
        const usageResponse = await fetch(`/api/patents/${patentId}/usage`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })
        if (usageResponse.ok) {
          const usageData = await usageResponse.json()
          setUsage(usageData)
        } else {
          setUsage(null)
        }
      } catch {
        setUsage(null)
      }

    } catch (err) {
      console.error('Failed to load data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshSessionData = async () => {
    try {
      const sessionResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (sessionResponse.ok) {
        const sessionData = await sessionResponse.json()
        const latest = sessionData.sessions?.[0] || null
        setSession(latest)
      }

      try {
        const ss = await fetch(`/api/patents/${patentId}/drafting/style-status`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })
        if (ss.ok) {
          const data = await ss.json()
          setStyleStatus(data)
        }
      } catch (styleErr) {
        console.warn('Silent style status refresh failed:', styleErr)
      }
    } catch (err) {
      console.error('Failed to refresh session data:', err)
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
    console.log('handleStageComplete called with:', stageData)
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
      console.log('API response status:', response.status)

      // Retry once on 401 by refreshing user/token
      if (response.status === 401) {
        console.log('Retrying after 401 error')
        try { await refreshUser(localStorage.getItem('auth_token') || undefined) } catch {}
        response = await doRequest()
        console.log('Retry response status:', response.status)
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
        console.log('Stage update failed:', { status: response.status, message, stageData })

        // Ensure message is always a string
        if (typeof message !== 'string' || !message.trim()) {
          message = 'Failed to update stage'
        }

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

      if (action === 'related_art_llm_review' || action === 'related_art_search' || !skipRefresh) {
        await refreshSessionData()
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
      <div className="min-h-screen bg-[#F5F6F7] flex items-center justify-center">
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
    <div className="min-h-screen bg-[#F5F6F7]">
      {/* Header - Compact & Clean */}
      <header className="bg-white/90 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="w-full max-w-[98%] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center space-x-4 min-w-0 flex-1">
              <Link
                href={`/projects/${patent.project.id}`}
                className="text-gray-400 hover:text-gray-700 transition-colors duration-200 p-1 rounded-full hover:bg-gray-100"
                title="Back to Project"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              
              <div className="h-4 w-px bg-gray-200 mx-2 hidden sm:block"></div>
              
              <div className="flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-semibold text-gray-900 truncate max-w-md cursor-default" title={patent.title}>
                    {patent.title}
                  </h1>
                  {styleStatus && (
                    <Badge variant={styleStatus.enabled ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
                      {styleStatus.enabled ? 'Style Active' : 'No Style'}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                  <span className="uppercase tracking-wider">{STAGE_LABELS[currentStage as keyof typeof STAGE_LABELS]}</span>
                  <span className="text-gray-300">•</span>
                  <span>{STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}% Complete</span>
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 flex-shrink-0">
              {usage && (
                <div className="hidden lg:flex flex-col items-end text-[10px] text-gray-400 mr-4">
                   <span>{usage.total_input_tokens.toLocaleString()} in / {usage.total_output_tokens.toLocaleString()} out</span>
                   <span className="opacity-70">Session Usage</span>
                </div>
              )}

              {/* Stage Navigation Buttons */}
              {session && (
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={async () => {
                      const { prev } = getPrevNextStages()
                      if (!prev || !session) return
                      console.log('Navigating to previous stage:', { prev, sessionId: session.id, currentPatentId: patentId })
                      await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: prev })
                    }}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-white shadow-sm transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:shadow-none"
                    disabled={!getPrevNextStages().prev}
                    title="Previous Stage"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  <div className="w-px h-4 bg-gray-200 mx-1"></div>

                  <button
                    onClick={async () => {
                      const { next } = getPrevNextStages()
                      if (!next || !session) return
                      console.log('Navigating to next stage:', { next, sessionId: session.id, currentPatentId: patentId })
                      await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: next })
                    }}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-white shadow-sm transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:shadow-none"
                    disabled={!getPrevNextStages().next}
                    title="Next Stage"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}

              <button
                onClick={resumeSession}
                className="ml-2 inline-flex items-center px-3 py-1.5 border border-indigo-600/20 text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                title="Resume the latest drafting session"
              >
                <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Resume
              </button>
            </div>
          </div>
        </div>
        
        {/* Integrated Slim Progress Bar */}
        <div className="w-full h-0.5 bg-gray-100">
          <div
            className="bg-indigo-500 h-0.5 transition-all duration-500 ease-out"
            style={{ width: `${STAGE_PROGRESS[currentStage as keyof typeof STAGE_PROGRESS]}%` }}
          ></div>
        </div>
      </header>

      {/* Main Content - Maximized Writing Space */}
      <main className="w-full max-w-[1800px] mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl border border-gray-200/60 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] min-h-[calc(100vh-140px)] overflow-hidden">
          {session ? (
            <div className="h-full">
              <StageComponent
                session={session}
                patent={patent}
                onComplete={handleStageComplete}
                onRefresh={refreshSessionData}
              />
            </div>
          ) : (
            <div className="p-12 text-center flex flex-col items-center justify-center h-64">
              <div className="animate-pulse flex space-x-2 mb-4">
                 <div className="h-2 w-2 bg-indigo-400 rounded-full"></div>
                 <div className="h-2 w-2 bg-indigo-400 rounded-full animation-delay-200"></div>
                 <div className="h-2 w-2 bg-indigo-400 rounded-full animation-delay-400"></div>
              </div>
              <div className="text-sm font-medium text-gray-500">Loading drafting workspace...</div>
            </div>
          )}
        </div>

        {/* Bottom Navigation (Contextual) */}
        <div className="mt-8 mb-12 flex items-center justify-between px-2 opacity-60 hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={async () => {
              const { prev } = getPrevNextStages()
              if (!prev || !session) return
              await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: prev })
            }}
            className="text-gray-400 hover:text-gray-700 flex items-center text-sm font-medium disabled:opacity-0 transition-all"
            disabled={!getPrevNextStages().prev}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to {STAGE_LABELS[getPrevNextStages().prev as keyof typeof STAGE_LABELS] || 'Previous'}
          </button>

          <button
            onClick={async () => {
              const { next } = getPrevNextStages()
              if (!next || !session) return
              await handleStageComplete({ action: 'set_stage', sessionId: session.id, stage: next })
            }}
            className="text-gray-400 hover:text-indigo-600 flex items-center text-sm font-medium disabled:opacity-0 transition-all"
            disabled={!getPrevNextStages().next}
          >
            Continue to {STAGE_LABELS[getPrevNextStages().next as keyof typeof STAGE_LABELS] || 'Next'}
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </main>
    </div>
  )
}
