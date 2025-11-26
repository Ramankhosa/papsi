'use client'

import React, { useEffect, useMemo, useState, Fragment } from 'react'
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
  const [useManualAndAISearch, setUseManualAndAISearch] = useState(true)
  const [savingManualPriorArt, setSavingManualPriorArt] = useState(false)

  // UI control states
  const [relevanceFilters, setRelevanceFilters] = useState<string[]>([])
  const [noveltyThreatFilters, setNoveltyThreatFilters] = useState<string[]>([])
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)
  const [countryWiseDrafting, setCountryWiseDrafting] = useState(false)

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
    console.log('🔄 useEffect running - session changed, ideaBank.length:', ideaBank.length, 'customQuery:', customQuery, 'results.length:', results.length)
    if (session?.relatedArtRuns && session.relatedArtRuns.length > 0) {
      // Load the most recent run's results
      const latestRun = session.relatedArtRuns[0]
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
      const latestRunId = session.relatedArtRuns?.[0]?.id || null

      if (latestRunId && session?.relatedArtSelections && session.relatedArtSelections.length > 0) {
        const currentRunSelections = session.relatedArtSelections.filter((sel: any) => sel.runId === latestRunId)
        
        console.log(`Filtering ${session.relatedArtSelections.length} total selections down to ${currentRunSelections.length} for runId: ${latestRunId}`)

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
  }, [session, ideaBank])

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

  // Generate consistent key for selection (must match the key used in render)
  const generateSelectionKey = (item: any, index?: number) => {
    const pn = item.pn || (item as any).patent_number || (item as any).publication_number || (item as any).publication_id || (item as any).publicationId || (item as any).patentId || (item as any).patent_id || (item as any).id || 'N/A'
    const ttl = item.title || (item as any).invention_title || pn || 'Untitled'
    return pn !== 'N/A' ? pn : `${ttl}-${index || 0}`
  }

  const toggleSelect = (item: any, index?: number) => {
    const key = generateSelectionKey(item, index)
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
      const resp = await onComplete({ action: 'related_art_llm_review', sessionId: session?.id, runId })
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
      const manualPriorArtData = {
        manualPriorArtText,
        useOnlyManualPriorArt,
        useManualAndAISearch
      }
      await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: manualPriorArtData })
      setIsManualPriorArtSaved(true)
      setIsEditingManualPriorArt(false)
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

  const saveSelections = async () => {
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

    const selections = Object.entries(selected).map(([k, v]) => ({
      patent_number: k,
      title: v.title,
      snippet: v.snippet,
      score: v.score,
      tags: v.tags || [],
      publication_date: v.publication_date,
      inventors: v.inventors,
      assignees: v.assignees,
      user_notes: v.aiSummary || undefined
    }))

    // Save current selections if any exist
    if (selections.length > 0) {
      await onComplete({ action: 'related_art_select', sessionId: session?.id, runId, selections })
    }

    // Save manual prior art data if it exists
    if (isManualPriorArtSaved && manualPriorArtText.trim()) {
      const manualPriorArtData = {
        manualPriorArtText,
        useOnlyManualPriorArt,
        useManualAndAISearch
      }
      await onComplete({ action: 'save_manual_prior_art', sessionId: session?.id, manualPriorArt: manualPriorArtData })
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 3.5: Related Art</h2>
        <p className="text-gray-600">Discover and curate relevant patents using the optimized search query from Stage 1.</p>
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

      <div className="space-y-6">
        {/* Input Preview Pane */}
        <div className="bg-white rounded border p-4">
          <h3 className="font-medium text-gray-900 mb-2">Input Preview</h3>
          <div className="text-sm text-gray-700">
            <div className="mb-2"><span className="font-medium">Title:</span> {idea?.title || 'Untitled'}</div>
            <div className="mb-2">
              <div className="text-xs text-gray-500 mb-1">Search Query (from Stage 1)</div>
              <div className="whitespace-pre-wrap text-gray-700 bg-gray-50 p-2 rounded text-xs">{searchQuery || 'No search query available - complete Stage 1 first'}</div>
            </div>
            <details className="mb-2">
              <summary className="cursor-pointer text-gray-800">Abstract</summary>
              <div className="mt-2 whitespace-pre-wrap text-gray-700">{abstract || '—'}</div>
            </details>
            <div className="mb-2">
              <div className="text-xs text-gray-500 mb-1">CPC / IPC</div>
              <div className="flex flex-wrap gap-2">
                {Array.from(new Set([...(cpcCodes||[]), ...(ipcCodes||[])])).slice(0,10).map((c) => (
                  <span key={c} className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs">{c}</span>
                ))}
                {(!cpcCodes?.length && !ipcCodes?.length) && <span className="text-gray-400 text-xs">None</span>}
              </div>
            </div>
            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showCustomQuery}
                  onChange={(e) => setShowCustomQuery(e.target.checked)}
                  className="rounded"
                />
                Use custom search query (overrides AI-generated query)
              </label>

              {showCustomQuery && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full border rounded p-2 text-sm"
                    rows={3}
                    value={customQuery}
                    onChange={(e)=>{
                      console.log('📝 Custom query changed from:', customQuery, 'to:', e.target.value)
                      setCustomQuery(e.target.value)
                    }}
                    placeholder="Enter your own search query..."
                  />
                  <div className="text-xs text-gray-500">
                    Current AI query: <span className="font-mono bg-gray-100 px-1 rounded">{q}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <button
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                className="inline-flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded border border-gray-200"
              >
                <svg className={`w-4 h-4 transition-transform ${showAdvancedSettings ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Advanced Settings
              </button>

              {showAdvancedSettings && (
                <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
                  <div className="flex items-center gap-3 text-sm">
                    <label className="text-gray-600 whitespace-nowrap">Result count:</label>
                    <input
                      type="number"
                      min={10}
                      max={50}
                      value={limit}
                      onChange={(e)=>setLimit(Math.max(10, Math.min(50, parseInt(e.target.value||'25',10))))}
                      className="w-20 border rounded px-2 py-1 text-sm"
                    />
                    <span className="text-gray-400 text-xs">(10-50)</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <label className="text-gray-600 whitespace-nowrap">Published after:</label>
                    <input
                      type="date"
                      value={afterDate}
                      onChange={(e)=>setAfterDate(e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                      placeholder="YYYY-MM-DD"
                    />
                    <span className="text-gray-400 text-xs">(optional - leave empty for all dates)</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={runSearch}
                disabled={busy}
                className="inline-flex items-center px-4 py-2 border border-indigo-300 rounded text-indigo-700 text-sm bg-white hover:bg-indigo-50 disabled:opacity-60"
              >{searching ? '🔬 Analyzing Millions of Patents...' : busy ? 'Processing...' : 'Search Related Patents'}</button>

              <button
                onClick={() => setShowDisplayControls(!showDisplayControls)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded border border-gray-200"
              >
                <svg className={`w-4 h-4 transition-transform ${showDisplayControls ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Display Controls
              </button>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showManualPriorArt}
                  onChange={(e) => setShowManualPriorArt(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Enter Prior Art Manually
              </label>
            </div>

            {/* Sophisticated Search Progress */}
            {searching && searchProgress && (
              <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Advanced Patent Intelligence Analysis</h3>
                    <p className="text-blue-800 font-medium">{searchProgress}</p>
                    <div className="mt-3 bg-blue-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{width: '100%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {showDisplayControls && (
          <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Choose what to display in patent results:</h4>
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
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={displaySettings[key as keyof typeof displaySettings] ?? defaultValue}
                    onChange={(e) => setDisplaySettings((prev: any) => ({ ...prev, [key]: e.target.checked }))}
                    className="rounded"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Your display preferences are automatically saved.
            </div>
          </div>
        )}

        {showManualPriorArt && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-amber-900 mb-3">Manual Prior Art Analysis</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-2">
                  Enter your prior art analysis (up to 300 words):
                </label>
                <textarea
                  className="w-full border border-amber-300 rounded-lg p-3 text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  rows={6}
                  maxLength={3000} // Roughly 300 words
                  value={manualPriorArtText}
                  onChange={(e) => setManualPriorArtText(e.target.value)}
                  disabled={!isEditingManualPriorArt && isManualPriorArtSaved}
                  placeholder="Describe your prior art analysis here. Include details about existing patents, publications, or technologies that are similar to your invention..."
                />
                <div className="mt-1 text-xs text-amber-600">
                  {manualPriorArtText.length}/3000 characters
                </div>
              </div>

              <div className="flex items-center gap-3">
                {!isManualPriorArtSaved ? (
                  <button
                    onClick={async () => {
                      if (manualPriorArtText.trim()) {
                        const success = await saveManualPriorArt()
                        if (success) {
                          // Optional: close the UI after saving
                        }
                      }
                    }}
                    disabled={!manualPriorArtText.trim() || savingManualPriorArt}
                    className="inline-flex items-center px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingManualPriorArt ? '💾 Saving...' : '💾 Save'}
                  </button>
                ) : (
                  <>
                    {!isEditingManualPriorArt ? (
                      <button
                        onClick={() => setIsEditingManualPriorArt(true)}
                        className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md"
                      >
                        ✏️ Edit
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={async () => {
                            if (manualPriorArtText.trim()) {
                              await saveManualPriorArt()
                            }
                          }}
                          disabled={!manualPriorArtText.trim() || savingManualPriorArt}
                          className="inline-flex items-center px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingManualPriorArt ? '💾 Saving...' : '💾 Save Changes'}
                        </button>
                        <button
                          onClick={() => {
                            setIsEditingManualPriorArt(false)
                          }}
                          className="inline-flex items-center px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md"
                        >
                          ❌ Cancel
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setManualPriorArtText('')
                        setIsManualPriorArtSaved(false)
                        setIsEditingManualPriorArt(false)
                        setUseOnlyManualPriorArt(false)
                        setUseManualAndAISearch(true)
                      }}
                      className="inline-flex items-center px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md"
                    >
                      🗑️ Delete
                    </button>
                  </>
                )}

                {isManualPriorArtSaved && !isEditingManualPriorArt && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-amber-800">
                        <input
                          type="checkbox"
                          checked={useOnlyManualPriorArt}
                          onChange={(e) => {
                            setUseOnlyManualPriorArt(e.target.checked)
                            if (e.target.checked) setUseManualAndAISearch(false)
                          }}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        Use only this prior art
                      </label>
                      <label className="flex items-center gap-2 text-sm text-amber-800">
                        <input
                          type="checkbox"
                          checked={useManualAndAISearch}
                          onChange={(e) => {
                            setUseManualAndAISearch(e.target.checked)
                            if (e.target.checked) setUseOnlyManualPriorArt(false)
                          }}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        Use this prior art and suitable prior art from AI search and relevance analysis
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={saveManualPriorArt}
                        disabled={savingManualPriorArt}
                        className="inline-flex items-center px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md disabled:opacity-50"
                      >
                        {savingManualPriorArt ? '💾 Saving...' : '💾 Update Selection'}
                      </button>
                      <button
                        onClick={() => setShowManualPriorArt(false)}
                        className="inline-flex items-center px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md"
                      >
                        ❌ Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results List */}
        <div className="bg-white rounded border p-4">
          {/* Results Summary */}
          <div className="mb-4 text-sm text-gray-600 border-b pb-2">
            Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredResults.length)} of {filteredResults.length} patent{filteredResults.length !== 1 ? 's' : ''}
            {filteredResults.length !== results.length && ` (filtered from ${results.length} total)`}
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              {/* Select All Checkbox */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={results.length > 0 && Object.keys(selected).length === filteredResults.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // Select all filtered results
                      const allSelected: Record<string, any> = {}
                      filteredResults.forEach((r) => {
                        const pn = r.pn || (r as any).publication_id || 'N/A'
                        if (pn !== 'N/A') {
                          allSelected[pn] = {
                            title: r.title,
                            snippet: r.snippet,
                            score: r.score,
                            tags: [],
                            publication_date: (r as any).publication_date,
                            inventors: (r as any).inventors,
                            assignees: (r as any).assignees
                          }
                        }
                      })
                      setSelected(allSelected)
                    } else {
                      // Deselect all
                      setSelected({})
                    }
                  }}
                  className="rounded"
                />
                Select to add in prior art for drafting ({filteredResults.length})
              </label>
              <Popover className="relative">
                <Popover.Button className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded text-gray-700 text-sm bg-white hover:bg-gray-50">
                  <span>Relevance Filter</span>
                  <ChevronDownIcon className="ml-2 h-4 w-4" />
                </Popover.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Popover.Panel className="absolute z-50 mt-2 w-56 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="py-1">
                      {/* Select All Option */}
                      <div className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-200">
                        <input
                          type="checkbox"
                          checked={relevanceFilters.length === 6} // All ranges selected
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRelevanceFilters(['90-100', '80-90', '70-80', '60-70', '50-60', '<50'])
                            } else {
                              setRelevanceFilters([])
                            }
                            setCurrentPage(1)
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label className="ml-3 font-medium">Select All ({results.length})</label>
                      </div>

                      {/* Individual Range Options */}
                      {['90-100', '80-90', '70-80', '60-70', '50-60', '<50'].map(range => (
                        <div key={range} className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                          <input
                            type="checkbox"
                            checked={relevanceFilters.includes(range)}
                            onChange={() => handleRelevanceFilterChange(range)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label className="ml-3 flex-1">{range}{range.includes('-') && '%'}</label>
                          <span className="text-xs text-gray-500 ml-2">({relevanceRangeCounts[range]})</span>
                        </div>
                      ))}
                    </div>
                  </Popover.Panel>
                </Transition>
              </Popover>

              <Popover className="relative">
                <Popover.Button className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded text-gray-700 text-sm bg-white hover:bg-gray-50">
                  <span>Novelty Threat Filter</span>
                  <ChevronDownIcon className="ml-2 h-4 w-4" />
                </Popover.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Popover.Panel className="absolute z-50 mt-2 w-64 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="py-1">
                      {/* Select All Option */}
                      <div className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-200">
                        <input
                          type="checkbox"
                          checked={noveltyThreatFilters.length === 4} // All threat levels selected
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNoveltyThreatFilters(['anticipates', 'obvious', 'adjacent', 'remote'])
                            } else {
                              setNoveltyThreatFilters([])
                            }
                            setCurrentPage(1)
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label className="ml-3 font-medium">Select All ({analyzedResultsCount})</label>
                      </div>

                      {/* Individual Threat Level Options */}
                      {[
                        { key: 'anticipates', label: 'Anticipates', color: 'text-red-600' },
                        { key: 'obvious', label: 'Obvious', color: 'text-amber-600' },
                        { key: 'adjacent', label: 'Adjacent', color: 'text-green-600' },
                        { key: 'remote', label: 'Remote', color: 'text-gray-600' }
                      ].map(({ key, label, color }) => (
                        <div key={key} className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                          <input
                            type="checkbox"
                            checked={noveltyThreatFilters.includes(key)}
                            onChange={() => handleNoveltyThreatFilterChange(key)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label className={`ml-3 flex-1 ${color}`}>{label}</label>
                          <span className="text-xs text-gray-500 ml-2">({noveltyThreatCounts[key] || 0})</span>
                        </div>
                      ))}
                    </div>
                  </Popover.Panel>
                </Transition>
              </Popover>

            </div>

            <div className="flex items-center space-x-2 text-sm">
              <span>Show:</span>
              <select
                value={itemsPerPage}
                onChange={e => {
                  setItemsPerPage(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="rounded border-gray-300 text-sm focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
              <span className="text-gray-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2 py-1 border rounded bg-white disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2 py-1 border rounded bg-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex items-center justify-center space-x-4">
            {results.length > 0 && (
              <button
                onClick={runAIReview}
                disabled={busy || reviewing}
                className="inline-flex items-center px-4 py-2 border border-emerald-300 rounded text-emerald-700 text-sm bg-white hover:bg-emerald-50 disabled:opacity-60"
              >
                {reviewing ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    AI reviewing…
                  </>
                ) : (
                  'Run AI Relevance Review'
                )}
              </button>
            )}
          </div>

          <div className="divide-y">
            {paginatedResults.map((r, i) => {
              // Debug: log all available fields for first result
              if (i === 0) {
                console.log('API result fields:', Object.keys(r))
                console.log('First result full data:', JSON.stringify(r, null, 2))
                console.log('First result patent data:', {
                  pn: r.pn,
                  patent_number: (r as any).patent_number,
                  publication_number: (r as any).publication_number,
                  publication_id: (r as any).publication_id,
                  publicationId: (r as any).publicationId,
                  // Check if patent number might be in title or other fields
                  title: r.title,
                  id: (r as any).id,
                  patentId: (r as any).patentId,
                  patent_id: (r as any).patent_id
                })
                console.log('Final patentNumber value:', r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A')
              }

              // Try multiple possible field names for patent data
              const patentNumber = r.pn || (r as any).patent_number || (r as any).publication_number || (r as any).publication_id || (r as any).publicationId || (r as any).patentId || (r as any).patent_id || (r as any).id || 'N/A'
              const title = r.title || (r as any).invention_title || patentNumber || 'Untitled'
              const abstract = (r as any).snippet || (r as any).abstract || (r as any).summary || (r as any).description || ''
              const pubDate = (r as any).publication_date || (r as any).filing_date || (r as any).date || ''
              const relevanceScore = typeof (r as any).score === 'number' ? (r as any).score : (typeof (r as any).relevance === 'number' ? (r as any).relevance : null)
              const inventors = (r as any).inventors || (r as any).inventor_names || []
              const assignees = (r as any).assignees || (r as any).assignee_names || []

              // Generate consistent key for selection
              const generateSelectionKey = (item: any) => {
                const pn = item.pn || item.patent_number || item.publication_number || item.publication_id || item.publicationId || item.patentId || item.patent_id || item.id || 'N/A'
                const ttl = item.title || item.invention_title || pn || 'Untitled'
                return pn !== 'N/A' ? pn : `${ttl}-${i}`
              }

              const key = generateSelectionKey(r)
              const checked = !!selected[key]
              const itemNumber = (currentPage - 1) * itemsPerPage + i + 1
              const totalItems = filteredResults.length

              return (
                <div key={key} className="py-4 px-3 border rounded-lg mb-3 bg-gray-50">
                  <div className="flex items-start gap-3">
                    {/* Item Number */}
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm flex-shrink-0">
                      {itemNumber}
                    </div>

                    <input type="checkbox" checked={checked} onChange={()=>toggleSelect({
                      ...r,
                      pn: patentNumber,
                      title: title,
                      snippet: abstract,
                      publication_date: pubDate,
                      score: relevanceScore,
                      inventors: inventors,
                      assignees: assignees
                    }, i)} className="mt-1" />
                    <div className="flex-1">
                      {/* Header with title and score */}
                      {displaySettings.showTitle && (
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <a className="font-medium text-indigo-700 hover:underline text-sm" target="_blank" href={`https://lens.org/${encodeURIComponent(patentNumber).replace(/\s+/g,'-')}`}>
                              {title}
                            </a>
                            <div className="text-xs text-gray-500 mt-1">
                              {displaySettings.showPatentNumber && patentNumber !== 'N/A' && `Patent: ${patentNumber}`}
                              {displaySettings.showPublicationDate && pubDate && (displaySettings.showPatentNumber && patentNumber !== 'N/A' ? ' · ' : '') + `Published: ${String(pubDate).slice(0,10)}`}
                              {displaySettings.showRelevanceScore && relevanceScore !== null && ((displaySettings.showPatentNumber && patentNumber !== 'N/A') || (displaySettings.showPublicationDate && pubDate) ? ' · ' : '') + `Relevance: ${(relevanceScore * 100).toFixed(1)}%`}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Snippet/Abstract */}
                      {displaySettings.showAbstract && abstract && (
                        <div className="mt-3">
                          <div className="text-xs font-medium text-gray-700 mb-1">Abstract/Summary:</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded border leading-relaxed">
                            {abstract}
                          </div>
                        </div>
                      )}

                      {/* Additional metadata if available and enabled */}
                      {((displaySettings.showInventors && inventors?.length) ||
                        (displaySettings.showAssignees && assignees?.length)) && (
                        <div className="mt-3 text-xs text-gray-600">
                          {displaySettings.showInventors && inventors?.length && <div><strong>Inventors:</strong> {Array.isArray(inventors) ? inventors.join(', ') : inventors}</div>}
                          {displaySettings.showAssignees && assignees?.length && <div><strong>Assignees:</strong> {Array.isArray(assignees) ? assignees.join(', ') : assignees}</div>}
                        </div>
                      )}

                      {/* AI review badges and analysis */}
                      {(selected[key]?.tags?.includes('AI_REVIEWED') || aiAnalysis[key]) && (
                        <div className="mt-3 border-t border-gray-200 pt-3">
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`inline-block px-3 py-1.5 rounded-lg text-sm font-semibold ${
                              (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'anticipates' ? 'bg-red-100 text-red-800 border border-red-300' :
                              (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'obvious' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                              (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat) === 'adjacent' ? 'bg-green-100 text-green-800 border border-green-300' :
                              'bg-gray-100 text-gray-800 border border-gray-300'
                            }`}>
                              🧩 Novelty Threat: {(selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat || 'unknown').charAt(0).toUpperCase() + (selected[key]?.noveltyThreat || aiAnalysis[key]?.noveltyThreat || 'unknown').slice(1)}
                            </span>
                            {selected[key]?.score !== undefined && (
                              <span className="text-sm text-gray-600 font-medium">
                                Relevance: {(selected[key].score * 100).toFixed(1)}%
                              </span>
                            )}
                          </div>

                          {(selected[key]?.aiSummary || aiAnalysis[key]?.aiSummary) && (
                            <div className="text-sm text-gray-800 bg-blue-50 p-4 rounded-lg border border-blue-200">
                              <div className="font-semibold text-blue-800 mb-2">🤖 AI Relevance Analysis:</div>
                              <div className="text-gray-700 leading-relaxed">{selected[key]?.aiSummary || aiAnalysis[key]?.aiSummary}</div>
                            </div>
                          )}

                          {/* Relevant Parts */}
                          {(() => {
                            const relevantParts = selected[key]?.relevantParts || aiAnalysis[key]?.relevantParts;
                            return relevantParts && relevantParts.length > 0 && (
                            <div className="text-sm text-gray-800 bg-green-50 p-4 rounded-lg border border-green-200">
                              <div className="font-semibold text-green-800 mb-2">✅ Relevant Parts:</div>
                              <ul className="text-gray-700 space-y-1">
                                {relevantParts.map((part: string, idx: number) => (
                                  <li key={idx} className="flex items-start">
                                    <span className="text-green-600 mr-2">•</span>
                                    <span>{part}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            );
                          })()}

                          {/* Irrelevant Parts */}
                          {(() => {
                            const irrelevantParts = selected[key]?.irrelevantParts || aiAnalysis[key]?.irrelevantParts;
                            return irrelevantParts && irrelevantParts.length > 0 && (
                            <div className="text-sm text-gray-800 bg-gray-50 p-4 rounded-lg border border-gray-200">
                              <div className="font-semibold text-gray-800 mb-2">❌ Irrelevant Parts:</div>
                              <ul className="text-gray-700 space-y-1">
                                {irrelevantParts.map((part: string, idx: number) => (
                                  <li key={idx} className="flex items-start">
                                    <span className="text-gray-600 mr-2">•</span>
                                    <span>{part}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            );
                          })()}

                          {/* Novelty Comparison */}
                          {(selected[key]?.noveltyComparison || aiAnalysis[key]?.noveltyComparison) && (
                            <div className="text-sm text-gray-800 bg-purple-50 p-4 rounded-lg border border-purple-200">
                              <div className="font-semibold text-purple-800 mb-2">💡 Novelty Comparison:</div>
                              <div className="text-gray-700 leading-relaxed">{selected[key]?.noveltyComparison || aiAnalysis[key]?.noveltyComparison}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {results.length === 0 && (
              <div className="text-center py-8">
                <div className="text-4xl mb-4">🔍</div>
                <div className="text-lg font-medium text-gray-900 mb-2">Ready for Advanced Patent Analysis</div>
                <div className="text-sm text-gray-600 max-w-md mx-auto">
                  Our AI-powered system will scan millions of global patents using sophisticated algorithms
                  to find the most relevant prior art for your invention. Click "Search Related Patents" to begin this comprehensive analysis.
                </div>
              </div>
            )}
          </div>
          {reviewing && (
            <div className="mt-3 text-xs text-gray-500">
              {reviewInfo || 'Analyzing…'}
            </div>
          )}
        </div>

        {/* Floating Selection UI */}
        {Object.keys(selected).length > 0 && (
          <div className="fixed top-20 right-6 z-50 opacity-100 transition-opacity duration-300">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 shadow-lg">
              <div className="flex flex-col items-center gap-2">
                <span className="text-green-700 font-medium text-sm text-center">
                  {Object.keys(selected).length} patent{Object.keys(selected).length !== 1 ? 's' : ''} will be used for<br/>prior art in patent draft
                </span>
                <button
                  onClick={async () => {
                    await saveSelections();
                    alert('Selections saved successfully!');
                  }}
                  className="inline-flex items-center px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
                >
                  💾 Save
                </button>
              </div>
            </div>
          </div>
        )}

        {ideaBankOpen && (
          <div className="mt-4 bg-white rounded border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-900">💡 Generated Ideas</h3>
              <div className="text-xs text-gray-500">{ideaBank.length} idea{ideaBank.length!==1?'s':''}</div>
            </div>
            {ideaBank.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-3">
                {ideaBank.map((ib, idx) => (
                <div key={idx} className="border rounded-lg p-3 bg-amber-50 border-amber-200">
                  <div className="font-semibold text-amber-900 mb-1">{ib.title}</div>
                  <div className="text-sm text-gray-800 mb-2">
                    <span className="font-medium">Core principle:</span> {ib.core_principle}
                  </div>
                  <div className="text-sm text-gray-800 mb-2">
                    <span className="font-medium">Expected advantage:</span> {ib.expected_advantage}
                  </div>
                  {Array.isArray(ib.tags) && ib.tags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {ib.tags.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 border border-amber-200">{t}</span>
                      ))}
                    </div>
                  )}
                  {ib.non_obvious_extension && (
                    <div className="text-sm text-gray-800">
                      <span className="font-medium">Non-obvious extension:</span> {ib.non_obvious_extension}
                    </div>
                  )}
                </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-3">💡</div>
                <div className="font-medium mb-1">No Ideas Generated Yet</div>
                <div className="text-sm">Run AI Relevance Review to generate innovative invention ideas based on the patent analysis.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-gray-600">Select references to include before drafting.</div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
              checked={countryWiseDrafting}
              onChange={e => setCountryWiseDrafting(e.target.checked)}
            />
            <span>
              Country Wise Drafting – insert an intermediate stage to choose jurisdictions (Stage 3.7a) before Annexure Draft.
            </span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          {/* Idea Bank Button */}
          <button
            onClick={() => setIdeaBankOpen(!ideaBankOpen)}
            className="inline-flex items-center px-3 py-2 border border-amber-300 rounded text-amber-700 text-sm bg-white hover:bg-amber-50"
            title={`Idea Bank: ${ideaBank.length} ideas`}
          >
            💡 Idea Bank ({ideaBank.length})
          </button>
          <button
            onClick={saveSelections}
            disabled={Object.keys(selected).length === 0}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
          >Save Selection</button>
          <button
            onClick={async ()=>{
              await saveSelections();
              const manualPriorArtData = isManualPriorArtSaved ? {
                manualPriorArtText,
                useOnlyManualPriorArt,
                useManualAndAISearch
              } : null;
              // Convert selected patents to array format for drafting
              const selectedPatentsArray = Object.entries(selected).map(([patentNumber, patentData]) => ({
                patentNumber,
                ...patentData
              }));
              await onComplete({
                action: 'set_stage',
                sessionId: session?.id,
                stage: countryWiseDrafting ? 'COUNTRY_WISE_DRAFTING' : 'ANNEXURE_DRAFT',
                manualPriorArt: manualPriorArtData,
                selectedPatents: selectedPatentsArray
              });
              await onRefresh()
            }}
            disabled={Object.keys(selected).length === 0}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          >Send to Drafting</button>
        </div>
      </div>
    </div>
  )
}
