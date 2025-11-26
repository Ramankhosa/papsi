'use client'

import { useEffect, useMemo, useState } from 'react'
import BackendActivityPanel from './BackendActivityPanel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

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
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals'
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
  const [usePersonaStyle, setUsePersonaStyle] = useState<boolean>(true)
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null)
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
      : ['IN']
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
      const initial: Record<string, string> = {
        title: latest.title || '',
        fieldOfInvention: latest.fieldOfInvention || '',
        crossReference: (latest.validationReport as any)?.extraSections?.crossReference || '',
        background: latest.background || '',
        summary: latest.summary || '',
        briefDescriptionOfDrawings: latest.briefDescriptionOfDrawings || '',
        detailedDescription: latest.detailedDescription || '',
        bestMethod: latest.bestMethod || '',
        industrialApplicability: latest.industrialApplicability || '',
        claims: latest.claims || '',
        abstract: latest.abstract || '',
        listOfNumerals: latest.listOfNumerals || ''
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
          list_of_numerals: 'listOfNumerals'
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
    } catch (error) {
      console.error('Regeneration failed:', error)
      alert(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Annexure Draft</h2>
          <p className="text-sm text-gray-600">Generate, review, and approve sections using the active jurisdiction's headings.</p>
        </div>
        <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
           <div className="flex items-center space-x-2">
            <Switch
              id="persona-style"
              checked={usePersonaStyle}
              onCheckedChange={setUsePersonaStyle}
              disabled={styleAvailable === false}
            />
            <Label htmlFor="persona-style" className="text-sm font-medium text-gray-700 cursor-pointer">
              Persona Style
            </Label>
          </div>
        </div>
      </div>

      {isMultiJurisdiction ? (
          <div className="mb-8 border border-gray-200 rounded-lg bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="text-sm font-semibold text-gray-800">Jurisdiction Runs</div>
              <div className="text-xs text-gray-500">Pick a source-of-truth draft, then iterate others one-by-one.</div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {availableJurisdictions.map((code) => {
                const isActive = code === activeJurisdiction
                const isSource = code === sourceOfTruth
                const countryMeta = availableCountries.find(c => c.code === code)
                const langs = countryMeta?.languages || []
                return (
                  <div key={code} className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => handleJurisdictionChange(code)}
                      className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition ${
                        isActive ? 'bg-indigo-50 border-indigo-300 text-indigo-800' : 'bg-white border-gray-200 text-gray-800 hover:border-indigo-300 hover:text-indigo-700'
                      }`}
                    >
                      <span className="font-semibold">{code}</span>
                      {isSource && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Source</span>}
                      {!isSource && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">Subsequent</span>}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-gray-900">
                      <input
                        type="radio"
                        name="source-of-truth"
                        checked={isSource}
                        onChange={() => handleSourceChange(code)}
                        className="text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                      />
                      Truth
                    </label>
                    {langs.length > 0 && (
                      <select
                        value={languageByCode[code] || langs[0]}
                        onChange={(e) => handleLanguageChange(code, e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                      >
                        {langs.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteDraft(code, false)}
                      disabled={deletingJurisdiction === code}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      title="Delete draft"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium text-gray-500">Add:</span>
              {availableCountriesError && (
                <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{availableCountriesError}</div>
              )}
              {addableCountries.length === 0 ? (
                <span className="text-gray-400">All available jurisdictions added.</span>
              ) : (
                <>
                  <select
                    className="border border-gray-300 rounded px-2 py-1 text-gray-700"
                    value={selectedAddCode}
                    onChange={(e) => setSelectedAddCode(e.target.value)}
                  >
                    {addableCountries.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddJurisdiction}
                    disabled={addingJurisdiction || !selectedAddCode}
                    className="px-3 py-1 rounded bg-white border border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  >
                    {addingJurisdiction ? 'Adding...' : 'Add'}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
           // Single Jurisdiction Header
           <div className="mb-8 flex items-center space-x-4">
              <div className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium border border-indigo-100">
                 Drafting for {activeJurisdiction}
              </div>
           </div>
        )}

        {profileLoading && (
          <div className="mb-6 text-sm text-gray-500 flex items-center gap-2 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-gray-400"></span>
            Loading country structure...
          </div>
        )}
        
        {!profileError && usingFallback && (
          <div className="mb-6 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-2">
            Using fallback section layout; country profile sections could not be mapped.
          </div>
        )}

        <div className="space-y-6">
            {(sectionConfigs || fallbackSections).map((section, idx) => {
              const isGeneratingThis = loading && currentKeys?.join('|') === section.keys.join('|')
              const isRegeneratingThis = section.keys.some(k => sectionLoading[k])
              const isWorking = isGeneratingThis || isRegeneratingThis

              return (
              <div key={section.keys.join('|') || idx} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
                <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-3 mb-1">
                       <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 truncate">
                         {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                       </h3>
                       {section.required && <span className="text-[10px] uppercase tracking-wider font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Required</span>}
                       {section.keys.some(k => generated?.[k]) && (
                         <span className="text-emerald-500 bg-emerald-50 rounded-full p-0.5">
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                         </span>
                       )}
                    </div>
                    
                    {/* Constraints & Description */}
                    {(section.description || (section.constraints && section.constraints.length > 0)) && (
                      <div className="text-sm text-gray-500 leading-relaxed">
                        {section.description}
                        {section.constraints && section.constraints.length > 0 && (
                          <span className="ml-2 text-xs text-gray-400">({section.constraints.join('; ')})</span>
                        )}
                      </div>
                    )}

                    {/* INJECTED ACTIVITY PANEL */}
                    {isWorking && showActivity && (
                       <div className="mt-3">
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

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!section.keys.some(k => generated?.[k]) ? (
                      <button
                        disabled={loading}
                        onClick={() => handleGenerate(section.keys)}
                        className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                      >
                        {isGeneratingThis ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                            </svg>
                            Drafting...
                          </>
                        ) : (
                          'Generate Draft'
                        )}
                      </button>
                    ) : (
                      <button
                        disabled={loading}
                        onClick={() => handleApproveSave(section.keys)}
                        className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        Approve & Save
                      </button>
                    )}
                  </div>
                </div>

                <div className="px-6 py-6 bg-gray-50/30">
                  {section.keys.map(keyName => (
                    <div className="mb-8 last:mb-0" key={keyName}>
                      {section.keys.length > 1 && (
                         <div className="flex items-center justify-between mb-2">
                           <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">{displayName[keyName] || keyName}</div>
                         </div>
                      )}
                      
                      {/* Toolbar for each section text */}
                      {generated?.[keyName] && (
                         <div className="flex items-center justify-end gap-1 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                        <div className="bg-white rounded-md shadow-sm border border-indigo-200 p-2">
                          <textarea
                            className="w-full border-0 focus:ring-0 text-sm text-gray-800 leading-relaxed p-2"
                            value={editDrafts[keyName] ?? generated[keyName] ?? ''}
                            onChange={(e) => setEditDrafts(prev => ({ ...prev, [keyName]: e.target.value }))}
                            rows={8}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-gray-100">
                            <button onClick={() => setEditingKey(null)} className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                            <button onClick={() => handleAutosaveSection(keyName)} className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm">Save Changes</button>
                          </div>
                        </div>
                      ) : (
                        <div className="group relative">
                          <textarea
                            className="w-full border-gray-200 bg-white rounded-lg text-sm text-gray-700 leading-relaxed p-4 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            value={generated[keyName] || ''}
                            onChange={(e) => setGenerated(prev => ({ ...prev, [keyName]: e.target.value }))}
                            rows={Math.max(4, (generated[keyName] || '').split('\n').length)}
                            placeholder="Section content will appear here..."
                            readOnly={!!regenOpen[keyName]}
                          />
                          
                          {/* Inline Regeneration Dialog */}
                          {regenOpen[keyName] && (
                            <div className="mt-3 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 animate-in fade-in zoom-in-95 duration-200">
                              <label className="block text-xs font-semibold text-indigo-900 mb-2">Refinement Instructions</label>
                              <textarea
                                className="w-full border-indigo-200 rounded-md p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={regenRemarks[keyName] || ''}
                                onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                placeholder="e.g. 'Make it more concise', 'Emphasize the speed', 'Correct the terminology'..."
                                rows={2}
                              />
                              <div className="flex justify-end gap-2 mt-3">
                                <button onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded transition-colors">Cancel</button>
                                <button 
                                  onClick={() => handleRegenerateSection(keyName)} 
                                  disabled={sectionLoading[keyName]}
                                  className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm disabled:opacity-50"
                                >
                                  {sectionLoading[keyName] ? 'Processing...' : 'Regenerate'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )})}
        </div>
    </div>
  )
}
