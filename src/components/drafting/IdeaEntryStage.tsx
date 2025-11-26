'use client'

import { useState, useEffect } from 'react'

interface IdeaEntryStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function IdeaEntryStage({ session, patent, onComplete, onRefresh }: IdeaEntryStageProps) {
  const [normalizedData, setNormalizedData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNormalized, setShowNormalized] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  // Editable fields
  const [problem, setProblem] = useState('')
  const [objectives, setObjectives] = useState('')
  const [logic, setLogic] = useState('')
  const [bestMethod, setBestMethod] = useState('')
  const [components, setComponents] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [abstractText, setAbstractText] = useState('')
  const [cpcCodes, setCpcCodes] = useState<string[]>([])
  const [ipcCodes, setIpcCodes] = useState<string[]>([])

  // Use data from existing idea record
  const rawIdea = session?.ideaRecord?.rawInput || ''
  const title = session?.ideaRecord?.title || ''

  // Load normalized data on component mount
  useEffect(() => {
    if (session?.ideaRecord?.normalizedData) {
      setNormalizedData({
        normalizedData: session.ideaRecord.normalizedData,
        extractedFields: {
          problem: session.ideaRecord.problem,
          objectives: session.ideaRecord.objectives,
          components: session.ideaRecord.components,
          logic: session.ideaRecord.logic,
          inputs: session.ideaRecord.inputs,
          outputs: session.ideaRecord.outputs,
          variants: session.ideaRecord.variants,
          bestMethod: session.ideaRecord.bestMethod,
          abstract: session.ideaRecord.abstract,
          cpcCodes: session.ideaRecord.cpcCodes,
          ipcCodes: session.ideaRecord.ipcCodes
        }
      })
      setShowNormalized(true)

      // Initialize editable state
      setProblem(session.ideaRecord.problem || '')
      setObjectives(session.ideaRecord.objectives || '')
      setLogic(session.ideaRecord.logic || '')
      setBestMethod(session.ideaRecord.bestMethod || '')
      setComponents(Array.isArray(session.ideaRecord.components) ? session.ideaRecord.components : [])
      setSearchQuery((session as any)?.ideaRecord?.searchQuery || '')
      setAbstractText(session.ideaRecord.abstract || '')
      setCpcCodes(Array.isArray(session.ideaRecord.cpcCodes) ? session.ideaRecord.cpcCodes : [])
      setIpcCodes(Array.isArray(session.ideaRecord.ipcCodes) ? session.ideaRecord.ipcCodes : [])
    }
  }, [session])

  const canProceed = normalizedData && normalizedData.extractedFields

  return (
    <div className="px-6 py-8 max-w-[1200px] mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Idea Review</h2>
          <p className="text-sm text-gray-500 mt-1">
            Review and refine the AI-structured breakdown of your invention.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Actions moved to header area if needed, or kept here */}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 rounded-lg p-4 flex items-start">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {(!showNormalized || !normalizedData) && (
        <div className="mb-8 bg-indigo-50/50 border border-indigo-100 rounded-lg p-4 flex items-center justify-center text-sm text-indigo-700 animate-pulse">
          <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          Structuring your idea into a patent-ready outline...
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Content Column */}
        <div className="lg:col-span-12 space-y-6">
          
          {/* Collapsible Original Input */}
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm hover:shadow transition-shadow duration-200">
            <button 
              onClick={() => setShowOriginal(!showOriginal)} 
              className="w-full flex justify-between items-center px-5 py-3 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-medium text-gray-700">Original Input Reference</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transform transition-transform duration-200 ${showOriginal ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showOriginal && (
              <div className="p-5 border-t border-gray-100 bg-gray-50/30">
                <div className="mb-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Title</span>
                  <p className="text-sm text-gray-900">{title}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">Description</span>
                  <div className="bg-white p-4 rounded border border-gray-200 text-sm text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                    {rawIdea}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI-Normalized Results */}
          {showNormalized && normalizedData && (
            <div className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-indigo-50/30">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center">
                     <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                     </svg>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900">AI Structure Analysis</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsEditing((v) => !v)}
                    className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${isEditing ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100 bg-white border border-gray-200'}`}
                  >
                    {isEditing ? 'Done Editing' : 'Edit Fields'}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setError(null)
                        if (!session?.id) return
                        const currentRaw = session?.ideaRecord?.rawInput || rawIdea || ''
                        const currentTitle = session?.ideaRecord?.title || title || ''
                        if (!currentRaw || !currentTitle) {
                          setError('Cannot regenerate: missing title or description.')
                          return
                        }
                        setIsRegenerating(true)
                        setShowNormalized(false)
                        setNormalizedData(null)
                        await onComplete({
                          action: 'normalize_idea',
                          sessionId: session.id,
                          rawIdea: currentRaw,
                          title: currentTitle
                        })
                        await onRefresh()
                        setShowNormalized(true)
                      } catch (e) {
                        setError('Failed to regenerate AI output. Please try again.')
                      } finally {
                        setIsRegenerating(false)
                      }
                    }}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
                    disabled={isRegenerating}
                    title="Regenerate AI Structure"
                  >
                    {isRegenerating ? (
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-8">
                {/* Codes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">CPC Codes</label>
                    {isEditing ? (
                      <input
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        placeholder="e.g., H04L 29/08"
                        value={cpcCodes.join(', ')}
                        onChange={(e) => setCpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      />
                    ) : (
                      <div className="text-sm font-mono bg-gray-50 px-3 py-2 rounded border border-gray-100 text-gray-700">
                        {(cpcCodes && cpcCodes.length) ? cpcCodes.join(', ') : <span className="text-gray-400">None</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">IPC Codes</label>
                    {isEditing ? (
                      <input
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        placeholder="e.g., G06F 17/30"
                        value={ipcCodes.join(', ')}
                        onChange={(e) => setIpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      />
                    ) : (
                      <div className="text-sm font-mono bg-gray-50 px-3 py-2 rounded border border-gray-100 text-gray-700">
                        {(ipcCodes && ipcCodes.length) ? ipcCodes.join(', ') : <span className="text-gray-400">None</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Fields */}
                <div className="space-y-6">
                  <div className="group">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Problem Statement</h4>
                    {isEditing ? (
                      <textarea
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        rows={4}
                        value={problem}
                        onChange={(e) => setProblem(e.target.value)}
                      />
                    ) : (
                      <div className="text-sm text-gray-700 leading-relaxed border-l-2 border-transparent group-hover:border-indigo-200 pl-3 transition-colors">
                        {problem || <span className="text-gray-400 italic">Not specified</span>}
                      </div>
                    )}
                  </div>

                  <div className="group">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Objectives</h4>
                    {isEditing ? (
                      <textarea
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        rows={3}
                        value={objectives}
                        onChange={(e) => setObjectives(e.target.value)}
                      />
                    ) : (
                      <div className="text-sm text-gray-700 leading-relaxed border-l-2 border-transparent group-hover:border-indigo-200 pl-3 transition-colors">
                        {objectives || <span className="text-gray-400 italic">Not specified</span>}
                      </div>
                    )}
                  </div>

                  <div className="group">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Technical Logic</h4>
                    {isEditing ? (
                      <textarea
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        rows={4}
                        value={logic}
                        onChange={(e) => setLogic(e.target.value)}
                      />
                    ) : (
                      <div className="text-sm text-gray-700 leading-relaxed border-l-2 border-transparent group-hover:border-indigo-200 pl-3 transition-colors">
                        {logic || <span className="text-gray-400 italic">Not specified</span>}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Key Components <span className="text-gray-400 font-normal text-xs ml-2">({components?.length || 0})</span></h4>
                    {components?.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {components.map((comp: any, idx: number) => (
                          <div key={idx} className="p-3 bg-gray-50 rounded-lg border border-gray-100 flex flex-col space-y-1 hover:border-indigo-200 transition-colors">
                            {isEditing ? (
                              <>
                                <input
                                  className="text-sm font-medium bg-white border border-gray-200 rounded px-2 py-1 w-full mb-1"
                                  value={comp.name || ''}
                                  placeholder="Component Name"
                                  onChange={(e) => {
                                    const arr = [...components]
                                    arr[idx] = { ...arr[idx], name: e.target.value }
                                    setComponents(arr)
                                  }}
                                />
                                <input
                                  className="text-xs text-gray-500 bg-white border border-gray-200 rounded px-2 py-1 w-full"
                                  value={comp.type || ''}
                                  placeholder="Type"
                                  onChange={(e) => {
                                    const arr = [...components]
                                    arr[idx] = { ...arr[idx], type: e.target.value }
                                    setComponents(arr)
                                  }}
                                />
                              </>
                            ) : (
                              <>
                                <span className="font-medium text-sm text-gray-900">{comp.name}</span>
                                <span className="text-xs text-gray-500 bg-white self-start px-1.5 py-0.5 rounded border border-gray-200">
                                  {(comp.type || '').toString().replace('_', ' ').toLowerCase()}
                                </span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 italic">No components identified</p>
                    )}
                  </div>

                  <div className="group">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Best Method</h4>
                    {isEditing ? (
                      <textarea
                        className="w-full text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        rows={3}
                        value={bestMethod}
                        onChange={(e) => setBestMethod(e.target.value)}
                      />
                    ) : (
                      <div className="text-sm text-gray-700 leading-relaxed border-l-2 border-transparent group-hover:border-indigo-200 pl-3 transition-colors">
                        {bestMethod || <span className="text-gray-400 italic">Not specified</span>}
                      </div>
                    )}
                  </div>
                  
                  {/* Search Query */}
                  <div className="pt-6 border-t border-gray-100">
                    <div className="flex items-baseline justify-between mb-2">
                      <h4 className="text-sm font-medium text-gray-900">Search Query Recommendation</h4>
                      <span className="text-xs text-gray-400">Max 25 words</span>
                    </div>
                    {isEditing ? (
                      <input
                        className="w-full text-sm font-mono bg-gray-50 border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    ) : (
                      <div className="text-sm font-mono text-gray-600 bg-gray-50/50 p-3 rounded border border-gray-200">
                        {searchQuery || <span className="text-gray-400 italic">Not specified</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Edit Actions Footer */}
              {isEditing && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                  <button
                    onClick={async () => {
                      try {
                        await onComplete({
                          action: 'update_idea_record',
                          sessionId: session?.id,
                          patch: {
                            problem,
                            objectives,
                            logic,
                            bestMethod,
                            components,
                            searchQuery,
                            abstract: abstractText,
                            cpcCodes,
                            ipcCodes
                          }
                        })
                        setShowNormalized(true)
                        setIsEditing(false)
                        onRefresh()
                      } catch (err) {
                        console.error('Failed to save edits:', err)
                        setError('Failed to save edits')
                      }
                    }}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm"
                  >
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-10 flex items-center justify-end">
        <button
          onClick={async () => {
            try {
              await onComplete({
                action: 'proceed_to_components',
                sessionId: session?.id
              });
              onRefresh();
            } catch (error) {
              console.error('Failed to proceed:', error);
            }
          }}
          className="inline-flex items-center px-6 py-2.5 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all hover:shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Start Component Planning
          <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
