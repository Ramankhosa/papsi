'use client'

import { useState, useEffect } from 'react'

interface ActivityItem {
  id: string
  type: 'idea' | 'draft' | 'novelty' | 'reservation'
  title: string
  description: string
  timestamp: Date
  icon: string
  kishoNote?: string
}

interface ActivityFeedProps {
  limit?: number
}

export default function ActivityFeed({ limit = 5 }: ActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    generateMockActivities()
  }, [])

  const generateMockActivities = async () => {
    // In a real implementation, this would fetch from various APIs
    // For now, we'll generate some mock recent activities
    const mockActivities: ActivityItem[] = [
      {
        id: '1',
        type: 'idea',
        title: '3 new ideas auto-added',
        description: 'AI discovered patent-worthy concepts in medical devices',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        icon: '🧩',
        kishoNote: 'Potential overlap with Project Bio-Mesh — review recommended.'
      },
      {
        id: '2',
        type: 'draft',
        title: 'Smart Bandage System draft',
        description: 'Reached 60% completion with automated sections',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
        icon: '📜',
        kishoNote: 'Claims section ready for your expert touch.'
      },
      {
        id: '3',
        type: 'novelty',
        title: 'AI Classroom Monitor search',
        description: 'Completed with 2 unique patent matches found',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        icon: '🔍',
        kishoNote: 'One match shows 85% similarity — consider differentiation strategy.'
      },
      {
        id: '4',
        type: 'reservation',
        title: 'IoT Security Framework',
        description: 'Idea reserved for 28 days remaining',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        icon: '⏰',
        kishoNote: 'Similar patents filed last quarter — timing is perfect.'
      },
      {
        id: '5',
        type: 'idea',
        title: 'Sustainable Packaging concept',
        description: 'Generated from recent industry trends analysis',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        icon: '🌱',
        kishoNote: 'Market gap identified in biodegradable composites.'
      }
    ]

    // Simulate API delay
    setTimeout(() => {
      setActivities(mockActivities.slice(0, limit))
      setLoading(false)
    }, 500)
  }

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`

    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays}d ago`
  }

  if (loading) {
    return (
      <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <span className="mr-2">🕊</span>
          While you were away
        </h3>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-6 mb-8">
      <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
        <span className="mr-2">🕊</span>
        While you were away
      </h3>

      <div className="space-y-6">
        {activities.map((activity, index) => (
          <div key={activity.id} className="relative">
            {/* Timeline dot */}
            {index < activities.length - 1 && (
              <div className="absolute left-4 top-10 bottom-0 w-px bg-gradient-to-b from-gray-200 to-transparent"></div>
            )}

            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white text-sm shadow-lg">
                  {activity.icon}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-medium text-gray-900 truncate">
                    {activity.title}
                  </h4>
                  <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>

                <p className="text-sm text-gray-600 mb-2">
                  {activity.description}
                </p>

                {activity.kishoNote && (
                  <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200/50 rounded-lg p-3 mt-2">
                    <div className="flex items-start space-x-2">
                      <span className="text-cyan-600 text-xs font-medium flex-shrink-0 mt-0.5">
                        💭 Kisho:
                      </span>
                      <p className="text-xs text-cyan-700 leading-relaxed">
                        {activity.kishoNote}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {activities.length === 0 && (
        <div className="text-center py-8">
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">No recent activity to show</p>
        </div>
      )}
    </div>
  )
}
