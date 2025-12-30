'use client'

/**
 * VerticalStageNav - Left-rail stage navigation for paper drafting.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Moon,
  Sun
} from 'lucide-react'
import {
  calculateOverallProgress,
  calculateStageCompletion,
  getStageSubStages,
  getVisibleStages,
  type SubStageStatus
} from '@/lib/stage-navigation-config'

// ============================================================================
// Types
// ============================================================================

interface VerticalStageNavProps {
  session: any
  currentStage: string
  patentId: string
  onNavigateToStage: (stage: string) => Promise<void>
}

type NavTheme = 'dark' | 'light'

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  THEME: 'paper_nav_theme',
  EXPANDED_STAGES: 'paper_nav_expanded_stages'
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StatusIconProps {
  status: SubStageStatus
  size?: 'sm' | 'md'
}

function StatusIcon({ status, size = 'md' }: StatusIconProps) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  switch (status) {
    case 'completed':
      return <Check className={`${sizeClass} text-emerald-400`} />
    case 'in_progress':
      return <Loader2 className={`${sizeClass} text-amber-400 animate-spin`} />
    case 'skipped':
      return <Circle className={`${sizeClass} text-slate-500`} />
    default:
      return <Circle className={`${sizeClass} text-slate-600`} />
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function VerticalStageNav({
  session,
  currentStage,
  patentId: _patentId,
  onNavigateToStage
}: VerticalStageNavProps) {
  const [theme, setTheme] = useState<NavTheme>('light')
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  const visibleStages = useMemo(() => getVisibleStages(session), [session])
  const resolvedCurrentStage = useMemo(() => {
    const keys = visibleStages.map(stage => stage.key)
    return keys.includes(currentStage) ? currentStage : keys[0]
  }, [currentStage, visibleStages])

  // ============================================================================
  // Initialize from localStorage
  // ============================================================================

  useEffect(() => {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) as NavTheme
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme)
    } else {
      localStorage.setItem(STORAGE_KEYS.THEME, 'light')
    }

    try {
      const savedStages = localStorage.getItem(STORAGE_KEYS.EXPANDED_STAGES)
      if (savedStages) {
        setExpandedStages(new Set(JSON.parse(savedStages)))
      }
    } catch {
      setExpandedStages(new Set())
    }
  }, [])

  useEffect(() => {
    if (!resolvedCurrentStage) return
    setExpandedStages(prev => {
      const next = new Set(prev)
      next.add(resolvedCurrentStage)
      return next
    })
  }, [resolvedCurrentStage])

  // ============================================================================
  // Persist to localStorage
  // ============================================================================

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EXPANDED_STAGES, JSON.stringify(Array.from(expandedStages)))
  }, [expandedStages])

  // ============================================================================
  // Derived State
  // ============================================================================

  const overallProgress = useMemo(
    () => calculateOverallProgress(session, resolvedCurrentStage || ''),
    [session, resolvedCurrentStage]
  )

  const themeClasses = useMemo(() => ({
    container: theme === 'dark'
      ? 'bg-gradient-to-b from-slate-900/95 via-slate-800/95 to-slate-900/95 border-white/10'
      : 'bg-white/95 border-slate-200 shadow-xl',
    text: theme === 'dark' ? 'text-white' : 'text-slate-900',
    textMuted: theme === 'dark' ? 'text-slate-400' : 'text-slate-600',
    textSubtle: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    border: theme === 'dark' ? 'border-white/10' : 'border-slate-200',
    hover: theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-50',
    activeStage: theme === 'dark'
      ? 'bg-teal-500/20 border-teal-400/30'
      : 'bg-indigo-50 border-indigo-200',
    activeText: theme === 'dark' ? 'text-teal-400' : 'text-indigo-600',
    completedText: theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600',
    progressBg: theme === 'dark' ? 'bg-slate-700/50' : 'bg-slate-200',
    progressFill: theme === 'dark'
      ? 'bg-gradient-to-r from-teal-500 to-cyan-400'
      : 'bg-gradient-to-r from-indigo-500 to-blue-400',
    subStageBorder: theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200'
  }), [theme])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const toggleStageExpansion = useCallback((stageKey: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      if (next.has(stageKey)) {
        next.delete(stageKey)
      } else {
        next.add(stageKey)
      }
      return next
    })
  }, [])

  const handleStageClick = useCallback(async (stageKey: string) => {
    await onNavigateToStage(stageKey)
  }, [onNavigateToStage])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <aside
      className={`
        fixed left-0 top-0 h-screen w-72 z-40 flex flex-col
        backdrop-blur-xl border-r transition-colors duration-300
        ${themeClasses.container}
      `}
    >
      {/* Header */}
      <div className={`p-4 border-b ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`
              w-9 h-9 rounded-xl flex items-center justify-center
              ${theme === 'dark'
                ? 'bg-gradient-to-br from-teal-400 to-cyan-500'
                : 'bg-gradient-to-br from-indigo-500 to-blue-500'
              }
            `}>
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className={`text-sm font-semibold ${themeClasses.text}`}>
                Paper Draft
              </div>
              <div className={`text-xs ${themeClasses.textMuted}`}>
                {overallProgress}% complete
              </div>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className={`
              p-2 rounded-lg transition-colors
              ${themeClasses.hover}
            `}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark'
              ? <Sun className={`w-4 h-4 ${themeClasses.textMuted}`} />
              : <Moon className={`w-4 h-4 ${themeClasses.textMuted}`} />
            }
          </button>
        </div>

        <div className={`mt-3 h-1.5 rounded-full ${themeClasses.progressBg}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${themeClasses.progressFill}`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Stage List */}
      <nav className={`flex-1 overflow-y-auto py-2 px-2 ${theme === 'dark' ? 'dark-scrollbar' : 'light-scrollbar'}`}>
        {visibleStages.map((stage, stageIndex) => {
          const StageIcon = stage.icon
          const isExpanded = expandedStages.has(stage.key)
          const completion = calculateStageCompletion(stage, session)
          const currentIndex = Math.max(0, visibleStages.findIndex(s => s.key === resolvedCurrentStage))
          const isCurrent = stage.key === resolvedCurrentStage
          const isPast = stageIndex < currentIndex
          const isFullyComplete = completion.requiredTotal > 0 && completion.requiredCompleted === completion.requiredTotal
          const isCompleted = isPast && isFullyComplete
          const subStages = getStageSubStages(stage, session)

          return (
            <div key={stage.key} className="mb-1">
              <div
                className={`
                  w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
                  transition-all duration-200 text-left border
                  ${isCurrent ? themeClasses.activeStage : themeClasses.hover + ' border-transparent'}
                `}
              >
                <div className="relative w-9 h-9 flex-shrink-0">
                  <svg className="w-9 h-9 transform -rotate-90">
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={themeClasses.progressBg}
                    />
                    <circle
                      cx="18" cy="18" r="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray={`${completion.percentage * 0.94} 94`}
                      strokeLinecap="round"
                      className={`
                        transition-all duration-500
                        ${isCompleted ? 'text-emerald-400' : isCurrent ? themeClasses.activeText : themeClasses.textSubtle}
                      `}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {isCompleted ? <Check className="w-4 h-4 text-emerald-400" /> : null}
                    {!isCompleted && isPast && !isFullyComplete ? <AlertCircle className="w-4 h-4 text-amber-400" /> : null}
                    {!isCompleted && !(isPast && !isFullyComplete) ? (
                      <StageIcon className={`w-4 h-4 ${isCurrent ? themeClasses.activeText : themeClasses.textMuted}`} />
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  className="flex-1 min-w-0 text-left"
                  title="Go to this stage"
                >
                  <div className="flex items-center gap-2">
                    <span className={`
                      text-sm font-medium truncate
                      ${isCompleted ? themeClasses.completedText : isCurrent ? themeClasses.activeText : themeClasses.textMuted}
                    `}>
                      {stage.label}
                    </span>
                    <span className={`text-[10px] ${themeClasses.textSubtle}`}>
                      {completion.completedCount}/{completion.totalCount}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => toggleStageExpansion(stage.key)}
                  className={`p-1 rounded-md ${themeClasses.hover}`}
                  aria-label={isExpanded ? 'Collapse stage' : 'Expand stage'}
                >
                  <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                    <ChevronRight className={`w-4 h-4 ${themeClasses.textSubtle}`} />
                  </div>
                </button>
              </div>

              {isExpanded && (
                <div className={`ml-5 pl-4 border-l ${themeClasses.subStageBorder} py-1 mt-1 space-y-0.5`}>
                  {subStages.length === 0 && (
                    <div className={`px-2 py-1.5 text-xs ${themeClasses.textSubtle}`}>
                      No steps configured yet.
                    </div>
                  )}
                  {subStages.map(subStage => {
                    const SubIcon = subStage.icon
                    const status = subStage.getStatus(session)

                    return (
                      <div
                        key={subStage.key}
                        className={`
                          flex items-center gap-2 px-2 py-1.5 rounded-lg
                          ${themeClasses.hover} transition-colors
                        `}
                      >
                        <StatusIcon status={status} size="sm" />
                        <span className={`
                          text-xs flex-1 truncate
                          ${status === 'completed' ? themeClasses.completedText :
                            status === 'skipped' ? themeClasses.textSubtle + ' line-through' :
                            themeClasses.textMuted}
                        `}>
                          {subStage.label}
                          {subStage.required && status !== 'completed' && status !== 'skipped' && (
                            <span className="text-red-400 ml-0.5">*</span>
                          )}
                        </span>
                        <SubIcon className={`w-3 h-3 ${themeClasses.textSubtle}`} />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className={`p-3 border-t ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <span className={`text-xs ${themeClasses.textSubtle}`}>
            Stage {Math.max(1, visibleStages.findIndex(s => s.key === resolvedCurrentStage) + 1)} of {visibleStages.length}
          </span>
          <button
            onClick={() => resolvedCurrentStage && handleStageClick(resolvedCurrentStage)}
            className={`
              text-xs px-2 py-1 rounded
              ${theme === 'dark'
                ? 'bg-teal-500/20 text-teal-400 hover:bg-teal-500/30'
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              }
              transition-colors
            `}
          >
            Current Stage
          </button>
        </div>
      </div>
    </aside>
  )
}
