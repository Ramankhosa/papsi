'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import NoveltySearchHistory from '@/components/novelty-search/NoveltySearchHistory'
import { PageLoadingBird } from '@/components/ui/loading-bird'

interface Collaborator {
  id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string
  }
}

interface ApplicantProfile {
  id: string
  applicantLegalName: string
  applicantAddress: string | null
  applicantPhone: string | null
  applicantEmail: string | null
}

interface Patent {
  id: string
  title: string
  status: string
  createdAt: string
}

interface Project {
  id: string
  name: string
  createdAt: string
  applicantProfile?: ApplicantProfile
  collaborators?: Collaborator[]
  patents?: Patent[]
}

export default function ProjectDashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const projectId = params?.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [patents, setPatents] = useState<Patent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasDraftSessions, setHasDraftSessions] = useState<Record<string, boolean>>({})
  const [deleteDialog, setDeleteDialog] = useState<{ patentId: string; patentTitle: string; hasDrafts: boolean } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (!authLoading && user) {
      fetchProject()
      fetchPatents()
    }
  }, [authLoading, user, router, projectId])

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setProject(data.project)
      } else if (response.status === 404) {
        router.push('/dashboard')
      } else {
        console.error('Failed to fetch project')
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Failed to fetch project:', error)
      router.push('/dashboard')
    }
  }

  const fetchPatents = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/patents`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        const list: Patent[] = data.patents || []
        setPatents(list)

        // Check for draft sessions per patent
        const sessionsMap: Record<string, boolean> = {}
        await Promise.all(
          list.map(async (p) => {
            try {
              const res = await fetch(`/api/patents/${p.id}/drafting`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
              })
              if (res.ok) {
                const draftData = await res.json()
                sessionsMap[p.id] = Array.isArray(draftData.sessions) && draftData.sessions.length > 0
              } else {
                sessionsMap[p.id] = false
              }
            } catch {
              sessionsMap[p.id] = false
            }
          })
        )
        setHasDraftSessions(sessionsMap)
      }
    } catch (error) {
      console.error('Failed to fetch patents:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeletePatent = async () => {
    if (!deleteDialog) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/patents/${deleteDialog.patentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Remove the patent from the list
        setPatents(patents.filter(p => p.id !== deleteDialog.patentId))
        setDeleteDialog(null)
        setDeleteConfirmText('')
      } else {
        const error = await response.json()
        alert(`Failed to delete patent: ${error.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to delete patent:', error)
      alert('Failed to delete patent. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  if (authLoading || isLoading) {
    return <PageLoadingBird message="Loading project..." />
  }

  if (!user || !project) {
    return null
  }

  return (
    <div className="min-h-screen bg-gpt-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gpt-gray-900">{project.name}</h1>
              <p className="text-gpt-gray-600 mt-2">
                Created {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex space-x-3">
              <Link
                href={`/projects/${projectId}/setup`}
                className="inline-flex items-center px-4 py-2 border border-gpt-gray-300 text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage Project
              </Link>
              {!project.applicantProfile && (
                <Link
                  href={`/projects/${projectId}/applicant`}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                  title="Set up organization details for patent filings"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Add Profile
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Patents</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{patents.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Collaborators</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{project.collaborators?.length || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gpt-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gpt-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gpt-gray-600">Applicant Profile</p>
                <p className="text-2xl font-semibold text-gpt-gray-900">{project.applicantProfile ? 'Set' : 'Not Set'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Actions */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gpt-gray-900 mb-4">Project Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href={`/patents/draft/new?projectId=${projectId}`}
              className="flex items-center p-4 border-2 border-gpt-blue-200 rounded-lg hover:border-gpt-blue-300 hover:bg-gpt-blue-50 transition-all duration-200 group"
            >
              <div className="w-12 h-12 bg-gpt-blue-100 rounded-full flex items-center justify-center mr-4 group-hover:bg-gpt-blue-200 transition-colors">
                <svg className="w-6 h-6 text-gpt-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gpt-gray-900">Draft New Patent</h3>
                <p className="text-sm text-gpt-gray-600">Start AI-powered patent drafting workflow</p>
              </div>
              <svg className="w-5 h-5 text-gpt-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>

            <Link
              href={`/novelty-search?projectId=${projectId}`}
              className="flex items-center p-4 border-2 border-gpt-purple-200 rounded-lg hover:border-gpt-purple-300 hover:bg-gpt-purple-50 transition-all duration-200 group"
            >
              <div className="w-12 h-12 bg-gpt-purple-100 rounded-full flex items-center justify-center mr-4 group-hover:bg-gpt-purple-200 transition-colors">
                <svg className="w-6 h-6 text-gpt-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gpt-gray-900">Novelty Search</h3>
                <p className="text-sm text-gpt-gray-600">Comprehensive patent novelty assessment</p>
              </div>
              <svg className="w-5 h-5 text-gpt-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {/* Patents Section */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gpt-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gpt-gray-900">Patents</h2>
                  <Link
                    href={`/patents/draft/new?projectId=${projectId}`}
                    className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    New Patent
                  </Link>
              </div>
            </div>

            <div className="p-6">
              {patents.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-gpt-gray-400 mb-4">
                    <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gpt-gray-900 mb-2">No patents yet</h3>
                  <p className="text-gpt-gray-600 mb-4">
                    Start by creating your first patent application.
                  </p>
              <Link
                href={`/patents/draft/new?projectId=${projectId}`}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500"
              >
                Create First Patent
              </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {patents.slice(0, 5).map((patent) => (
                    <div key={patent.id} className="flex items-center justify-between p-4 border border-gpt-gray-200 rounded-lg hover:bg-gpt-gray-50 transition-colors">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gpt-gray-900">{patent.title}</h4>
                        <p className="text-xs text-gpt-gray-500">
                          Status: {patent.status} • Created {new Date(patent.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/projects/${projectId}/patents/${patent.id}`}
                          className="inline-flex items-center px-3 py-1 border border-gpt-gray-300 text-sm font-medium rounded text-gpt-gray-700 bg-white hover:bg-gpt-gray-50"
                        >
                          View
                        </Link>
                        <Link
                          href={`/patents/${patent.id}/draft`}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-gpt-blue-600 hover:bg-gpt-blue-700"
                        >
                          Resume Draft
                        </Link>
                        <button
                          onClick={() => setDeleteDialog({
                            patentId: patent.id,
                            patentTitle: patent.title,
                            hasDrafts: hasDraftSessions[patent.id] || false
                          })}
                          className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-white bg-red-600 hover:bg-red-700"
                          title="Delete this patent"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {patents.length > 5 && (
                    <div className="text-center pt-4">
                      <button
                        onClick={() => {
                          // Scroll to show all patents (they're already displayed)
                          const patentsSection = document.querySelector('.space-y-4');
                          patentsSection?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="text-gpt-blue-600 hover:text-gpt-blue-800 text-sm font-medium"
                      >
                        Showing {patents.length} patents
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collaborators Section */}
        {project.collaborators && project.collaborators.length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gpt-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gpt-gray-900">
                  Collaborators ({project.collaborators.length})
                </h2>
                <Link
                  href={`/projects/${projectId}/setup`}
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded text-gpt-blue-600 hover:text-gpt-blue-800"
                >
                  Manage
                </Link>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.collaborators.map((collaborator) => (
                  <div key={collaborator.id} className="flex items-center p-3 bg-gpt-gray-50 rounded-lg">
                    <div className="w-8 h-8 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {collaborator.user.name?.charAt(0) || collaborator.user.email.charAt(0) || 'U'}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gpt-gray-900">
                        {collaborator.user.name || collaborator.user.email}
                      </p>
                      <p className="text-xs text-gpt-gray-500">{collaborator.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Back to Dashboard */}
        <div className="mt-8 text-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
          >
            Back to Dashboard
          </Link>
        </div>

        {/* Delete Confirmation Dialog */}
        {deleteDialog && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900">Delete Patent</h3>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-3">
                    Are you sure you want to delete the patent <strong>"{deleteDialog.patentTitle}"</strong>?
                  </p>
                  <p className="text-sm text-gray-600 mb-3">
                    This action cannot be undone. All patent data, including drafting sessions and generated content, will be permanently removed.
                  </p>

                  {deleteDialog.hasDrafts && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-red-800 mb-2">
                        <strong>Warning:</strong> This patent has existing draft sessions. To confirm deletion, please type <strong>"delete"</strong> below:
                      </p>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="Type 'delete' to confirm"
                        className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setDeleteDialog(null)
                      setDeleteConfirmText('')
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                    disabled={isDeleting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeletePatent}
                    disabled={isDeleting || (deleteDialog.hasDrafts && deleteConfirmText.toLowerCase() !== 'delete')}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Deleting...
                      </>
                    ) : (
                      'Delete Patent'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Novelty Search History Section */}
        <div className="mt-8" id="novelty-search-history">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Novelty Search History</h2>
              <p className="text-sm text-gray-600 mt-1">View and access reports from previous novelty searches in this project</p>
            </div>

            <NoveltySearchHistory projectId={projectId} showStats={false} />
          </div>
        </div>
      </div>
    </div>
  )
}
