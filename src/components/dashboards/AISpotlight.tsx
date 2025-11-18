'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AISpotlightProps {
  draftsCount: number
  latestNoveltySearch?: any
  userReservations: number
}

export default function AISpotlight({ draftsCount, latestNoveltySearch, userReservations }: AISpotlightProps) {
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(true)
  const [currentSuggestion, setCurrentSuggestion] = useState<any>(null)

  useEffect(() => {
    generateSuggestion()
  }, [draftsCount, latestNoveltySearch, userReservations])

  const generateSuggestion = () => {
    const suggestions = []

    // Draft completion suggestion
    if (draftsCount > 0) {
      suggestions.push({
        type: 'draft',
        title: 'Resume Your Draft',
        message: `You have ${draftsCount} draft${draftsCount > 1 ? 's' : ''} waiting. Your latest draft is 78% complete.`,
        actions: [
          { label: 'Resume Draft', action: () => router.push('/patents/draft/new') },
          { label: 'View All Drafts', action: () => router.push('/projects') }
        ]
      })
    }

    // Novelty review suggestion
    if (latestNoveltySearch) {
      const stage1Results = latestNoveltySearch.results?.stage1
      const patentCount = stage1Results?.patentCount || 0

      if (patentCount > 0) {
        suggestions.push({
          type: 'novelty',
          title: 'Review Novelty Results',
          message: `"${latestNoveltySearch.title.substring(0, 30)}..." found ${patentCount} potential match${patentCount > 1 ? 'es' : ''}. Review recommended.`,
          actions: [
            { label: 'Review Results', action: () => router.push(`/novelty-search/${latestNoveltySearch.id}`) },
            { label: 'Novelty Search', action: () => router.push('/novelty-search') }
          ]
        })
      }
    }

    // Idea bank suggestion
    if (userReservations === 0) {
      suggestions.push({
        type: 'idea',
        title: 'Explore Ideas',
        message: 'Discover AI-generated patent ideas with prior art analysis. Transform ideas into patents.',
        actions: [
          { label: 'Browse Ideas', action: () => router.push('/idea-bank') },
          { label: 'Generate New', action: () => router.push('/idea-bank') }
        ]
      })
    }

    // Default suggestion
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'welcome',
        title: 'Welcome Back!',
        message: 'Ready to innovate? Start with a novelty search or explore the idea bank.',
        actions: [
          { label: 'Start Novelty Search', action: () => router.push('/novelty-search') },
          { label: 'Explore Ideas', action: () => router.push('/idea-bank') }
        ]
      })
    }

    // Pick random suggestion
    const randomIndex = Math.floor(Math.random() * suggestions.length)
    setCurrentSuggestion(suggestions[randomIndex])
  }

  const dismiss = () => {
    setIsVisible(false)
  }

  if (!isVisible || !currentSuggestion) return null

  return (
    <div className="mb-8 relative">
      <div className="relative bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-sm overflow-hidden">
        {/* Subtle top accent */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#4C5EFF] to-[#7A5AF8] opacity-20"></div>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center mb-3">
              <div className="w-8 h-8 bg-[#4C5EFF] rounded-full flex items-center justify-center mr-3">
                🧠
              </div>
              <h3 className="text-lg font-semibold text-[#1E293B]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
                Kisho suggests:
              </h3>
            </div>

            <p className="text-[#334155] mb-4 leading-relaxed" style={{ fontFamily: 'Source Sans Pro, sans-serif', fontWeight: 400 }}>
              <strong>{currentSuggestion.title}:</strong> {currentSuggestion.message}
            </p>

            <div className="flex flex-wrap gap-3">
              {currentSuggestion.actions.map((action: any, index: number) => (
                <button
                  key={index}
                  onClick={action.action}
                  className={`
                    px-4 py-2 rounded-lg font-medium transition-all duration-200
                    ${index === 0
                      ? 'bg-[#4C5EFF] text-white hover:bg-[#3B4ACC] shadow-sm hover:shadow-md'
                      : 'bg-white text-[#334155] hover:bg-[#F8FAFC] border border-[#E5E7EB]'
                    }
                  `}
                  style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={dismiss}
            className="text-[#64748B] hover:text-[#334155] transition-colors p-1 hover:bg-[#F1F5F9] rounded-full"
            title="Dismiss suggestion"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
