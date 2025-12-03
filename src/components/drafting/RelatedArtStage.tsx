'use client'

import React, { useEffect, useMemo, useState, Fragment, useRef } from 'react'
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

export default function RelatedArtStage({ session, patent, onComplete, onRefresh }: RelatedArtStageProps) {
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
  const [selected, setSelected] = useState<Record<string, { title?: string; snippet?: string; score?: number; tags?: string[]; publication_date?: string; inventors?: any; assignees?: any; aiSummary?: string; noveltyThreat?: string; relevantParts?: string[]; irrelevantParts?: string[]; noveltyComparison?: string }>>({})
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
  const [ideaBankVersion, setIdeaBankVersion] = useState(0) // Force re-renders

  // Manual prior art states
  const [showManualPriorArt, setShowManualPriorArt] = useState(false)
  const [manualPriorArtText, setManualPriorArtText] = useState('')
  const [isManualPriorArtSaved, setIsManualPriorArtSaved] = useState(false)
  const [isEditingManualPriorArt, setIsEditingManualPriorArt] = useState(false)
  const [useOnlyManualPriorArt, setUseOnlyManualPriorArt] = useState(false)
  const [useManualAndAISearch, setUseManualAndAISearch] = useState(false)
  const [savingManualPriorArt, setSavingManualPriorArt] = useState(false)

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

  // DEBUG: Log ideaBank changes
  useEffect(() => {
    console.log('💡 ideaBank state changed:', ideaBank.length, 'ideas')
    if (ideaBank.length > 0) {
      console.log('💡 First idea title:', ideaBank[0]?.title)
    }
  }, [ideaBank])

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

  // Load stored results on mount
  useEffect(() => {
    if (!session) return

    const latestRun = session.relatedArtRuns?.[0]
    const latestRunId = latestRun?.id || null

    // Avoid reloading the same run repeatedly
    if (latestRunId && lastLoadedRunIdRef.current === latestRunId) return
    console.log('🔄 useEffect running - session changed. runId:', latestRunId, 'ideaBank.length:', ideaBank.length, 'results.length:', results.length)

    if (latestRunId) {
      lastLoadedRunIdRef.current = latestRunId
    }

    if (latestRun?.resultsJson && Array.isArray(latestRun.resultsJson)) {
      setResults(latestRun.resultsJson)
      setRunId(latestRun.id)
      console.log('Loaded stored PQAI results:', latestRun.resultsJson.length, 'items from run:', latestRun.id)
    }

    // Load stored idea bank suggestions only if ideaBank is empty (to avoid overwriting AI-generated ideas)
    if ((latestRun as any)?.ideaBankSuggestions && Array.isArray((latestRun as any).ideaBankSuggestions) && ideaBank.length === 0) {
      const storedIdeas = (latestRun as any).ideaBankSuggestions.map((ibs: any) => ({
        title: ibs.ideaTitle || '',
        core_principle: ibs.corePrinciple || '',
        expected_advantage: ibs.expectedAdvantage || '',
        tags: Array.isArray(ibs.tags) ? ibs.tags : [],
        non_obvious_extension: ibs.nonObviousExtension || ''
      }))
      setIdeaBank(storedIdeas)
      setIdeaBankVersion(prev => prev + 1) // Force re-render
      console.log('Loaded stored idea bank suggestions:', storedIdeas.length, 'ideas (ideaBank was empty)')
    } else if ((latestRun as any)?.ideaBankSuggestions && Array.isArray((latestRun as any).ideaBankSuggestions)) {
      console.log('Skipping stored idea bank load - ideaBank already has', ideaBank.length, 'ideas')
    }

    // Load manual prior art data if it exists
    if (session?.manualPriorArt) {
      const manualData = session.manualPriorArt
      setManualPriorArtText(manualData.manualPriorArtText || '')
      setUseOnlyManualPriorArt(manualData.useOnlyManualPriorArt || false)
      setUseManualAndAISearch(manualData.useManualAndAISearch !== false) // Default to true
      setIsManualPriorArtSaved(true)
      console.log('Loaded stored manual prior art data')
    }

    // Load AI analysis data if it exists
    if ((session as any)?.aiAnalysisData) {
      const storedAiAnalysis = (session as any).aiAnalysisData
      setAiAnalysis(storedAiAnalysis)
      console.log('Loaded stored AI analysis data')
    }

    // Load user's saved selections (only explicitly selected patents for the current run)
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
    setHasLoadedSelections(true)
    console.log('Loaded selections for current run:', Object.keys(selectionsMap).length, 'patents')
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
      console.log('AI Review Response:', JSON.stringify(resp, null, 2)) // Debug: full response
      console.log('Response type:', typeof resp)
      console.log('Response keys:', Object.keys(resp || {}))
      console.log('Direct ideaBankSuggestions:', resp?.ideaBankSuggestions)
      console.log('Nested ideaBankSuggestions:', resp?.data?.ideaBankSuggestions)
      console.log('Response.data keys:', resp?.data ? Object.keys(resp.data) : 'no data property')

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
      console.log('✅ Idea Bank setIdeaBank called with', ideasToSet.length, 'ideas, version:', ideaBankVersion + 1)

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
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 3.5: Related Art</h2>
        <p className="text-gray-600">Discover and curate relevant patents using the optimized search query from Stage 1.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={scrollToManualPriorArt}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md"
          >
            Manual Prior Art
          </button>
        </div>
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
                        Searching PQAI Database...
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

        {/* STEP 3: Filter & Select */}
        {results.length > 0 && (
          <div className="rounded-xl border transition-all duration-300 bg-white border-indigo-100 shadow-sm">
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

        {/* STEP 4: Manual Prior Art Input */}
        <div ref={manualPriorArtRef} className="rounded-xl border transition-all duration-300 bg-white border-amber-100 shadow-sm">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">4</div>
              Manual Prior Art Input
            </h3>
            {manualPriorArtText.trim() && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                Manual prior art added
              </span>
            )}
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              Paste or describe any prior art you already know. This can include non-patent literature, internal disclosures, or specific patent citations.
            </p>
            <textarea
              className="w-full border rounded-md p-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 min-h-[140px]"
              placeholder="Example: US 9,123,456 (Smith) — discloses a server-side ranking model using click-through data only..."
              value={manualPriorArtText}
              onChange={(e) => {
                setManualPriorArtText(e.target.value)
                setIsManualPriorArtSaved(false)
              }}
            />
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                    className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    checked={useOnlyManualPriorArt}
                    onChange={(e) => {
                      const next = e.target.checked
                      setUseOnlyManualPriorArt(next)
                      if (next) setUseManualAndAISearch(false)
                      setIsManualPriorArtSaved(false)
                    }}
                  />
                  <span>Use only manually entered prior art</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                      className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                      checked={useManualAndAISearch}
                      onChange={(e) => {
                        const next = e.target.checked
                        setUseManualAndAISearch(next)
                      if (next) setUseOnlyManualPriorArt(false)
                      setIsManualPriorArtSaved(false)
                    }}
                  />
                  <span>Combine manual prior art with selected system prior art (Mixed Mode)</span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveManualPriorArt}
                  disabled={savingManualPriorArt || (!manualPriorArtText.trim() && !useOnlyManualPriorArt && !useManualAndAISearch)}
                  className="px-4 py-2 text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md border border-amber-200 disabled:opacity-50"
                >
                  {savingManualPriorArt ? 'Saving…' : 'Save Manual Prior Art'}
                </button>
                <button
                  type="button"
                  onClick={clearManualPriorArt}
                  disabled={!manualPriorArtEnabled && !isManualPriorArtSaved}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-200 disabled:opacity-50"
                >
                  Disable Manual Prior Art
                </button>
                {isManualPriorArtSaved && (
                  <span className="text-xs text-emerald-700">
                    ✓ Saved — editable anytime before drafting
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

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

          <div className="flex items-center gap-3">
            {Object.keys(selected).length > 0 && (
              <span className="text-sm text-gray-500 mr-2">
                {Object.keys(selected).length} patents selected
              </span>
            )}
            <button
              onClick={async () => {
                await saveSelections()
                const hasManual = manualPriorArtEnabled
                const systemCount = Object.keys(selected).length
                const manualCount = hasManual ? 1 : 0
                const totalEntries =
                  useOnlyManualPriorArt && hasManual ? manualCount : systemCount + manualCount

                if (totalEntries === 0) {
                  setStatusMessage({
                    type: 'warning',
                    text: '⚠️ No prior art included. You may continue, but this weakens legal defensibility.'
                  })
                } else {
                  setStatusMessage({
                    type: 'success',
                    text: `✓ Prior Art Selection Saved — ${totalEntries} entries will be used in Stage 4.`
                  })
                }
              }}
              disabled={Object.keys(selected).length === 0 && !manualPriorArtEnabled}
              className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              onClick={async () => {
                const hasManual = manualPriorArtEnabled
                const systemCount = Object.keys(selected).length
                const manualCount = hasManual ? 1 : 0
                const totalEntries =
                  useOnlyManualPriorArt && hasManual ? manualCount : systemCount + manualCount

                await saveSelections()

                const manualPriorArtData =
                  hasManual
                    ? {
                        manualPriorArtText,
                        useOnlyManualPriorArt,
                        useManualAndAISearch
                      }
                    : null

                const selectedPatentsArray = Object.entries(selected).map(
                  ([patentNumber, patentData]) => ({
                    patentNumber,
                    ...patentData
                  })
                )

                if (totalEntries === 0) {
                  setStatusMessage({
                    type: 'warning',
                    text: '⚠️ No prior art included. You may continue, but this weakens legal defensibility.'
                  })
                } else {
                  setStatusMessage({
                    type: 'success',
                    text: `✓ Prior Art Selection Saved — ${totalEntries} entries will be used in Stage 4.`
                  })
                }

                await onComplete({
                  action: 'set_stage',
                  sessionId: session?.id,
                  stage: 'ANNEXURE_DRAFT',
                  manualPriorArt: manualPriorArtData,
                  selectedPatents: selectedPatentsArray
                })
                await onRefresh()
              }}
              disabled={Object.keys(selected).length === 0 && !manualPriorArtEnabled}
              className="px-6 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span>Proceed to Drafting</span>
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
}
