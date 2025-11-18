'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import IdeaCard from './IdeaCard'
import IdeaListItem from './IdeaListItem'
import IdeaDetailsModal from './IdeaDetailsModal'
import IdeaEditorModal from './IdeaEditorModal'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'

interface IdeaSearchFilters {
  query?: string
  domainTags?: string[]
  technicalField?: string
  status?: string
}

interface IdeaBankStats {
  totalIdeas: number
  publicIdeas: number
  reservedIdeas: number
  userReservations: number
}

type LayoutType = 'tile' | 'list'

export default function IdeaBankDashboard() {
  const { user } = useAuth()
  const [ideas, setIdeas] = useState<IdeaBankIdeaWithDetails[]>([])
  const [stats, setStats] = useState<IdeaBankStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedIdea, setSelectedIdea] = useState<IdeaBankIdeaWithDetails | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditorModal, setShowEditorModal] = useState(false)
  const [editingIdea, setEditingIdea] = useState<IdeaBankIdeaWithDetails | null>(null)

  // Layout
  const [layout, setLayout] = useState<LayoutType>('tile')
  // Page size
  const [pageSize, setPageSize] = useState<number>(20)

  // Search and filters
  const [filters, setFilters] = useState<IdeaSearchFilters>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDomain, setSelectedDomain] = useState<string>('')

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  // Auto refresh
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [fadeInKey, setFadeInKey] = useState(Date.now())

  // Create idea form
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    abstract: '',
    domainTags: [] as string[],
    technicalField: '',
    keyFeatures: [] as string[],
    potentialApplications: [] as string[]
  })
  const [creatingIdea, setCreatingIdea] = useState(false)

  // Available domain tags (could be fetched from API)
  const availableDomains = [
    'AI/ML', 'IoT', 'Biotech', 'Medical Devices', 'Software', 'Hardware',
    'Energy', 'Transportation', 'Agriculture', 'Manufacturing', 'Finance', 'Other'
  ]

  useEffect(() => {
    loadStats()
    loadIdeas()
  }, [])

  // Auto refresh ideas every 30 seconds (only when no filters active)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only auto-refresh ideas when no active search filters
      if (!searchQuery && !selectedDomain) {
        loadIdeas(currentPage, true) // Silent refresh, no loading spinner
      }
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [currentPage, searchQuery, selectedDomain])

  // Manual refresh (subtle - only refresh ideas, not stats)
  useEffect(() => {
    if (lastRefresh > 0) {
      loadIdeas(currentPage, true) // Silent refresh for manual refresh
    }
  }, [lastRefresh, currentPage])

  // Update filters when search query changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({ ...prev, query: searchQuery }))
      setCurrentPage(1)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Update filters when domain changes
  useEffect(() => {
    const newDomainTags = selectedDomain ? [selectedDomain] : undefined
    setFilters(prev => ({ ...prev, domainTags: newDomainTags }))
    setCurrentPage(1)
  }, [selectedDomain])

  // Load ideas whenever filters, page or page size change
  useEffect(() => {
    loadIdeas(currentPage)
  }, [filters, currentPage, pageSize])

  const loadStats = async () => {
    try {
      const response = await fetch('/api/idea-bank/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        }
      })
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats)
      } else if (response.status === 403) {
        // User doesn't have access to Idea Bank
        setStats({ totalIdeas: 0, publicIdeas: 0, reservedIdeas: 0, userReservations: 0 })
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
      // Set default stats if there's an error
      setStats({ totalIdeas: 0, publicIdeas: 0, reservedIdeas: 0, userReservations: 0 })
    }
  }

  const loadIdeas = async (page: number = 1, silent: boolean = false) => {
    if (!silent) setSearchLoading(true)
    if (silent) setIsRefreshing(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: String(pageSize),
        ...Object.fromEntries(
          Object.entries(filters).filter(([_, v]) => v !== undefined && v !== '')
        )
      })

      if (filters.domainTags?.length) {
        params.set('domainTags', filters.domainTags.join(','))
      }

      const response = await fetch(`/api/idea-bank?${params}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        }
      })

      console.log('📡 Idea Bank API response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('✅ Idea Bank: Received', data.ideas?.length || 0, 'ideas, total:', data.totalCount)
        setIdeas(data.ideas || [])
        if (silent) {
          setFadeInKey(Date.now()) // Trigger fade-in effect for silent refreshes
        }
        setTotalPages(data.totalPages)
        setHasMore(data.currentPage < data.totalPages)
        setCurrentPage(data.currentPage)
      } else if (response.status === 403) {
        // User doesn't have access to Idea Bank
        setIdeas([])
        setTotalPages(0)
        setHasMore(false)
        if (page === 1) {
          alert('You do not have access to the Idea Bank feature. Please contact your administrator to upgrade your plan.')
        }
      }
    } catch (error) {
      console.error('Failed to load ideas:', error)
    } finally {
      if (!silent) {
        setLoading(false)
        setSearchLoading(false)
      } else {
        setIsRefreshing(false)
      }
    }
  }

  const handleCreateIdea = async () => {
    if (!createForm.title.trim() || !createForm.description.trim()) return

    setCreatingIdea(true)
    try {
      const response = await fetch('/api/idea-bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify(createForm)
      })

      if (response.ok) {
        const data = await response.json()
        // Reload ideas to ensure proper filtering and ordering
        loadIdeas(1, true) // Silent refresh
        setShowCreateModal(false)
        setCreateForm({
          title: '',
          description: '',
          abstract: '',
          domainTags: [],
          technicalField: '',
          keyFeatures: [],
          potentialApplications: []
        })
        loadStats() // Refresh stats
      } else if (response.status === 403) {
        // This shouldn't happen since creating ideas doesn't require subscription
        alert('Failed to create idea. Please try again.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to create idea')
      }
    } catch (error) {
      console.error('Failed to create idea:', error)
      alert('Failed to create idea. Please try again.')
    } finally {
      setCreatingIdea(false)
    }
  }

  const handleReserveIdea = async (ideaId: string) => {
    // Find the idea to check its current state
    const idea = ideas.find(i => i.id === ideaId)
    if (!idea || idea.status !== 'PUBLIC' || idea._isReservedByCurrentUser) {
      return // Already reserved or not available
    }

    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Update the idea in the list
        setIdeas(prev => prev.map(idea =>
          idea.id === ideaId
            ? { ...idea, status: 'RESERVED', _isReservedByCurrentUser: true, reservedCount: idea.reservedCount + 1 }
            : idea
        ))
        loadStats() // Refresh stats
      } else if (response.status === 403) {
        alert('You do not have permission to reserve ideas. Please upgrade your plan.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to reserve idea')
      }
    } catch (error) {
      console.error('Failed to reserve idea:', error)
      alert('Failed to reserve idea. Please try again.')
    }
  }

  const handleReleaseReservation = async (ideaId: string) => {
    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/reserve`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        // Update the idea in the list
        setIdeas(prev => prev.map(idea =>
          idea.id === ideaId
            ? { ...idea, status: 'PUBLIC', _isReservedByCurrentUser: false }
            : idea
        ))
        loadStats() // Refresh stats
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to release reservation')
      }
    } catch (error) {
      console.error('Failed to release reservation:', error)
      alert('Failed to release reservation. Please try again.')
    }
  }

  const handleSendToSearch = async (ideaId: string) => {
    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/send-to-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Idea sent to novelty search! Search ID: ${data.searchRunId}`)
      } else if (response.status === 403) {
        alert('You do not have access to novelty search. Please upgrade your plan.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to send idea to novelty search')
      }
    } catch (error) {
      console.error('Failed to send to search:', error)
      alert('Failed to send idea to novelty search. Please try again.')
    }
  }

  const handleSendToDrafting = async (ideaId: string) => {
    try {
      const response = await fetch(`/api/idea-bank/${ideaId}/send-to-drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        alert(`Idea sent to drafting pipeline! Session ID: ${data.draftingSessionId}`)
      } else if (response.status === 403) {
        alert('You do not have access to patent drafting. Please upgrade your plan.')
      } else {
        const errorData = await response.json()
        alert(errorData.details || 'Failed to send idea to drafting')
      }
    } catch (error) {
      console.error('Failed to send to drafting:', error)
      alert('Failed to send idea to drafting. Please try again.')
    }
  }

  // Pagination controls
  const goToPage = (p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p))
    if (clamped !== currentPage) setCurrentPage(clamped)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">🧠 Idea Bank</h1>
            <p className="text-gray-600 mt-1">Discover and reserve AI-generated patent ideas</p>
          </div>
          <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700">
                + Add Idea
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Idea</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={createForm.title}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter idea title"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    value={createForm.description}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe your invention idea"
                    rows={4}
                  />
                </div>
                <div>
                  <Label htmlFor="abstract">Abstract</Label>
                  <Textarea
                    id="abstract"
                    value={createForm.abstract}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, abstract: e.target.value }))}
                    placeholder="Patent abstract (optional)"
                    rows={3}
                  />
                </div>
                <div>
                  <Label>Domain Tags</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableDomains.map(domain => (
                      <Badge
                        key={domain}
                        variant={createForm.domainTags.includes(domain) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => {
                          setCreateForm(prev => ({
                            ...prev,
                            domainTags: prev.domainTags.includes(domain)
                              ? prev.domainTags.filter(t => t !== domain)
                              : [...prev.domainTags, domain]
                          }))
                        }}
                      >
                        {domain}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateIdea}
                    disabled={creatingIdea || !createForm.title.trim() || !createForm.description.trim()}
                  >
                    {creatingIdea ? 'Creating...' : 'Create Idea'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-indigo-600">{stats.totalIdeas}</div>
                <div className="text-sm text-gray-600">Total Ideas</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">{stats.publicIdeas}</div>
                <div className="text-sm text-gray-600">Available</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-orange-600">{stats.reservedIdeas}</div>
                <div className="text-sm text-gray-600">Reserved</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-purple-600">{stats.userReservations}</div>
                <div className="text-sm text-gray-600">Your Reservations</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Search ideas by title, description, or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <Select value={selectedDomain} onValueChange={setSelectedDomain}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Domains</SelectItem>
              {availableDomains.map(domain => (
                <SelectItem key={domain} value={domain}>{domain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Layout Toggle and Refresh */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">Layout:</span>
          <ToggleGroup
            type="single"
            value={layout}
            onValueChange={(value: string) => value && setLayout(value as LayoutType)}
            className="bg-gray-100 p-1 rounded-md"
          >
            <ToggleGroupItem value="tile" aria-label="Tile view" className="px-3 py-1 text-sm">
              🔲 Tile
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view" className="px-3 py-1 text-sm">
              📋 List
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            onClick={() => setLastRefresh(Date.now())}
            variant="ghost"
            size="sm"
            className="ml-4 text-gray-500 hover:text-gray-700 transition-colors"
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <div className="flex items-center gap-1">
                <div className="animate-spin rounded-full h-3 w-3 border border-gray-400 border-t-transparent"></div>
                <span className="text-xs">Updating...</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-xs">↻</span>
                <span className="text-xs hidden sm:inline">Refresh</span>
              </div>
            )}
          </Button>
        </div>
        <div className="text-sm text-gray-500">
          {ideas.length} ideas • Page {currentPage} of {totalPages}
        </div>
      </div>

      {/* Ideas Display */}
      <div
        key={fadeInKey}
        className="transition-opacity duration-500 ease-in-out opacity-100"
      >
        {searchLoading && ideas.length === 0 ? (
        <div className="flex items-center justify-center min-h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : ideas.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No ideas found</h3>
          <p className="text-gray-600">Try adjusting your search or create a new idea to get started.</p>
        </div>
      ) : (
        <>
          {layout === 'tile' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {ideas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  onView={() => setSelectedIdea(idea)}
                  onReserve={() => handleReserveIdea(idea.id)}
                  onRelease={() => handleReleaseReservation(idea.id)}
                  onEdit={() => {
                    setEditingIdea(idea)
                    setShowEditorModal(true)
                  }}
                  onSendToSearch={() => handleSendToSearch(idea.id)}
                  onSendToDrafting={() => handleSendToDrafting(idea.id)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4 mb-8">
              {ideas.map((idea) => (
                <IdeaListItem
                  key={idea.id}
                  idea={idea}
                  onView={() => setSelectedIdea(idea)}
                  onReserve={() => handleReserveIdea(idea.id)}
                  onRelease={() => handleReleaseReservation(idea.id)}
                  onEdit={() => {
                    setEditingIdea(idea)
                    setShowEditorModal(true)
                  }}
                  onSendToSearch={() => handleSendToSearch(idea.id)}
                  onSendToDrafting={() => handleSendToDrafting(idea.id)}
                />
              ))}
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex items-center justify-between mt-4">
            {/* Page size selector */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setCurrentPage(1); setPageSize(parseInt(v, 10)); }}>
                <SelectTrigger className="w-20 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="30">30</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pager */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage <= 1 || searchLoading} onClick={() => goToPage(currentPage - 1)}>Prev</Button>
              {/* Simple numeric pager: show up to 7 buttons around current */}
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const span = 3
                let start = Math.max(1, currentPage - span)
                let end = Math.min(totalPages, currentPage + span)
                if (end - start < 6) {
                  if (start === 1) end = Math.min(totalPages, start + 6)
                  else if (end === totalPages) start = Math.max(1, end - 6)
                }
                const pageNums = [] as number[]
                for (let p = start; p <= end; p++) pageNums.push(p)
                return (
                  <span key={`pg-${i}`} className="flex items-center gap-2">
                    {pageNums.map(p => (
                      <Button key={p} variant={p === currentPage ? 'default' : 'outline'} size="sm" disabled={searchLoading} onClick={() => goToPage(p)}>
                        {p}
                      </Button>
                    ))}
                  </span>
                )
              })[0]}
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages || searchLoading} onClick={() => goToPage(currentPage + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
      </div>

      {/* Modals */}
      {selectedIdea && (
        <IdeaDetailsModal
          idea={selectedIdea}
          open={!!selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onReserve={() => handleReserveIdea(selectedIdea.id)}
          onRelease={() => handleReleaseReservation(selectedIdea.id)}
          onEdit={() => {
            setEditingIdea(selectedIdea)
            setShowEditorModal(true)
            setSelectedIdea(null)
          }}
          onSendToSearch={() => handleSendToSearch(selectedIdea.id)}
          onSendToDrafting={() => handleSendToDrafting(selectedIdea.id)}
        />
      )}

      {editingIdea && (
        <IdeaEditorModal
          idea={editingIdea}
          open={showEditorModal}
          onClose={() => {
            setShowEditorModal(false)
            setEditingIdea(null)
          }}
          onSave={(updatedIdea) => {
            setIdeas(prev => prev.map(idea =>
              idea.id === updatedIdea.id ? updatedIdea : idea
            ))
            setShowEditorModal(false)
            setEditingIdea(null)
          }}
        />
      )}
    </div>
  )
}
