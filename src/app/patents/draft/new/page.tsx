'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

type CountryOption = {
  code: string
  label: string
  description: string
  continent: string
  office: string
  applicationTypes: string[]
  languages: string[]
}

interface Project {
  id: string
  name: string
  applicantProfile?: {
    applicantLegalName: string
  }
}

function NewPatentDraftPageContent() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialProjectId = searchParams?.get('projectId') || ''
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>(initialProjectId)
  const [patentTitle, setPatentTitle] = useState('')
  const [rawIdea, setRawIdea] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [loadingCountries, setLoadingCountries] = useState<boolean>(true)
  const [allowRefine, setAllowRefine] = useState<boolean>(true)

  // Derived: currently selected project object from list
  const selectedProjectObj = projects.find(p => p.id === selectedProject)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProjects()
    }
  }, [authLoading, user, router])

  // Preselect project if provided via query param
  useEffect(() => {
    if (initialProjectId) {
      setSelectedProject(initialProjectId)
    }
  }, [initialProjectId])

  // Load country profiles for jurisdiction selection
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setLoadingCountries(true)
        const res = await fetch('/api/country-profiles', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          continent: meta.continent || 'Unknown',
          office: meta.office || 'Patent Office',
          applicationTypes: meta.applicationTypes || [],
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => {
          if (a.continent !== b.continent) return a.continent.localeCompare(b.continent)
          return a.label.localeCompare(b.label)
        })
        setAvailableCountries(countries)
        if (countries.length > 0) {
          const defaultSel = countries.find(c => c.code === 'IN')?.code || countries[0].code
          setSelectedCodes([defaultSel])
        }
      } catch (e) {
        console.error('Failed to load country profiles:', e)
        setError('Failed to load country profiles. Please try again.')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        const list: Project[] = data.projects || []
        setProjects(list)

        // If coming from dashboard, find and select the "Default Project"
        if (!initialProjectId && list.length > 0) {
          const defaultProject = list.find(p => p.name === 'Default Project');
          if (defaultProject) {
            setSelectedProject(defaultProject.id);
          } else {
            // Fallback to the first project if "Default Project" is not found
            setSelectedProject(list[0].id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['text/plain']
    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.txt')) {
      setError('Please upload a plain text (.txt) file. Word documents (.docx) are not supported yet.')
      return
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError('File size must be less than 5MB')
      return
    }

    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string

        if (!content) {
          setError('File appears to be empty')
          return
        }

        // Clean the content to remove BOM and normalize line endings
        const cleanContent = content
          .replace(/^\uFEFF/, '') // Remove BOM
          .replace(/\r\n/g, '\n') // Normalize Windows line endings
          .replace(/\r/g, '\n')   // Normalize Mac line endings
          .trim() // Remove leading/trailing whitespace

        if (cleanContent.length === 0) {
          setError('File appears to be empty or contains no readable text')
          return
        }

    if (cleanContent.length > 5000) {
      setError('File content exceeds 5,000 characters. Please reduce the file size or split into smaller sections.')
      return
    }

        // Basic validation - check if content looks like text
        const nonPrintableChars = (cleanContent.match(/[^\x20-\x7E\n\t]/g) || []).length
        const nonPrintableRatio = nonPrintableChars / cleanContent.length

        if (nonPrintableRatio > 0.1 && cleanContent.length > 100) {
          setError('File appears to contain binary data or is not a plain text file. Please use a .txt file.')
          return
        }

        setRawIdea(cleanContent)
        setError(null)

      } catch (error) {
        console.error('File processing error:', error)
        setError('Failed to process file. Please check the file format and try again.')
      }
    }

    reader.onerror = () => {
      setError('Failed to read file. Please check the file format and try again.')
    }

    reader.onabort = () => {
      setError('File reading was aborted. Please try again.')
    }

    // Read as text with UTF-8 encoding
    reader.readAsText(file, 'UTF-8')
  }

  const handleCreateDraft = async () => {
    if (!selectedProject) {
      setError('Please select a project')
      return
    }

    if (!patentTitle.trim()) {
      setError('Please enter a patent title')
      return
    }

    if (!rawIdea.trim()) {
      setError('Please provide an invention description or upload a file')
      return
    }

    if (rawIdea.length > 5000) {
      setError('Description exceeds 5,000 character limit. Please shorten your text.')
      return
    }

    // Validate title length
    const titleWords = patentTitle.trim().split(/\s+/).length
    if (titleWords > 15) {
      setError('Title must be 15 words or less')
      return
    }

    const normalizedCodes = selectedCodes.map(c => c.toUpperCase())
    const finalSelection = mode === 'single' ? normalizedCodes.slice(0, 1) : normalizedCodes
    if (finalSelection.length === 0) {
      setError('Please select at least one jurisdiction')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      // First create a basic patent record
      const patentResponse = await fetch(`/api/projects/${selectedProject}/patents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          title: patentTitle.trim(),
          description: 'Created for patent drafting workflow'
        })
      })

      if (!patentResponse.ok) {
        throw new Error('Failed to create patent')
      }

      const patentData = await patentResponse.json()
      const patentId = patentData.patent.id

      // Start drafting session and normalize idea
      const draftingResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'start_session'
        })
      })

      if (!draftingResponse.ok) {
        throw new Error('Failed to start drafting session')
      }

      const draftSessionData = await draftingResponse.json()
      const sessionId = draftSessionData.session.id

      // Persist jurisdiction choice immediately
      const setStageResponse = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'set_stage',
          sessionId,
          stage: 'COUNTRY_WISE_DRAFTING',
          draftingJurisdictions: finalSelection,
          activeJurisdiction: finalSelection[0]
        })
      })

      if (!setStageResponse.ok) {
        throw new Error('Failed to persist jurisdiction selection')
      }

      // Normalize the idea
        const normalizeResponse = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: JSON.stringify({
            action: 'normalize_idea',
            sessionId,
            rawIdea: rawIdea.trim(),
            title: patentTitle.trim(),
            allowRefine
          })
        })

      if (!normalizeResponse.ok) {
        throw new Error('Failed to normalize idea')
      }

      // Redirect to the drafting page (already on component planner stage)
      router.push(`/patents/${patentId}/draft`)

    } catch (error) {
      console.error('Failed to create patent draft:', error)
      setError(error instanceof Error ? error.message : 'Failed to start patent draft. Please try again.')
    } finally {
      setIsCreating(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Start Patent Drafting</h1>
            <p className="text-lg text-gray-600">
              Enter your invention details and let AI create a complete patent draft
            </p>
          </div>
        </div>

        {/* Main Form */}
        <div className="bg-white rounded-lg shadow-sm p-8">
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

          <div className="space-y-6">
            {/* Jurisdiction Selection */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Jurisdiction & Mode</div>
                  <p className="text-xs text-gray-600">Choose single or multiple jurisdictions; this controls downstream prompts, figures, and rules.</p>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-700">
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'single'} onChange={() => {
                      setMode('single')
                      if (selectedCodes.length > 1) setSelectedCodes([selectedCodes[0]])
                    }} />
                    Single
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" className="h-4 w-4" checked={mode === 'multi'} onChange={() => setMode('multi')} />
                    Multiple
                  </label>
                </div>
              </div>
              {loadingCountries ? (
                <div className="text-sm text-gray-500">Loading jurisdictions...</div>
              ) : availableCountries.length === 0 ? (
                <div className="text-sm text-red-600">No country profiles available. Please ask an admin to add them.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 max-h-56 overflow-auto">
                  {availableCountries.map(c => (
                    <label key={c.code} className="flex items-start gap-2 p-2 border border-gray-200 rounded hover:bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        checked={selectedCodes.includes(c.code)}
                        onChange={() => {
                          if (mode === 'single') {
                            setSelectedCodes([c.code])
                          } else {
                            setSelectedCodes(prev => prev.includes(c.code) ? prev.filter(x => x !== c.code) : [...prev, c.code])
                          }
                        }}
                        disabled={mode === 'single' && !selectedCodes.includes(c.code) && selectedCodes.length >= 1}
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{c.label}</div>
                        <div className="text-xs text-gray-600">{c.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Your chosen active jurisdiction will drive figures and validation; you can generate other jurisdictions later.
              </p>
            </div>

            {/* Project Display / Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Project
              </label>
              {initialProjectId ? (
                <>
                  <div className="flex items-center space-x-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{selectedProjectObj?.name || 'Project'}</div>
                      <div className="text-xs text-gray-500">Linked from project context</div>
                    </div>
                    <Badge variant="secondary" className="text-xs">Locked</Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    This draft will be saved to {selectedProjectObj?.name || 'the selected project'}.
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    Choose a project to store this draft. Select “Default Project” for quick drafts.
                  </p>
                </div>
              )}
            </div>

            {/* Patent Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Patent Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={patentTitle}
                onChange={(e) => setPatentTitle(e.target.value)}
                placeholder="Enter a descriptive title for your patent"
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                {patentTitle.trim().split(/\s+/).length} words (max 15) • This will be the title of your patent application
              </p>
            </div>
            {/* Invention Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Invention Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                value={rawIdea}
                onChange={(e) => setRawIdea(e.target.value)}
                rows={8}
                placeholder="Describe your invention in detail. Include the problem it solves, how it works, key components, advantages, and any specific embodiments..."
                className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-vertical"
                required
              />
              <p className={`mt-1 text-sm ${rawIdea.length > 5000 ? 'text-red-600' : rawIdea.length > 4500 ? 'text-orange-600' : 'text-gray-500'}`}>
                {rawIdea.length} characters (max 5,000)
                {rawIdea.length > 4500 && rawIdea.length <= 5000 && ' - Approaching limit'}
                {rawIdea.length > 5000 && ' - Exceeds limit!'}
              </p>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or upload a text file
              </label>
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <p className="mt-1 text-sm text-gray-500">
                Supported format: .txt files only (max 5MB, 5,000 characters)
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Note: Word documents (.docx) and PDFs are not supported yet. To convert:
              </p>
              <ul className="mt-1 text-xs text-gray-400 list-disc list-inside">
                <li>In Word: File → Save As → Plain Text (.txt)</li>
                <li>In Google Docs: File → Download → Plain text (.txt)</li>
              </ul>
              <p className="mt-1 text-xs text-blue-600">
                💡 Tip: If you upload a file, it will replace any text you've entered above
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700">
                <span className="font-medium text-gray-900">Idea handling:</span>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    className="h-4 w-4"
                    checked={allowRefine === true}
                    onChange={() => setAllowRefine(true)}
                  />
                  Let Kisho improve/structure my idea
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    className="h-4 w-4"
                    checked={allowRefine === false}
                    onChange={() => setAllowRefine(false)}
                  />
                  Keep exactly what I provided
                </label>
              </div>
              <div className="flex justify-end space-x-4">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </Link>
                <button
                  onClick={handleCreateDraft}
                  disabled={isCreating || !selectedProject || !patentTitle.trim()}
                  className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-3"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Initiate Patent Drafting
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Projects List */}
        {projects.length === 0 && (
          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">
              You need to create a project first before starting patent drafting.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Create Project
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function NewPatentDraftPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    }>
      <NewPatentDraftPageContent />
    </Suspense>
  )
}
