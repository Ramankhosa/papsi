'use client'

/**
 * VerticalStageNav - Intelligent Left-Rail Stage Navigation
 * 
 * Features:
 * - Collapsible/expandable stages with sub-stages
 * - Dynamic jurisdiction drafts from database
 * - Section-level completion tracking
 * - Dark/Light theme toggle
 * - Persisted user preferences
 * 
 * All data is fetched dynamically - no hardcoding.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { 
  ChevronRight, 
  ChevronDown,
  Check, 
  Circle, 
  Loader2,
  SkipForward,
  Sun,
  Moon,
  FileText,
  AlertCircle
} from 'lucide-react'
import {
  getVisibleStages,
  calculateStageCompletion,
  getSectionCompletionStatus,
  calculateOverallProgress,
  type SubStageStatus,
  type JurisdictionDraftInfo,
  type JurisdictionSectionInfo
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

interface JurisdictionConfig {
  code: string
  name: string
  sections: Array<{
    key: string
    label: string
    displayOrder: number
    isRequired: boolean
  }>
}

type NavTheme = 'dark' | 'light'

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  THEME: 'patent_nav_theme',
  EXPANDED_STAGES: 'patent_nav_expanded_stages',
  EXPANDED_JURISDICTIONS: 'patent_nav_expanded_jurisdictions'
}

// ============================================================================
// Helper: Fetch all country names from API (cached)
// ============================================================================

let cachedCountryNames: Map<string, string> | null = null

async function fetchCountryNames(authToken: string): Promise<Map<string, string>> {
  if (cachedCountryNames) return cachedCountryNames

  try {
    const response = await fetch('/api/country-names', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
    
    if (response.ok) {
      const data = await response.json()
      const nameMap = new Map<string, string>()
      
      for (const country of (data.countries || [])) {
        nameMap.set(country.code.toUpperCase(), country.name)
      }
      
      cachedCountryNames = nameMap
      return nameMap
    }
  } catch (error) {
    console.error('Failed to fetch country names:', error)
  }
  
  return new Map()
}

// ============================================================================
// Helper: Fetch jurisdiction sections from API
// ============================================================================

async function fetchJurisdictionSections(
  jurisdictionCode: string,
  authToken: string,
  countryNameMap: Map<string, string>
): Promise<JurisdictionConfig | null> {
  try {
    const response = await fetch(
      `/api/sections/by-jurisdiction?jurisdiction=${jurisdictionCode}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }
    )

    if (!response.ok) return null

    const data = await response.json()
    
    // Get country name from cached map
    const countryName = countryNameMap.get(jurisdictionCode.toUpperCase()) || jurisdictionCode

    return {
      code: jurisdictionCode,
      name: countryName,
      sections: (data.sections || []).map((s: any) => ({
        key: s.key,
        label: s.label,
        displayOrder: s.displayOrder || 0,
        isRequired: s.isRequired || false
      })).sort((a: any, b: any) => a.displayOrder - b.displayOrder)
    }
  } catch (error) {
    console.error(`Failed to fetch sections for ${jurisdictionCode}:`, error)
    return null
  }
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
      return <SkipForward className={`${sizeClass} text-slate-500`} />
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
  patentId,
  onNavigateToStage
}: VerticalStageNavProps) {
  // Theme state - default to light theme
  const [theme, setTheme] = useState<NavTheme>('light')
  
  // Expansion states
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())
  const [expandedJurisdictions, setExpandedJurisdictions] = useState<Set<string>>(new Set())
  
  // Jurisdiction data from API
  const [jurisdictionConfigs, setJurisdictionConfigs] = useState<Map<string, JurisdictionConfig>>(new Map())
  const [loadingJurisdictions, setLoadingJurisdictions] = useState<Set<string>>(new Set())
  
  // Track which jurisdictions we've attempted to fetch (prevents stale closure issues)
  const fetchedJurisdictionsRef = useRef<Set<string>>(new Set())

  // ============================================================================
  // Initialize from localStorage
  // ============================================================================

  useEffect(() => {
    // Load theme - default to light if not previously saved
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) as NavTheme
    if (savedTheme && (savedTheme === 'dark' || savedTheme === 'light')) {
      setTheme(savedTheme)
    } else {
      // No saved theme or invalid value - default to light and save it
      setTheme('light')
      localStorage.setItem(STORAGE_KEYS.THEME, 'light')
    }

    // Load expanded stages
    try {
      const savedStages = localStorage.getItem(STORAGE_KEYS.EXPANDED_STAGES)
      if (savedStages) {
        setExpandedStages(new Set(JSON.parse(savedStages)))
      } else {
        // Default: expand current stage
        setExpandedStages(new Set([currentStage]))
      }
    } catch {
      setExpandedStages(new Set([currentStage]))
    }

    // Load expanded jurisdictions
    try {
      const savedJurisdictions = localStorage.getItem(STORAGE_KEYS.EXPANDED_JURISDICTIONS)
      if (savedJurisdictions) {
        setExpandedJurisdictions(new Set(JSON.parse(savedJurisdictions)))
      }
    } catch {
      // Ignore
    }
  }, []) // Run once on mount

  // Auto-expand current stage when it changes
  useEffect(() => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      next.add(currentStage)
      return next
    })
  }, [currentStage])

  // ============================================================================
  // Persist to localStorage
  // ============================================================================

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EXPANDED_STAGES, JSON.stringify(Array.from(expandedStages)))
  }, [expandedStages])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EXPANDED_JURISDICTIONS, JSON.stringify(Array.from(expandedJurisdictions)))
  }, [expandedJurisdictions])

  // ============================================================================
  // Fetch jurisdiction section configs from database
  // ============================================================================

  useEffect(() => {
    const jurisdictions = session?.draftingJurisdictions || []
    if (jurisdictions.length === 0) return

    const authToken = localStorage.getItem('auth_token') || ''

    let isMounted = true

    const loadJurisdictions = async () => {
      // First, fetch all country names (cached after first call)
      const countryNameMap = await fetchCountryNames(authToken)

      // Then fetch section configs for each jurisdiction
      const uniqueCodes = Array.from(new Set((jurisdictions as string[]).map((c) => (c || '').toUpperCase()).filter(Boolean)))
      
      for (const upperCode of uniqueCodes) {
        // Skip if already fetched (using ref to avoid stale closure)
        if (fetchedJurisdictionsRef.current.has(upperCode)) {
          continue
        }
        
        // Mark as being fetched
        fetchedJurisdictionsRef.current.add(upperCode)
        setLoadingJurisdictions(prev => new Set(Array.from(prev).concat(upperCode)))

        const config = await fetchJurisdictionSections(upperCode, authToken, countryNameMap)
        
        // Check if component is still mounted before updating state
        if (!isMounted) return
        
        if (config) {
          setJurisdictionConfigs(prev => new Map(prev).set(upperCode, config))
        }

        setLoadingJurisdictions(prev => {
          const next = new Set(prev)
          next.delete(upperCode)
          return next
        })
      }
    }

    loadJurisdictions()
    
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.draftingJurisdictions]) // Intentionally exclude jurisdictionConfigs/loadingJurisdictions to prevent refetch loops

  // ============================================================================
  // Derived State
  // ============================================================================

  const visibleStages = useMemo(() => getVisibleStages(session), [session])

  // NOTE: overall progress uses stage sub-stage completion; drafting-stage is refined below
  const overallProgress = useMemo(() => calculateOverallProgress(session, currentStage), [session, currentStage])

  // Build jurisdiction draft info with section completion
  const jurisdictionDrafts = useMemo((): JurisdictionDraftInfo[] => {
    const rawJurisdictions = session?.draftingJurisdictions || []
    // Normalize and deduplicate jurisdiction codes
    const jurisdictions: string[] = Array.from(new Set(
      rawJurisdictions.map((c: unknown) => String(c || '').toUpperCase()).filter(Boolean)
    ))

    return jurisdictions.map((code: string) => {
      const upperCode = code.toUpperCase()
      const config = jurisdictionConfigs.get(upperCode)
      
      if (!config) {
        return {
          code: upperCode,
          name: upperCode,
          sections: [],
          completedCount: 0,
          totalCount: 0,
          status: 'pending' as SubStageStatus
        }
      }

      const sections: JurisdictionSectionInfo[] = config.sections.map(section => {
        const { status, wordCount } = getSectionCompletionStatus(session, upperCode, section.key)
        return {
          key: section.key,
          label: section.label,
          displayOrder: section.displayOrder,
          isRequired: section.isRequired,
          status,
          wordCount
        }
      })

      const completedCount = sections.filter(s => s.status === 'completed').length
      const totalCount = sections.length

      let status: SubStageStatus = 'pending'
      if (completedCount === totalCount && totalCount > 0) {
        status = 'completed'
      } else if (completedCount > 0) {
        status = 'in_progress'
      }

      return {
        code: upperCode,
        name: config.name,
        sections,
        completedCount,
        totalCount,
        status
      }
    })
  }, [session, jurisdictionConfigs])

  // Drafting stage completion should reflect jurisdiction section progress + review/export
  const getDraftingStageCompletion = useCallback(() => {
    const draftingStage = visibleStages.find(s => s.key === 'ANNEXURE_DRAFT')
    if (!draftingStage) {
      return { completedCount: 0, totalCount: 0, requiredCompleted: 0, requiredTotal: 0, percentage: 0 }
    }

    const reviewExport = draftingStage.subStages
      .filter(s => ['ai_review', 'export'].includes(s.key))
      .map(s => ({ status: s.getStatus(session), required: s.required }))

    const sectionStatuses = jurisdictionDrafts.flatMap(j => j.sections.map(sec => ({
      status: sec.status,
      required: sec.isRequired
    })))

    const all = [...sectionStatuses, ...reviewExport]
    const completedCount = all.filter(s => s.status === 'completed').length
    const totalCount = all.filter(s => s.status !== 'skipped').length
    const requiredCompleted = all.filter(s => s.required && s.status === 'completed').length
    const requiredTotal = all.filter(s => s.required && s.status !== 'skipped').length

    return {
      completedCount,
      totalCount,
      requiredCompleted,
      requiredTotal,
      percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
    }
  }, [jurisdictionDrafts, session, visibleStages])

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

  const toggleJurisdictionExpansion = useCallback((code: string) => {
    setExpandedJurisdictions(prev => {
      const next = new Set(prev)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }, [])

  const handleStageClick = useCallback(async (stageKey: string) => {
    await onNavigateToStage(stageKey)
  }, [onNavigateToStage])

  // ============================================================================
  // Theme Classes
  // ============================================================================

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
    subStageBorder: theme === 'dark' ? 'border-slate-700/50' : 'border-slate-200',
    iconBg: theme === 'dark' ? 'bg-slate-700/50' : 'bg-slate-100',
    currentIconBg: theme === 'dark'
      ? 'bg-gradient-to-br from-teal-400 to-cyan-500'
      : 'bg-gradient-to-br from-indigo-500 to-blue-500'
  }), [theme])

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
                Patent Draft
              </div>
              <div className={`text-xs ${themeClasses.textMuted}`}>
                {overallProgress}% complete
              </div>
            </div>
          </div>
          
          {/* Theme Toggle */}
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

        {/* Progress Bar */}
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
          const isDraftingStage = stage.key === 'ANNEXURE_DRAFT'
          const completion = isDraftingStage ? getDraftingStageCompletion() : calculateStageCompletion(stage, session)
          const isFullyComplete = completion.requiredTotal > 0 && completion.requiredCompleted === completion.requiredTotal
          const isCurrent = stage.key === currentStage
          const isPast = stageIndex < visibleStages.findIndex(s => s.key === currentStage)
          const isCompleted = isPast && isFullyComplete

          return (
            <div key={stage.key} className="mb-1">
              {/* Stage Header */}
              <div
                className={`
                  w-full flex items-center gap-2 px-3 py-2.5 rounded-xl
                  transition-all duration-200 text-left border
                  ${isCurrent ? themeClasses.activeStage : themeClasses.hover + ' border-transparent'}
                `}
              >
                {/* Stage Icon with Progress Ring */}
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

                {/* Stage Label */}
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

                {/* Expand Arrow */}
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

              {/* Sub-Stages (Expandable) */}
              {isExpanded && (
                <div className={`ml-5 pl-4 border-l ${themeClasses.subStageBorder} py-1 mt-1 space-y-0.5`}>
                  {/* Static Sub-Stages */}
                  {stage.subStages
                    .filter(sub => !isDraftingStage || !['ai_review', 'export'].includes(sub.key))
                    .map(subStage => {
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

                  {/* Drafting stage: always show Review & Export; jurisdiction drafts are dynamic */}
                  {isDraftingStage && (
                    <>
                      <div className={`text-[10px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1 ${themeClasses.textSubtle}`}>
                        Jurisdiction Drafts
                      </div>
                      
                      {jurisdictionDrafts.length === 0 ? (
                        <div className={`px-2 py-1.5 text-xs ${themeClasses.textSubtle}`}>
                          No jurisdictions selected yet.
                        </div>
                      ) : jurisdictionDrafts.map(jurisdiction => {
                        const isJurisdictionExpanded = expandedJurisdictions.has(jurisdiction.code)
                        const isLoading = loadingJurisdictions.has(jurisdiction.code)

                        return (
                          <div key={jurisdiction.code}>
                            {/* Jurisdiction Header */}
                            <button
                              onClick={() => toggleJurisdictionExpansion(jurisdiction.code)}
                              className={`
                                w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
                                ${themeClasses.hover} transition-colors text-left
                              `}
                            >
                              <StatusIcon status={jurisdiction.status} size="sm" />
                              <span className={`
                                text-xs flex-1
                                ${jurisdiction.status === 'completed' ? themeClasses.completedText : themeClasses.textMuted}
                              `}>
                                {jurisdiction.name}
                              </span>
                              <span className={`text-[10px] ${themeClasses.textSubtle}`}>
                                {isLoading ? '...' : `${jurisdiction.completedCount}/${jurisdiction.totalCount}`}
                              </span>
                              <ChevronDown className={`
                                w-3 h-3 transition-transform ${themeClasses.textSubtle}
                                ${isJurisdictionExpanded ? 'rotate-180' : ''}
                              `} />
                            </button>

                            {/* Jurisdiction Sections */}
                            {isJurisdictionExpanded && !isLoading && (
                              <div className={`ml-4 pl-3 border-l ${themeClasses.subStageBorder} py-0.5 space-y-0.5`}>
                                {jurisdiction.sections.map(section => (
                                  <div
                                    key={section.key}
                                    className={`
                                      flex items-center gap-2 px-2 py-1 rounded
                                      ${themeClasses.hover} transition-colors
                                    `}
                                  >
                                    <StatusIcon status={section.status} size="sm" />
                                    <span className={`
                                      text-[11px] flex-1 truncate
                                      ${section.status === 'completed' ? themeClasses.completedText : themeClasses.textMuted}
                                    `}>
                                      {section.label}
                                      {section.isRequired && section.status !== 'completed' && (
                                        <span className="text-red-400 ml-0.5">*</span>
                                      )}
                                    </span>
                                    {section.wordCount !== undefined && section.wordCount > 0 && (
                                      <span className={`text-[9px] ${themeClasses.textSubtle}`}>
                                        {section.wordCount}w
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* AI Review & Export */}
                      <div className={`text-[10px] font-semibold uppercase tracking-wider px-2 pt-2 pb-1 ${themeClasses.textSubtle}`}>
                        Review & Export
                      </div>
                      
                      {stage.subStages
                        .filter(sub => ['ai_review', 'export'].includes(sub.key))
                        .map(subStage => {
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
                                ${status === 'completed' ? themeClasses.completedText : themeClasses.textMuted}
                              `}>
                                {subStage.label}
                              </span>
                              <SubIcon className={`w-3 h-3 ${themeClasses.textSubtle}`} />
                            </div>
                          )
                        })}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={`p-3 border-t ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <span className={`text-xs ${themeClasses.textSubtle}`}>
            Stage {visibleStages.findIndex(s => s.key === currentStage) + 1} of {visibleStages.length}
          </span>
          <button
            onClick={() => handleStageClick(currentStage)}
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

