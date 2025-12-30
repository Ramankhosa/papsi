'use client'

/**
 * PaperVerticalStageNav - Left-rail stage navigation for paper writing.
 * Hierarchical navigation with expandable stages and sub-stages.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Moon,
  Sun,
  Lightbulb,
  Search,
  ListOrdered,
  PenTool,
  CheckCircle,
  BookOpen
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface PaperVerticalStageNavProps {
  session: any
  currentStage: string
  paperId: string
  onNavigateToStage: (stage: string) => Promise<void> | void
  // For Section Drafting - allows selecting specific sections
  selectedSection?: string
  onSectionSelect?: (sectionKey: string) => void
}

type NavTheme = 'dark' | 'light'

type SubStageStatus = 'completed' | 'in_progress' | 'pending' | 'skipped'

interface SubStageDefinition {
  key: string
  label: string
  icon: any
  description: string
  required: boolean
  getStatus: (session: any) => SubStageStatus
}

interface StageDefinition {
  key: string
  label: string
  icon: any
  description: string
  subStages: SubStageDefinition[]
  weight: number
  getSubStages?: (session: any) => SubStageDefinition[]
}

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  THEME: 'paper_writing_nav_theme',
  EXPANDED_STAGES: 'paper_writing_nav_expanded_stages'
}

// ============================================================================
// Helper Functions
// ============================================================================

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(Boolean)
  }
  if (typeof value === 'string') {
    const parsed = safeJsonParse<unknown>(value, [])
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item)).filter(Boolean)
    }
  }
  return []
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

function getPaperDraftSections(session: any): Record<string, string> {
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const paperDraft = drafts
    .filter((draft: any) => (draft?.jurisdiction || '').toUpperCase() === 'PAPER')
    .sort((a: any, b: any) => (b?.version || 0) - (a?.version || 0))[0]

  if (!paperDraft) return {}

  const extraSections = paperDraft.extraSections
  if (!extraSections) return {}
  if (typeof extraSections === 'string') {
    return safeJsonParse<Record<string, string>>(extraSections, {})
  }
  if (typeof extraSections === 'object') {
    return extraSections as Record<string, string>
  }
  return {}
}

function getPaperSectionStatus(session: any, sectionKey: string): { status: SubStageStatus; wordCount: number } {
  const sections = getPaperDraftSections(session)
  const content = sections[sectionKey] || ''
  const wordCount = computeWordCount(typeof content === 'string' ? content : '')

  if (wordCount >= 20) return { status: 'completed', wordCount }
  if (wordCount > 0) return { status: 'in_progress', wordCount }
  return { status: 'pending', wordCount }
}

function getPaperTypeSectionConfig(session: any): {
  requiredSections: string[]
  optionalSections: string[]
  sectionOrder: string[]
} {
  const paperType = session?.paperType
  const requiredSections = normalizeStringArray(paperType?.requiredSections)
  const optionalSections = normalizeStringArray(paperType?.optionalSections)
  const sectionOrder = normalizeStringArray(paperType?.sectionOrder)

  if (sectionOrder.length > 0) {
    return { requiredSections, optionalSections, sectionOrder }
  }

  const combined = [...requiredSections, ...optionalSections]
  const unique = Array.from(new Set(combined))
  return { requiredSections, optionalSections, sectionOrder: unique }
}

function getDraftSectionSubStages(session: any): SubStageDefinition[] {
  const { requiredSections, sectionOrder } = getPaperTypeSectionConfig(session)
  if (sectionOrder.length === 0) return []

  return sectionOrder.map(sectionKey => {
    const isRequired = requiredSections.includes(sectionKey)
    return {
      key: sectionKey,
      label: formatSectionLabel(sectionKey),
      icon: FileText,
      description: isRequired ? 'Required section' : 'Optional section',
      required: isRequired,
      getStatus: (currentSession: any) => getPaperSectionStatus(currentSession, sectionKey).status
    }
  })
}

function getCitationsCount(session: any): number {
  return Array.isArray(session?.citations) ? session.citations.length : 0
}

function getRequiredSectionsCompletion(session: any): SubStageStatus {
  const { requiredSections } = getPaperTypeSectionConfig(session)
  if (requiredSections.length === 0) return 'pending'

  const statuses = requiredSections.map(sectionKey => getPaperSectionStatus(session, sectionKey).status)
  if (statuses.every(status => status === 'completed')) return 'completed'
  if (statuses.some(status => status !== 'pending')) return 'in_progress'
  return 'pending'
}

function getDraftReadyStatus(session: any): SubStageStatus {
  const sections = getPaperDraftSections(session)
  const hasContent = Object.values(sections).some(content => computeWordCount(String(content)) > 0)
  return hasContent ? 'completed' : 'pending'
}

// ============================================================================
// Stage Definitions
// ============================================================================

const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    key: 'OUTLINE_PLANNING',
    label: 'Paper Foundation',
    icon: ListOrdered,
    description: 'Set up paper type & structure',
    weight: 20,
    subStages: [
      {
        key: 'paper_type',
        label: 'Paper Type',
        icon: FileText,
        description: 'Select a paper type',
        required: true,
        getStatus: (session) => {
          return session?.paperType?.code || session?.paperTypeId ? 'completed' : 'pending'
        }
      },
      {
        key: 'citation_style',
        label: 'Citation Style',
        icon: FileText,
        description: 'Choose a citation style',
        required: true,
        getStatus: (session) => {
          return session?.citationStyle?.code || session?.citationStyleId ? 'completed' : 'pending'
        }
      },
      {
        key: 'venue',
        label: 'Publication Venue',
        icon: FileText,
        description: 'Optional venue selection',
        required: false,
        getStatus: (session) => {
          return session?.publicationVenue?.code || session?.publicationVenueId ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'TOPIC_ENTRY',
    label: 'Research Topic',
    icon: Lightbulb,
    description: 'Define your research question',
    weight: 15,
    subStages: [
      {
        key: 'title',
        label: 'Paper Title',
        icon: FileText,
        description: 'Set the paper title',
        required: true,
        getStatus: (session) => {
          const title = session?.researchTopic?.title
          return title && String(title).trim() ? 'completed' : 'pending'
        }
      },
      {
        key: 'research_question',
        label: 'Research Question',
        icon: FileText,
        description: 'Define a clear research question',
        required: true,
        getStatus: (session) => {
          const question = session?.researchTopic?.researchQuestion
          const length = question ? String(question).trim().length : 0
          if (length >= 20) return 'completed'
          if (length > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'keywords',
        label: 'Keywords',
        icon: FileText,
        description: 'Add at least 3 keywords',
        required: true,
        getStatus: (session) => {
          const keywords = Array.isArray(session?.researchTopic?.keywords)
            ? session.researchTopic.keywords
            : []
          if (keywords.length >= 3) return 'completed'
          if (keywords.length > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'methodology',
        label: 'Methodology',
        icon: FileText,
        description: 'Select methodology type',
        required: true,
        getStatus: (session) => {
          return session?.researchTopic?.methodology ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'LITERATURE_SEARCH',
    label: 'Literature Review',
    icon: Search,
    description: 'Search and import citations',
    weight: 15,
    subStages: [
      {
        key: 'citations_imported',
        label: 'Imported Citations',
        icon: BookOpen,
        description: 'Import at least 5 citations',
        required: true,
        getStatus: (session) => {
          const count = getCitationsCount(session)
          if (count >= 5) return 'completed'
          if (count > 0) return 'in_progress'
          return 'pending'
        }
      },
      {
        key: 'literature_status',
        label: 'Review Progress',
        icon: FileText,
        description: 'Track literature review status',
        required: false,
        getStatus: (session) => {
          const status = session?.literatureReviewStatus
          if (status === 'COMPLETED') return 'completed'
          if (status === 'IN_PROGRESS') return 'in_progress'
          return 'pending'
        }
      }
    ]
  },
  {
    key: 'FIGURE_PLANNER',
    label: 'Figure Planning',
    icon: PenTool,
    description: 'Plan figures and tables',
    weight: 10,
    subStages: [
      {
        key: 'figures',
        label: 'Figure Plan',
        icon: FileText,
        description: 'Optional figure planning',
        required: false,
        getStatus: (session) => {
          const hasFigures = Array.isArray(session?.figurePlans) && session.figurePlans.length > 0
          return hasFigures ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'SECTION_DRAFTING',
    label: 'Section Drafting',
    icon: FileText,
    description: 'Draft each section',
    weight: 25,
    subStages: [],
    getSubStages: getDraftSectionSubStages
  },
  {
    key: 'REVIEW_EXPORT',
    label: 'Review & Export',
    icon: CheckCircle,
    description: 'Validate and export',
    weight: 15,
    subStages: [
      {
        key: 'required_sections',
        label: 'Required Sections',
        icon: FileText,
        description: 'Ensure required sections are complete',
        required: true,
        getStatus: (session) => getRequiredSectionsCompletion(session)
      },
      {
        key: 'export_ready',
        label: 'Draft Ready',
        icon: FileText,
        description: 'Draft has content for export',
        required: true,
        getStatus: (session) => getDraftReadyStatus(session)
      }
    ]
  }
]

// ============================================================================
// Calculation Functions
// ============================================================================

function getStageSubStages(stage: StageDefinition, session: any): SubStageDefinition[] {
  if (stage.getSubStages) {
    return stage.getSubStages(session)
  }
  return stage.subStages
}

function calculateStageCompletion(
  stage: StageDefinition,
  session: any
): {
  completedCount: number
  totalCount: number
  requiredCompleted: number
  requiredTotal: number
  percentage: number
} {
  const subStages = getStageSubStages(stage, session)
  if (subStages.length === 0) {
    return { completedCount: 0, totalCount: 0, requiredCompleted: 0, requiredTotal: 0, percentage: 0 }
  }

  const statuses = subStages.map(sub => ({
    status: sub.getStatus(session),
    required: sub.required
  }))

  const completedCount = statuses.filter(s => s.status === 'completed').length
  const totalCount = statuses.filter(s => s.status !== 'skipped').length
  const requiredCompleted = statuses.filter(s => s.required && s.status === 'completed').length
  const requiredTotal = statuses.filter(s => s.required && s.status !== 'skipped').length

  return {
    completedCount,
    totalCount,
    requiredCompleted,
    requiredTotal,
    percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  }
}

function calculateOverallProgress(session: any, currentStage: string): number {
  const currentIndex = STAGE_DEFINITIONS.findIndex(s => s.key === currentStage)
  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex

  let totalWeight = 0
  let completedWeight = 0

  STAGE_DEFINITIONS.forEach((stage, index) => {
    totalWeight += stage.weight

    if (index < resolvedIndex) {
      completedWeight += stage.weight
    } else if (index === resolvedIndex) {
      const completion = calculateStageCompletion(stage, session)
      completedWeight += (stage.weight * completion.percentage) / 100
    }
  })

  return totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0
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
      return <Check className={`${sizeClass} text-emerald-500`} />
    case 'in_progress':
      return <Loader2 className={`${sizeClass} text-amber-500 animate-spin`} />
    case 'skipped':
      return <Circle className={`${sizeClass} text-slate-400`} />
    default:
      return <Circle className={`${sizeClass} text-slate-300`} />
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function PaperVerticalStageNav({
  session,
  currentStage,
  paperId: _paperId,
  onNavigateToStage,
  selectedSection,
  onSectionSelect
}: PaperVerticalStageNavProps) {
  const [theme, setTheme] = useState<NavTheme>('light')
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  const resolvedCurrentStage = useMemo(() => {
    const keys = STAGE_DEFINITIONS.map(stage => stage.key)
    return keys.includes(currentStage) ? currentStage : keys[0]
  }, [currentStage])

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
      ? 'bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 border-slate-700'
      : 'bg-white border-slate-200',
    text: theme === 'dark' ? 'text-white' : 'text-slate-900',
    textMuted: theme === 'dark' ? 'text-slate-400' : 'text-slate-600',
    textSubtle: theme === 'dark' ? 'text-slate-500' : 'text-slate-400',
    border: theme === 'dark' ? 'border-slate-700' : 'border-slate-200',
    hover: theme === 'dark' ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50',
    activeStage: theme === 'dark'
      ? 'bg-blue-500/20 border-blue-400/30'
      : 'bg-blue-50 border-blue-200',
    activeText: theme === 'dark' ? 'text-blue-400' : 'text-blue-600',
    completedText: theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600',
    progressBg: theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200',
    progressFill: theme === 'dark'
      ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
      : 'bg-gradient-to-r from-blue-500 to-blue-400',
    subStageBorder: theme === 'dark' ? 'border-slate-700' : 'border-slate-200'
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
        border-r transition-colors duration-300 shadow-sm
        ${themeClasses.container}
      `}
    >
      {/* Header */}
      <div className={`p-4 border-b ${themeClasses.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`
              w-10 h-10 rounded-xl flex items-center justify-center
              ${theme === 'dark'
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                : 'bg-gradient-to-br from-blue-500 to-blue-600'
              }
            `}>
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className={`text-sm font-semibold ${themeClasses.text}`}>
                Research Paper
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

        {/* Progress bar */}
        <div className={`mt-3 h-1.5 rounded-full ${themeClasses.progressBg}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${themeClasses.progressFill}`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Stage List */}
      <nav className={`flex-1 overflow-y-auto py-3 px-2 ${theme === 'dark' ? 'dark-scrollbar' : 'light-scrollbar'}`}>
        {STAGE_DEFINITIONS.map((stage, stageIndex) => {
          const StageIcon = stage.icon
          const isExpanded = expandedStages.has(stage.key)
          const completion = calculateStageCompletion(stage, session)
          const currentIndex = Math.max(0, STAGE_DEFINITIONS.findIndex(s => s.key === resolvedCurrentStage))
          const isCurrent = stage.key === resolvedCurrentStage
          const isPast = stageIndex < currentIndex
          const isFullyComplete = completion.requiredTotal > 0 && completion.requiredCompleted === completion.requiredTotal
          const isCompleted = isPast && isFullyComplete
          const subStages = getStageSubStages(stage, session)

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
                {/* Progress Ring */}
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
                        ${isCompleted ? 'text-emerald-500' : isCurrent ? themeClasses.activeText : themeClasses.textSubtle}
                      `}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {isCompleted ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <StageIcon className={`w-4 h-4 ${isCurrent ? themeClasses.activeText : themeClasses.textMuted}`} />
                    )}
                  </div>
                </div>

                {/* Stage Label */}
                <button
                  type="button"
                  onClick={() => handleStageClick(stage.key)}
                  className="flex-1 min-w-0 text-left"
                  title={stage.description}
                >
                  <div className="flex items-center gap-2">
                    <span className={`
                      text-sm font-medium truncate
                      ${isCompleted ? themeClasses.completedText : isCurrent ? themeClasses.activeText : themeClasses.textMuted}
                    `}>
                      {stage.label}
                    </span>
                    {completion.totalCount > 0 && (
                      <span className={`text-[10px] ${themeClasses.textSubtle}`}>
                        {completion.completedCount}/{completion.totalCount}
                      </span>
                    )}
                  </div>
                </button>

                {/* Expand/Collapse Button */}
                {subStages.length > 0 && (
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
                )}
              </div>

              {/* Sub-stages (expandable) */}
              {isExpanded && subStages.length > 0 && (
                <div className={`ml-5 pl-4 border-l ${themeClasses.subStageBorder} py-1 mt-1 space-y-0.5`}>
                  {subStages.map(subStage => {
                    const SubIcon = subStage.icon
                    const status = subStage.getStatus(session)
                    const isSectionDrafting = stage.key === 'SECTION_DRAFTING'
                    const isSelectedSection = isSectionDrafting && selectedSection === subStage.key
                    const canClickSection = isSectionDrafting && onSectionSelect

                    return (
                      <button
                        key={subStage.key}
                        type="button"
                        onClick={() => {
                          if (canClickSection) {
                            // If not on Section Drafting stage, navigate there first
                            if (currentStage !== 'SECTION_DRAFTING') {
                              onNavigateToStage('SECTION_DRAFTING')
                            }
                            onSectionSelect(subStage.key)
                          }
                        }}
                        disabled={!canClickSection}
                        className={`
                          w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left
                          ${isSelectedSection 
                            ? theme === 'dark' 
                              ? 'bg-blue-500/20 border border-blue-400/30' 
                              : 'bg-blue-50 border border-blue-200'
                            : `${themeClasses.hover} border border-transparent`
                          }
                          ${canClickSection ? 'cursor-pointer' : 'cursor-default'}
                        `}
                        title={subStage.description}
                      >
                        <StatusIcon status={status} size="sm" />
                        <span className={`
                          text-xs flex-1 truncate
                          ${isSelectedSection 
                            ? themeClasses.activeText
                            : status === 'completed' ? themeClasses.completedText :
                              status === 'skipped' ? themeClasses.textSubtle + ' line-through' :
                              themeClasses.textMuted}
                        `}>
                          {subStage.label}
                          {subStage.required && status !== 'completed' && status !== 'skipped' && (
                            <span className="text-red-400 ml-0.5">*</span>
                          )}
                        </span>
                        {!isSelectedSection && <SubIcon className={`w-3 h-3 ${themeClasses.textSubtle}`} />}
                        {isSelectedSection && <ChevronRight className={`w-3 h-3 ${themeClasses.activeText}`} />}
                      </button>
                    )
                  })}
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
            Stage {Math.max(1, STAGE_DEFINITIONS.findIndex(s => s.key === resolvedCurrentStage) + 1)} of {STAGE_DEFINITIONS.length}
          </span>
          <button
            onClick={() => resolvedCurrentStage && handleStageClick(resolvedCurrentStage)}
            className={`
              text-xs px-2 py-1 rounded
              ${theme === 'dark'
                ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
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

