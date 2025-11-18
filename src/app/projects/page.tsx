'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FolderOpen, Plus, Users, FileText, ArrowLeft } from 'lucide-react'
import LoadingBird from '@/components/ui/loading-bird'

interface Project {
  id: string
  name: string
  createdAt: string
  patents?: { id: string; title?: string; status?: string }[]
  collaborators?: { id: string; user: { name: string; email: string } }[]
  applicantProfile?: { applicantLegalName: string }
  _count?: { patents: number; collaborators?: number }
}

export default function ProjectsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
      return
    }

    if (user) {
      fetchProjects()
    }
  }, [user, authLoading, router])

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'bg-yellow-100 text-yellow-800'
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800'
      case 'COMPLETED': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7] flex items-center justify-center">
        <LoadingBird message="Loading your projects..." useKishoFallback={true} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FAFAFB] to-[#F2F4F7]">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <Link href="/dashboard" className="text-[#64748B] hover:text-[#475569] transition-colors">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-[#1E293B]">Your Projects</h1>
                <p className="text-[#64748B] text-lg">Manage your patent projects and collaborations</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-[#334155]">{user?.email}</div>
                <div className="text-xs text-[#64748B]">Role: {user?.roles?.join(', ') || 'None'}</div>
              </div>
              <Link href="/dashboard">
                <Button variant="outline" className="text-[#334155] border-[#E5E7EB] hover:bg-[#F8FAFC]">
                  Back to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Create Project Section */}
        <div className="mb-8">
          <Card className="bg-gradient-to-r from-[#4C5EFF] to-[#7A5AF8] border border-white/30 shadow-2xl shadow-blue-500/20 shadow-lg shadow-white/10 backdrop-blur-sm relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/10 before:via-transparent before:to-white/10 before:pointer-events-none after:absolute after:inset-[-1px] after:bg-gradient-to-r after:from-transparent after:via-white/5 after:to-transparent after:blur-sm after:pointer-events-none">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Start a New Project</h2>
                  <p className="text-white/80">Create a new project to organize your patents and collaborate with others.</p>
                </div>
                <Button
                  className="!bg-white !text-[#4C5EFF] hover:!bg-gray-50 font-medium px-6 py-3 rounded-xl shadow-lg"
                  onClick={() => router.push('/projects/new')}
                >
                  <Plus className="w-5 h-5 mr-2" />
                  New Project
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="text-center py-16">
            <FolderOpen className="w-24 h-24 text-[#CBD5E1] mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-[#1E293B] mb-2">No projects yet</h3>
            <p className="text-[#64748B] mb-6 max-w-md mx-auto">
              Create your first project to start organizing your patents and collaborating with your team.
            </p>
            <Button
              className="bg-[#4C5EFF] text-white hover:bg-[#3B4ACC] px-6 py-3 rounded-xl font-medium"
              onClick={() => router.push('/projects/new')}
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card key={project.id} className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 hover:scale-[1.02]">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-[#1E293B] truncate">{project.name}</span>
                    <FolderOpen className="w-6 h-6 text-[#4C5EFF] flex-shrink-0 ml-2" />
                  </CardTitle>
                  <div className="text-sm text-[#64748B]">
                    Created {new Date(project.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    {/* Applicant Info */}
                    {project.applicantProfile && (
                      <div className="flex items-center space-x-2 text-sm text-[#64748B]">
                        <Users className="w-4 h-4" />
                        <span>{project.applicantProfile.applicantLegalName}</span>
                      </div>
                    )}

                    {/* Patents Count */}
                    <div className="flex items-center space-x-2 text-sm text-[#64748B]">
                      <FileText className="w-4 h-4" />
                      <span>
                        {(project as any)._count?.patents ?? project.patents?.length ?? 0} patent
                        {((project as any)._count?.patents ?? project.patents?.length ?? 0) !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Patents Status (only if status exists) */}
                    {project.patents && project.patents.length > 0 && project.patents.some((p: any) => (p as any).status) && (
                      <div className="flex flex-wrap gap-1">
                        {project.patents
                          .filter((p: any) => (p as any).status)
                          .slice(0, 3)
                          .map((patent: any) => (
                            <Badge key={patent.id} className={`text-xs ${getStatusColor(patent.status)}`}>
                              {String(patent.status).replace('_', ' ')}
                            </Badge>
                          ))}
                        {project.patents.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{project.patents.length - 3} more
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Collaborators */}
                    {project.collaborators && project.collaborators.length > 0 && (
                      <div className="flex items-center space-x-2 text-sm text-[#64748B]">
                        <Users className="w-4 h-4" />
                        <span>{project.collaborators.length} collaborator{project.collaborators.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}

                    {/* Action Button */}
                    <Link href={`/projects/${project.id}`}>
                      <Button className="w-full bg-[#4C5EFF] text-white hover:bg-[#3B4ACC] mt-4">
                        Open Project
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
