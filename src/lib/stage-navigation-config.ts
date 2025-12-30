/**
 * Stage Navigation Configuration (Research Paper Flow)
 *
 * This file defines the structure of stages and sub-stages for paper drafting.
 * Data comes from the session object and paper-type configuration in the database.
 */

import {
  CheckCircle,
  FileText,
  Lightbulb,
  ListOrdered,
  PenTool,
  Search,
  type LucideIcon
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export type SubStageStatus = 'completed' | 'in_progress' | 'pending' | 'skipped'

export interface SubStageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  required: boolean
  getStatus: (session: any) => SubStageStatus
}

export interface StageDefinition {
  key: string
  label: string
  icon: LucideIcon
  description: string
  subStages: SubStageDefinition[]
  weight: number
  getSubStages?: (session: any) => SubStageDefinition[]
}

// ============================================================================
// Helpers
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
  if (typeof session?.currentWordCount === 'number' && session.currentWordCount > 0) {
    return 'completed'
  }

  const sections = getPaperDraftSections(session)
  const hasContent = Object.values(sections).some(content => computeWordCount(String(content)) > 0)
  return hasContent ? 'completed' : 'pending'
}

// ============================================================================
// Stage Definitions
// ============================================================================

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    key: 'TOPIC_ENTRY',
    label: 'Topic Entry',
    icon: Lightbulb,
    description: 'Define your research topic',
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
    label: 'Literature Search',
    icon: Search,
    description: 'Search and import citations',
    weight: 15,
    subStages: [
      {
        key: 'citations_imported',
        label: 'Imported Citations',
        icon: FileText,
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
    key: 'OUTLINE_PLANNING',
    label: 'Outline Planning',
    icon: ListOrdered,
    description: 'Configure paper structure',
    weight: 15,
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
      },
      {
        key: 'word_target',
        label: 'Target Word Count',
        icon: FileText,
        description: 'Set a word count target',
        required: false,
        getStatus: (session) => {
          return session?.targetWordCount ? 'completed' : 'pending'
        }
      }
    ]
  },
  {
    key: 'FIGURE_PLANNER',
    label: 'Figure Planner',
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
    weight: 30,
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
// Stage Order
// ============================================================================

export const STAGE_ORDER = STAGE_DEFINITIONS.map(stage => stage.key)

// ============================================================================
// Helpers for Navigation
// ============================================================================

export function getStageSubStages(stage: StageDefinition, session: any): SubStageDefinition[] {
  if (stage.getSubStages) {
    return stage.getSubStages(session)
  }
  return stage.subStages
}

export function getVisibleStages(_session: any): StageDefinition[] {
  return STAGE_DEFINITIONS
}

export function calculateStageCompletion(
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

export function getStageStatus(
  stage: StageDefinition,
  session: any,
  currentStage: string
): 'completed' | 'current' | 'pending' | 'skipped' {
  const visibleStages = getVisibleStages(session)
  const currentIndex = Math.max(0, visibleStages.findIndex(s => s.key === currentStage))
  const stageIndex = visibleStages.findIndex(s => s.key === stage.key)

  if (stage.key === currentStage) return 'current'
  if (stageIndex !== -1 && stageIndex < currentIndex) return 'completed'
  return 'pending'
}

export function calculateOverallProgress(session: any, currentStage: string): number {
  const visibleStages = getVisibleStages(session)
  const currentIndex = visibleStages.findIndex(s => s.key === currentStage)
  const resolvedIndex = currentIndex === -1 ? 0 : currentIndex

  let totalWeight = 0
  let completedWeight = 0

  visibleStages.forEach((stage, index) => {
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
