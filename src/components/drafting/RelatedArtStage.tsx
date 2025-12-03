'use client'

import React, { useEffect, useMemo, useState, Fragment, useRef, memo } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/20/solid'

interface RelatedArtStageProps {
  session: {
    id: string
    relatedArtRuns?: Array<{
      id: string
      resultsJson: any[]
      ranAt: string
    }>
    relatedArtSelections?: Array<{
      patentNumber: string
      title?: string
      snippet?: string
      score?: number
      tags?: string[]
      publicationDate?: string
      cpcCodes?: string[]
      ipcCodes?: string[]
      inventors?: string[]
      assignees?: string[]
      runId?: string // Added runId to selection
    }>
    ideaRecord?: any
    manualPriorArt?: {
      manualPriorArtText: string
      useOnlyManualPriorArt: boolean
      useManualAndAISearch: boolean
    }
    aiAnalysisData?: Record<string, any>
  }
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

type ResultItem = {
  title: string
  pn: string
  snippet?: string
  publication_date?: string
  score?: number
  inventors?: string[] | string
  assignees?: string[] | string
}

const RelatedArtStage = React.memo(function RelatedArtStage({ session, patent, onComplete, onRefresh }: RelatedArtStageProps) {
  // DEBUG: Check if component is being remounted
  console.log('🔄 RelatedArtStage component instance created/rendered')

  const idea = session?.ideaRecord || {}
  const searchQuery = idea?.searchQuery || ''
  const abstract = idea?.abstract || ''
  const cpcCodes: string[] = Array.isArray(idea?.cpcCodes) ? idea.cpcCodes : []
  const ipcCodes: string[] = Array.isArray(idea?.ipcCodes) ? idea.ipcCodes : []

  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, { aiSummary?: string; noveltyThreat?: string; relevantParts?: string[]; irrelevantParts?: string[]; noveltyComparison?: string }>>({})
  const [hasLoadedSelections, setHasLoadedSelections] = useState(false)
  const [limit, setLimit] = useState(25)
  const [afterDate, setAfterDate] = useState('')
  const [customQuery, setCustomQuery] = useState('')
  const [showCustomQuery, setShowCustomQuery] = useState(false)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  // AI review states
  const [reviewing, setReviewing] = useState(false)
  const [reviewInfo, setReviewInfo] = useState<string>('')
  const [ideaBankOpen, setIdeaBankOpen] = useState(false)
  const [ideaBank, setIdeaBank] = useState<Array<{ title: string; core_principle: string; expected_advantage: string; tags: string[]; non_obvious_extension: string }>>([])
  const [hasRestoredFromStorage, setHasRestoredFromStorage] = useState(false)
  const [ideaBankVersion, setIdeaBankVersion] = useState(0) // Force re-renders

  // ============= TAB-BASED WORKFLOW STATES =============
  // Active tab: 'prior-art' = for drafting references, 'claim-refinement' = for claim comparison
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<'prior-art' | 'claim-refinement'>('prior-art')

  // WORKFLOW A: Prior Art for Patent Drafting
  // These patents/text will be cited in the patent draft (background, etc.)
  const [priorArtMode, setPriorArtMode] = useState<'ai' | 'manual' | 'hybrid'>('ai')
  const [priorArtSelected, setPriorArtSelected] = useState<Record<string, any>>({})
  const [priorArtManualText, setPriorArtManualText] = useState('')
  const [priorArtThreatFilter, setPriorArtThreatFilter] = useState<string[]>([])

  // WORKFLOW B: Patents for Claim Refinement
  // These patents will be compared against claims to ensure novelty
  const [claimRefMode, setClaimRefMode] = useState<'ai' | 'manual' | 'hybrid'>('ai')
  const [claimRefSelected, setClaimRefSelected] = useState<Record<string, any>>({})
  const [claimRefManualText, setClaimRefManualText] = useState('')
  const [claimRefThreatFilter, setClaimRefThreatFilter] = useState<string[]>(['anticipates', 'obvious']) // Default to high-risk

  // Skip Claim Refinement option - user confident in their claims
  const [skipClaimRefinement, setSkipClaimRefinement] = useState(false)

  // Quick View panel states
  const [showAbstractPanel, setShowAbstractPanel] = useState(false)
  const [showAIAnalysisPanel, setShowAIAnalysisPanel] = useState(false)
  const [showRawResultsPanel, setShowRawResultsPanel] = useState(false)

  // Track which patents have expanded details (on-demand loading)
  const [expandedPatentDetails, setExpandedPatentDetails] = useState<Set<string>>(new Set())

  // Track which sections within expanded patents are visible
  const [expandedSections, setExpandedSections] = useState<{
    [patentKey: string]: {
      metadata: boolean
      abstract: boolean
      aiSummary: boolean
      relevantParts: boolean
      irrelevantParts: boolean
      noveltyComparison: boolean
    }
  }>({})

  // Legacy state for backward compatibility
  const [selected, setSelected] = useState<Record<string, { title?: string; snippet?: string; score?: number; tags?: string[]; publication_date?: string; inventors?: any; assignees?: any; aiSummary?: string; noveltyThreat?: string; relevantParts?: string[]; irrelevantParts?: string[]; noveltyComparison?: string }>>({})

  // Legacy manual prior art states (kept for backward compatibility with saved sessions)
  const [manualPriorArtText, setManualPriorArtText] = useState('')
  const [isManualPriorArtSaved, setIsManualPriorArtSaved] = useState(false)
  const [useOnlyManualPriorArt, setUseOnlyManualPriorArt] = useState(false)
  const [useManualAndAISearch, setUseManualAndAISearch] = useState(false)
  const [savingManualPriorArt, setSavingManualPriorArt] = useState(false)
  const [useAutoPriorArt, setUseAutoPriorArt] = useState(true)
  const [useManualPriorArtToggle, setUseManualPriorArtToggle] = useState(false)

  // Saving states
  const [savingPriorArt, setSavingPriorArt] = useState(false)
  const [savingClaimRef, setSavingClaimRef] = useState(false)

  // UI control states
  const [relevanceFilters, setRelevanceFilters] = useState<string[]>([])
  const [noveltyThreatFilters, setNoveltyThreatFilters] = useState<string[]>([])
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [autoSelectWarning, setAutoSelectWarning] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'warning'; text: string } | null>(null)

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualPriorArtRef = useRef<HTMLDivElement | null>(null)
  const lastLoadedRunIdRef = useRef<string | null>(null)

  // DEBUG: Log renders
  console.log('RelatedArtStage render - ideaBank:', ideaBank.length, 'ideaBankOpen:', ideaBankOpen, 'version:', ideaBankVersion)

  // DEBUG: Check for component mounting
  useEffect(() => {
    console.log('🏗️ RelatedArtStage component mounted')
    return () => {
      console.log('🏗️ RelatedArtStage component unmounting')
    }
  }, [])

  // Restore ideaBank from sessionStorage once session is available
  useEffect(() => {
    if (session?.id && !hasRestoredFromStorage && ideaBank.length === 0) {
      try {
        const storageKey = `ideaBank_${session.id}`
        const saved = sessionStorage.getItem(storageKey)
        console.log('🔍 Checking sessionStorage for key:', storageKey, 'found:', !!saved)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('💾 Restored ideaBank from sessionStorage:', parsed.length, 'ideas')
            console.log('💾 First restored idea:', parsed[0]?.title?.substring(0, 50))
            setIdeaBank(parsed)
            setIdeaBankVersion(prev => prev + 1)
            setHasRestoredFromStorage(true)
          } else {
            console.log('💾 sessionStorage had data but no valid ideas array')
          }
        } else {
          console.log('💾 No saved ideaBank found in sessionStorage')
        }
      } catch (e) {
        console.warn('Failed to restore ideaBank from sessionStorage:', e)
      }
    }
  }, [session?.id, hasRestoredFromStorage, ideaBank.length])

  // DEBUG: Log ideaBank changes and persist to sessionStorage
  useEffect(() => {
    console.log('💡 ideaBank state changed:', ideaBank.length, 'ideas, version:', ideaBankVersion)
    if (ideaBank.length > 0) {
      console.log('💡 First idea title:', ideaBank[0]?.title)
    }

    // Persist ideaBank to sessionStorage to survive component remounts
    if (typeof window !== 'undefined' && session?.id) {
      try {
        if (ideaBank.length > 0) {
          sessionStorage.setItem(`ideaBank_${session.id}`, JSON.stringify(ideaBank))
          console.log('💾 Saved ideaBank to sessionStorage:', ideaBank.length, 'ideas')
        } else if (hasRestoredFromStorage) {
          // Only clear sessionStorage if we've already restored and now have 0 items
          sessionStorage.removeItem(`ideaBank_${session.id}`)
        }
      } catch (e) {
        console.warn('Failed to save ideaBank to sessionStorage:', e)
      }
    }
  }, [ideaBank, session?.id, hasRestoredFromStorage])

  // Display control settings (saved in localStorage)
  const [displaySettings, setDisplaySettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('patentDisplaySettings')
      return saved ? JSON.parse(saved) : {
        showTitle: true,
        showPatentNumber: true,
        showAbstract: true,
        showInventors: true,
        showAssignees: false,
        showPublicationDate: true,
        showRelevanceScore: true
      }
    }
    return {
      showTitle: true,
      showPatentNumber: true,
      showAbstract: true,
      showInventors: true,
      showAssignees: false,
      showPublicationDate: true,
      showRelevanceScore: true
    }
  })

  const [showDisplayControls, setShowDisplayControls] = useState(false)

  // Save display settings to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('patentDisplaySettings', JSON.stringify(displaySettings))
    }
  }, [displaySettings])

  // Track whether initial hydration has been done to avoid overwriting user changes
  const hasInitializedRef = useRef(false)

  // Load stored results and AI analysis on mount/session change
  useEffect(() => {
    if (!session) return

    const latestRun = session.relatedArtRuns?.[0]
    const latestRunId = latestRun?.id || null

    console.log('🔄 useEffect running - session changed. runId:', latestRunId, 'ideaBank.length:', ideaBank.length, 'results.length:', results.length, 'hasInitialized:', hasInitializedRef.current)

    const hasStoredResults = latestRun?.resultsJson && Array.isArray(latestRun.resultsJson) && latestRun.resultsJson.length > 0

    // Check if the run ID changed (new search was performed)
    const runIdChanged = latestRunId && lastLoadedRunIdRef.current !== latestRunId

    // Hydrate results from DB on first load or when run ID changes
    if (latestRun && (runIdChanged || (!hasInitializedRef.current && latestRunId && hasStoredResults && results.length === 0))) {
      lastLoadedRunIdRef.current = latestRunId
      setResults(latestRun.resultsJson)
      setRunId(latestRun.id)
      console.log('Hydrated prior-art results from DB:', latestRun.resultsJson.length, 'items from run:', latestRun.id)
    } else if (latestRunId && !runId) {
      // Preserve runId hint even if resultsJson was not persisted (avoid losing AI review CTA)
      setRunId(latestRunId)
    }

    // NOTE: Idea bank suggestions are stored in the main idea bank table, not in the run record
    // The local ideaBank state is only populated by AI review and should persist until component unmount
    // No loading from stored data needed here

    // Load manual prior art data if it exists (only on first initialization to avoid overwriting user edits)
    if (!hasInitializedRef.current && session?.manualPriorArt) {
      const manualData = session.manualPriorArt
      setManualPriorArtText(manualData.manualPriorArtText || '')
      setUseOnlyManualPriorArt(manualData.useOnlyManualPriorArt || false)
      setUseManualAndAISearch(manualData.useManualAndAISearch !== false) // Default to true
      setIsManualPriorArtSaved(true)
      setUseManualPriorArtToggle(!!(manualData.manualPriorArtText || manualData.useOnlyManualPriorArt || manualData.useManualAndAISearch))
      console.log('Loaded stored manual prior art data')
    }

    // CRITICAL: Always load AI analysis data from session if not already in state
    // This ensures AI review results persist across stage navigation
    if ((session as any)?.aiAnalysisData && Object.keys(aiAnalysis).length === 0) {
      const storedAiAnalysis = (session as any).aiAnalysisData
      if (storedAiAnalysis && typeof storedAiAnalysis === 'object' && Object.keys(storedAiAnalysis).length > 0) {
      setAiAnalysis(storedAiAnalysis)
        console.log('✅ Loaded stored AI analysis data:', Object.keys(storedAiAnalysis).length, 'entries')
      }
    }

    // Load saved workflow configurations from priorArtConfig
    if (!hasInitializedRef.current && (session as any)?.priorArtConfig) {
      const config = (session as any).priorArtConfig
      
      // Load Prior Art for Drafting configuration
      if (config.priorArtForDrafting) {
        const draftConfig = config.priorArtForDrafting
        if (draftConfig.mode) setPriorArtMode(draftConfig.mode)
        if (draftConfig.manualText) setPriorArtManualText(draftConfig.manualText)
        if (draftConfig.selectedPatents && Array.isArray(draftConfig.selectedPatents)) {
          const selectedMap: Record<string, any> = {}
          draftConfig.selectedPatents.forEach((p: any) => {
            if (p.patentNumber) selectedMap[p.patentNumber] = p
          })
          setPriorArtSelected(selectedMap)
        }
        console.log('✅ Loaded Prior Art for Drafting config:', draftConfig.mode, Object.keys(draftConfig.selectedPatents || {}).length, 'patents')
      }
      
      // Load Claim Refinement configuration
      if (config.claimRefinementConfig) {
        const claimConfig = config.claimRefinementConfig
        if (claimConfig.mode) setClaimRefMode(claimConfig.mode)
        if (claimConfig.manualText) setClaimRefManualText(claimConfig.manualText)
        if (claimConfig.selectedPatents && Array.isArray(claimConfig.selectedPatents)) {
          const selectedMap: Record<string, any> = {}
          claimConfig.selectedPatents.forEach((p: any) => {
            if (p.patentNumber) selectedMap[p.patentNumber] = p
          })
          setClaimRefSelected(selectedMap)
        }
        console.log('✅ Loaded Claim Refinement config:', claimConfig.mode, Object.keys(claimConfig.selectedPatents || {}).length, 'patents')
      }
      
      // Load skip claim refinement flag
      if (config.skippedClaimRefinement) {
        setSkipClaimRefinement(true)
        console.log('✅ Loaded skipClaimRefinement: true')
      }
    }

    // Load user's saved selections (only on first initialization or when run changes)
    if (!hasInitializedRef.current || runIdChanged) {
    const selectionsMap: Record<string, any> = {}

    if (latestRunId && session?.relatedArtSelections && session.relatedArtSelections.length > 0) {
      const allRunSelections = session.relatedArtSelections.filter((sel: any) => sel.runId === latestRunId)

      // Prefer only user-confirmed selections (USER_SELECTED tag); if none, load none
      const userConfirmed = allRunSelections.filter((sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED'))
      const currentRunSelections = userConfirmed.length > 0 ? userConfirmed : []

      console.log(`Filtering ${session.relatedArtSelections.length} total selections down to ${currentRunSelections.length} for runId: ${latestRunId} (user-confirmed: ${userConfirmed.length})`)

      currentRunSelections.forEach((sel: any) => {
        const key = sel.patentNumber && sel.patentNumber !== 'N/A' ? sel.patentNumber : sel.title || 'Untitled'

        // Parse AI analysis from the saved selection
        let aiSummary = '', relevantParts: string[] = [], irrelevantParts: string[] = [], noveltyComparison = ''
        if (sel.userNotes) {
          try {
            const parsedAnalysis = JSON.parse(sel.userNotes)
            aiSummary = parsedAnalysis.summary || ''
            relevantParts = parsedAnalysis.relevant_parts || []
            irrelevantParts = parsedAnalysis.irrelevant_parts || []
            noveltyComparison = parsedAnalysis.novelty_comparison || ''
          } catch (e) {
            // Fallback for old format or plain text
            aiSummary = sel.userNotes
          }
        }

        const noveltyThreat = sel.tags?.includes('AI_ANTICIPATES') ? 'anticipates' :
                              sel.tags?.includes('AI_OBVIOUS') ? 'obvious' :
                              sel.tags?.includes('AI_ADJACENT') ? 'adjacent' :
                              sel.tags?.includes('AI_REMOTE') ? 'remote' : 'unknown'

        // Load user's saved selections for the current run
        selectionsMap[key] = {
          title: sel.title,
          snippet: sel.snippet,
          score: sel.score,
          tags: sel.tags || [],
          publication_date: sel.publicationDate,
          inventors: sel.inventors,
          assignees: sel.assignees,
          aiSummary,
          relevantParts,
          irrelevantParts,
          noveltyComparison,
          noveltyThreat
        }
      })
    }

    setSelected(selectionsMap) // Load only user's saved selections for the current run
    console.log('Loaded selections for current run:', Object.keys(selectionsMap).length, 'patents')
    }

    // Mark initialization complete
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      setHasLoadedSelections(true)
    }
  }, [session])

  // Auto-persist checkbox selections without refreshing the whole page
  useEffect(() => {
    if (!hasLoadedSelections) return
    if (!runId || !session?.id) return

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      // Skip manual prior art to avoid noisy saves while the user types
      // Errors are logged but do not interrupt the UX
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      saveSelections({ skipManual: true }).catch(err => {
        console.error('Auto-save of related art selections failed:', err)
      })
    }, 800)

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [selected, runId, session?.id, hasLoadedSelections])

  // Check if AI review has been done FOR CURRENT RESULTS
  const hasAIReview = useMemo(() => {
    if (results.length === 0) return false;
    // Check if at least one result in the current list has been analyzed
    return results.some(r => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      return !!aiAnalysis[pn];
    });
  }, [results, aiAnalysis]);

  // Calculate AI analysis summary stats for Quick View panels
  const analysisSummary = useMemo(() => {
    const total = Object.keys(aiAnalysis).length
    const anticipates = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'anticipates').length
    const obvious = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'obvious').length
    const adjacent = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'adjacent').length
    const remote = Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'remote').length
    return { total, anticipates, obvious, adjacent, remote }
  }, [aiAnalysis])

  // Get section visibility for a patent (defaults to all visible)
  const getSectionVisibility = (patentKey: string) => {
    return expandedSections[patentKey] || {
      metadata: true,
      abstract: true,
      aiSummary: true,
      relevantParts: true,
      irrelevantParts: true,
      noveltyComparison: true
    }
  }

  // Toggle section visibility
  const toggleSection = (patentKey: string, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [patentKey]: {
        ...getSectionVisibility(patentKey),
        [section]: !getSectionVisibility(patentKey)[section as keyof typeof getSectionVisibility]
      }
    }))
  }

  const handleRelevanceFilterChange = (range: string) => {
    setRelevanceFilters(prev =>
      prev.includes(range) ? prev.filter(r => r !== range) : [...prev, range]
    )
    setCurrentPage(1) // Reset to first page on filter change
  }

  const handleNoveltyThreatFilterChange = (threat: string) => {
    setNoveltyThreatFilters(prev =>
      prev.includes(threat) ? prev.filter(t => t !== threat) : [...prev, threat]
    )
    setCurrentPage(1) // Reset to first page on filter change
  }

  const handleAutoSelectAdjacent = () => {
    if (!hasAIReview) return

    const candidates = results
      .map((r, index) => {
        const pn =
          r.pn ||
          (r as any).patent_number ||
          (r as any).publication_number ||
          (r as any).publication_id ||
          (r as any).publicationId ||
          (r as any).patentId ||
          (r as any).patent_id ||
          (r as any).id ||
          'N/A'
        const analysis = aiAnalysis[pn]
        if (!pn || pn === 'N/A' || !analysis || analysis.noveltyThreat !== 'adjacent') return null

        const relevance =
          typeof (r as any).score === 'number'
            ? (r as any).score
            : typeof (r as any).relevance === 'number'
              ? (r as any).relevance
              : 0

        return { r, pn, relevance, index }
      })
      .filter(Boolean) as Array<{ r: ResultItem | any; pn: string; relevance: number; index: number }>

    if (candidates.length === 0) {
      setAutoSelectWarning('⚠️ No adjacent-category patents found. Automatic selection may reduce novelty quality. Manual selection is recommended.')
      return
    }

    // Sort by relevance (desc), then by stable index
    candidates.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance
      return a.index - b.index
    })

    const top = candidates.slice(0, 10)
    const nextSelected: typeof selected = { ...selected }

    top.forEach(({ r, pn }) => {
      const title = (r as any).title || (r as any).invention_title || pn || 'Untitled'
      const snippet = (r as any).snippet || (r as any).abstract || (r as any).summary || (r as any).description || ''
      const publication_date = (r as any).publication_date
      const score =
        typeof (r as any).score === 'number'
          ? (r as any).score
          : typeof (r as any).relevance === 'number'
            ? (r as any).relevance
            : undefined
      const inventors = (r as any).inventors || (r as any).inventor_names || []
      const assignees = (r as any).assignees || (r as any).assignee_names || []

      const existing = nextSelected[pn] || {}

      nextSelected[pn] = {
        ...existing,
        title,
        snippet,
        score,
        publication_date,
        inventors,
        assignees,
        aiSummary: aiAnalysis[pn]?.aiSummary || existing.aiSummary,
        noveltyThreat: aiAnalysis[pn]?.noveltyThreat || existing.noveltyThreat,
        relevantParts: aiAnalysis[pn]?.relevantParts || existing.relevantParts || [],
        irrelevantParts: aiAnalysis[pn]?.irrelevantParts || existing.irrelevantParts || [],
        noveltyComparison: aiAnalysis[pn]?.noveltyComparison || existing.noveltyComparison,
        tags: Array.from(new Set([...(existing.tags || []), 'AI_REVIEWED', 'AI_ADJACENT']))
      }
    })

    setSelected(nextSelected)
    setAutoSelectWarning(null)
  }


  // Calculate patent counts for each relevance range
  const relevanceRangeCounts = useMemo(() => {
    return results.reduce((acc, r) => {
      const score = (r.score || 0) * 100
      if (score >= 90 && score <= 100) acc['90-100'] = (acc['90-100'] || 0) + 1
      else if (score >= 80 && score < 90) acc['80-90'] = (acc['80-90'] || 0) + 1
      else if (score >= 70 && score < 80) acc['70-80'] = (acc['70-80'] || 0) + 1
      else if (score >= 60 && score < 70) acc['60-70'] = (acc['60-70'] || 0) + 1
      else if (score >= 50 && score < 60) acc['50-60'] = (acc['50-60'] || 0) + 1
      else if (score < 50) acc['<50'] = (acc['<50'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [results])

  // First, filter results by relevance only (not threat)
  const relevanceFilteredResults = useMemo(() => {
    if (relevanceFilters.length === 0) return results
    return results.filter(r => {
      const score = (r.score || 0) * 100
      return relevanceFilters.some(filter => {
        if (filter === '90-100') return score >= 90 && score <= 100
        if (filter === '80-90') return score >= 80 && score < 90
        if (filter === '70-80') return score >= 70 && score < 80
        if (filter === '60-70') return score >= 60 && score < 70
        if (filter === '50-60') return score >= 50 && score < 60
        if (filter === '<50') return score < 50
        return false
      })
    })
  }, [results, relevanceFilters])

  // Calculate patent counts for each novelty threat level (based on relevance-filtered results)
  const noveltyThreatCounts = useMemo(() => {
    return relevanceFilteredResults.reduce((acc, r) => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      const threat = aiAnalysis[pn]?.noveltyThreat || 'unknown'
      acc[threat] = (acc[threat] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }, [relevanceFilteredResults, aiAnalysis])

  // Then apply threat filter to get final filtered results
  const filteredResults = useMemo(() => {
    if (noveltyThreatFilters.length === 0) return relevanceFilteredResults
    return relevanceFilteredResults.filter(r => {
      const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
      const threat = aiAnalysis[pn]?.noveltyThreat || 'unknown'
      return noveltyThreatFilters.includes(threat)
    })
  }, [relevanceFilteredResults, noveltyThreatFilters, aiAnalysis])

  // Calculate total analyzed results (excluding unknown)
  const analyzedResultsCount = useMemo(() => {
    return (noveltyThreatCounts.anticipates || 0) + (noveltyThreatCounts.obvious || 0) + (noveltyThreatCounts.adjacent || 0) + (noveltyThreatCounts.remote || 0)
  }, [noveltyThreatCounts])


  const totalPages = Math.ceil(filteredResults.length / itemsPerPage)
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const defaultQuery = useMemo(() => {
    // Use only the searchQuery from Stage 1 (LLM-generated, compact and optimized)
    return searchQuery
  }, [searchQuery])

  const q = defaultQuery

  const getPatentKey = (item: any, index?: number) => {
    const pn =
      item.pn ||
      (item as any).patent_number ||
      (item as any).publication_number ||
      (item as any).publication_id ||
      (item as any).publicationId ||
      (item as any).patentId ||
      (item as any).patent_id ||
      (item as any).id ||
      'N/A'
    const ttl = item.title || (item as any).invention_title || pn || 'Untitled'
    const idx = typeof index === 'number' ? index : 0
    return pn !== 'N/A' ? pn : `${ttl}-${idx}`
  }

  // Generate consistent key for selection (must match the key used in render)
  const generateSelectionKey = (item: any, index?: number) => {
    return getPatentKey(item, index)
  }

  const toggleSelect = (item: any, index?: number) => {
    const key = getPatentKey(item, index)
    setSelected(prev => {
      const next = { ...prev }
      if (next[key]) {
        delete next[key]
      } else {
        next[key] = {
          title: item.title || (item as any).invention_title || (item as any).patent_number || 'Untitled',
          snippet: item.snippet || (item as any).abstract || (item as any).summary || (item as any).description || '',
          score: item.score || (item as any).relevance || 0,
          tags: [],
          publication_date: (item as any).publication_date || (item as any).filing_date || (item as any).date || '',
          inventors: (item as any).inventors || (item as any).inventor_names || [],
          assignees: (item as any).assignees || (item as any).assignee_names || []
        }
      }
      return next
    })
  }

  const scrollToManualPriorArt = () => {
    if (manualPriorArtRef.current) {
      manualPriorArtRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const manualPriorArtEnabled = useMemo(() => {
    return manualPriorArtText.trim().length > 0 || useOnlyManualPriorArt || useManualAndAISearch
  }, [manualPriorArtText, useOnlyManualPriorArt, useManualAndAISearch])

  const clearAllSelections = async () => {
    setSelected({})
    try {
      if (session?.id && runId) {
        await onComplete({ action: 'clear_related_art_selections', sessionId: session.id, runId })
      }
      setStatusMessage({
        type: 'warning',
        text: 'All patent selections cleared.'
      })
    } catch (e) {
      console.error('Failed to clear selections:', e)
      setError('Failed to clear selections.')
    }
  }

  const runSearch = async () => {
    console.log('🚀 runSearch called - customQuery:', customQuery, 'q:', q)
    try {
      setBusy(true)
      setSearching(true)
      setError(null)

      const searchQuery = customQuery.trim() || q

      // Debug logging
      console.log('🔍 Search Query Debug:')
      console.log('  - Custom Query (raw):', customQuery)
      console.log('  - Custom Query (trimmed):', customQuery.trim())
      console.log('  - Default Query (q):', q)
      console.log('  - Final Search Query:', searchQuery)
      console.log('  - Using custom query?', customQuery.trim().length > 0)

      // Sophisticated search progress simulation
      const progressSteps = [
        '🔍 Scanning through 12M+ global patent database...',
        '🎯 Applying advanced semantic analysis to your invention...',
        '🧠 Using proprietary AI algorithms for relevance matching...',
        '📊 Calculating multi-dimensional similarity scores...',
        '🔬 Cross-referencing with CPC/IPC classification systems...',
        '⚡ Filtering results through novelty assessment engine...',
        '✨ Ranking patents by technical relevance and impact...',
        '📋 Preparing final results with comprehensive metadata...'
      ]

      // Show progress with artificial delays to impress the user
      for (let i = 0; i < progressSteps.length; i++) {
        setSearchProgress(progressSteps[i])
        await new Promise(resolve => setTimeout(resolve, 1800)) // 1.8 seconds per step
      }

      // Execute actual search
      setSearchProgress('💡 Finalizing patent analysis and generating comprehensive report...')
      const resp = await onComplete({ action: 'related_art_search', sessionId: session?.id, limit, queryOverride: searchQuery, afterDate: afterDate || undefined })

      const items = Array.isArray(resp?.results) ? resp.results : []

      // Show final result count
      setSearchProgress(`✨ Analysis complete! Found ${items.length} highly relevant patent${items.length !== 1 ? 's' : ''} from millions of global records.`)

      // Brief pause to show the result
      await new Promise(resolve => setTimeout(resolve, 2500))

      // Reset AI analysis and selections for new search to ensure fresh workflow
      setAiAnalysis({})
      setSelected({})
      setIdeaBank([])
      setIdeaBankVersion(prev => prev + 1) // Force re-render
      setHasRestoredFromStorage(false) // Reset restoration flag

      // Clear persisted ideaBank for this session
      if (typeof window !== 'undefined' && session?.id) {
        sessionStorage.removeItem(`ideaBank_${session.id}`)
        console.log('🗑️ Cleared persisted ideaBank for new search')
      }

      setResults(items)
      setRunId(resp?.runId || null)

    } catch (e) {
      console.log('Search error:', e)
      const errorData = (e as any)?.response?.data || e
      if ((errorData as any)?.showMockOption) {
        setError(`${(errorData as any).error || 'Search failed'}. Try using "Mock Search" for testing.`)
      } else {
        setError((errorData as any)?.error || 'Search failed. Please try again.')
      }
    } finally {
      setBusy(false)
      setSearching(false)
      setSearchProgress('')
    }
  }

  const runAIReview = async () => {
    if (!runId) { setError('Run a search first.'); return }
    if (results.length === 0) { setError('No results to review.'); return }
    try {
      setError(null)
      setReviewing(true)
      setReviewInfo('Analyzing patents with AI…')
      
      // Get frozen claims from session for claim-aware prior art analysis
      const normalizedData = (session?.ideaRecord?.normalizedData || {}) as any
      const frozenClaims = normalizedData.claimsStructured || []
      const claimsText = normalizedData.claims || ''
      const claimsApprovedAt = normalizedData.claimsApprovedAt
      
      // Pass claims context to the AI review for deeper analysis
      const resp = await onComplete({
        action: 'related_art_llm_review',
        sessionId: session?.id,
        runId,
        // Include frozen claims for claim-aware analysis
        claimsContext: claimsApprovedAt ? {
          claims: frozenClaims.length > 0 ? frozenClaims : claimsText,
          jurisdiction: normalizedData.claimsJurisdiction,
          frozenAt: claimsApprovedAt
        } : null
      })

      console.log('=== AI REVIEW RESPONSE DEBUG ===')
      console.log('AI Review Response received:', !!resp)
      console.log('Response type:', typeof resp)

      // Check if response is null or undefined
      if (!resp) {
        console.error('❌ AI Review API returned null/undefined response')
        setError('AI review failed: No response from server. Please try again.')
        setReviewing(false)
        return
      }

      console.log('Response keys:', Object.keys(resp))
      console.log('Response has decisions:', Array.isArray(resp.decisions))
      console.log('Response has ideaBankSuggestions:', Array.isArray(resp.ideaBankSuggestions))
      console.log('Decisions count:', resp.decisions?.length || 0)
      console.log('IdeaBankSuggestions count:', resp.ideaBankSuggestions?.length || 0)

      const decisions: Array<{ pn: string; title: string; relevance: number; decision: string; summary: string }> = Array.isArray(resp?.decisions) ? resp.decisions : []
      const auto: string[] = Array.isArray(resp?.autoSelect) ? resp.autoSelect : []

      // Try multiple ways to extract ideas
      let ideas: any[] = []
      if (Array.isArray(resp?.ideaBankSuggestions)) {
        ideas = resp.ideaBankSuggestions
        console.log('✅ Found ideas in resp.ideaBankSuggestions')
      } else if (Array.isArray(resp?.data?.ideaBankSuggestions)) {
        ideas = resp.data.ideaBankSuggestions
        console.log('✅ Found ideas in resp.data.ideaBankSuggestions')
      } else if (resp?.data && Array.isArray(resp.data.ideaBankSuggestions)) {
        ideas = resp.data.ideaBankSuggestions
        console.log('✅ Found ideas in resp.data (nested)')
      } else {
        console.log('❌ No ideas found in any expected location')
      }

      console.log('Final Idea Bank Ideas:', ideas)
      console.log('Ideas length:', ideas.length)
      console.log('=== END AI REVIEW RESPONSE DEBUG ===')

      // Always set ideaBank, even if empty, to ensure UI updates
      console.log('🚀 About to call setIdeaBank with:', ideas.length, 'ideas')
      console.log('🚀 Ideas array content:', ideas)

      // Store ideas in a way that survives re-renders
      const ideasToSet = [...ideas] // Create a copy

      // Update both states to force re-render
      setIdeaBank(ideasToSet)
      setIdeaBankVersion(prev => prev + 1) // Force re-render
      console.log('✅ Idea Bank setIdeaBank called with', ideasToSet.length, 'ideas, new version will be:', ideaBankVersion + 1)

      // Force an immediate state check
      setTimeout(() => {
        console.log('🔄 Immediate check after setIdeaBank:', ideaBank.length, 'ideas, version:', ideaBankVersion)
        if (ideasToSet.length > 0) {
          console.log('🔄 Immediate check - first idea:', ideasToSet[0]?.title)
        }
      }, 0)

      // Update review info
      setReviewInfo('Analysis complete - ' + ideasToSet.length + ' ideas generated')

      // Force a re-render check
      setTimeout(() => {
        console.log('🔄 Re-checking ideaBank state after setState:', ideaBank.length, 'ideas, version:', ideaBankVersion)
        console.log('🔄 Current ideaBank content:', ideaBank)
      }, 100)
      const byPn: Record<string, { relevance: number; novelty_threat: string; summary: string; title: string; relevant_parts?: string[]; irrelevant_parts?: string[]; novelty_comparison?: string }> = {}
      for (const d of decisions) {
        if (!d?.pn) continue
        byPn[d.pn] = {
          relevance: typeof d.relevance === 'number' ? d.relevance : 0,
          novelty_threat: String((d as any).novelty_threat||'remote'),
          summary: String(d.summary||'').slice(0,260),
          title: d.title || '',
          relevant_parts: (d as any).detailedAnalysis?.relevant_parts || [],
          irrelevant_parts: (d as any).detailedAnalysis?.irrelevant_parts || [],
          novelty_comparison: (d as any).detailedAnalysis?.novelty_comparison || ''
        }
      }
      // Store AI analysis results separately from manual selections
      const newAiAnalysis: Record<string, any> = {}
      results.forEach((r, i) => {
        const pn = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
        if (!pn || pn === 'N/A') return
        const dec = byPn[pn]
        if (!dec) return

        newAiAnalysis[pn] = {
          aiSummary: dec.summary,
          noveltyThreat: dec.novelty_threat,
          relevantParts: Array.isArray(dec.relevant_parts) ? dec.relevant_parts : [],
          irrelevantParts: Array.isArray(dec.irrelevant_parts) ? dec.irrelevant_parts : [],
          noveltyComparison: String(dec.novelty_comparison || '').trim()
        }
      })

      setAiAnalysis(newAiAnalysis)

      // Save AI analysis data to database
      try {
        await onComplete({ action: 'save_ai_analysis', sessionId: session?.id, aiAnalysisData: newAiAnalysis })
        console.log('AI analysis data saved to database')
      } catch (e) {
        console.error('Failed to save AI analysis data:', e)
      }

      // Only update selected items (manually selected patents) with AI data
      setSelected(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(key => {
          const dec = byPn[key]
          if (dec) {
            // Update existing selected patent with AI data
            next[key] = {
              ...next[key],
              aiSummary: dec.summary,
              noveltyThreat: dec.novelty_threat,
              tags: ['AI_REVIEWED'].concat(
                dec.novelty_threat === 'anticipates' ? ['AI_ANTICIPATES'] :
                dec.novelty_threat === 'obvious' ? ['AI_OBVIOUS'] :
                dec.novelty_threat === 'adjacent' ? ['AI_ADJACENT'] :
                ['AI_REMOTE']
              )
            }
          }
        })
        return next
      })
      setReviewInfo(`AI reviewed ${decisions.length} items${resp?.batches ? ` in ${resp.batches} batch(es)` : ''}.`)
    } catch (e) {
      setError('AI review failed. Please try again.')
    } finally {
      setReviewing(false)
    }
  }

  const saveManualPriorArt = async () => {
    if (!session?.id) {
      setError('Cannot save manual prior art: missing session ID.')
      return false
    }

    try {
      setSavingManualPriorArt(true)
      if (!manualPriorArtEnabled) {
        await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: null })
        setIsManualPriorArtSaved(false)
        return true
      }
      const manualPriorArtData = {
        manualPriorArtText,
        useOnlyManualPriorArt,
        useManualAndAISearch
      }
      await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: manualPriorArtData })
      setIsManualPriorArtSaved(true)
      console.log('Manual prior art saved successfully:', manualPriorArtData)
      setUseManualPriorArtToggle(true)
      return true
    } catch (e) {
      console.error('Failed to save manual prior art:', e)
      setError('Failed to save manual prior art.')
      return false
    } finally {
      setSavingManualPriorArt(false)
    }
  }

  const clearManualPriorArt = async () => {
    setManualPriorArtText('')
    setUseOnlyManualPriorArt(false)
    setUseManualAndAISearch(false)
    setIsManualPriorArtSaved(false)
    setUseManualPriorArtToggle(false)
    try {
      if (session?.id) {
        await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: null })
      }
      setStatusMessage({
        type: 'warning',
        text: 'Manual prior art removed. Drafting will not use manual prior art unless re-enabled.'
      })
    } catch (e) {
      console.error('Failed to clear manual prior art:', e)
      setError('Failed to remove manual prior art.')
    }
  }

  const saveSelections = async (options?: { skipManual?: boolean }) => {
    if (!runId || !session?.id) {
      setError('Cannot save selections: missing run or session ID.')
      return
    }

    // First, clear all existing user selections for this session/run
    // This ensures we only keep the current selections
    try {
      await onComplete({ action: 'clear_related_art_selections', sessionId: session?.id, runId })
    } catch (e) {
      console.warn('Failed to clear existing selections:', e)
      // Continue anyway - not a critical error
    }

    const selections = Object.entries(selected).map(([k, v]) => {
      const baseTags = Array.isArray(v.tags) ? v.tags : []
      const tags = baseTags.includes('USER_SELECTED') ? baseTags : [...baseTags, 'USER_SELECTED']
      return {
        patent_number: k,
        title: v.title,
        snippet: v.snippet,
        score: v.score,
        tags,
        publication_date: v.publication_date,
        inventors: v.inventors,
        assignees: v.assignees,
        user_notes: v.aiSummary || undefined
      }
    })

    // Save current selections if any exist
    if (selections.length > 0) {
      await onComplete({ action: 'related_art_select', sessionId: session?.id, runId, selections })
    }

    // Save manual prior art data unless explicitly skipped (auto-save path)
    if (!options?.skipManual) {
      await saveManualPriorArt()
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 3.5: Related Art Analysis</h2>
        <p className="text-gray-600">Discover and curate relevant patents using AI-powered search and analysis.</p>
        
        {/* Quick View Buttons - Show transformation from raw data to insights */}
        {(results.length > 0 || idea?.abstract) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-2">Quick View:</span>
            
            {/* Your Invention Abstract */}
          <button
              onClick={() => setShowAbstractPanel(!showAbstractPanel)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                showAbstractPanel 
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-700' 
                  : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              <span>📄</span> Your Invention
          </button>
            
            {/* AI Analysis Summary */}
            {hasAIReview && (
              <button
                onClick={() => setShowAIAnalysisPanel(!showAIAnalysisPanel)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  showAIAnalysisPanel 
                    ? 'bg-emerald-100 border-emerald-300 text-emerald-700' 
                    : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-600'
                }`}
              >
                <span>🧠</span> AI Analysis
                <span className="bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded text-[10px]">{analysisSummary.total}</span>
              </button>
            )}
            
            {/* Raw Search Results */}
            {results.length > 0 && (
              <button
                onClick={() => setShowRawResultsPanel(!showRawResultsPanel)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  showRawResultsPanel 
                    ? 'bg-gray-200 border-gray-400 text-gray-700' 
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-700'
                }`}
              >
                <span>🔍</span> Raw Search Results
                <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[10px]">{results.length}</span>
              </button>
            )}
        </div>
        )}

        {/* Expandable Panels */}
        {/* Your Invention Abstract Panel */}
        {showAbstractPanel && (
          <div className="mt-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-5 animate-fadeIn">
            <div className="flex items-start justify-between mb-3">
              <h4 className="font-semibold text-indigo-900 flex items-center gap-2">
                <span className="text-lg">📄</span> Your Invention
              </h4>
              <button onClick={() => setShowAbstractPanel(false)} className="text-indigo-400 hover:text-indigo-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Title</div>
                <div className="text-gray-900 font-medium">{idea?.title || 'Untitled'}</div>
              </div>
              {idea?.abstract && (
                <div>
                  <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Abstract</div>
                  <div className="text-gray-700 text-sm leading-relaxed">{idea.abstract}</div>
                </div>
              )}
              {idea?.problem && (
                <div>
                  <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Problem Solved</div>
                  <div className="text-gray-700 text-sm">{idea.problem}</div>
                </div>
              )}
              {searchQuery && (
                <div>
                  <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Optimized Search Query</div>
                  <div className="text-gray-600 text-xs font-mono bg-white/50 p-2 rounded border border-indigo-100">{searchQuery}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Analysis Summary Panel */}
        {showAIAnalysisPanel && hasAIReview && (
          <div className="mt-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-5 animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <h4 className="font-semibold text-emerald-900 flex items-center gap-2">
                <span className="text-lg">🧠</span> AI Relevance Analysis Summary
                <span className="text-xs font-normal text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                  {analysisSummary.total} patents analyzed
                </span>
              </h4>
              <button onClick={() => setShowAIAnalysisPanel(false)} className="text-emerald-400 hover:text-emerald-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Threat Level Distribution */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{analysisSummary.anticipates}</div>
                <div className="text-xs text-red-700 font-medium">🛑 Anticipates</div>
                <div className="text-[10px] text-red-500">High Risk</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">{analysisSummary.obvious}</div>
                <div className="text-xs text-amber-700 font-medium">⚠️ Obvious</div>
                <div className="text-[10px] text-amber-500">Medium Risk</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{analysisSummary.adjacent}</div>
                <div className="text-xs text-green-700 font-medium">✅ Adjacent</div>
                <div className="text-[10px] text-green-500">Low Risk</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-600">{analysisSummary.remote}</div>
                <div className="text-xs text-gray-700 font-medium">⚪ Remote</div>
                <div className="text-[10px] text-gray-500">Safe</div>
              </div>
            </div>

            {/* Detailed Analysis List */}
            <div className="bg-white/50 rounded-lg border border-emerald-100 max-h-[300px] overflow-y-auto">
              <div className="divide-y divide-emerald-100">
                {results.slice(0, 15).map((r, i) => {
                  const pn = getPatentKey(r, i)
                  const analysis = aiAnalysis[pn]
                  if (!analysis) return null
                  return (
                    <div key={pn} className="p-3 hover:bg-emerald-50/50">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 px-1.5 py-0.5 text-xs rounded ${
                          analysis.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-700' :
                          analysis.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-700' :
                          analysis.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {analysis.noveltyThreat}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900 truncate">{r.title}</div>
                          <div className="text-xs text-gray-500">{pn}</div>
                          {analysis.aiSummary && (
                            <div className="text-xs text-gray-600 mt-1 line-clamp-2">{analysis.aiSummary}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {results.length > 15 && (
                <div className="p-2 text-center text-xs text-emerald-600 bg-emerald-50">
                  + {results.length - 15} more patents analyzed
                </div>
              )}
            </div>

            <div className="mt-3 text-xs text-emerald-700 bg-emerald-100/50 p-2 rounded-lg">
              💡 <strong>What we did:</strong> Analyzed {analysisSummary.total} patents against your invention using AI to determine novelty threat levels, 
              extract relevant disclosures, and provide actionable summaries.
            </div>
          </div>
        )}

        {/* Raw Search Results Panel */}
        {showRawResultsPanel && results.length > 0 && (
          <div className="mt-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-300 p-5 animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                <span className="text-lg">🌍</span> Worldwide Relevant Prior Art Compilation
                <span className="text-xs font-normal text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">
                  {results.length} patents found
                </span>
              </h4>
              <button onClick={() => setShowRawResultsPanel(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="text-xs text-gray-500 mb-3">
              Worldwide patent search results compiled from global patent databases. Sorted by relevance to your invention.
            </div>

            {/* Expandable Prior Art Results */}
            <div className="bg-white rounded-lg border border-gray-200 max-h-[600px] overflow-y-auto">
              <div className="divide-y divide-gray-100">
                {results.map((r, i) => {
                  const pn = r.pn || (r as any).patent_number || (r as any).publication_number || 'N/A'
                  const score = r.score || (r as any).relevance || 0
                  const pubDate = (r as any).publication_date || ''
                  const patentAbstract = (r as any).abstract || (r as any).snippet || ''
                  const analysis = aiAnalysis[pn]
                  const isExpanded = expandedPatentDetails.has(`raw-${pn}`)

                  return (
                    <div key={i} className="border-b border-gray-100 last:border-b-0">
                      <div className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer" onClick={() => {
                        setExpandedPatentDetails(prev => {
                          const next = new Set(prev)
                          const key = `raw-${pn}`
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm text-gray-400 w-6">{i + 1}</span>
                          <span className="font-mono text-sm text-gray-600">{pn}</span>
                          <span className="text-sm text-gray-900 truncate flex-1">{r.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{pubDate ? String(pubDate).slice(0, 10) : '-'}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            score > 0.8 ? 'bg-indigo-100 text-indigo-700' :
                            score > 0.6 ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {(score * 100).toFixed(0)}%
                          </span>
                          <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expandable Detailed Analysis */}
                      {isExpanded && (
                        <div className="mx-3 mb-3 p-4 bg-gradient-to-r from-gray-50 to-slate-100 rounded-lg border border-gray-300 animate-fadeIn">
                          {/* Section Toggle Controls */}
                          <div className="mb-3 flex flex-wrap gap-2">
                            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mr-2">View:</div>

                            {/* Patent Metadata */}
                            <button
                              onClick={() => toggleSection(`raw-${pn}`, 'metadata')}
                              className={`px-2 py-1 text-xs rounded transition-colors ${
                                getSectionVisibility(`raw-${pn}`).metadata
                                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                  : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                              }`}
                            >
                              📋 Details
                            </button>

                            {patentAbstract && (
                              <button
                                onClick={() => toggleSection(`raw-${pn}`, 'abstract')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  getSectionVisibility(`raw-${pn}`).abstract
                                    ? 'bg-gray-200 text-gray-700 border border-gray-400'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                }`}
                              >
                                📄 Abstract
                              </button>
                            )}
                            {analysis?.aiSummary && (
                              <button
                                onClick={() => toggleSection(`raw-${pn}`, 'aiSummary')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  getSectionVisibility(`raw-${pn}`).aiSummary
                                    ? 'bg-gray-200 text-gray-700 border border-gray-400'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                }`}
                              >
                                🤖 AI Summary
                              </button>
                            )}
                            {analysis?.relevantParts && analysis.relevantParts.length > 0 && (
                              <button
                                onClick={() => toggleSection(`raw-${pn}`, 'relevantParts')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  getSectionVisibility(`raw-${pn}`).relevantParts
                                    ? 'bg-red-100 text-red-700 border border-red-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                }`}
                              >
                                ⚠️ Overlaps
                              </button>
                            )}
                            {analysis?.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                              <button
                                onClick={() => toggleSection(`raw-${pn}`, 'irrelevantParts')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  getSectionVisibility(`raw-${pn}`).irrelevantParts
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                }`}
                              >
                                ✅ Differences
                              </button>
                            )}
                            {analysis?.noveltyComparison && (
                              <button
                                onClick={() => toggleSection(`raw-${pn}`, 'noveltyComparison')}
                                className={`px-2 py-1 text-xs rounded transition-colors ${
                                  getSectionVisibility(`raw-${pn}`).noveltyComparison
                                    ? 'bg-purple-100 text-purple-700 border border-purple-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                }`}
                              >
                                ⚖️ Comparison
                              </button>
                            )}
                          </div>

                          {/* Patent Metadata */}
                          {getSectionVisibility(`raw-${pn}`).metadata && (
                            <div className="mb-3">
                              <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">📋 Patent Details</div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="font-medium text-gray-600">Patent Number:</span>
                                  <span className="ml-2 font-mono text-gray-900">{pn}</span>
                                </div>
                                {(r as any).filing_date && (
                                  <div>
                                    <span className="font-medium text-gray-600">Filing Date:</span>
                                    <span className="ml-2 text-gray-900">{String((r as any).filing_date).slice(0, 10)}</span>
                                  </div>
                                )}
                                {(r as any).publication_date && (
                                  <div>
                                    <span className="font-medium text-gray-600">Publication Date:</span>
                                    <span className="ml-2 text-gray-900">{String((r as any).publication_date).slice(0, 10)}</span>
                                  </div>
                                )}
                                {(r as any).inventors && (r as any).inventors.length > 0 && (
                                  <div className="md:col-span-2">
                                    <span className="font-medium text-gray-600">Inventors:</span>
                                    <span className="ml-2 text-gray-900">
                                      {Array.isArray((r as any).inventors)
                                        ? (r as any).inventors.join(', ')
                                        : (r as any).inventors
                                      }
                                    </span>
                                  </div>
                                )}
                                {(r as any).assignees && (r as any).assignees.length > 0 && (
                                  <div className="md:col-span-2">
                                    <span className="font-medium text-gray-600">Assignees:</span>
                                    <span className="ml-2 text-gray-900">
                                      {Array.isArray((r as any).assignees)
                                        ? (r as any).assignees.join(', ')
                                        : (r as any).assignees
                                      }
                                    </span>
                                  </div>
                                )}
                                {(r as any).country && (
                                  <div>
                                    <span className="font-medium text-gray-600">Country:</span>
                                    <span className="ml-2 text-gray-900">{(r as any).country}</span>
                                  </div>
                                )}
                                {(r as any).patent_type && (
                                  <div>
                                    <span className="font-medium text-gray-600">Type:</span>
                                    <span className="ml-2 text-gray-900">{(r as any).patent_type}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Patent Abstract */}
                          {patentAbstract && getSectionVisibility(`raw-${pn}`).abstract && (
                            <div className="mb-3">
                              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">📄 Patent Abstract</div>
                              <div className="text-sm text-gray-700 bg-white/50 p-2 rounded border border-gray-200">{patentAbstract}</div>
                            </div>
                          )}

                          {/* AI Summary */}
                          {analysis?.aiSummary && getSectionVisibility(`raw-${pn}`).aiSummary && (
                            <div className="mb-3">
                              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">🤖 AI-Generated Summary</div>
                              <div className="text-sm text-gray-700">{analysis.aiSummary}</div>
                            </div>
                          )}

                          {/* Relevant Parts - Overlaps */}
                          {analysis?.relevantParts && analysis.relevantParts.length > 0 && getSectionVisibility(`raw-${pn}`).relevantParts && (
                            <div className="mb-3">
                              <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">⚠️ Potential Overlaps with Your Invention</div>
                              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {analysis.relevantParts.map((part, idx) => (
                                  <li key={idx} className="text-red-800">{part}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Irrelevant Parts - Differences */}
                          {analysis?.irrelevantParts && analysis.irrelevantParts.length > 0 && getSectionVisibility(`raw-${pn}`).irrelevantParts && (
                            <div className="mb-3">
                              <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">✅ Key Differences from Your Invention</div>
                              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                {analysis.irrelevantParts.map((part, idx) => (
                                  <li key={idx} className="text-green-700">{part}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Novelty Comparison */}
                          {analysis?.noveltyComparison && getSectionVisibility(`raw-${pn}`).noveltyComparison && (
                            <div className="mb-0">
                              <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">⚖️ Novelty Comparison</div>
                              <div className="text-sm text-gray-700 bg-purple-50 p-2 rounded border border-purple-100">{analysis.noveltyComparison}</div>
                            </div>
                          )}

                          {/* Threat Level */}
                          {analysis?.noveltyThreat && (
                            <div className="mt-3 pt-3 border-t border-gray-300">
                              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                                analysis.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-800' :
                                analysis.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-800' :
                                analysis.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                Novelty Threat Level: {
                                  analysis.noveltyThreat === 'anticipates' ? '🛑 High Risk (Anticipates)' :
                                  analysis.noveltyThreat === 'obvious' ? '⚠️ Medium Risk (Obvious)' :
                                  analysis.noveltyThreat === 'adjacent' ? '✅ Low Risk (Adjacent)' :
                                  '⚪ Safe (Remote)'
                                }
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-3 text-xs text-gray-600 bg-gray-100 p-2 rounded-lg">
              🌍 <strong>Global Prior Art Compilation:</strong> Worldwide patent search results from global patent databases.
              Expand any patent to view detailed analysis and control what information you see.
            </div>
          </div>
        )}

        {/* Value Proposition Banner - shown when AI review is complete */}
        {hasAIReview && !showAIAnalysisPanel && !showRawResultsPanel && (
          <div className="mt-4 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl p-4 text-white">
            <div className="flex items-center gap-4">
              <div className="text-3xl">✨</div>
              <div className="flex-1">
                <div className="font-semibold">AI-Powered Analysis Complete</div>
                <div className="text-sm text-white/80">
                  We transformed {results.length} raw patents into {analysisSummary.anticipates + analysisSummary.obvious} actionable threats and {analysisSummary.adjacent + analysisSummary.remote} safe references.
                </div>
              </div>
              <button
                onClick={() => setShowAIAnalysisPanel(true)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
              >
                View Details
              </button>
            </div>
          </div>
        )}

        {isManualPriorArtSaved && (
          <div className="mt-3 inline-flex items-center px-3 py-1 rounded-full text-sm bg-amber-100 text-amber-800 border border-amber-300">
            📝 Manual prior art entered
            {useOnlyManualPriorArt && <span className="ml-2">(Using only manual prior art)</span>}
            {useManualAndAISearch && <span className="ml-2">(Combining with AI search results)</span>}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">{error}</div>
      )}

      <div className="space-y-8">
        {/* STEP 1: Global Patent Search */}
        <div className={`rounded-xl border transition-all duration-300 ${results.length > 0 ? 'bg-gray-50 border-gray-200' : 'bg-white border-indigo-100 shadow-sm'}`}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">1</div>
              Global Patent Search
            </h3>
            {results.length > 0 && (
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckIcon className="w-3 h-3" /> Completed
              </span>
            )}
          </div>
          
          <div className="p-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="text-sm text-gray-700 space-y-3">
                <div>
                  <span className="font-medium text-gray-500 block text-xs mb-1">Invention Title</span>
                  <div className="font-medium">{idea?.title || 'Untitled'}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-500 block text-xs mb-1">Search Query (Optimized)</span>
                  <div className="font-mono text-xs text-gray-600 bg-gray-100 p-2 rounded border border-gray-200 break-all">
                    {searchQuery || 'No search query available'}
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                    <input
                      type="checkbox"
                      checked={showCustomQuery}
                      onChange={(e) => setShowCustomQuery(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Use custom search query
                  </label>

                  {showCustomQuery && (
                    <div className="space-y-2 animate-fadeIn">
                      <textarea
                        className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        rows={3}
                        value={customQuery}
                        onChange={(e) => setCustomQuery(e.target.value)}
                        placeholder="Enter custom Boolean query..."
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={runSearch}
                    disabled={busy}
                    className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm
                      ${searching 
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 cursor-wait' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {searching ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-indigo-700" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Searching prior-art database...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {results.length > 0 ? 'Run New Search' : 'Search Related Patents'}
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    className="text-sm text-gray-600 hover:text-indigo-600 underline decoration-dotted"
                  >
                    {showAdvancedSettings ? 'Hide Settings' : 'Advanced Settings'}
                  </button>
                </div>

                {showAdvancedSettings && (
                  <div className="p-3 bg-gray-50 rounded border border-gray-200 text-sm space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="text-gray-600">Limit results:</label>
                      <input
                        type="number"
                        min={10}
                        max={50}
                        value={limit}
                        onChange={(e)=>setLimit(Math.max(10, Math.min(50, parseInt(e.target.value||'25',10))))}
                        className="w-20 border rounded px-2 py-1"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-gray-600">After Date:</label>
                      <input
                        type="date"
                        value={afterDate}
                        onChange={(e)=>setAfterDate(e.target.value)}
                        className="border rounded px-2 py-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Progress Indicator */}
            {searching && searchProgress && (
              <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-lg p-4 animate-fadeIn">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
                  <span className="text-indigo-800 font-medium text-sm">{searchProgress}</span>
                </div>
                <div className="mt-2 w-full bg-indigo-200 rounded-full h-1.5">
                  <div className="bg-indigo-600 h-1.5 rounded-full animate-pulse" style={{width: '100%'}}></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* STEP 2: AI Relevance Review */}
        {results.length > 0 && (
          <div className={`rounded-xl border transition-all duration-300 ${hasAIReview ? 'bg-gray-50 border-gray-200' : 'bg-white border-emerald-100 shadow-sm ring-1 ring-emerald-50'}`}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${hasAIReview ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-800 text-white'}`}>2</div>
                AI Relevance Review
              </h3>
              {hasAIReview && (
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full flex items-center gap-1">
                  <CheckIcon className="w-3 h-3" /> Analysis Complete
                </span>
              )}
            </div>

            <div className="p-6">
              {!hasAIReview ? (
                <div className="text-center">
                  <div className="mb-4 text-gray-600">
                    <p className="mb-2">We found {results.length} potential candidates.</p>
                    <p className="text-sm">Now, let our AI analyze the full text of these patents to determine relevance and novelty threats.</p>
                  </div>
                  <button
                    onClick={runAIReview}
                    disabled={reviewing}
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-60"
                  >
                    {reviewing ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Running AI Analysis...
                      </>
                    ) : (
                      <>
                        <span className="mr-2">🧠</span> Run AI Relevance Review
                      </>
                    )}
                  </button>
                  {reviewing && (
                    <div className="mt-4 text-sm text-gray-500 animate-pulse">
                      {reviewInfo || 'Processing patents batch by batch...'}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-emerald-800 font-medium mb-1">AI Analysis Complete</div>
                    <div className="text-sm text-emerald-600">
                      Analyzed {results.length} patents. {Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'anticipates' || a.noveltyThreat === 'obvious').length} potential threats identified.
                    </div>
                  </div>
                  <button
                    onClick={runAIReview}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium underline decoration-dotted"
                  >
                    Re-run Analysis
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Workflow Selection - Two Tabs */}
        {results.length > 0 && hasAIReview && (
          <div className="rounded-xl border transition-all duration-300 bg-white border-indigo-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">3</div>
                Configure Prior Art Usage
              </h3>
              <p className="text-sm text-gray-500 mt-1">Select how to use the analyzed patents for drafting and claim refinement</p>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-gray-200">
              <nav className="flex" aria-label="Workflow tabs">
                <button
                  onClick={() => setActiveWorkflowTab('prior-art')}
                  className={`flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm transition-colors ${
                    activeWorkflowTab === 'prior-art'
                      ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-lg">📝</span>
                    <span>Step 1: Background References</span>
                    {(Object.keys(priorArtSelected).length > 0 || priorArtManualText.trim()) && (
                      <span className="ml-1 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs">
                        {priorArtMode === 'manual' ? 'Manual' : priorArtMode === 'hybrid' ? `${Object.keys(priorArtSelected).length} + Manual` : Object.keys(priorArtSelected).length}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">References cited in your patent</p>
                </button>
                <button
                  onClick={() => setActiveWorkflowTab('claim-refinement')}
                  className={`flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm transition-colors ${
                    activeWorkflowTab === 'claim-refinement'
                      ? 'border-amber-500 text-amber-600 bg-amber-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-lg">⚖️</span>
                    <span>Step 2: Claim Novelty Check</span>
                    {(Object.keys(claimRefSelected).length > 0 || claimRefManualText.trim()) && (
                      <span className="ml-1 bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">
                        {claimRefMode === 'manual' ? 'Manual' : claimRefMode === 'hybrid' ? `${Object.keys(claimRefSelected).length} + Manual` : Object.keys(claimRefSelected).length}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Claims compared against these</p>
                </button>
              </nav>
            </div>

            {/* Tab Content */}
            <div className="p-6">
              {/* ===== TAB A: Prior Art for Drafting ===== */}
              {activeWorkflowTab === 'prior-art' && (
                <div className="space-y-6">
                  {/* Purpose explanation */}
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                    <h4 className="font-semibold text-indigo-900 mb-1">📝 Purpose: Prior Art References for Patent Draft</h4>
                    <p className="text-sm text-indigo-700">
                      These patents and/or your manual notes will be cited in the Background section and throughout your patent application to provide context for your invention.
                    </p>
                  </div>

                  {/* Mode Selection */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">How would you like to provide prior art references?</label>
                    <div className="grid grid-cols-3 gap-3">
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${priorArtMode === 'ai' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
                        <input type="radio" name="priorArtMode" value="ai" checked={priorArtMode === 'ai'} onChange={() => setPriorArtMode('ai')} className="sr-only" />
                        <span className="text-2xl mb-2">🤖</span>
                        <span className="font-medium text-sm">AI-Selected Only</span>
                        <span className="text-xs text-gray-500 text-center mt-1">Use patents from AI review</span>
                        {priorArtMode === 'ai' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-indigo-600" />}
                      </label>
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${priorArtMode === 'manual' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
                        <input type="radio" name="priorArtMode" value="manual" checked={priorArtMode === 'manual'} onChange={() => setPriorArtMode('manual')} className="sr-only" />
                        <span className="text-2xl mb-2">✍️</span>
                        <span className="font-medium text-sm">Manual Text Only</span>
                        <span className="text-xs text-gray-500 text-center mt-1">Only use your own text</span>
                        {priorArtMode === 'manual' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-indigo-600" />}
                      </label>
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${priorArtMode === 'hybrid' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
                        <input type="radio" name="priorArtMode" value="hybrid" checked={priorArtMode === 'hybrid'} onChange={() => setPriorArtMode('hybrid')} className="sr-only" />
                        <span className="text-2xl mb-2">🔀</span>
                        <span className="font-medium text-sm">Hybrid</span>
                        <span className="text-xs text-gray-500 text-center mt-1">AI patents + your text</span>
                        {priorArtMode === 'hybrid' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-indigo-600" />}
                      </label>
                    </div>
                  </div>

                  {/* Manual Text Input (shown for manual and hybrid modes) */}
                  {(priorArtMode === 'manual' || priorArtMode === 'hybrid') && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Your Prior Art Notes</label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[120px]"
                        placeholder="Paste patent numbers, publication references, or describe prior art you want cited in your draft..."
                        value={priorArtManualText}
                        onChange={(e) => setPriorArtManualText(e.target.value)}
                      />
                      <p className="text-xs text-gray-500">Include patent numbers, titles, and brief descriptions of relevant disclosures.</p>
                    </div>
                  )}

                  {/* AI Patent Selection (shown for ai and hybrid modes) */}
                  {(priorArtMode === 'ai' || priorArtMode === 'hybrid') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">Select AI-Reviewed Patents</label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              // Auto-select adjacent/remote patents (good for background, not direct threats)
                              const autoSelected: Record<string, any> = {}
                              results.forEach((r) => {
                                const pn = getPatentKey(r)
                                const threat = aiAnalysis[pn]?.noveltyThreat
                                if (threat === 'adjacent' || threat === 'remote') {
                                  autoSelected[pn] = { ...r, noveltyThreat: threat }
                                }
                              })
                              setPriorArtSelected(autoSelected)
                            }}
                            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                          >
                            Auto-select (Adjacent/Remote)
                          </button>
                          <button
                            onClick={() => setPriorArtSelected({})}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                      
                      {/* Threat Filter */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: 'anticipates', label: 'Anticipates', color: 'red', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'anticipates').length },
                          { key: 'obvious', label: 'Obvious', color: 'amber', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'obvious').length },
                          { key: 'adjacent', label: 'Adjacent', color: 'green', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'adjacent').length },
                          { key: 'remote', label: 'Remote', color: 'gray', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'remote').length },
                        ].map(({ key, label, color, count }) => (
                          <button
                            key={key}
                            onClick={() => setPriorArtThreatFilter(prev => prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key])}
                            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                              priorArtThreatFilter.includes(key)
                                ? `bg-${color}-100 border-${color}-300 text-${color}-700`
                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            {label} ({count})
                          </button>
                        ))}
                      </div>

                      {/* Patent List - Doubled height to show more patents for comparison */}
                      <div className="border border-gray-200 rounded-lg max-h-[1200px] overflow-y-auto">
                        {results
                          .filter(r => {
                            if (priorArtThreatFilter.length === 0) return true
                            const pn = getPatentKey(r)
                            return priorArtThreatFilter.includes(aiAnalysis[pn]?.noveltyThreat || '')
                          })
                          .map((r, i) => {
                            const pn = getPatentKey(r, i)
                            const analysis = aiAnalysis[pn]
                            const isSelected = !!priorArtSelected[pn]
                            const isExpanded = expandedPatentDetails.has(`priorArt-${pn}`)
                            const patentAbstract = (r as any).abstract || (r as any).snippet || ''
                            return (
                              <div key={pn} className={`border-b border-gray-100 last:border-b-0 ${isSelected ? 'bg-indigo-50' : ''}`}>
                                <label className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${!isSelected && 'hover:bg-gray-50'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setPriorArtSelected(prev => {
                                        if (prev[pn]) {
                                          const { [pn]: _, ...rest } = prev
                                          return rest
                                        }
                                        return { ...prev, [pn]: { ...r, noveltyThreat: analysis?.noveltyThreat } }
                                      })
                                    }}
                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm text-gray-900">{r.title}</span>
                                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                                        analysis?.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-700' :
                                        analysis?.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-700' :
                                        analysis?.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-700' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>
                                        {analysis?.noveltyThreat || 'unknown'}
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                      <span>{pn}</span>
                                      {analysis && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setExpandedPatentDetails(prev => {
                                              const next = new Set(prev)
                                              const key = `priorArt-${pn}`
                                              if (next.has(key)) next.delete(key)
                                              else next.add(key)
                                              return next
                                            })
                                          }}
                                          className="text-indigo-600 hover:text-indigo-700 font-medium underline"
                                        >
                                          {isExpanded ? 'Hide Details' : 'View AI Analysis'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </label>
                                
                                {/* Expandable Detailed Analysis */}
                                {isExpanded && analysis && (
                                  <div className="mx-3 mb-3 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200 animate-fadeIn">
                                    {/* Section Toggle Controls */}
                                    <div className="mb-3 flex flex-wrap gap-2">
                                      <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mr-2">Show:</div>

                                      {/* Patent Metadata */}
                                      <button
                                        onClick={() => toggleSection(`priorArt-${pn}`, 'metadata')}
                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                          getSectionVisibility(`priorArt-${pn}`).metadata
                                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                            : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                        }`}
                                      >
                                        📋 Details
                                      </button>

                                      {patentAbstract && (
                                        <button
                                          onClick={() => toggleSection(`priorArt-${pn}`, 'abstract')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`priorArt-${pn}`).abstract
                                              ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          📄 Abstract
                                        </button>
                                      )}
                                      {analysis.aiSummary && (
                                        <button
                                          onClick={() => toggleSection(`priorArt-${pn}`, 'aiSummary')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`priorArt-${pn}`).aiSummary
                                              ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          🤖 Summary
                                        </button>
                                      )}
                                      {analysis.relevantParts && analysis.relevantParts.length > 0 && (
                                        <button
                                          onClick={() => toggleSection(`priorArt-${pn}`, 'relevantParts')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`priorArt-${pn}`).relevantParts
                                              ? 'bg-green-100 text-green-700 border border-green-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ✅ Matches
                                        </button>
                                      )}
                                      {analysis.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                        <button
                                          onClick={() => toggleSection(`priorArt-${pn}`, 'irrelevantParts')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`priorArt-${pn}`).irrelevantParts
                                              ? 'bg-gray-100 text-gray-700 border border-gray-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ❌ Non-matches
                                        </button>
                                      )}
                                      {analysis.noveltyComparison && (
                                        <button
                                          onClick={() => toggleSection(`priorArt-${pn}`, 'noveltyComparison')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`priorArt-${pn}`).noveltyComparison
                                              ? 'bg-purple-100 text-purple-700 border border-purple-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ⚖️ Comparison
                                        </button>
                                      )}
                                    </div>

                                    {/* Patent Metadata */}
                                    {getSectionVisibility(`priorArt-${pn}`).metadata && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">📋 Patent Details</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <span className="font-medium text-gray-600">Patent Number:</span>
                                            <span className="ml-2 font-mono text-gray-900">{pn}</span>
                                          </div>
                                          {(r as any).filing_date && (
                                            <div>
                                              <span className="font-medium text-gray-600">Filing Date:</span>
                                              <span className="ml-2 text-gray-900">{String((r as any).filing_date).slice(0, 10)}</span>
                                            </div>
                                          )}
                                          {(r as any).publication_date && (
                                            <div>
                                              <span className="font-medium text-gray-600">Publication Date:</span>
                                              <span className="ml-2 text-gray-900">{String((r as any).publication_date).slice(0, 10)}</span>
                                            </div>
                                          )}
                                          {(r as any).inventors && (r as any).inventors.length > 0 && (
                                            <div className="md:col-span-2">
                                              <span className="font-medium text-gray-600">Inventors:</span>
                                              <span className="ml-2 text-gray-900">
                                                {Array.isArray((r as any).inventors)
                                                  ? (r as any).inventors.join(', ')
                                                  : (r as any).inventors
                                                }
                                              </span>
                                            </div>
                                          )}
                                          {(r as any).assignees && (r as any).assignees.length > 0 && (
                                            <div className="md:col-span-2">
                                              <span className="font-medium text-gray-600">Assignees:</span>
                                              <span className="ml-2 text-gray-900">
                                                {Array.isArray((r as any).assignees)
                                                  ? (r as any).assignees.join(', ')
                                                  : (r as any).assignees
                                                }
                                              </span>
                                            </div>
                                          )}
                                          {(r as any).country && (
                                            <div>
                                              <span className="font-medium text-gray-600">Country:</span>
                                              <span className="ml-2 text-gray-900">{(r as any).country}</span>
                                            </div>
                                          )}
                                          {(r as any).patent_type && (
                                            <div>
                                              <span className="font-medium text-gray-600">Type:</span>
                                              <span className="ml-2 text-gray-900">{(r as any).patent_type}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {/* Patent Abstract */}
                                    {patentAbstract && getSectionVisibility(`priorArt-${pn}`).abstract && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">📄 Patent Abstract</div>
                                        <div className="text-sm text-gray-700 bg-white/50 p-2 rounded border border-indigo-100">{patentAbstract}</div>
                                      </div>
                                    )}

                                    {/* AI Summary - What this patent does */}
                                    {analysis.aiSummary && getSectionVisibility(`priorArt-${pn}`).aiSummary && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">🤖 What This Patent Does</div>
                                        <div className="text-sm text-gray-700">{analysis.aiSummary}</div>
                                      </div>
                                    )}

                                    {/* Relevant Parts - What matches */}
                                    {analysis.relevantParts && analysis.relevantParts.length > 0 && getSectionVisibility(`priorArt-${pn}`).relevantParts && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">✅ What Matches (Relevant Parts)</div>
                                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                          {analysis.relevantParts.map((part, idx) => (
                                            <li key={idx} className="text-green-800">{part}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Irrelevant Parts - What doesn't match */}
                                    {analysis.irrelevantParts && analysis.irrelevantParts.length > 0 && getSectionVisibility(`priorArt-${pn}`).irrelevantParts && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">❌ What Doesn't Match</div>
                                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                          {analysis.irrelevantParts.map((part, idx) => (
                                            <li key={idx}>{part}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Novelty Comparison */}
                                    {analysis.noveltyComparison && getSectionVisibility(`priorArt-${pn}`).noveltyComparison && (
                                      <div className="mb-0">
                                        <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">⚖️ Novelty Comparison</div>
                                        <div className="text-sm text-gray-700 bg-purple-50 p-2 rounded border border-purple-100">{analysis.noveltyComparison}</div>
                                      </div>
                                    )}

                                    {/* Threat Level Explanation */}
                                    <div className="mt-3 pt-3 border-t border-indigo-200">
                                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                                        analysis.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-800' :
                                        analysis.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-800' :
                                        analysis.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-800' :
                                        'bg-gray-100 text-gray-700'
                                      }`}>
                                        {analysis.noveltyThreat === 'anticipates' && '🛑 HIGH RISK: This patent may anticipate your invention'}
                                        {analysis.noveltyThreat === 'obvious' && '⚠️ MEDIUM RISK: May raise obviousness concerns'}
                                        {analysis.noveltyThreat === 'adjacent' && '✅ LOW RISK: Related but differentiable'}
                                        {analysis.noveltyThreat === 'remote' && '⚪ SAFE: Remotely related, not a threat'}
                                        {!analysis.noveltyThreat && '❓ Threat level not determined'}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="text-sm font-medium text-gray-700 mb-2">Summary for Patent Drafting:</div>
                    <div className="text-sm text-gray-600">
                      {priorArtMode === 'ai' && `${Object.keys(priorArtSelected).length} AI-reviewed patents selected`}
                      {priorArtMode === 'manual' && (priorArtManualText.trim() ? 'Manual prior art text provided' : 'No manual text entered yet')}
                      {priorArtMode === 'hybrid' && `${Object.keys(priorArtSelected).length} patents + ${priorArtManualText.trim() ? 'manual text' : 'no manual text'}`}
                    </div>
                  </div>
                </div>
              )}

              {/* ===== TAB B: Patents for Claim Refinement ===== */}
              {activeWorkflowTab === 'claim-refinement' && (
                <div className="space-y-6">
                  {/* Skip notice */}
                  {skipClaimRefinement && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-start gap-3">
                      <span className="text-2xl">⏭️</span>
                      <div>
                        <h4 className="font-semibold text-purple-900 mb-1">Claim Refinement Will Be Skipped</h4>
                        <p className="text-sm text-purple-700">
                          You've chosen to skip claim refinement. The configuration below will not be used. 
                          Uncheck "Skip Claim Refinement" in the footer if you change your mind.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Purpose explanation */}
                  <div className={`bg-amber-50 border border-amber-100 rounded-lg p-4 ${skipClaimRefinement ? 'opacity-50' : ''}`}>
                    <h4 className="font-semibold text-amber-900 mb-1">⚖️ Purpose: Differentiate Your Claims from Prior Art</h4>
                    <p className="text-sm text-amber-700">
                      Select patents that your claims should be compared against. The AI will analyze your claims and suggest refinements to ensure novelty and non-obviousness over these references.
                    </p>
                  </div>

                  {/* Mode Selection */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">How would you like to provide comparison references?</label>
                    <div className="grid grid-cols-3 gap-3">
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${claimRefMode === 'ai' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}>
                        <input type="radio" name="claimRefMode" value="ai" checked={claimRefMode === 'ai'} onChange={() => setClaimRefMode('ai')} className="sr-only" />
                        <span className="text-2xl mb-2">🤖</span>
                        <span className="font-medium text-sm">AI-Selected Only</span>
                        <span className="text-xs text-gray-500 text-center mt-1">High-risk patents from AI</span>
                        {claimRefMode === 'ai' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-amber-600" />}
                      </label>
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${claimRefMode === 'manual' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}>
                        <input type="radio" name="claimRefMode" value="manual" checked={claimRefMode === 'manual'} onChange={() => setClaimRefMode('manual')} className="sr-only" />
                        <span className="text-2xl mb-2">✍️</span>
                        <span className="font-medium text-sm">Manual Text Only</span>
                        <span className="text-xs text-gray-500 text-center mt-1">Your own prior art notes</span>
                        {claimRefMode === 'manual' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-amber-600" />}
                      </label>
                      <label className={`relative flex flex-col items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${claimRefMode === 'hybrid' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}>
                        <input type="radio" name="claimRefMode" value="hybrid" checked={claimRefMode === 'hybrid'} onChange={() => setClaimRefMode('hybrid')} className="sr-only" />
                        <span className="text-2xl mb-2">🔀</span>
                        <span className="font-medium text-sm">Hybrid</span>
                        <span className="text-xs text-gray-500 text-center mt-1">AI patents + your notes</span>
                        {claimRefMode === 'hybrid' && <CheckIcon className="absolute top-2 right-2 w-5 h-5 text-amber-600" />}
                      </label>
                    </div>
                  </div>

                  {/* Manual Text Input (shown for manual and hybrid modes) */}
                  {(claimRefMode === 'manual' || claimRefMode === 'hybrid') && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Your Prior Art for Claim Comparison</label>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[120px]"
                        placeholder="Describe prior art that you want your claims to be differentiated from. Include patent numbers and key technical disclosures..."
                        value={claimRefManualText}
                        onChange={(e) => setClaimRefManualText(e.target.value)}
                      />
                      <p className="text-xs text-gray-500">Be specific about what aspects of the prior art might overlap with your claims.</p>
                    </div>
                  )}

                  {/* AI Patent Selection (shown for ai and hybrid modes) */}
                  {(claimRefMode === 'ai' || claimRefMode === 'hybrid') && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">Select Patents to Compare Against</label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              // Auto-select high-risk patents (anticipates/obvious)
                              const autoSelected: Record<string, any> = {}
                              results.forEach((r) => {
                                const pn = getPatentKey(r)
                                const threat = aiAnalysis[pn]?.noveltyThreat
                                if (threat === 'anticipates' || threat === 'obvious') {
                                  autoSelected[pn] = { ...r, noveltyThreat: threat }
                                }
                              })
                              setClaimRefSelected(autoSelected)
                            }}
                            className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                          >
                            Auto-select High-Risk
                          </button>
                          <button
                            onClick={() => setClaimRefSelected({})}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                      
                      {/* Threat Filter */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: 'anticipates', label: '🛑 Anticipates', color: 'red', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'anticipates').length },
                          { key: 'obvious', label: '⚠️ Obvious', color: 'amber', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'obvious').length },
                          { key: 'adjacent', label: '✅ Adjacent', color: 'green', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'adjacent').length },
                          { key: 'remote', label: '⚪ Remote', color: 'gray', count: Object.values(aiAnalysis).filter(a => a.noveltyThreat === 'remote').length },
                        ].map(({ key, label, color, count }) => (
                          <button
                            key={key}
                            onClick={() => setClaimRefThreatFilter(prev => prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key])}
                            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                              claimRefThreatFilter.includes(key)
                                ? `bg-${color}-100 border-${color}-300 text-${color}-700`
                                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            {label} ({count})
                          </button>
                        ))}
                      </div>

                      {/* Patent List - Doubled height to show more patents for comparison */}
                      <div className="border border-gray-200 rounded-lg max-h-[1200px] overflow-y-auto">
                        {results
                          .filter(r => {
                            if (claimRefThreatFilter.length === 0) return true
                            const pn = getPatentKey(r)
                            return claimRefThreatFilter.includes(aiAnalysis[pn]?.noveltyThreat || '')
                          })
                          .map((r, i) => {
                            const pn = getPatentKey(r, i)
                            const analysis = aiAnalysis[pn]
                            const isSelected = !!claimRefSelected[pn]
                            const isExpanded = expandedPatentDetails.has(`claimRef-${pn}`)
                            const patentAbstract = (r as any).abstract || (r as any).snippet || ''
                            return (
                              <div key={pn} className={`border-b border-gray-100 last:border-b-0 ${isSelected ? 'bg-amber-50' : ''}`}>
                                <label className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${!isSelected && 'hover:bg-gray-50'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setClaimRefSelected(prev => {
                                        if (prev[pn]) {
                                          const { [pn]: _, ...rest } = prev
                                          return rest
                                        }
                                        return { ...prev, [pn]: { ...r, noveltyThreat: analysis?.noveltyThreat, aiSummary: analysis?.aiSummary } }
                                      })
                                    }}
                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-600"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-sm text-gray-900">{r.title}</span>
                                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                                        analysis?.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-700' :
                                        analysis?.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-700' :
                                        analysis?.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-700' :
                                        'bg-gray-100 text-gray-600'
                                      }`}>
                                        {analysis?.noveltyThreat || 'unknown'}
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                      <span>{pn}</span>
                                      {analysis && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setExpandedPatentDetails(prev => {
                                              const next = new Set(prev)
                                              const key = `claimRef-${pn}`
                                              if (next.has(key)) next.delete(key)
                                              else next.add(key)
                                              return next
                                            })
                                          }}
                                          className="text-amber-600 hover:text-amber-700 font-medium underline"
                                        >
                                          {isExpanded ? 'Hide Details' : 'View AI Analysis'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </label>
                                
                                {/* Expandable Detailed Analysis */}
                                {isExpanded && analysis && (
                                  <div className="mx-3 mb-3 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border border-amber-200 animate-fadeIn">
                                    {/* Section Toggle Controls */}
                                    <div className="mb-3 flex flex-wrap gap-2">
                                      <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mr-2">Show:</div>

                                      {/* Patent Metadata */}
                                      <button
                                        onClick={() => toggleSection(`claimRef-${pn}`, 'metadata')}
                                        className={`px-2 py-1 text-xs rounded transition-colors ${
                                          getSectionVisibility(`claimRef-${pn}`).metadata
                                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                            : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                        }`}
                                      >
                                        📋 Details
                                      </button>

                                      {patentAbstract && (
                                        <button
                                          onClick={() => toggleSection(`claimRef-${pn}`, 'abstract')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`claimRef-${pn}`).abstract
                                              ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          📄 Abstract
                                        </button>
                                      )}
                                      {analysis.aiSummary && (
                                        <button
                                          onClick={() => toggleSection(`claimRef-${pn}`, 'aiSummary')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`claimRef-${pn}`).aiSummary
                                              ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          🤖 Summary
                                        </button>
                                      )}
                                      {analysis.relevantParts && analysis.relevantParts.length > 0 && (
                                        <button
                                          onClick={() => toggleSection(`claimRef-${pn}`, 'relevantParts')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`claimRef-${pn}`).relevantParts
                                              ? 'bg-red-100 text-red-700 border border-red-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ⚠️ Overlaps
                                        </button>
                                      )}
                                      {analysis.irrelevantParts && analysis.irrelevantParts.length > 0 && (
                                        <button
                                          onClick={() => toggleSection(`claimRef-${pn}`, 'irrelevantParts')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`claimRef-${pn}`).irrelevantParts
                                              ? 'bg-green-100 text-green-700 border border-green-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ✅ Differences
                                        </button>
                                      )}
                                      {analysis.noveltyComparison && (
                                        <button
                                          onClick={() => toggleSection(`claimRef-${pn}`, 'noveltyComparison')}
                                          className={`px-2 py-1 text-xs rounded transition-colors ${
                                            getSectionVisibility(`claimRef-${pn}`).noveltyComparison
                                              ? 'bg-purple-100 text-purple-700 border border-purple-300'
                                              : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60'
                                          }`}
                                        >
                                          ⚖️ Comparison
                                        </button>
                                      )}
                                    </div>

                                    {/* Patent Metadata */}
                                    {getSectionVisibility(`claimRef-${pn}`).metadata && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">📋 Patent Details</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <span className="font-medium text-gray-600">Patent Number:</span>
                                            <span className="ml-2 font-mono text-gray-900">{pn}</span>
                                          </div>
                                          {(r as any).filing_date && (
                                            <div>
                                              <span className="font-medium text-gray-600">Filing Date:</span>
                                              <span className="ml-2 text-gray-900">{String((r as any).filing_date).slice(0, 10)}</span>
                                            </div>
                                          )}
                                          {(r as any).publication_date && (
                                            <div>
                                              <span className="font-medium text-gray-600">Publication Date:</span>
                                              <span className="ml-2 text-gray-900">{String((r as any).publication_date).slice(0, 10)}</span>
                                            </div>
                                          )}
                                          {(r as any).inventors && (r as any).inventors.length > 0 && (
                                            <div className="md:col-span-2">
                                              <span className="font-medium text-gray-600">Inventors:</span>
                                              <span className="ml-2 text-gray-900">
                                                {Array.isArray((r as any).inventors)
                                                  ? (r as any).inventors.join(', ')
                                                  : (r as any).inventors
                                                }
                                              </span>
                                            </div>
                                          )}
                                          {(r as any).assignees && (r as any).assignees.length > 0 && (
                                            <div className="md:col-span-2">
                                              <span className="font-medium text-gray-600">Assignees:</span>
                                              <span className="ml-2 text-gray-900">
                                                {Array.isArray((r as any).assignees)
                                                  ? (r as any).assignees.join(', ')
                                                  : (r as any).assignees
                                                }
                                              </span>
                                            </div>
                                          )}
                                          {(r as any).country && (
                                            <div>
                                              <span className="font-medium text-gray-600">Country:</span>
                                              <span className="ml-2 text-gray-900">{(r as any).country}</span>
                                            </div>
                                          )}
                                          {(r as any).patent_type && (
                                            <div>
                                              <span className="font-medium text-gray-600">Type:</span>
                                              <span className="ml-2 text-gray-900">{(r as any).patent_type}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {/* Patent Abstract */}
                                    {patentAbstract && getSectionVisibility(`claimRef-${pn}`).abstract && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">📄 Patent Abstract</div>
                                        <div className="text-sm text-gray-700 bg-white/50 p-2 rounded border border-amber-100">{patentAbstract}</div>
                                      </div>
                                    )}

                                    {/* AI Summary - What this patent does */}
                                    {analysis.aiSummary && getSectionVisibility(`claimRef-${pn}`).aiSummary && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">🤖 What This Patent Does</div>
                                        <div className="text-sm text-gray-700">{analysis.aiSummary}</div>
                                      </div>
                                    )}

                                    {/* Relevant Parts - What overlaps */}
                                    {analysis.relevantParts && analysis.relevantParts.length > 0 && getSectionVisibility(`claimRef-${pn}`).relevantParts && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">⚠️ What Overlaps With Your Claims</div>
                                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                          {analysis.relevantParts.map((part, idx) => (
                                            <li key={idx} className="text-red-800">{part}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Irrelevant Parts - What doesn't match */}
                                    {analysis.irrelevantParts && analysis.irrelevantParts.length > 0 && getSectionVisibility(`claimRef-${pn}`).irrelevantParts && (
                                      <div className="mb-3">
                                        <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">✅ What Doesn't Overlap (Differentiation Opportunities)</div>
                                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                          {analysis.irrelevantParts.map((part, idx) => (
                                            <li key={idx} className="text-green-700">{part}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* Novelty Comparison */}
                                    {analysis.noveltyComparison && getSectionVisibility(`claimRef-${pn}`).noveltyComparison && (
                                      <div className="mb-0">
                                        <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">⚖️ Novelty Comparison</div>
                                        <div className="text-sm text-gray-700 bg-purple-50 p-2 rounded border border-purple-100">{analysis.noveltyComparison}</div>
                                      </div>
                                    )}

                                    {/* Threat Level & Action */}
                                    <div className="mt-3 pt-3 border-t border-amber-200">
                                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                                        analysis.noveltyThreat === 'anticipates' ? 'bg-red-100 text-red-800' :
                                        analysis.noveltyThreat === 'obvious' ? 'bg-amber-100 text-amber-800' :
                                        analysis.noveltyThreat === 'adjacent' ? 'bg-green-100 text-green-800' :
                                        'bg-gray-100 text-gray-700'
                                      }`}>
                                        {analysis.noveltyThreat === 'anticipates' && '🛑 CRITICAL: Claims may need significant revision to overcome this reference'}
                                        {analysis.noveltyThreat === 'obvious' && '⚠️ IMPORTANT: Claims should be differentiated from this reference'}
                                        {analysis.noveltyThreat === 'adjacent' && '✅ RECOMMENDED: Include for defensive positioning'}
                                        {analysis.noveltyThreat === 'remote' && '⚪ OPTIONAL: May provide useful context'}
                                        {!analysis.noveltyThreat && '❓ Threat level not determined'}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="text-sm font-medium text-gray-700 mb-2">Summary for Claim Refinement:</div>
                    <div className="text-sm text-gray-600">
                      {claimRefMode === 'ai' && `${Object.keys(claimRefSelected).length} patents selected for claim comparison`}
                      {claimRefMode === 'manual' && (claimRefManualText.trim() ? 'Manual comparison notes provided' : 'No manual notes entered yet')}
                      {claimRefMode === 'hybrid' && `${Object.keys(claimRefSelected).length} patents + ${claimRefManualText.trim() ? 'manual notes' : 'no manual notes'}`}
                    </div>
                    {Object.keys(claimRefSelected).length > 0 && (
                      <div className="text-xs text-amber-600 mt-2">
                        ⚠️ {Object.values(claimRefSelected).filter((p: any) => p.noveltyThreat === 'anticipates' || p.noveltyThreat === 'obvious').length} high-risk patents will be analyzed
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legacy Step 3: Filter & Select (shown only when AI review not done) */}
        {results.length > 0 && !hasAIReview && (
          <div className="rounded-xl border transition-all duration-300 bg-white border-gray-200 shadow-sm">
             <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold">3</div>
                Configure Prior Art Usage
              </h3>
            </div>
            <div className="p-6 text-center text-gray-500">
              <p className="mb-4">Run the AI Relevance Review first to analyze patents and configure prior art usage.</p>
              <button
                onClick={runAIReview}
                disabled={reviewing}
                className="inline-flex items-center px-4 py-2 border border-emerald-300 text-sm font-medium rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
              >
                🧠 Run AI Relevance Review
              </button>
            </div>
          </div>
        )}

        {/* LEGACY: Old Filter & Select UI - Hidden but kept for compatibility */}
        {false && results.length > 0 && (
          <div className="rounded-xl border transition-all duration-300 bg-white border-indigo-100 shadow-sm hidden">
             <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">3</div>
                Filter & Select Prior Art
              </h3>
              {Object.keys(selected).length > 0 && (
                 <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                   {Object.keys(selected).length} Selected
                 </span>
               )}
            </div>

            <div className="p-4">
              {/* Controls Toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-6 bg-gray-50 p-2 rounded-lg border border-gray-100">
                <label className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={results.length > 0 && Object.keys(selected).length === filteredResults.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const allSelected: Record<string, any> = {}
                        filteredResults.forEach((r) => {
                          const key = getPatentKey(r)
                          allSelected[key] = {
                            title: r.title || (r as any).invention_title || key || 'Untitled',
                            snippet: (r as any).snippet || (r as any).abstract || (r as any).summary || (r as any).description || '',
                            score: (r as any).score || (r as any).relevance || 0,
                            tags: [],
                            publication_date: (r as any).publication_date,
                            inventors: (r as any).inventors,
                            assignees: (r as any).assignees
                          }
                        })
                        setSelected(allSelected)
                      } else {
                        setSelected({})
                      }
                    }}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  Select All
                </label>

                <div className="h-6 w-px bg-gray-300 mx-1"></div>

                {/* Relevance Filter - Only active if results exist (always true here) */}
                <Popover className="relative">
                  <Popover.Button className={`inline-flex items-center px-3 py-1.5 border rounded text-sm transition-colors ${relevanceFilters.length > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                    <span>Relevance Filter</span>
                    {relevanceFilters.length > 0 && <span className="ml-2 bg-indigo-100 px-1.5 rounded-full text-xs font-bold">{relevanceFilters.length}</span>}
                    <ChevronDownIcon className="ml-2 h-4 w-4" />
                  </Popover.Button>
                  <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                    <Popover.Panel className="absolute z-10 mt-2 w-64 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="py-1">
                        {['90-100', '80-90', '70-80', '60-70', '50-60', '<50'].map(range => (
                          <div key={range} className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={relevanceFilters.includes(range)}
                              onChange={() => handleRelevanceFilterChange(range)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                            />
                            <label className="ml-3 flex-1 cursor-pointer">{range}{range.includes('-') && '%'}</label>
                            <span className="text-xs text-gray-500 ml-2">({relevanceRangeCounts[range]})</span>
                          </div>
                        ))}
                      </div>
                    </Popover.Panel>
                  </Transition>
                </Popover>

                {/* Novelty Threat Filter - Only active if AI Review is done */}
                <Popover className="relative">
                  <Popover.Button 
                    disabled={!hasAIReview}
                    className={`inline-flex items-center px-3 py-1.5 border rounded text-sm transition-colors ${!hasAIReview ? 'opacity-50 cursor-not-allowed bg-gray-100 border-gray-200 text-gray-400' : noveltyThreatFilters.length > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                  >
                    <span>Novelty Threat Filter</span>
                    {noveltyThreatFilters.length > 0 && <span className="ml-2 bg-emerald-100 px-1.5 rounded-full text-xs font-bold">{noveltyThreatFilters.length}</span>}
                    <ChevronDownIcon className="ml-2 h-4 w-4" />
                  </Popover.Button>
                  {hasAIReview && (
                    <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                      <Popover.Panel className="absolute z-10 mt-2 w-64 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                        <div className="py-1">
                          {[
                            { key: 'anticipates', label: 'Anticipates (High Risk)', color: 'text-red-600' },
                            { key: 'obvious', label: 'Obvious (Medium Risk)', color: 'text-amber-600' },
                            { key: 'adjacent', label: 'Adjacent (Low Risk)', color: 'text-green-600' },
                            { key: 'remote', label: 'Remote (Safe)', color: 'text-gray-600' }
                          ].map(({ key, label, color }) => (
                            <div key={key} className="flex items-center px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={noveltyThreatFilters.includes(key)}
                                onChange={() => handleNoveltyThreatFilterChange(key)}
                                className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                              />
                              <label className={`ml-3 flex-1 cursor-pointer ${color}`}>{label}</label>
                              <span className="text-xs text-gray-500 ml-2">({noveltyThreatCounts[key] || 0})</span>
                            </div>
                          ))}
                        </div>
                      </Popover.Panel>
                    </Transition>
                  )}
                </Popover>

                {hasAIReview && (
                  <button
                    type="button"
                    onClick={handleAutoSelectAdjacent}
                    className="inline-flex items-center px-3 py-1.5 border border-emerald-200 rounded text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                  >
                    Auto-Select Relevant Prior Art
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearAllSelections}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-200 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Clear Selections
                </button>

                <div className="flex-1"></div>

                <button
                  onClick={() => setShowDisplayControls(!showDisplayControls)}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <span className="text-xs uppercase tracking-wide font-semibold">View Options</span>
                  <ChevronDownIcon className="w-4 h-4" />
                </button>
              </div>

              {autoSelectWarning && (
                <div className="mb-4 flex items-start gap-2 text-xs sm:text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <span>{autoSelectWarning}</span>
                </div>
              )}

              {/* Display Controls Panel */}
              {showDisplayControls && (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-100 rounded-lg animate-fadeIn">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { key: 'showTitle', label: 'Title', default: true },
                      { key: 'showPatentNumber', label: 'Patent Number', default: true },
                      { key: 'showAbstract', label: 'Abstract', default: true },
                      { key: 'showInventors', label: 'Inventors', default: true },
                      { key: 'showAssignees', label: 'Assignees', default: false },
                      { key: 'showPublicationDate', label: 'Publication Date', default: true },
                      { key: 'showRelevanceScore', label: 'Relevance Score', default: true }
                    ].map(({ key, label, default: defaultValue }) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={displaySettings[key as keyof typeof displaySettings] ?? defaultValue}
                          onChange={(e) => setDisplaySettings((prev: any) => ({ ...prev, [key]: e.target.checked }))}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Results List */}
              <div className="space-y-4">
                {paginatedResults.map((r, i) => {
                  const patentNumber = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
                  const title = r.title || (r as any).invention_title || patentNumber || 'Untitled'
                  const abstract = (r as any).snippet || (r as any).abstract || (r as any).summary || (r as any).description || ''
                  const pubDate = (r as any).publication_date || (r as any).filing_date || (r as any).date || ''
                  const relevanceScore = typeof (r as any).score === 'number' ? (r as any).score : (typeof (r as any).relevance === 'number' ? (r as any).relevance : null)
                  const inventors = (r as any).inventors || (r as any).inventor_names || []
                  const assignees = (r as any).assignees || (r as any).assignee_names || []

                  const key = getPatentKey(r, i)
                  const checked = !!selected[key]
                  const itemNumber = (currentPage - 1) * itemsPerPage + i + 1

                  return (
                    <div key={key} className={`group relative border rounded-lg transition-all duration-200 ${checked ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-gray-200 hover:border-indigo-300'}`}>
                      <div className="p-4 flex items-start gap-4">
                        <div className="flex items-center gap-3 pt-1">
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 font-medium text-xs">
                            {itemNumber}
                          </div>
                          <input 
                            type="checkbox" 
                            checked={checked} 
                            onChange={()=>toggleSelect({
                              ...r,
                              pn: patentNumber,
                              title: title,
                              snippet: abstract,
                              publication_date: pubDate,
                              score: relevanceScore,
                              inventors: inventors,
                              assignees: assignees
                            }, i)} 
                            className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" 
                          />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          {displaySettings.showTitle && (
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <a 
                                  className="text-lg font-medium text-indigo-700 hover:underline block mb-1" 
                                  target="_blank" 
                                  href={`https://lens.org/${encodeURIComponent(patentNumber).replace(/\s+/g,'-')}`}
                                >
                                  {title}
                                </a>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                  {displaySettings.showPatentNumber && patentNumber !== 'N/A' && (
                                    <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-mono">{patentNumber}</span>
                                  )}
                                  {displaySettings.showPublicationDate && pubDate && (
                                    <span>{String(pubDate).slice(0,10)}</span>
                                  )}
                                  {displaySettings.showRelevanceScore && relevanceScore !== null && (
                                    <span className="font-medium text-indigo-600">{(relevanceScore * 100).toFixed(1)}% Relevance</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {displaySettings.showAbstract && abstract && (
                            <div className="mt-3 text-sm text-gray-600 leading-relaxed line-clamp-3 hover:line-clamp-none transition-all">
                              {abstract}
                            </div>
                          )}

                          {/* Metadata */}
                          {((displaySettings.showInventors && inventors?.length) || (displaySettings.showAssignees && assignees?.length)) && (
                            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                              {displaySettings.showInventors && inventors?.length && (
                                <div><span className="font-semibold">Inventors:</span> {Array.isArray(inventors) ? inventors.join(', ') : inventors}</div>
                              )}
                              {displaySettings.showAssignees && assignees?.length && (
                                <div><span className="font-semibold">Assignees:</span> {Array.isArray(assignees) ? assignees.join(', ') : assignees}</div>
                              )}
                            </div>
                          )}

                          {/* AI Analysis Section */}
                          {(selected[key]?.tags?.includes('AI_REVIEWED') || aiAnalysis[key]) && (
                            <div className="mt-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
                              {/* Novelty Threat Header */}
                              <div className={`px-4 py-2 border-b text-sm font-medium flex items-center gap-2 ${
                                (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'anticipates' ? 'bg-red-50 text-red-800 border-red-100' :
                                (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'obvious' ? 'bg-amber-50 text-amber-800 border-amber-100' :
                                (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'adjacent' ? 'bg-green-50 text-green-800 border-green-100' :
                                'bg-gray-50 text-gray-800 border-gray-200'
                              }`}>
                                <span className="text-lg">
                                  {(selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'anticipates' ? '🛑' :
                                   (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'obvious' ? '⚠️' :
                                   (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'adjacent' ? '✅' : '⚪'}
                                </span>
                                <span>
                                  Novelty Threat: {(selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat || 'unknown').toUpperCase()}
                                </span>
                              </div>

                              {/* AI Summary */}
                              <div className="p-4 space-y-4 text-sm">
                                {(selected[key]?.aiSummary || aiAnalysis[key]?.aiSummary) && (
                                  <div>
                                    <div className="font-semibold text-gray-900 mb-1">Analysis</div>
                                    <div className="text-gray-700">{selected[key]?.aiSummary || aiAnalysis[key]?.aiSummary}</div>
                                  </div>
                                )}
                                
                                {(() => {
                                  const relevantParts =
                                    (selected[key]?.relevantParts ||
                                      aiAnalysis[key]?.relevantParts ||
                                      []) as string[]
                                  if (relevantParts.length === 0) return null
                                  return (
                                    <div>
                                      <div className="font-semibold text-green-800 mb-1">Relevant Aspects</div>
                                      <ul className="list-disc list-inside text-gray-700 pl-1">
                                        {relevantParts.map((part: string, i: number) => (
                                          <li key={i}>{part}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )
                                })()}

                                {(selected[key]?.noveltyComparison || aiAnalysis[key]?.noveltyComparison) && (
                                  <div className="bg-purple-50 p-3 rounded border border-purple-100">
                                    <div className="font-semibold text-purple-900 mb-1">Comparison</div>
                                    <div className="text-purple-800">{selected[key]?.noveltyComparison || aiAnalysis[key]?.noveltyComparison}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
      </div>
    </div>
  )
                })}
              </div>

              {/* Pagination */}
              {filteredResults.length > itemsPerPage && (
                <div className="mt-6 flex items-center justify-between border-t pt-4">
                  <div className="text-sm text-gray-500">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 text-sm"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 text-sm"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LEGACY: Step 4 Manual Prior Art Input - Now integrated into tabs above */}
        {/* Hidden but kept for ref anchor compatibility */}
        <div ref={manualPriorArtRef} className="hidden" />

        {/* Idea Bank */}
        {ideaBankOpen && (
          <div className="mt-8 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                <span>💡</span> Idea Bank
                <span className="text-xs font-normal bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">{ideaBank.length} generated</span>
              </h3>
            </div>
            
            {ideaBank.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ideaBank.map((ib, idx) => (
                  <div key={idx} className="bg-white p-4 rounded-lg border border-amber-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="font-bold text-gray-900 mb-2">{ib.title}</div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Core Principle</span>
                        <p className="text-gray-600 mt-0.5">{ib.core_principle}</p>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Advantage</span>
                        <p className="text-gray-600 mt-0.5">{ib.expected_advantage}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-amber-800/60">
                Run the AI Relevance Review to generate new invention ideas from the prior art analysis.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIdeaBankOpen(!ideaBankOpen)}
              className="text-sm text-amber-700 hover:text-amber-800 font-medium flex items-center gap-2"
            >
              <span>💡</span> {ideaBankOpen ? 'Hide Ideas' : `View Idea Bank (${ideaBank.length})`}
            </button>
            {statusMessage && (
              <div
                className={`text-xs sm:text-sm ${
                  statusMessage.type === 'success' ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {statusMessage.text}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* Workflow Status Badges */}
            {hasAIReview && !skipClaimRefinement && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100">
                  <span className="text-xs">📝</span>
                  <span className="text-xs font-medium text-indigo-700">
                    For Background: {priorArtMode === 'manual' ? 'Manual only' : priorArtMode === 'hybrid' ? `${Object.keys(priorArtSelected).length} patents + Manual` : `${Object.keys(priorArtSelected).length} patents`}
              </span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
                  <span className="text-xs">⚖️</span>
                  <span className="text-xs font-medium text-amber-700">
                    For Claims: {claimRefMode === 'manual' ? 'Manual only' : claimRefMode === 'hybrid' ? `${Object.keys(claimRefSelected).length} patents + Manual` : `${Object.keys(claimRefSelected).length} patents`}
                  </span>
                </div>
              </>
            )}

            {/* Skip Claim Refinement Option */}
            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
              skipClaimRefinement 
                ? 'bg-purple-50 border-purple-200 text-purple-700' 
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
              <input
                type="checkbox"
                checked={skipClaimRefinement}
                onChange={(e) => setSkipClaimRefinement(e.target.checked)}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <div className="flex flex-col">
                <span className="text-xs font-medium">Skip Claim Refinement</span>
                <span className="text-[10px] opacity-75">Claims are already optimized</span>
              </div>
            </label>
            
            <button
              onClick={async () => {
                // Save both workflow configurations
                setSavingPriorArt(true)
                try {
                  // Build prior art data for drafting
                  const priorArtPatentsArray = Object.entries(priorArtSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )
                  
                  // Build claim refinement data
                  const claimRefPatentsArray = Object.entries(claimRefSelected).map(
                    ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                  )
                  
                  console.log('💾 Saving configurations:', {
                    priorArtCount: priorArtPatentsArray.length,
                    claimRefCount: claimRefPatentsArray.length,
                    priorArtMode,
                    claimRefMode
                  })
                  
                  // Save the configurations
                  await onComplete({
                    action: 'save_prior_art_config',
                    sessionId: session?.id,
                    priorArtConfig: {
                      mode: priorArtMode,
                      selectedPatents: priorArtPatentsArray,
                      manualText: priorArtManualText
                    },
                    claimRefConfig: {
                      mode: claimRefMode,
                      selectedPatents: claimRefPatentsArray,
                      manualText: claimRefManualText
                    },
                    skipClaimRefinement
                  })
                  
                  // Refresh session to get updated config
                  await onRefresh()
                  
                  setStatusMessage({
                    type: 'success',
                    text: `✓ Saved: ${priorArtPatentsArray.length} patents for drafting, ${claimRefPatentsArray.length} patents for claim refinement`
                  })
                } catch (e) {
                  console.error('Failed to save config:', e)
                  setStatusMessage({
                    type: 'warning',
                    text: '⚠️ Failed to save configuration'
                  })
                } finally {
                  setSavingPriorArt(false)
                }
              }}
              disabled={savingPriorArt || !hasAIReview}
              className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md disabled:opacity-50"
            >
              {savingPriorArt ? 'Saving...' : 'Save Both Selections'}
            </button>
            <button
              onClick={async () => {
                // Build prior art data for drafting
                const priorArtPatentsArray = Object.entries(priorArtSelected).map(
                  ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                )
                
                // Build claim refinement data  
                const claimRefPatentsArray = Object.entries(claimRefSelected).map(
                  ([patentNumber, patentData]) => ({ patentNumber, ...patentData })
                )

                // Save configuration first (so user can revisit and see selections)
                try {
                  await onComplete({
                    action: 'save_prior_art_config',
                    sessionId: session?.id,
                    priorArtConfig: {
                      mode: priorArtMode,
                      selectedPatents: priorArtPatentsArray,
                      manualText: priorArtManualText
                    },
                    claimRefConfig: {
                      mode: claimRefMode,
                      selectedPatents: claimRefPatentsArray,
                      manualText: claimRefManualText
                    },
                    skipClaimRefinement
                  })
                  console.log('✅ Saved workflow configurations before proceeding')
                } catch (e) {
                  console.error('Failed to save config before proceeding:', e)
                }

                // If skipping claim refinement, go directly to component planner
                if (skipClaimRefinement) {
                  setStatusMessage({
                    type: 'success',
                    text: '✓ Skipping Claim Refinement, proceeding to Component Planner...'
                  })

                  await onComplete({
                    action: 'set_stage',
                    sessionId: session?.id,
                    stage: 'COMPONENT_PLANNER',
                    // Prior art for drafting (background sections)
                    priorArtForDrafting: {
                      mode: priorArtMode,
                      selectedPatents: priorArtPatentsArray,
                      manualText: priorArtManualText
                    },
                    // Store that claim refinement was skipped
                    claimRefinementSkipped: true,
                    // Legacy fields for backward compatibility
                    manualPriorArt: priorArtManualText ? {
                      manualPriorArtText: priorArtManualText,
                      useOnlyManualPriorArt: priorArtMode === 'manual',
                      useManualAndAISearch: priorArtMode === 'hybrid'
                    } : null,
                    selectedPatents: priorArtPatentsArray,
                    priorArtConfig: {
                      useAuto: priorArtMode !== 'manual',
                      useManual: priorArtMode === 'manual' || priorArtMode === 'hybrid',
                      skippedClaimRefinement: true
                    }
                  })
                  await onRefresh()
                  return
                }
                
                // Validate at least some selection is made for claim refinement
                const hasClaimRef = claimRefMode === 'manual' ? claimRefManualText.trim() :
                                    claimRefMode === 'hybrid' ? (claimRefPatentsArray.length > 0 || claimRefManualText.trim()) :
                                    claimRefPatentsArray.length > 0
                
                if (!hasClaimRef) {
                  setStatusMessage({
                    type: 'warning',
                    text: '⚠️ Please select at least one patent or provide manual text for claim refinement, or check "Skip Claim Refinement".'
                  })
                  setActiveWorkflowTab('claim-refinement')
                  return
                }

                  setStatusMessage({
                    type: 'success',
                  text: '✓ Proceeding to Claim Refinement...'
                  })

                // Navigate to claim refinement with both configurations
                await onComplete({
                  action: 'set_stage',
                  sessionId: session?.id,
                  stage: 'CLAIM_REFINEMENT',
                  // Prior art for drafting (background sections)
                  priorArtForDrafting: {
                    mode: priorArtMode,
                    selectedPatents: priorArtPatentsArray,
                    manualText: priorArtManualText
                  },
                  // Patents for claim comparison
                  claimRefinementConfig: {
                    mode: claimRefMode,
                    selectedPatents: claimRefPatentsArray,
                    manualText: claimRefManualText
                  },
                  // Legacy fields for backward compatibility
                  manualPriorArt: priorArtManualText ? {
                    manualPriorArtText: priorArtManualText,
                    useOnlyManualPriorArt: priorArtMode === 'manual',
                    useManualAndAISearch: priorArtMode === 'hybrid'
                  } : null,
                  selectedPatents: claimRefPatentsArray, // Use claim ref patents for claim refinement
                  priorArtConfig: {
                    useAuto: claimRefMode !== 'manual',
                    useManual: claimRefMode === 'manual' || claimRefMode === 'hybrid'
                  }
                })
                await onRefresh()
              }}
              disabled={!hasAIReview}
              className={`px-6 py-2 text-sm font-medium text-white rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                skipClaimRefinement 
                  ? 'bg-purple-600 hover:bg-purple-700' 
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <span>{skipClaimRefinement ? 'Skip to Component Planner' : 'Proceed to Claim Refinement'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="h-20"></div> {/* Spacer for fixed footer */}
    </div>
  )
})

RelatedArtStage.displayName = 'RelatedArtStage'

export default RelatedArtStage
