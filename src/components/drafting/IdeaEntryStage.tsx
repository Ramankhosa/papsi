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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onload = async (e) => {
      const content = e.target?.result as string
      // Clean the content to remove BOM and normalize line endings
      const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      if (cleanContent.length > 50000) {
        setError('File content exceeds 50,000 characters. Please reduce the file size or split into smaller sections.')
        return
      }

      if (cleanContent.length === 0) {
        setError('File appears to be empty or unreadable')
        return
      }

      try {
        // Update the idea record with the uploaded content
        await onComplete({
          action: 'update_idea_record',
          sessionId: session?.id,
          patch: { rawInput: cleanContent }
        })

        // Refresh to get updated data
        await onRefresh()
        setError(null) // Clear any previous errors
      } catch (err) {
        setError('Failed to save uploaded content')
      }
    }

    reader.onerror = () => {
      setError('Failed to read file. Please check the file format and try again.')
    }

    reader.readAsText(file, 'UTF-8')
  }

  const canProceed = normalizedData && normalizedData.extractedFields

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 1: Idea Review</h2>
        <p className="text-gray-600">
          Review the AI-normalized structure of your invention idea.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}

      {(!showNormalized || !normalizedData) && (
        <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800 animate-pulse">
          AI is structuring your idea into a patent-ready outline (problem, objectives, logic, best method, components). Hang tight—this usually takes a few seconds.
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        {/* Original Input Display */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Your Original Input</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="mb-3">
              <span className="font-medium text-gray-700">Title:</span>
              <p className="mt-1 text-gray-900">{title}</p>
            </div>
            <div>
              <span className="font-medium text-gray-700">Description:</span>
              <div className="mt-1 max-h-32 overflow-y-auto bg-white p-3 rounded border text-sm text-gray-700">
                {rawIdea}
              </div>
            </div>
          </div>
        </div>

        {/* AI-Normalized Results */}
        {showNormalized && normalizedData && (
          <div className="bg-blue-50 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <svg className="w-6 h-6 text-blue-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h3 className="text-lg font-medium text-blue-900">AI-Normalized Structure</h3>
              <div className="ml-auto flex items-center space-x-2">
                <button
                  onClick={() => setIsEditing((v) => !v)}
                  className="inline-flex items-center px-3 py-1 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50"
                >
                  {isEditing ? 'Stop Editing' : 'Edit'}
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
                  className="inline-flex items-center px-3 py-1 border border-indigo-300 text-sm font-medium rounded-md text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-60"
                  disabled={isRegenerating}
                  title="Re-run AI normalization for this idea"
                >
                  {isRegenerating ? (
                    <>
                      <svg className="animate-spin h-4 w-4 mr-2 text-indigo-600" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                      Regenerating...
                    </>
                  ) : (
                    'Regenerate AI Normalization'
                  )}
                </button>
              </div>
            </div>

            {/* Vertically stacked tiles for readability */}
            <div className="space-y-6">
              {/* Search Query moved to the bottom of the section */}

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Classification Codes</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-blue-800 mb-1">CPC Codes</label>
                    {isEditing ? (
                      <input
                        className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                        placeholder="e.g., H04L 29/08, G06F 17/30"
                        value={cpcCodes.join(', ')}
                        onChange={(e) => setCpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      />
                    ) : (
                      <div className="text-sm text-blue-700 bg-white p-3 rounded border">
                        {(cpcCodes && cpcCodes.length) ? cpcCodes.join(', ') : 'None'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-blue-800 mb-1">IPC Codes</label>
                    {isEditing ? (
                      <input
                        className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                        placeholder="e.g., G06F 17/30, H04L 29/08"
                        value={ipcCodes.join(', ')}
                        onChange={(e) => setIpcCodes(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      />
                    ) : (
                      <div className="text-sm text-blue-700 bg-white p-3 rounded border">
                        {(ipcCodes && ipcCodes.length) ? ipcCodes.join(', ') : 'None'}
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-blue-600">These codes will be used to link with patent search APIs.</p>
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Problem Statement</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={4}
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {problem || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Objectives</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={3}
                    value={objectives}
                    onChange={(e) => setObjectives(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {objectives || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Technical Logic</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={4}
                    value={logic}
                    onChange={(e) => setLogic(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {logic || 'Not specified'}
                  </p>
                )}
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Key Components ({components?.length || 0})</h4>
                <div>
                  {components?.length > 0 ? (
                    <ul className="text-sm text-blue-700 space-y-2">
                      {components.map((comp: any, idx: number) => (
                        <li key={idx} className="flex items-center space-x-2">
                          {isEditing ? (
                            <>
                              <input
                                className="flex-1 border rounded px-2 py-1"
                                value={comp.name || ''}
                                onChange={(e) => {
                                  const arr = [...components]
                                  arr[idx] = { ...arr[idx], name: e.target.value }
                                  setComponents(arr)
                                }}
                              />
                              <input
                                className="w-40 border rounded px-2 py-1"
                                value={comp.type || ''}
                                onChange={(e) => {
                                  const arr = [...components]
                                  arr[idx] = { ...arr[idx], type: e.target.value }
                                  setComponents(arr)
                                }}
                              />
                            </>
                          ) : (
                            <>
                              <span className="font-medium flex-1">{comp.name}</span>
                              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                                {(comp.type || '').toString().replace('_', ' ').toLowerCase()}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-blue-600">No components identified</p>
                  )}
                </div>
              </div>

              <div className="bg-white p-4 rounded border">
                <h4 className="font-medium text-blue-800 mb-2">Best Method</h4>
                {isEditing ? (
                  <textarea
                    className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
                    rows={3}
                    value={bestMethod}
                    onChange={(e) => setBestMethod(e.target.value)}
                    onInput={(e: any) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }}
                  />
                ) : (
                  <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
                    {bestMethod || 'Not specified'}
                  </p>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="mt-4 flex justify-end">
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
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  Save Edits
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8 pt-6 border-t border-gray-200">
      {/* Search Query placed at bottom for reference */}
      <div className="mb-6">
        <div className="bg-white p-4 rounded border">
          <h4 className="font-medium text-blue-800 mb-2">Search Query (≤25 words)</h4>
          {isEditing ? (
            <input
              className="w-full text-sm text-blue-700 bg-white p-3 rounded border"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          ) : (
            <p className="text-sm text-blue-700 bg-white p-3 rounded border whitespace-pre-wrap">
              {searchQuery || 'Not specified'}
            </p>
          )}
          <p className="mt-1 text-xs text-blue-600">Plain text, ASCII-safe; no quotes/brackets/CPC/IPC; include only essential technical terms.</p>
        </div>
      </div>
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Review the AI-normalized structure and proceed to component planning
          </div>
          <button
            onClick={async () => {
              try {
                await onComplete({
                  action: 'proceed_to_components',
                  sessionId: session?.id
                });
                onRefresh(); // Refresh to show new stage
              } catch (error) {
                console.error('Failed to proceed:', error);
              }
            }}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Continue to Components
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
