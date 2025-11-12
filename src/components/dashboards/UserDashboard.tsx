'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { getRandomGreeting, getCurrentTimeString, getTimeSegment } from '@/lib/greetings'
import InsightGrid from './InsightGrid'
import AISpotlight from './AISpotlight'
import ActivityFeed from './ActivityFeed'
import KishoWidget from './KishoWidget'
import LoadingBird from '../ui/loading-bird'

interface DashboardStats {
  draftsCount: number
  ideaReservations: number
  latestNoveltySearch?: any
}

export default function UserDashboard() {
  const { user } = useAuth()
  const router = useRouter()
  const [greeting, setGreeting] = useState('')
  const [currentTime, setCurrentTime] = useState('')
  const currentTimeSegmentRef = useRef('')
  const [stats, setStats] = useState<DashboardStats>({
    draftsCount: 0,
    ideaReservations: 0,
    latestNoveltySearch: null
  })
  const [hoverTooltip, setHoverTooltip] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [idleMessage, setIdleMessage] = useState('')
  const [showIdleMessage, setShowIdleMessage] = useState(false)

  useEffect(() => {
    if (user) {
      initializeDashboard()
    }
  }, [user])


  // Idle detection and intelligence cues
  useEffect(() => {
    let idleTimer: NodeJS.Timeout
    let lastActivity = Date.now()

    const resetIdleTimer = () => {
      lastActivity = Date.now()
      setShowIdleMessage(false)
    }

    const checkIdle = () => {
      const now = Date.now()
      const idleTime = now - lastActivity

      if (idleTime > 3 * 60 * 1000 && !showIdleMessage) { // 3 minutes
        const messages = [
          "Still here? I'll autosave your work in 10 seconds.",
          "Taking a creative pause? Your ideas are safe with me.",
          "Daydreaming about inventions? That's how breakthroughs happen.",
          "Need a moment? Your workspace is always ready when you are."
        ]
        setIdleMessage(messages[Math.floor(Math.random() * messages.length)])
        setShowIdleMessage(true)

        // Auto-hide after 8 seconds
        setTimeout(() => setShowIdleMessage(false), 8000)
      }
    }

    // Set up event listeners for user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
    events.forEach(event => {
      document.addEventListener(event, resetIdleTimer, true)
    })

    // Check for idle every 30 seconds
    idleTimer = setInterval(checkIdle, 30000)

    return () => {
      clearInterval(idleTimer)
      events.forEach(event => {
        document.removeEventListener(event, resetIdleTimer, true)
      })
    }
  }, [showIdleMessage])

  const initializeDashboard = async () => {
    setIsLoading(true)

    // Set initial greeting and time
    const initialTimeSegment = getTimeSegment()
    currentTimeSegmentRef.current = initialTimeSegment
    setGreeting(getRandomGreeting())
    setCurrentTime(getCurrentTimeString())

    // Update time every minute and check if time segment changed
    const timeInterval = setInterval(() => {
      const newTime = getCurrentTimeString()
      const newTimeSegment = getTimeSegment()

      setCurrentTime(newTime)

      // Update greeting if time segment changed (morning/afternoon/evening)
      if (newTimeSegment !== currentTimeSegmentRef.current) {
        currentTimeSegmentRef.current = newTimeSegment
        setGreeting(getRandomGreeting())
      }
    }, 60000)

    // Fetch dashboard stats
    await fetchDashboardStats()

    setIsLoading(false)

    return () => clearInterval(timeInterval)
  }

  const fetchDashboardStats = async () => {
    try {
      // Fetch idea bank stats
      const ideaResponse = await fetch('/api/idea-bank/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let ideaReservations = 0
      if (ideaResponse.ok) {
        const ideaData = await ideaResponse.json()
        ideaReservations = ideaData.stats?.userReservations || 0
      }

      // Fetch projects to count drafts
      const projectsResponse = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let draftsCount = 0
      if (projectsResponse.ok) {
        const projectsData = await projectsResponse.json()
        const projects = projectsData.projects || []

        // Count patents across all projects that are in draft status
        for (const project of projects) {
          if (project.patents) {
            draftsCount += project.patents.filter((patent: any) =>
              patent.status === 'DRAFT' || patent.status === 'IN_PROGRESS'
            ).length
          }
        }
      }

      // Fetch novelty search history
      const noveltyResponse = await fetch('/api/novelty-search/history', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      let latestNoveltySearch = null
      if (noveltyResponse.ok) {
        const noveltyData = await noveltyResponse.json()
        const history = noveltyData.history || []
        if (history.length > 0) {
          latestNoveltySearch = history[0]
        }
      }

      setStats({
        draftsCount,
        ideaReservations,
        latestNoveltySearch
      })
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error)
    }
  }

  const handleCardHover = (cardType: string, message: string) => {
    setHoverTooltip(message)
  }



  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7] flex items-center justify-center">
        <LoadingBird message="Preparing your workspace..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7] relative overflow-hidden">
      {/* Subtle ambient light elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-3 h-3 bg-[#D9E2FF]/20 rounded-full animate-pulse"></div>
        <div className="absolute top-3/4 right-1/4 w-2 h-2 bg-[#E9EDF4]/30 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 w-2.5 h-2.5 bg-[#F2F4F7]/25 rounded-full animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Hero Greeting Section */}
        <div className="mb-8 relative">
          {/* Soft animated light gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#FAFAFB] via-[#F2F4F7] to-[#E9EDF4] rounded-2xl opacity-50 animate-pulse" style={{ animationDuration: '15s' }}></div>

          <div className="relative bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex-1 relative">
                {/* Radial gradient glow behind Kisho avatar */}
                <div
                  className="absolute -top-4 -left-4 w-32 h-32 opacity-25 pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle at 30% 40%, rgba(166,190,255,0.25), transparent 70%)'
                  }}
                ></div>

                <h2 className="text-3xl font-bold text-[#1E293B] mb-2 leading-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
                  {greeting}
                </h2>
                <p className="text-[#64748B] text-lg" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
                  Welcome back, {user?.email?.split('@')[0]}
                </p>
              </div>
              <div className="text-right text-[#64748B]">
                <div className="text-sm" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 300 }}>{new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}</div>
                <div className="text-lg font-mono" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 300 }}>{currentTime}</div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => router.push('/projects')}
                className="px-6 py-3 bg-[#10B981] text-white rounded-xl font-medium hover:bg-[#059669] transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5"
                style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
              >
                📁 My Projects
              </button>
              <button
                onClick={() => router.push('/patents/draft/new')}
                className="px-6 py-3 bg-[#4C5EFF] text-white rounded-xl font-medium hover:bg-[#3B4ACC] transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5"
                style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
              >
                ✍️ Draft Patent
              </button>
              <button
                onClick={() => router.push('/novelty-search')}
                className="px-6 py-3 bg-[#7A5AF8] text-white rounded-xl font-medium hover:bg-[#6B4AD6] transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5"
                style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
              >
                🔍 Novelty Search
              </button>
              <button
                onClick={() => router.push('/idea-bank')}
                className="px-6 py-3 bg-[#CBB67C] text-[#334155] rounded-xl font-medium hover:bg-[#B8A36A] transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5"
                style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
              >
                💡 Idea Bank
              </button>
            </div>
          </div>
        </div>

        {/* Insight Grid */}
        <InsightGrid onCardHover={handleCardHover} />

        {/* AI Spotlight */}
        <AISpotlight
          draftsCount={stats.draftsCount}
          latestNoveltySearch={stats.latestNoveltySearch}
          userReservations={stats.ideaReservations}
        />

        {/* Activity Feed */}
        <ActivityFeed />

        {/* Hover Tooltip */}
        {hoverTooltip && (
          <div className="fixed top-20 right-6 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-xl z-50 max-w-xs">
            {hoverTooltip}
          </div>
        )}

        {/* Idle Message */}
        {showIdleMessage && (
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-cyan-900/90 backdrop-blur-md border border-cyan-400/30 rounded-xl p-6 shadow-2xl z-50 max-w-md animate-fade-in">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center">
                💭
              </div>
              <p className="text-cyan-100 text-sm leading-relaxed">
                {idleMessage}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Kisho Widget */}
      <KishoWidget />

    </div>
  )
}
