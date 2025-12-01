'use client'

import { useEffect, useMemo, useState } from 'react'
import BackendActivityPanel from './BackendActivityPanel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import plantumlEncoder from 'plantuml-encoder'
import SectionInstructionPopover from './SectionInstructionPopover'
import AllInstructionsModal from './AllInstructionsModal'
import WritingSamplesModal from './WritingSamplesModal'
import PersonaManager, { type PersonaSelection } from './PersonaManager'

type SectionConfig = {
  keys: string[]
  label: string
  description?: string
  constraints?: string[]
  required?: boolean
}

interface AnnexureDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface CountryOption {
  code: string
  label: string
  description: string
  languages: string[]
}

const displayName: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  fieldOfInvention: 'Field of Invention',
  crossReference: 'Cross-Reference to Related Applications',
  background: 'Background',
  objectsOfInvention: 'Objects of the Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals',
  // PCT/JP specific
  technicalProblem: 'Technical Problem',
  technicalSolution: 'Technical Solution',
  advantageousEffects: 'Advantageous Effects'
}

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract' },
  { keys: ['fieldOfInvention'], label: 'Technical Field' },
  { keys: ['background'], label: 'Background' },
  { keys: ['summary', 'briefDescriptionOfDrawings'], label: 'Summary + Brief Description' },
  { keys: ['detailedDescription', 'bestMethod'], label: 'Detailed Description + Best Mode' },
  { keys: ['industrialApplicability'], label: 'Industrial Applicability' },
  { keys: ['claims', 'listOfNumerals'], label: 'Claims + List of Reference Numerals' }
]

export default function AnnexureDraftStage({ session, patent, onComplete, onRefresh }: AnnexureDraftStageProps) {
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [debugSteps, setDebugSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [usePersonaStyle, setUsePersonaStyle] = useState<boolean>(false) // OFF by default
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null)
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({})
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({})
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({})
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({})
  const [activeJurisdiction, setActiveJurisdiction] = useState<string>(() => (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN'))
  const [sourceOfTruth, setSourceOfTruth] = useState<string>(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
      : ['IN']
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    if (preferred && list.includes(preferred)) return preferred
    const active = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    if (active && list.includes(active)) return active
    return list[0] || 'IN'
  })
  const [languageByCode, setLanguageByCode] = useState<Record<string, string>>({})
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [availableCountriesError, setAvailableCountriesError] = useState<string | null>(null)
  const [selectedAddCode, setSelectedAddCode] = useState<string>('')
  const [addingJurisdiction, setAddingJurisdiction] = useState<boolean>(false)
  const [deletingJurisdiction, setDeletingJurisdiction] = useState<string | null>(null)
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null)
  const [profileLoading, setProfileLoading] = useState<boolean>(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState<boolean>(false)
  
  // Activity Panel Visibility
  const [showActivity, setShowActivity] = useState(true)
  
  // Debug Panel for B+T+U (Base + TopUp + User prompts)
  const [showDebugPanel, setShowDebugPanel] = useState(true)
  const [promptInjectionInfo, setPromptInjectionInfo] = useState<Record<string, { B: boolean; T: boolean; U: boolean; source: string | null; key: string; strategy: string }>>({})

  // Text Formatting
  const [showFormatting, setShowFormatting] = useState(false)
  const [fontFamily, setFontFamily] = useState('serif')
  const [fontSize, setFontSize] = useState('15px')
  
  // User Instructions
  const [userInstructions, setUserInstructions] = useState<Record<string, Record<string, any>>>({}) // { jurisdiction: { sectionKey: instruction } }
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null)
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false)
  const [lineHeight, setLineHeight] = useState('1.7')

  // Data for figures
  const figurePlans = useMemo(() => Array.isArray(session?.figurePlans) ? session.figurePlans : [], [session?.figurePlans])
  const diagramSources = useMemo(() => Array.isArray(session?.diagramSources) ? session.diagramSources : [], [session?.diagramSources])

  const copySection = async (key: string) => {
    try {
      const text = generated?.[key] || ''
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {}
  }

  const availableJurisdictions: string[] = useMemo(() => {
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions
      : []
    return list.map((c: string) => (c || '').toUpperCase())
  }, [session?.draftingJurisdictions])

  const latestDrafts = useMemo(() => {
    const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
    const map: Record<string, any> = {}
    drafts.forEach((d: any) => {
      const code = (d?.jurisdiction || 'IN').toUpperCase()
      if (!map[code] || (d.version || 0) > (map[code].version || 0)) {
        map[code] = d
      }
    })
    return map
  }, [session?.annexureDrafts])
  const isMultiJurisdiction = availableJurisdictions.length > 1

  const addableCountries = useMemo(
    () => availableCountries.filter(c => !availableJurisdictions.includes(c.code)),
    [availableCountries, availableJurisdictions]
  )

  const persistStageState = async (opts: {
    jurisdictions?: string[]
    active?: string
    source?: string
    languageMap?: Record<string, string>
  }) => {
    if (!session?.id) return
    const nextJurisdictions = opts.jurisdictions || availableJurisdictions
    const payload: any = {
      action: 'set_stage',
      sessionId: session.id,
      stage: session?.status || 'ANNEXURE_DRAFT',
      draftingJurisdictions: nextJurisdictions,
      activeJurisdiction: opts.active || activeJurisdiction,
      languageByJurisdiction: opts.languageMap || languageByCode,
      sourceOfTruth: opts.source || sourceOfTruth
    }
    await onComplete(payload)
    await onRefresh()
  }

  const handleSourceChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setSourceOfTruth(normalized)
    const reordered = [normalized, ...availableJurisdictions.filter(c => c !== normalized)]
    await persistStageState({ source: normalized, jurisdictions: reordered })
  }

  const handleLanguageChange = async (code: string, lang: string) => {
    const normalized = (code || '').toUpperCase()
    setLanguageByCode(prev => ({ ...prev, [normalized]: lang }))
    await persistStageState({ languageMap: { ...languageByCode, [normalized]: lang } })
  }

  const handleAddJurisdiction = async () => {
    if (!selectedAddCode || !session?.id) return
    if (availableJurisdictions.includes(selectedAddCode)) return
    try {
      setAddingJurisdiction(true)
      const country = availableCountries.find(c => c.code === selectedAddCode)
      const preferredLang = languageByCode[selectedAddCode] || country?.languages?.[0]
      const nextLanguageMap = preferredLang ? { ...languageByCode, [selectedAddCode]: preferredLang } : { ...languageByCode }
      setLanguageByCode(nextLanguageMap)
      const nextList = [...availableJurisdictions, selectedAddCode]
      await persistStageState({
        jurisdictions: nextList,
        active: selectedAddCode,
        source: sourceOfTruth || nextList[0],
        languageMap: nextLanguageMap
      })
      setActiveJurisdiction(selectedAddCode)
    } finally {
      setAddingJurisdiction(false)
    }
  }

  const handleDeleteDraft = async (code: string, removeFromList: boolean = false) => {
    if (!session?.id) return
    const normalized = (code || '').toUpperCase()
    try {
      setDeletingJurisdiction(normalized)
      await onComplete({
        action: 'delete_annexure_draft',
        sessionId: session.id,
        jurisdiction: normalized,
        removeFromList
      })
      // Optimistically update local active/source to reflect removal/clear
      const remaining = removeFromList
        ? availableJurisdictions.filter(c => c !== normalized)
        : availableJurisdictions
      if (removeFromList && remaining.length > 0) {
        const next = remaining[0]
        setActiveJurisdiction(next)
        setSourceOfTruth(prev => (remaining.includes(prev) ? prev : next))
      }
      // Clear the generated state for the deleted jurisdiction to prevent stale data
      if (activeJurisdiction === normalized) {
        setGenerated({})
      }
      await onRefresh()
    } finally {
      setDeletingJurisdiction(null)
    }
  }

  // Initialize from latest saved draft for the active jurisdiction
  useEffect(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const latest = latestDrafts[code]

    if (latest) {
      // Get extraSections from dedicated column OR legacy validationReport location
      const extraSections = (latest as any).extraSections || (latest.validationReport as any)?.extraSections || {}
      
      const initial: Record<string, string> = {
        // Legacy columns (dedicated DB fields)
        title: latest.title || '',
        fieldOfInvention: latest.fieldOfInvention || '',
        background: latest.background || '',
        summary: latest.summary || '',
        briefDescriptionOfDrawings: latest.briefDescriptionOfDrawings || '',
        detailedDescription: latest.detailedDescription || '',
        bestMethod: latest.bestMethod || '',
        industrialApplicability: latest.industrialApplicability || '',
        claims: latest.claims || '',
        abstract: latest.abstract || '',
        listOfNumerals: latest.listOfNumerals || '',
        // Extra sections (JSON column for scalable storage)
        crossReference: extraSections.crossReference || '',
        preamble: extraSections.preamble || '',
        objectsOfInvention: extraSections.objectsOfInvention || '',
        technicalProblem: extraSections.technicalProblem || '',
        technicalSolution: extraSections.technicalSolution || '',
        advantageousEffects: extraSections.advantageousEffects || '',
        modeOfCarryingOut: extraSections.modeOfCarryingOut || ''
      }
      setGenerated(initial)
    } else {
      setGenerated({})
    }
  }, [latestDrafts, activeJurisdiction])

  // Sync active jurisdiction when session updates
  useEffect(() => {
    const nextJurisdiction = session?.activeJurisdiction || session?.draftingJurisdictions?.[0]
    if (nextJurisdiction && nextJurisdiction !== activeJurisdiction) {
      setActiveJurisdiction(nextJurisdiction)
    }
  }, [session?.activeJurisdiction, session?.draftingJurisdictions])

  // Keep source-of-truth in sync
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    const fallbackActive = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    const resolved = preferred && availableJurisdictions.includes(preferred)
      ? preferred
      : (fallbackActive && availableJurisdictions.includes(fallbackActive)
        ? fallbackActive
        : (availableJurisdictions[0] || sourceOfTruth))
    setSourceOfTruth(resolved || 'IN')
  }, [session?.jurisdictionDraftStatus, session?.activeJurisdiction, availableJurisdictions, sourceOfTruth])

  // Load available country profiles
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setAvailableCountriesError(null)
        const res = await fetch('/api/country-profiles', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => a.label.localeCompare(b.label))
        setAvailableCountries(countries)
      } catch (err) {
        console.error('Failed to load country profiles (Annexure stage)', err)
        setAvailableCountriesError('Failed to load jurisdiction catalog. You can still draft with existing selections.')
      }
    }
    fetchCountries()
  }, [])

  // Maintain language preferences
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    setLanguageByCode(prev => {
      const next: Record<string, string> = {}
      availableJurisdictions.forEach(code => {
        const saved = status?.[code]?.language
        const country = availableCountries.find(c => c.code === code)
        const defaultLang = country?.languages?.[0] || ''
        next[code] = saved || prev[code] || defaultLang
      })
      return next
    })
  }, [session?.jurisdictionDraftStatus, availableCountries, availableJurisdictions])

  // Load user instructions for the session
  useEffect(() => {
    const loadUserInstructions = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting/user-instructions?sessionId=${session.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setUserInstructions(data.grouped || {})
        }
      } catch (err) {
        console.error('Failed to load user instructions:', err)
      }
    }
    loadUserInstructions()
  }, [session?.id, patent?.id])

  // Keep add-jurisdiction dropdown updated
  useEffect(() => {
    const addable = availableCountries.filter(c => !availableJurisdictions.includes(c.code))
    if (!selectedAddCode || !addable.find(c => c.code === selectedAddCode)) {
      setSelectedAddCode(addable[0]?.code || '')
    }
  }, [availableCountries, availableJurisdictions, selectedAddCode])

  useEffect(() => {
    if (!selectedAddCode) return
    const country = availableCountries.find(c => c.code === selectedAddCode)
    if (!country) return
    setLanguageByCode(prev => {
      if (prev[selectedAddCode]) return prev
      const lang = country.languages?.[0]
      if (!lang) return prev
      return { ...prev, [selectedAddCode]: lang }
    })
  }, [selectedAddCode, availableCountries])

  // Load country profile to drive section layout
  useEffect(() => {
    const loadProfile = async () => {
      if (!activeJurisdiction) return
      setProfileLoading(true)
      setProfileError(null)
      try {
        const res = await fetch(`/api/country-profiles/${activeJurisdiction}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profile (${res.status})`)
        const data = await res.json()
        const profile = data?.profile
        const variant = profile?.structure?.variants?.find((v: any) => v.id === profile?.structure?.defaultVariant) || profile?.structure?.variants?.[0]
        const sections: SectionConfig[] = []
        const canonicalMap: Record<string, string> = {
          title: 'title',
          technical_field: 'fieldOfInvention',
          field_of_invention: 'fieldOfInvention',
          field: 'fieldOfInvention',
          cross_reference: 'crossReference',
          background: 'background',
          background_art: 'background',
          objects: 'objectsOfInvention',
          objects_of_invention: 'objectsOfInvention',
          objectsofinvention: 'objectsOfInvention',
          summary_of_invention: 'summary',
          summary: 'summary',
          brief_drawings: 'briefDescriptionOfDrawings',
          brief_description_of_drawings: 'briefDescriptionOfDrawings',
          description: 'detailedDescription',
          detailed_description: 'detailedDescription',
          best_mode: 'bestMethod',
          best_method: 'bestMethod',
          industrial_applicability: 'industrialApplicability',
          utility: 'industrialApplicability',
          claims: 'claims',
          abstract: 'abstract',
          reference_numerals: 'listOfNumerals',
          reference_signs: 'listOfNumerals',
          list_of_numerals: 'listOfNumerals',
          // PCT/JP specific
          technical_problem: 'technicalProblem',
          technical_solution: 'technicalSolution',
          advantageous_effects: 'advantageousEffects'
        }
        const promptSections = profile?.prompts?.sections || {}
        if (variant?.sections?.length) {
          for (const sec of variant.sections) {
            const keys = (sec.canonicalKeys || []).map((k: string) => k.toLowerCase())
            let mapped: string | undefined
            for (const k of keys) {
              if (canonicalMap[k]) { mapped = canonicalMap[k]; break }
            }
            if (!mapped && canonicalMap[sec.id]) mapped = canonicalMap[sec.id]
            if (!mapped) continue
            sections.push({
              keys: [mapped],
              label: sec.label || sec.id,
              description: sec.description || sec.ui?.helpText || '',
              constraints: promptSections?.[sec.id]?.constraints || [],
              required: Boolean(sec.required)
            })
          }
        }
        if (sections.length > 0) {
          setSectionConfigs(sections)
          setUsingFallback(false)
        } else {
          setSectionConfigs(fallbackSections)
          setUsingFallback(true)
        }
      } catch (err) {
        console.error('Failed to load jurisdiction profile', err)
        setProfileError('Failed to load country-specific sections; using default layout.')
        setSectionConfigs(fallbackSections)
        setUsingFallback(true)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [activeJurisdiction])

  const handleJurisdictionChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setActiveJurisdiction(normalized)
    if (!session?.id) return
    try {
      await persistStageState({ active: normalized })
    } catch (err) {
      console.error('Failed to persist jurisdiction change', err)
    }
  }

  const handleGenerate = async (keys: string[]) => {
    if (loading) return
    setLoading(true)
    setShowActivity(true)
    setCurrentKeys(keys)
    try {
      const sections = keys.filter(Boolean)
      const res = await onComplete({
        action: 'generate_sections',
        sessionId: session?.id,
        sections,
        usePersonaStyle,
        jurisdiction: activeJurisdiction
      })
      const incoming = res?.generated || {}
      const filtered: Record<string, string> = {}
      Object.entries(incoming).forEach(([k, v]) => {
        if (typeof v === 'string' && v.trim()) filtered[k] = v.trim()
      })
      setGenerated(prev => ({ ...prev, ...filtered }))
      setDebugSteps(res?.debugSteps || [])
      
      // Extract B+T+U prompt injection info from debug steps
      const steps = res?.debugSteps || []
      const injectionInfo: Record<string, any> = {}
      steps.forEach((step: any) => {
        if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
          const sectionKey = step.step.replace('build_prompt_', '')
          injectionInfo[sectionKey] = step.meta.promptInjection
        }
      })
      if (Object.keys(injectionInfo).length > 0) {
        setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
      }
    } catch (error) {
      console.error('Generation failed:', error)
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setLoading(false)
      // Optionally hide activity after a delay
      // setTimeout(() => setShowActivity(false), 5000)
    }
  }

  const handleApproveSave = async (keys: string[]) => {
    const patch: Record<string, string> = {}
    for (const k of keys) if (generated?.[k]) patch[k] = generated[k]
    if (Object.keys(patch).length === 0) return
    await onComplete({ action: 'save_sections', sessionId: session?.id, patch })
    await onRefresh()
  }

  const handleAutosaveSection = async (key: string) => {
    const value = (editDrafts?.[key] ?? generated?.[key] ?? '').trim()
    if (!value) return
    setGenerated(prev => ({ ...prev, [key]: value }))
    await onComplete({ action: 'autosave_sections', sessionId: session?.id, patch: { [key]: value } })
    setEditingKey(null)
  }

  const handleRegenerateSection = async (key: string) => {
    if (sectionLoading[key]) return
    setSectionLoading(prev => ({ ...prev, [key]: true }))
    setShowActivity(true)
    try {
      const instructions: Record<string, string> = {}
      if (regenRemarks[key]) instructions[key] = regenRemarks[key]
      const res = await onComplete({
        action: 'generate_sections',
        sessionId: session?.id,
        sections: [key],
        instructions,
        usePersonaStyle,
        jurisdiction: activeJurisdiction
      })
      const incoming = res?.generated || {}
      const value = typeof incoming?.[key] === 'string' ? incoming[key].trim() : ''
      if (value) setGenerated(prev => ({ ...prev, [key]: value }))
      setDebugSteps(res?.debugSteps || [])
      setRegenOpen(prev => ({ ...prev, [key]: false }))
      setRegenRemarks(prev => ({ ...prev, [key]: '' }))
      
      // Extract B+T+U prompt injection info from debug steps
      const steps = res?.debugSteps || []
      const injectionInfo: Record<string, any> = {}
      steps.forEach((step: any) => {
        if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
          const sectionKey = step.step.replace('build_prompt_', '')
          injectionInfo[sectionKey] = step.meta.promptInjection
        }
      })
      if (Object.keys(injectionInfo).length > 0) {
        setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
      }
    } catch (error) {
      console.error('Regeneration failed:', error)
      alert(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // If no jurisdictions are available, show a message instead of defaulting to IN
  if (availableJurisdictions.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-gray-500 mb-4">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Jurisdictions Available</h3>
        <p className="text-gray-500 mb-4">All patent jurisdictions have been removed from this drafting session.</p>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div className="pb-24 pt-8 bg-[#F5F6F7] min-h-screen">
      {/* Top Controls Bar */}
      <div className="max-w-[850px] mx-auto mb-6 px-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Annexure Draft</h2>
          <p className="text-sm text-gray-500">Review and edit your patent application.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
           {/* AI Persona Toggle with Writing Samples */}
           <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm border transition-colors ${
             usePersonaStyle 
               ? 'bg-emerald-50 border-emerald-300' 
               : 'bg-red-50 border-red-200'
           }`}>
            <button
              onClick={() => setUsePersonaStyle(!usePersonaStyle)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                usePersonaStyle ? 'bg-emerald-500' : 'bg-red-400'
              }`}
              title={usePersonaStyle ? 'Style mimicry is ON' : 'Style mimicry is OFF'}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                usePersonaStyle ? 'left-5' : 'left-0.5'
              }`} />
            </button>
            <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-red-600'}`}>
              {usePersonaStyle ? '✓ Style ON' : '○ Style OFF'}
            </span>
            {/* Selected Persona Display */}
            {personaSelection?.primaryPersonaName && (
              <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-100 rounded">
                {personaSelection.primaryPersonaName}
                {personaSelection.secondaryPersonaNames?.length ? ` +${personaSelection.secondaryPersonaNames.length}` : ''}
              </span>
            )}
            <button
              onClick={() => setShowPersonaManager(true)}
              className="px-2 py-0.5 text-xs rounded bg-blue-50 border border-blue-300 text-blue-600 hover:bg-blue-100"
              title="Select writing persona (CSE, Bio, etc.)"
            >
              👤 Persona
            </button>
            <button
              onClick={() => setShowWritingSamplesModal(true)}
              className="px-2 py-0.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="Manage writing samples"
            >
              ✍️ Samples
            </button>
          </div>

          {/* Clear/Delete controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleDeleteDraft(activeJurisdiction, false)}
              disabled={loading || deletingJurisdiction === activeJurisdiction}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              title="Clear the generated draft for the active jurisdiction but keep it selected."
            >
              {deletingJurisdiction === activeJurisdiction ? 'Clearing…' : `Clear draft (${activeJurisdiction})`}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteDraft(activeJurisdiction, true)}
              disabled={loading || deletingJurisdiction === activeJurisdiction}
              className="inline-flex items-center rounded-md border border-red-500 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
              title="Delete the draft and remove this jurisdiction from the drafting list."
            >
              {deletingJurisdiction === activeJurisdiction ? 'Deleting…' : `Delete & remove (${activeJurisdiction})`}
            </button>
          </div>

          {/* Custom Instructions Button */}
          <button
            onClick={() => setShowAllInstructionsModal(true)}
            className={`p-2 rounded-full shadow-sm border transition-colors relative ${
              Object.keys(userInstructions).length > 0
                ? 'bg-violet-50 border-violet-200 text-violet-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            title="Custom Instructions"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            {Object.keys(userInstructions).length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-violet-500 rounded-full text-[8px] text-white flex items-center justify-center">
                {Object.values(userInstructions).reduce((sum, j) => sum + Object.keys(j).length, 0)}
              </span>
            )}
          </button>

          {/* Formatting Button */}
          <div className="relative">
            <button
              onClick={() => setShowFormatting(!showFormatting)}
              className={`p-2 rounded-full shadow-sm border transition-colors ${
                showFormatting
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              title="Text Formatting"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>

            {/* Formatting Panel */}
            {showFormatting && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Font Family</label>
                    <select
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="serif">Serif (Times New Roman)</option>
                      <option value="sans-serif">Sans Serif (Arial)</option>
                      <option value="monospace">Monospace (Courier)</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="system-ui, sans-serif">System UI</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Font Size</label>
                    <select
                      value={fontSize}
                      onChange={(e) => setFontSize(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="12px">Small (12px)</option>
                      <option value="14px">Medium (14px)</option>
                      <option value="15px">Default (15px)</option>
                      <option value="16px">Large (16px)</option>
                      <option value="18px">Extra Large (18px)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Line Spacing</label>
                    <select
                      value={lineHeight}
                      onChange={(e) => setLineHeight(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="1.3">Compact (1.3)</option>
                      <option value="1.5">Normal (1.5)</option>
                      <option value="1.7">Relaxed (1.7)</option>
                      <option value="1.9">Spacious (1.9)</option>
                      <option value="2.1">Very Spacious (2.1)</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-gray-100">
                    <button
                      onClick={() => setShowFormatting(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMultiJurisdiction && (
        <div className="max-w-[850px] mx-auto mb-8 px-8">
          <div className="border border-gray-200 rounded-lg bg-white shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Jurisdictions</div>
            <div className="flex flex-wrap gap-2">
              {availableJurisdictions.map((code) => (
                <button
                  key={code}
                  onClick={() => handleJurisdictionChange(code)}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                    code === activeJurisdiction
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {code}
                  {code === sourceOfTruth && <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">Source</span>}
                </button>
              ))}
              {/* Add jurisdiction logic hidden in simple UI for now or expandable */}
            </div>
          </div>
        </div>
      )}

      {/* B+T+U Debug Panel - Testing Only */}
      {showDebugPanel && (
        <div className="max-w-[850px] mx-auto mb-4 px-8">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">DEBUG</span>
                <h3 className="text-sm font-semibold text-white">Prompt Injection Status (B+T+U)</h3>
              </div>
              <button
                onClick={() => setShowDebugPanel(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Hide ✕
              </button>
            </div>
            
            {/* Legend */}
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">B</span>
                <span className="text-slate-300">Base (Superset)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-amber-500 text-white font-bold flex items-center justify-center text-[10px]">T</span>
                <span className="text-slate-300">TopUp (Country)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-emerald-500 text-white font-bold flex items-center justify-center text-[10px]">U</span>
                <span className="text-slate-300">User Instructions</span>
              </div>
              <div className="flex items-center gap-1.5 ml-4">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400"></span>
                <span className="text-slate-400 text-[10px]">DB</span>
                <span className="inline-block w-2 h-2 rounded-full bg-violet-400 ml-2"></span>
                <span className="text-slate-400 text-[10px]">JSON</span>
              </div>
            </div>
            
            {/* Section Status Grid */}
            <div className="flex flex-wrap gap-2">
              {Object.keys(promptInjectionInfo).length === 0 ? (
                <div className="text-slate-500 text-xs italic">Generate sections to see prompt injection status...</div>
              ) : (
                Object.entries(promptInjectionInfo).map(([key, info]) => (
                  <div key={key} className="bg-slate-700/50 rounded px-2 py-1.5 flex items-center gap-1.5" title={`Key: ${info.key}, Strategy: ${info.strategy}`}>
                    <span className="text-slate-300 text-[10px] font-mono mr-1">{key.substring(0, 12)}{key.length > 12 ? '…' : ''}</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.B ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-400'}`}>B</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.T ? 'bg-amber-500 text-white' : 'bg-slate-600 text-slate-400'}`}>T</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.U ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-slate-400'}`}>U</span>
                    {info.T && info.source && (
                      <span className={`inline-block w-2 h-2 rounded-full ${info.source === 'db' ? 'bg-cyan-400' : 'bg-violet-400'}`} title={`Source: ${info.source}`}></span>
                    )}
                  </div>
                ))
              )}
            </div>
            
            {/* Active Profile Info */}
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="flex items-center gap-4 text-xs">
                <div className="text-slate-400">
                  <span className="text-slate-500">Active:</span>{' '}
                  <span className="text-emerald-400 font-semibold">{activeJurisdiction}</span>
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-500">Sections:</span>{' '}
                  <span className="text-white">{sectionConfigs?.length || 0}</span>
                  {usingFallback && <span className="text-amber-400 ml-1">(fallback)</span>}
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-500">Prompts Tracked:</span>{' '}
                  <span className="text-white">{Object.keys(promptInjectionInfo).length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Toggle Debug Panel (if hidden) */}
      {!showDebugPanel && (
        <div className="max-w-[850px] mx-auto mb-2 px-8">
          <button
            onClick={() => setShowDebugPanel(true)}
            className="text-xs text-slate-400 hover:text-slate-600 font-mono"
          >
            [Show B+T+U Debug Panel]
          </button>
        </div>
      )}

      {/* The "Paper" Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[1100px] px-[60px] py-[60px] relative border border-gray-100">

        {profileLoading && (
          <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500">
               <span className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full"></span>
               Loading template...
            </div>
          </div>
        )}

        <div className="space-y-10">
            {(sectionConfigs || fallbackSections).map((section, idx) => {
              const isGeneratingThis = loading && currentKeys?.join('|') === section.keys.join('|')
              const isRegeneratingThis = section.keys.some(k => sectionLoading[k])
              const isWorking = isGeneratingThis || isRegeneratingThis
              const hasContent = section.keys.some(k => generated?.[k])

              return (
              <div key={section.keys.join('|') || idx} className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg">
                {/* Hover Actions (Floating) */}
                <div className={`absolute -right-4 top-0 transform translate-x-full opacity-0 group-hover:opacity-100 transition-opacity pl-2 ${isWorking ? 'opacity-100' : ''}`}>
                   <div className="flex flex-col gap-1 bg-white border border-gray-200 shadow-sm rounded-md p-1">
                      {!hasContent ? (
                         <button
                           disabled={loading}
                           onClick={() => handleGenerate(section.keys)}
                           className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-md"
                           title="Generate"
                         >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApproveSave(section.keys)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-md"
                            title="Save"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button
                             onClick={() => {
                               const key = section.keys[0] // Default to first key for simple edit trigger
                               setEditingKey(editingKey === key ? null : key)
                               setEditDrafts(prev => ({ ...prev, [key]: generated?.[key] || '' }))
                             }}
                             className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
                             title="Edit"
                          >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </>
                      )}
                   </div>
                </div>

                {/* Section Header */}
                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                  </h3>
                    {/* Per-section instruction controls */}
                    {(() => {
                      const key = section.keys[0]
                      const jurisdictionInstr = userInstructions[activeJurisdiction]?.[key]
                      const globalInstr = userInstructions['*']?.[key]
                      const hasInstruction = jurisdictionInstr || globalInstr
                      const activeInstr = jurisdictionInstr || globalInstr
                      const isActive = activeInstr?.isActive !== false
                      
                      return (
                        <div className="relative flex items-center gap-1">
                          {/* Quick toggle button - only show if instruction exists */}
                          {hasInstruction && (
                            <button
                              onClick={async () => {
                                const instr = jurisdictionInstr || globalInstr
                                if (!instr) return
                                const newStatus = !isActive
                                try {
                                  await fetch(`/api/patents/${patent?.id}/drafting/user-instructions`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                                    },
                                    body: JSON.stringify({
                                      sessionId: session?.id,
                                      sectionKey: key,
                                      jurisdiction: instr.jurisdiction || (jurisdictionInstr ? activeJurisdiction : '*'),
                                      instruction: instr.instruction,
                                      emphasis: instr.emphasis,
                                      avoid: instr.avoid,
                                      style: instr.style,
                                      wordCount: instr.wordCount,
                                      isActive: newStatus
                                    })
                                  })
                                  // Update local state
                                  const jur = jurisdictionInstr ? activeJurisdiction : '*'
                                  setUserInstructions(prev => ({
                                    ...prev,
                                    [jur]: {
                                      ...(prev[jur] || {}),
                                      [key]: { ...instr, isActive: newStatus }
                                    }
                                  }))
                                } catch (err) {
                                  console.error('Failed to toggle instruction:', err)
                                }
                              }}
                              className={`p-1 rounded transition-colors ${
                                isActive 
                                  ? 'text-emerald-600 hover:bg-emerald-50' 
                                  : 'text-gray-400 hover:bg-gray-100'
                              }`}
                              title={isActive ? 'Click to disable instruction' : 'Click to enable instruction'}
                            >
                              {isActive ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor">
                                  <circle cx="10" cy="10" r="7" strokeWidth="1.5" />
                                </svg>
                              )}
                            </button>
                          )}
                          
                          {/* Edit/Add instruction button */}
                          <button
                            onClick={() => setInstructionPopoverKey(instructionPopoverKey === key ? null : key)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              hasInstruction
                                ? isActive
                                  ? 'text-violet-600 bg-violet-50 hover:bg-violet-100'
                                  : 'text-gray-400 bg-gray-100 hover:bg-gray-200 line-through'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                            title={
                              hasInstruction 
                                ? isActive 
                                  ? `Custom instruction for ${jurisdictionInstr ? activeJurisdiction : 'all jurisdictions'} (active)`
                                  : `Custom instruction (disabled)`
                                : 'Add custom instruction'
                            }
                          >
                            <svg className="w-4 h-4" fill={hasInstruction ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
                          
                          {/* Instruction Popover */}
                          {instructionPopoverKey === key && (
                            <SectionInstructionPopover
                              sectionKey={key}
                              sectionLabel={section.label || displayName[key] || key}
                              sessionId={session?.id || ''}
                              patentId={patent?.id || ''}
                              activeJurisdiction={activeJurisdiction}
                              existingInstruction={jurisdictionInstr || null}
                              globalInstruction={globalInstr || null}
                              onSave={(instr) => {
                                const jur = instr.jurisdiction || '*'
                                setUserInstructions(prev => ({
                                  ...prev,
                                  [jur]: {
                                    ...(prev[jur] || {}),
                                    [key]: instr.instruction ? instr : undefined
                                  }
                                }))
                              }}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Activity Panel Injection */}
                  {isWorking && showActivity && (
                      <div className="ml-4 transform scale-90 origin-right">
                        <BackendActivityPanel
                          isVisible={true}
                          onClose={() => setShowActivity(false)}
                          steps={(Array.isArray(debugSteps) ? debugSteps : []).map((s: any) => ({
                            id: String(s.step || ''),
                            state: s.status === 'fail' ? 'error' : (s.status || 'running')
                          }))}
                        />
                      </div>
                  )}
                </div>

                {/* Content Area */}
                <div className="text-gray-800 text-justify">
                  {!hasContent && !isWorking ? (
                    <div 
                      onClick={() => handleGenerate(section.keys)}
                      className="border-2 border-dashed border-gray-100 rounded-lg p-8 text-center hover:border-indigo-100 hover:bg-indigo-50/30 transition-all cursor-pointer group/empty"
                    >
                       <div className="text-gray-400 group-hover/empty:text-indigo-400 font-medium mb-1">Section not generated</div>
                       <div className="text-xs text-gray-300 group-hover/empty:text-indigo-300">Click to draft with AI</div>
                    </div>
                  ) : (
                    <div>
                      {section.keys.map(keyName => (
                        <div key={keyName} className="mb-6 last:mb-0">
                          {section.keys.length > 1 && (
                             <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-4">{displayName[keyName] || keyName}</h4>
                          )}
                          
                          {/* Toolbar for each section text */}
                          {generated?.[keyName] && (
                             <div className="flex items-center justify-end gap-1 mb-2">
                               <button
                                 onClick={() => copySection(keyName)}
                                 className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                                 title={copiedKey === keyName ? "Copied" : "Copy to clipboard"}
                               >
                                  {copiedKey === keyName ? <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>}
                               </button>
                               <button
                                 onClick={() => !sectionLoading[keyName] && setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                 className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                 title="Regenerate"
                                 disabled={sectionLoading[keyName]}
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                               </button>
                               <button
                                 onClick={() => { setEditingKey(editingKey === keyName ? null : keyName); setEditDrafts(prev => ({ ...prev, [keyName]: generated?.[keyName] || '' })) }}
                                 className={`p-1.5 rounded transition-colors ${editingKey === keyName ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                                 title="Edit"
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                               </button>
                             </div>
                          )}
                          
                          {editingKey === keyName ? (
                            <div className="relative">
                              <textarea
                                className="w-full border-0 bg-gray-50 p-4 rounded-md text-gray-800 focus:ring-1 focus:ring-indigo-200 resize-none text-justify"
                                style={{
                                  fontFamily,
                                  fontSize,
                                  lineHeight
                                }}
                                value={editDrafts[keyName] ?? generated[keyName] ?? ''}
                                onChange={(e) => setEditDrafts(prev => ({ ...prev, [keyName]: e.target.value }))}
                                rows={Math.max(6, (generated[keyName] || '').split('\n').length)}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setEditingKey(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1">Cancel</button>
                                <button onClick={() => handleAutosaveSection(keyName)} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded shadow-sm hover:bg-indigo-700">Save</button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <div className="whitespace-pre-wrap text-justify"
                                   style={{
                                     fontFamily,
                                     fontSize,
                                     lineHeight
                                   }}>
                                {generated[keyName] || (isWorking ? <span className="text-gray-300 animate-pulse">Drafting content...</span> : '')}
                              </div>

                              {/* Inline Regeneration Dialog */}
                              {regenOpen[keyName] && (
                                <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1 bg-indigo-100 rounded-md">
                                       <svg className="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    </div>
                                    <label className="block text-xs font-semibold text-indigo-900">Refinement Instructions</label>
                                  </div>
                                  <textarea
                                    className="w-full border-indigo-200 rounded-md p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                                    value={regenRemarks[keyName] || ''}
                                    onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                    placeholder="Tell the AI what to improve (e.g. 'Make it more concise', 'Expand on the benefits', 'Fix the claim dependencies')..."
                                    rows={3}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded transition-colors border border-transparent hover:border-gray-200">Cancel</button>
                                    <button 
                                      onClick={() => handleRegenerateSection(keyName)} 
                                      disabled={sectionLoading[keyName]}
                                      className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm disabled:opacity-50 flex items-center gap-2"
                                    >
                                      {sectionLoading[keyName] && <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>}
                                      {sectionLoading[keyName] ? 'Refining...' : 'Regenerate Section'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )})}

            {/* Drawings Section */}
            <div className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg mt-16 break-before-page">
               <div className="flex items-baseline justify-between mb-8">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    Drawings
                  </h3>
               </div>
               
               <div className="space-y-16">
                 {figurePlans.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-lg">
                      <div className="text-gray-400 font-medium mb-1">No figures defined</div>
                      <div className="text-xs text-gray-300">Define figures in the Planner stage to see them here.</div>
                    </div>
                 ) : (
                   figurePlans.map((plan: any) => {
                     const source = diagramSources.find((d: any) => d.figureNo === plan.figureNo)
                     
                     // PRIORITIZE STORED IMAGES OVER LIVE RENDERING
                     let imgUrl = null
                     
                     if (source?.imageFilename) {
                       // Use uploaded/stored image
                       imgUrl = `/api/projects/${patent.project.id}/patents/${patent.id}/upload?filename=${encodeURIComponent(source.imageFilename)}`
                     } else if (source?.plantuml) {
                       // Fallback to live render if no stored image
                       try {
                         const encoded = plantumlEncoder.encode(source.plantuml)
                         imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
                       } catch (e) {
                         console.error('Failed to encode plantuml', e)
                       }
                     }
                     
                     return (
                       <div key={plan.figureNo} className="flex flex-col items-center break-inside-avoid">
                         <div className="w-full max-w-3xl bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center bg-gray-50/50 p-4">
                            {imgUrl ? (
                              <img 
                                src={imgUrl} 
                                alt={`Figure ${plan.figureNo}`}
                                className="max-w-full max-h-[600px] object-contain mix-blend-multiply"
                                loading="lazy"
                              />
                            ) : (
                              <div className="text-center p-8 text-gray-400 flex flex-col items-center">
                                <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                <span className="text-sm font-medium">Figure {plan.figureNo}</span>
                                <span className="text-xs opacity-75 mt-1">Draft pending</span>
                              </div>
                            )}
                         </div>
                         <div className="mt-4 text-center max-w-xl">
                           <div className="font-bold text-gray-900 uppercase tracking-widest text-sm">FIG. {plan.figureNo}</div>
                           {plan.title && <div className="text-sm text-gray-600 mt-1">{plan.title}</div>}
                         </div>
                       </div>
                     )
                   })
                 )}
               </div>
            </div>
        </div>
    </div>

      {/* All Instructions Modal */}
      {showAllInstructionsModal && (
        <AllInstructionsModal
          sessionId={session?.id || ''}
          patentId={patent?.id || ''}
          activeJurisdiction={activeJurisdiction}
          availableJurisdictions={availableJurisdictions}
          sectionLabels={displayName}
          onClose={() => setShowAllInstructionsModal(false)}
          onUpdate={() => {
            // Refresh instructions
            fetch(`/api/patents/${patent?.id}/drafting/user-instructions?sessionId=${session?.id}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
            })
              .then(res => res.json())
              .then(data => setUserInstructions(data.grouped || {}))
              .catch(console.error)
          }}
        />
      )}

      {/* Persona Manager Modal */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            setPersonaSelection(selection)
            if (selection.primaryPersonaId) {
              setUsePersonaStyle(true) // Auto-enable style when persona selected
            }
          }}
        />
      )}

      {/* Writing Samples Modal */}
      {showWritingSamplesModal && (
        <WritingSamplesModal
          onClose={() => setShowWritingSamplesModal(false)}
          onUpdate={() => {
            // Could refresh any UI state related to samples
          }}
        />
      )}
    </div>
  )
}
