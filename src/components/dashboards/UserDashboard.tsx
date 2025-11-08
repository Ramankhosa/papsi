'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import NoveltySearchCard from '../novelty-search/NoveltySearchCard'
import NoveltySearchHistory from '../novelty-search/NoveltySearchHistory'
import LoadingBird from '../ui/loading-bird'
import AnimatedLogo from '../ui/animated-logo'

interface Project {
  id: string
  name: string
  createdAt: string
  applicantProfile?: {
    id: string
    applicantLegalName: string
  }
  collaborators?: {
    id: string
    role: string
    user: {
      id: string
      name: string | null
      email: string
    }
  }[]
}

interface DropdownState {
  [projectId: string]: boolean
}

export default function UserDashboard() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingProjectName, setEditingProjectName] = useState('')
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState<DropdownState>({})
  const [showNoveltyHistory, setShowNoveltyHistory] = useState(false)

  // Load projects on component mount
  useEffect(() => {
    if (user) {
      fetchProjects()
    }
  }, [user])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.dropdown-container')) {
        closeAllDropdowns()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
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
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName.trim()) return

    setIsCreating(true)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name: projectName.trim() })
      })

      if (response.ok) {
        const data = await response.json()
        resetCreateForm()
        // Could redirect to the new project, but for now just refresh
        fetchProjects()
      } else {
        const errorText = await response.text()
        console.error('Failed to create project:', response.status, errorText)
        alert('Failed to create project')
      }
    } catch (error) {
      console.error('Failed to create project:', error)
      alert('Failed to create project')
    } finally {
      setIsCreating(false)
    }
  }

  const handleEditProject = async (projectId: string, newName: string) => {
    if (!newName.trim()) return

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ name: newName.trim() })
      })

      if (response.ok) {
        const updatedProject = await response.json()
        setProjects(projects.map(p => p.id === projectId ? updatedProject.project : p))
        setEditingProjectId(null)
        setEditingProjectName('')
      } else {
        console.error('Failed to update project')
        alert('Failed to update project')
      }
    } catch (error) {
      console.error('Failed to update project:', error)
      alert('Failed to update project')
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        setProjects(projects.filter(p => p.id !== projectId))
        setDeletingProjectId(null)
      } else {
        console.error('Failed to delete project')
        alert('Failed to delete project')
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
      alert('Failed to delete project')
    }
  }

  const startEditing = (project: Project) => {
    setEditingProjectId(project.id)
    setEditingProjectName(project.name)
  }

  const cancelEditing = () => {
    setEditingProjectId(null)
    setEditingProjectName('')
  }

  const toggleDropdown = (projectId: string) => {
    setDropdownOpen(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }))
  }

  const closeAllDropdowns = () => {
    setDropdownOpen({})
  }

  const resetCreateForm = () => {
    setProjectName('')
    setShowCreateForm(false)
  }

  const startWorkflow = async (actionType: 'draft' | 'novelty-search') => {
    try {
      // Get user's projects to find the Default Project
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        const userProjects = data.projects || []

        // Find the "Default Project" specifically
        const defaultProject = userProjects.find((p: Project) => p.name === 'Default Project')

        if (actionType === 'draft') {
          // Navigate to patent drafting with default project (or fallback to no project)
          const url = defaultProject ? `/patents/draft/new?projectId=${defaultProject.id}` : '/patents/draft/new'
          router.push(url)
        } else {
          // Navigate to novelty search with default project pre-selected
          const url = defaultProject ? `/novelty-search?projectId=${defaultProject.id}` : '/novelty-search'
          router.push(url)
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
      // Fallback to without project
      if (actionType === 'draft') {
        router.push('/patents/draft/new')
      } else {
        router.push('/novelty-search')
      }
    }
  }


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <AnimatedLogo size="lg" className="flex-shrink-0" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-600">Welcome to your workspace</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-gray-500">{user?.email}</div>
                <div className="text-xs text-gray-400">Role: {user?.role}</div>
                {user?.ati_id && (
                  <div className="text-xs text-gray-400">Company: {user?.ati_id}</div>
                )}
              </div>
              <button
                onClick={logout}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Welcome Section */}
        <div className="bg-white shadow rounded-lg mb-8">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-2">
              Welcome, {user?.email?.split('@')[0]}!
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              You are logged in with <span className="font-medium">{user?.role}</span> permissions
              {user?.ati_id && (
                <span> for company <span className="font-medium">{user?.ati_id}</span></span>
              )}.
            </p>
            {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Patent Drafting Card */}
                  <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-all duration-200 group cursor-pointer" onClick={() => startWorkflow('draft')}>
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">Draft Patent</h4>
                        <p className="text-sm text-gray-600">Start drafting without a project</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Begin the AI-powered patent drafting workflow. You can associate it with a project later.
                    </p>
                    <div className="inline-flex items-center text-indigo-600 font-medium group-hover:text-indigo-800">
                      Start Drafting
                      <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>

                  {/* Novelty Search Card */}
                  <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-all duration-200 group cursor-pointer" onClick={() => startWorkflow('novelty-search')}>
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-600 rounded-full flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">Novelty Search</h4>
                        <p className="text-sm text-gray-600">Comprehensive patent analysis</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Perform detailed novelty assessment and prior art analysis for your invention.
                    </p>
                    <div className="inline-flex items-center text-purple-600 font-medium group-hover:text-purple-800">
                      Start Analysis
                      <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>

                  {/* Idea Bank Card */}
                  <div className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-all duration-200 group cursor-pointer" onClick={() => router.push('/idea-bank')}>
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-600 rounded-full flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900">🧠 Idea Bank</h4>
                        <p className="text-sm text-gray-600">AI-generated patent ideas</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Explore and reserve AI-generated patent ideas with prior art analysis. Transform ideas into patents.
                    </p>
                    <div className="inline-flex items-center text-purple-600 font-medium group-hover:text-purple-800">
                      Explore Ideas
                      <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create Project Section */}
        {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Create New Project</h2>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
              >
                {showCreateForm ? 'Cancel' : '+ New Project'}
              </button>
            </div>

            {showCreateForm && (
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div>
                  <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-1">
                    Project Name
                  </label>
                  <input
                    id="projectName"
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name"
                    className="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    required
                  />
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      'Create Project'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Projects List */}
        <div className="bg-white rounded-lg shadow-sm overflow-visible">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Your Projects</h2>
          </div>

          {isLoading ? (
            <div className="px-6 py-12 text-center">
              <LoadingBird size="lg" message="Loading your projects..." />
            </div>
          ) : projects.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-gray-500 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
              <p className="text-gray-600 mb-4">
                Create your first project to get started with patent filings.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {projects.map((project) => (
                <div key={project.id} className="px-6 py-4 hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {editingProjectId === project.id ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editingProjectName}
                            onChange={(e) => setEditingProjectName(e.target.value)}
                            className="text-lg font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleEditProject(project.id, editingProjectName)
                              } else if (e.key === 'Escape') {
                                cancelEditing()
                              }
                            }}
                          />
                          <button
                            onClick={() => handleEditProject(project.id, editingProjectName)}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="text-gray-500 hover:text-gray-700 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3 className="text-lg font-medium text-gray-900">{project.name}</h3>
                      )}
                      {project.applicantProfile && (
                        <p className="text-sm text-gray-600 mt-1">
                          Applicant: {project.applicantProfile.applicantLegalName}
                        </p>
                      )}
                      {project.collaborators && project.collaborators.length > 0 && (
                        <p className="text-sm text-gray-600 mt-1">
                          Collaborators: {project.collaborators.length}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/projects/${project.id}`}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                      >
                        Open
                      </Link>
                      {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ANALYST') && (
                        <Link
                          href={`/patents/draft/new?projectId=${project.id}`}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200"
                        >
                          Add Patent
                        </Link>
                      )}

                      {/* Dropdown Menu */}
                      <div className="relative dropdown-container">
                        <button
                          onClick={() => toggleDropdown(project.id)}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>

                        {dropdownOpen[project.id] && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                            <div className="py-1">
                              <button
                                onClick={() => {
                                  startEditing(project)
                                  closeAllDropdowns()
                                }}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              >
                                Edit Title
                              </button>
                              <Link
                                href={`/projects/${project.id}/setup`}
                                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                              >
                                Manage Team
                              </Link>
                              <div className="border-t border-gray-100"></div>
                              <button
                                onClick={() => {
                                  setDeletingProjectId(project.id)
                                  closeAllDropdowns()
                                }}
                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700"
                              >
                                Delete Project
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Delete Confirmation Modal */}
                  {deletingProjectId === project.id && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800 mb-3">
                        Are you sure you want to delete "{project.name}"? This action cannot be undone.
                      </p>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          Delete Project
                        </button>
                        <button
                          onClick={() => setDeletingProjectId(null)}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Novelty Search History Section */}
        <div className="mt-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Novelty Search History</h2>
              <button
                onClick={() => setShowNoveltyHistory(!showNoveltyHistory)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200"
              >
                {showNoveltyHistory ? 'Hide Search History' : 'Show Search History'}
              </button>
            </div>

            {showNoveltyHistory && (
              <div className="mt-4">
                <NoveltySearchHistory showStats={true} />
              </div>
            )}
          </div>
        </div>
      </main>

    </div>
  )
}
