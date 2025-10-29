'use client'

import { useEffect, useState } from 'react'

interface AnnexureDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function AnnexureDraftStage({ session, patent, onComplete, onRefresh }: AnnexureDraftStageProps) {
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [debugSteps, setDebugSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPair, setCurrentPair] = useState<[string, string] | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({})
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({})
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({})
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({})

  const copySection = async (key: string) => {
    try {
      const text = generated?.[key] || ''
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {}
  }
  const pair: Array<[string,string]> = [
    ['title','abstract'],
    ['fieldOfInvention',''],
    ['background',''],
    ['summary','briefDescriptionOfDrawings'],
    ['detailedDescription','bestMethod'],
    ['industrialApplicability',''],
    ['claims','listOfNumerals']
  ]

  const displayName: Record<string,string> = {
    title: 'Title',
    abstract: 'Abstract',
    fieldOfInvention: 'Field of Invention',
    background: 'Background of Invention',
    summary: 'Summary of the Invention',
    briefDescriptionOfDrawings: 'Brief Description of Drawings',
    detailedDescription: 'Detailed Description',
    bestMethod: 'Best Method',
    industrialApplicability: 'Industrial Applicability',
    claims: 'Claims',
    listOfNumerals: 'List of Reference Numerals'
  }

  // Initialize from latest saved draft
  useEffect(() => {
    const latest = session?.annexureDrafts?.[0]
    if (latest) {
      const initial: Record<string,string> = {
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
        listOfNumerals: latest.listOfNumerals || ''
      }
      setGenerated(prev => ({ ...initial, ...prev }))
    }
  }, [session?.annexureDrafts])

  const handleGeneratePair = async (keys: [string,string]) => {
    if (loading) return
    setLoading(true)
    setCurrentPair(keys)
    try {
      const sections = keys.filter(Boolean)
      const res = await onComplete({ action: 'generate_sections', sessionId: session?.id, sections })
      // Merge new generated content with existing content, but do not overwrite with empty strings
      const incoming = res?.generated || {}
      const filtered: Record<string,string> = {}
      Object.entries(incoming).forEach(([k, v]) => {
        if (typeof v === 'string' && v.trim()) filtered[k] = v.trim()
      })
      setGenerated(prev => ({ ...prev, ...filtered }))
      setDebugSteps(res?.debugSteps || [])
    } catch (error) {
      console.error('Generation failed:', error)
      // Show error to user but don't crash the UI
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setLoading(false)
    }
  }

  const handleApproveSave = async (keys: [string,string]) => {
    const patch: Record<string,string> = {}
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
    try {
      const instructions: Record<string,string> = {}
      if (regenRemarks[key]) instructions[key] = regenRemarks[key]
      const res = await onComplete({ action: 'generate_sections', sessionId: session?.id, sections: [key], instructions })
      const incoming = res?.generated || {}
      const value = typeof incoming?.[key] === 'string' ? incoming[key].trim() : ''
      if (value) setGenerated(prev => ({ ...prev, [key]: value }))
      setDebugSteps(res?.debugSteps || [])

      // Close the regenerate dialog and clear remarks after successful regeneration
      setRegenOpen(prev => ({ ...prev, [key]: false }))
      setRegenRemarks(prev => ({ ...prev, [key]: '' }))
    } catch (error) {
      console.error('Regeneration failed:', error)
      // Show error to user but don't crash the UI
      alert(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])

      // Keep the dialog open on error so user can try again
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 4: Annexure Draft</h2>
        <p className="text-gray-600">Generate, review, and approve sections in pairs with visible backend steps.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {/* Vertical document-like layout */}
          <div className="bg-white">
            {pair.map(([a,b], idx) => (
              <div key={idx}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h3 className="text-lg font-bold text-blue-700 flex items-center">
                    {displayName[a]}{b ? ` + ${displayName[b]}` : ''}
                    {(generated?.[a] || generated?.[b]) && (
                      <svg className="w-4 h-4 ml-2 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button disabled={loading} onClick={() => handleGeneratePair([a,b])} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white disabled:opacity-50 flex items-center gap-2">
                      {loading && currentPair?.includes(a) ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Generating...
                        </>
                      ) : (
                        'Generate'
                      )}
                    </button>
                    {(generated?.[a] || generated?.[b]) && (
                      <button disabled={loading} onClick={() => handleApproveSave([a,b])} className="px-3 py-2 text-sm rounded bg-green-600 text-white disabled:opacity-50">Approve & Save</button>
                    )}
                  </div>
                </div>
                <div className="px-6 pb-6">
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold text-blue-700 uppercase">{displayName[a]}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] text-gray-400" title="Actions" aria-label="Actions">
                          {/* three-dots icon */}
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                        </div>
                        <div className="flex items-center gap-1">
                          {generated?.[a] && (
                            <button
                              type="button"
                              onClick={() => copySection(a)}
                              className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                              title="Copy section"
                            >
                              {copiedKey === a ? (
                                // check icon
                                <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                              ) : (
                                // copy icon
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" fill="currentColor"/></svg>
                              )}
                            </button>
                          )}
                          {/* Regenerate stack: only show when content exists */}
                          {generated?.[a] && (
                            <button
                              type="button"
                              disabled={sectionLoading[a]}
                              onClick={() => !sectionLoading[a] && setRegenOpen(prev => ({ ...prev, [a]: !prev[a] }))}
                              className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              title={regenOpen[a] ? 'Close' : 'Regenerate'}
                            >
                              {sectionLoading[a] ? (
                                // loading spinner
                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : regenOpen[a] ? (
                                // close icon
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6.225 4.811l13 13-1.414 1.414-13-13z"/><path d="M18.811 4.811l1.414 1.414-13 13-1.414-1.414z"/></svg>
                              ) : (
                                // refresh icon
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.95 7.95 0 0012 4V1L7 6l5 5V7a6 6 0 11-6 6H4a8 8 0 108-8c-1.66 0-3.18.51-4.45 1.35l.9 1.45C9.39 7.3 10.64 7 12 7a5 5 0 11-5 5H5a7 7 0 107-7c-1.3 0-2.52.31-3.6.86l1.25 2.03C10.49 7.32 11.21 7.16 12 7.16c2.68 0 4.84 2.16 4.84 4.84S14.68 16.84 12 16.84 7.16 14.68 7.16 12H5.84A6.16 6.16 0 0012 18.16c3.4 0 6.16-2.76 6.16-6.16 0-1.69-.69-3.22-1.81-4.35z"/></svg>
                              )}
                            </button>
                          )}
                          {/* Edit */}
                          <button
                            type="button"
                            onClick={() => { setEditingKey(editingKey === a ? null : a); setEditDrafts(prev => ({ ...prev, [a]: generated?.[a] || '' })) }}
                            className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                            title={editingKey === a ? 'Cancel edit' : 'Edit'}
                          >
                            {editingKey === a ? (
                              // cancel icon
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71L12 12.01 5.7 5.7 4.29 7.11 10.59 13.4l-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.29-6.3 6.29-6.29z"/></svg>
                            ) : (
                              // pencil icon
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap text-base leading-7 text-justify bg-white p-0">{generated?.[a] || ''}</div>
                    {regenOpen[a] && generated?.[a] && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Remarks for regeneration (optional)"
                          className="flex-1 text-xs px-2 py-1 border rounded border-gray-200"
                          value={regenRemarks[a] || ''}
                          onChange={e => setRegenRemarks(prev => ({ ...prev, [a]: e.target.value }))}
                        />
                        <button
                          type="button"
                          disabled={loading || sectionLoading[a]}
                          onClick={() => handleRegenerateSection(a)}
                          className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          {sectionLoading[a] ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Processing...
                            </>
                          ) : (
                            'Confirm Regenerate'
                          )}
                        </button>
                      </div>
                    )}
                    {editingKey === a && (
                      <div className="mt-2">
                        <textarea
                          className="w-full text-sm p-2 border rounded border-gray-200"
                          rows={6}
                          value={editDrafts[a] ?? ''}
                          onChange={e => setEditDrafts(prev => ({ ...prev, [a]: e.target.value }))}
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleAutosaveSection(a)}
                            className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {b && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-semibold text-blue-700 uppercase">{displayName[b]}</div>
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] text-gray-400" title="Actions" aria-label="Actions">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                        </div>
                        <div className="flex items-center gap-1">
                          {generated?.[b] && (
                            <button
                              type="button"
                              disabled={!generated?.[b]}
                              onClick={() => copySection(b)}
                              className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                              title="Copy section"
                            >
                              {copiedKey === b ? (
                                <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                              ) : (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="9" width="10" height="10" rx="2"/><path d="M7 15H6a2 2 0 01-2-2V6a2 2 0 012-2h7a2 2 0 012 2v1" fill="currentColor"/></svg>
                              )}
                            </button>
                          )}
                          {generated?.[b] && (
                            <button
                              type="button"
                              disabled={sectionLoading[b]}
                              onClick={() => !sectionLoading[b] && setRegenOpen(prev => ({ ...prev, [b]: !prev[b] }))}
                              className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              title={regenOpen[b] ? 'Close' : 'Regenerate'}
                            >
                              {sectionLoading[b] ? (
                                // loading spinner
                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : regenOpen[b] ? (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6.225 4.811l13 13-1.414 1.414-13-13z"/><path d="M18.811 4.811l1.414 1.414-13 13-1.414-1.414z"/></svg>
                              ) : (
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.95 7.95 0 0012 4V1L7 6l5 5V7a6 6 0 11-6 6H4a8 8 0 108-8c-1.66 0-3.18.51-4.45 1.35l.9 1.45C9.39 7.3 10.64 7 12 7a5 5 0 11-5 5H5a7 7 0 107-7c-1.3 0-2.52.31-3.6.86l1.25 2.03C10.49 7.32 11.21 7.16 12 7.16c2.68 0 4.84 2.16 4.84 4.84S14.68 16.84 12 16.84 7.16 14.68 7.16 12H5.84A6.16 6.16 0 0012 18.16c3.4 0 6.16-2.76 6.16-6.16 0-1.69-.69-3.22-1.81-4.35z"/></svg>
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { setEditingKey(editingKey === b ? null : b); setEditDrafts(prev => ({ ...prev, [b]: generated?.[b] || '' })) }}
                            className="px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50"
                            title={editingKey === b ? 'Cancel edit' : 'Edit'}
                          >
                            {editingKey === b ? (
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71L12 12.01 5.7 5.7 4.29 7.11 10.59 13.4l-6.3 6.3 1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.29-6.3 6.29-6.29z"/></svg>
                            ) : (
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="whitespace-pre-wrap text-base leading-7 text-justify bg-white p-0">{generated?.[b] || ''}</div>
                    {regenOpen[b] && generated?.[b] && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Remarks for regeneration (optional)"
                          className="flex-1 text-xs px-2 py-1 border rounded border-gray-200"
                          value={regenRemarks[b] || ''}
                          onChange={e => setRegenRemarks(prev => ({ ...prev, [b]: e.target.value }))}
                        />
                        <button
                          type="button"
                          disabled={loading || sectionLoading[b]}
                          onClick={() => handleRegenerateSection(b)}
                          className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          {sectionLoading[b] ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Processing...
                            </>
                          ) : (
                            'Confirm Regenerate'
                          )}
                        </button>
                      </div>
                    )}
                    {editingKey === b && (
                      <div className="mt-2">
                        <textarea
                          className="w-full text-sm p-2 border rounded border-gray-200"
                          rows={6}
                          value={editDrafts[b] ?? ''}
                          onChange={e => setEditDrafts(prev => ({ ...prev, [b]: e.target.value }))}
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleAutosaveSection(b)}
                            className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  )}
                </div>
                {/* Section splitter */}
                <div className="h-3 bg-gray-50"></div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold text-gray-900 mb-2">Backend activity</h4>
            {loading && (
              <div className="mb-3 p-2 bg-yellow-50 rounded text-sm text-yellow-700 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing with AI...
              </div>
            )}
            {currentPair && !loading && (
              <div className="mb-3 p-2 bg-blue-50 rounded text-sm text-blue-700">
                {(() => {
                  const names = currentPair.filter(Boolean).map(k => displayName[k] || k)
                  return `Currently generating: ${names.join(' + ')}`
                })()}
              </div>
            )}
            {Object.values(sectionLoading).some(Boolean) && !loading && (
              <div className="mb-3 p-2 bg-blue-50 rounded text-sm text-blue-700">
                Regenerating: {Object.entries(sectionLoading).filter(([_, loading]) => loading).map(([key, _]) => displayName[key] || key).join(', ')}
              </div>
            )}
            <ol className="space-y-2 text-sm">
              {Array.isArray(debugSteps) && debugSteps.map((s:any, i:number) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-gray-700">{s.step}</span>
                  <span className={"text-xs px-2 py-0.5 rounded " + (s.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{s.status}</span>
                </li>
              ))}
              {!Array.isArray(debugSteps) || debugSteps.length === 0 ? <li className="text-gray-400">No steps yet. Click Generate.</li> : null}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
