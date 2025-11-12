'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import FileUpload from '@/components/persona-sync/FileUpload'
import { StyleProfileResponse, StyleTrainingJobStatus } from '@/types/persona-sync'

export default function PersonaSyncPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [profile, setProfile] = useState<StyleProfileResponse | null>(null)
  const [currentJob, setCurrentJob] = useState<StyleTrainingJobStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [documents, setDocuments] = useState<Array<{ id: string; filename: string; sizeBytes?: number; tokens: number; createdAt: string; trained: boolean }>>([])
  const [notice, setNotice] = useState<string>('')
  const [preTrainSnapshot, setPreTrainSnapshot] = useState<{ count: number; hasTrained: boolean } | null>(null)

  const exportProfile = () => {
    try {
      if (!profile?.profile) return
      const data = JSON.stringify(profile.profile, null, 2)
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `style-profile-${selectedUserId}-v${profile.version}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
    }
  }

  const deriveSectionPresence = (sections: any) => {
    const names = ['ABSTRACT','CLAIMS','BACKGROUND','SUMMARY','BRIEF_DESCRIPTION','DETAILED_DESCRIPTION']
    const presence: Record<string, boolean> = {}
    names.forEach((n) => {
      const s = sections?.[n]
      const hasWords = Array.isArray(s?.word_count_range) && (s.word_count_range[0] > 0 || s.word_count_range[1] > 0)
      const hasSent = Array.isArray(s?.sentence_count_range) && (s.sentence_count_range[0] > 0 || s.sentence_count_range[1] > 0)
      const hasMicro = s?.micro_rules && Object.keys(s.micro_rules).length > 0
      presence[n] = !!(hasWords || hasSent || hasMicro)
    })
    return presence
  }

  // Check if user has admin privileges
  const isAdmin = user?.roles?.includes('OWNER') || user?.roles?.includes('ADMIN')

  useEffect(() => {
    if (user?.tenant_id) {
      // Default to current user for both admins and regular users
      // Admins can change this to train other users' styles
      setSelectedUserId(user.user_id)
    }
  }, [user, isAdmin])

  const fetchProfile = async (userId: string) => {
    if (!userId || !user?.tenant_id) return

    try {
      const response = await fetch(
        `/api/tenants/${user.tenant_id}/users/${userId}/style/profile`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        setProfile(data)
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
    }
  }

  const fetchDocuments = async (userId: string) => {
    if (!userId || !user?.tenant_id) return
    try {
      const res = await fetch(`/api/tenants/${user.tenant_id}/users/${userId}/style/documents`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents || [])
      }
    } catch (e) {
      console.error('Failed to fetch documents:', e)
    }
  }

  const startTraining = async (files: File[]) => {
    if (!selectedUserId || !user?.tenant_id) return

    setLoading(true)
    setError('')
    setNotice('')
    setPreTrainSnapshot({ count: documents.length, hasTrained: documents.some(d => d.trained) })

    try {
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))
      formData.append('jurisdictionHints', 'USPTO') // Default

      const response = await fetch(
        `/api/tenants/${user.tenant_id}/users/${selectedUserId}/style/learn`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          },
          body: formData
        }
      )

      if (response.ok) {
        const data = await response.json()
        setCurrentJob({
          jobId: data.jobId,
          status: 'pending',
          progress: 0
        })
        // Start polling for job status
        pollJobStatus(data.jobId)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Training failed')
      }
    } catch (err) {
      console.error('Network error:', err)
      setError('Network error occurred')
    } finally {
      setLoading(false)
    }
  }

  const pollJobStatus = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/style/jobs/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })

        if (response.ok) {
          const jobData = await response.json()
          setCurrentJob(jobData)

          if (jobData.status === 'completed' || jobData.status === 'failed') {
            clearInterval(pollInterval)
            if (jobData.status === 'completed') {
              // Refresh profile and documents
              await fetchProfile(selectedUserId)
              await fetchDocuments(selectedUserId)
              // If we had previously trained docs and added more, show reuse notice
              if (preTrainSnapshot) {
                const nowCount = documents.length
                if (preTrainSnapshot.hasTrained && nowCount > preTrainSnapshot.count) {
                  setNotice('Existing trained drafts reused from cache; only newly added drafts were analyzed and the profile was merged.')
                } else {
                  setNotice('Training complete. Profile merged from current drafts.')
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to poll job status:', err)
      }
    }, 2000) // Poll every 2 seconds

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(pollInterval), 300000)
  }

  const lockProfile = async () => {
    if (!selectedUserId || !user?.tenant_id) return

    try {
      const response = await fetch(
        `/api/tenants/${user.tenant_id}/users/${selectedUserId}/style/lock`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        }
      )

      if (response.ok) {
        // Refresh profile
        fetchProfile(selectedUserId)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Failed to lock profile')
      }
    } catch (err) {
      setError('Network error occurred')
    }
  }

  useEffect(() => {
    if (selectedUserId) {
      fetchProfile(selectedUserId)
      fetchDocuments(selectedUserId)
    }
  }, [selectedUserId])

  if (!user) {
    return <div className="flex justify-center items-center h-64">Loading...</div>
  }

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Alert>
          <AlertDescription>
            PersonaSync is only available for tenant administrators.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // TODO: Add plan-based access control check here
  // Check if tenant has PRO_PLAN or ENTERPRISE_PLAN with PERSONA_SYNC feature enabled

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">PersonaSync Training</h1>
        <p className="text-gray-600">
          Learn and mimic writing styles from patent documents to maintain consistency across your team.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="profile">Style Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>How PersonaSync Works</CardTitle>
              <CardDescription>
                Train AI models on your team's writing style for consistent patent drafting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">📚 Training Process</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Upload 3-4 sample documents (emails, papers, patents)</li>
                    <li>• AI analyzes writing style, tone, and terminology</li>
                    <li>• Creates a normalized Style Profile JSON</li>
                    <li>• Validates quality and coverage</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">🎯 What Gets Learned</h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Tone and verbosity patterns</li>
                    <li>• Sentence structure and length</li>
                    <li>• Preferred connectors and terminology</li>
                    <li>• Section-specific formatting habits</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="training" className="space-y-6">
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Training Configuration</CardTitle>
                <CardDescription>
                  Train style for yourself or another user in your tenant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">User ID to Train</label>
                    <input
                      type="text"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      placeholder="User ID (leave as-is to train your own style)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Current: Training your style. Enter another user's ID to train theirs.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Upload Training Samples</CardTitle>
              <CardDescription>
                Upload up to 3 patent drafts. We will analyze each draft independently and statistically merge the styles into a single profile.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {documents.some(d => d.trained) && (
                <div className="mb-3 p-2 rounded bg-blue-50 text-blue-800 text-sm">
                  Previously trained drafts detected. When adding new drafts, existing ones are reused from cache; only new drafts are analyzed, and the style is merged.
                </div>
              )}

              <FileUpload
                onFilesSelected={startTraining}
                accept=".docx,.pdf,.txt,.md"
                maxFiles={3}
                disabled={loading}
                autoSelect={true}
              />

              {currentJob && (
                <div className="mt-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="text-sm font-medium">Training Progress:</span>
                    <Badge variant={
                      currentJob.status === 'completed' ? 'default' :
                      currentJob.status === 'failed' ? 'destructive' : 'secondary'
                    }>
                      {currentJob.status}
                    </Badge>
                  </div>
                  {currentJob.progress !== undefined && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${currentJob.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Uploaded Training Documents */}
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-lg">Uploaded Training Documents</CardTitle>
                  <CardDescription>Manage uploaded drafts. Trained indicates inclusion in the latest completed job.</CardDescription>
                </CardHeader>
                <CardContent>
                  {notice && (
                    <div className="mb-3 p-2 rounded bg-yellow-50 text-yellow-800 text-sm">
                      {notice}
                    </div>
                  )}
                  {documents.length === 0 ? (
                    <div className="text-sm text-gray-500">No documents uploaded yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {documents.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate max-w-md">{doc.filename}</div>
                            <div className="text-xs text-gray-500">{(doc.sizeBytes ? (doc.sizeBytes/1024/1024).toFixed(2)+' MB • ' : '')}{doc.tokens?.toLocaleString()} tokens • {new Date(doc.createdAt).toLocaleString()}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {doc.trained ? (
                              <Badge variant="secondary">Trained</Badge>
                            ) : (
                              <Badge variant="outline">Not trained</Badge>
                            )}
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                if (!confirm(`Delete ${doc.filename}?`)) return
                                try {
                                  const resp = await fetch(`/api/tenants/${user?.tenant_id}/users/${selectedUserId}/style/documents/${doc.id}`, {
                                    method: 'DELETE',
                                    headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
                                  })
                                  if (resp.ok) {
                                    const data = await resp.json()
                                    setDocuments(prev => prev.filter(d => d.id !== doc.id))
                                    setNotice(data.profileCleared ? 'All source documents removed — style profile cleared.' : 'Source removed — style profile recomputed.')
                                    // Refresh profile after recompute
                                    fetchProfile(selectedUserId)
                                  } else {
                                    const e = await resp.json(); alert(e.error || 'Delete failed')
                                  }
                                } catch (e) {
                                  console.error('Delete failed', e)
                                  alert('Network error')
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Learned Style Profile</CardTitle>
              <CardDescription>
                Review the extracted writing style profile for {selectedUserId}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profile ? (
                <div className="space-y-6">
                  {/* Profile Status Header */}
                  <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Badge variant={
                      profile.status === 'learned' ? 'default' :
                      profile.status === 'learning' ? 'secondary' :
                      profile.status === 'failed' ? 'destructive' :
                      profile.status === 'needs_more_data' ? 'outline' : 'outline'
                    }>
                      {profile.status.replace('_', ' ')}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      Version {profile.version} • Updated {new Date(profile.lastUpdated).toLocaleString()}
                    </span>
                    {profile.locked && (
                      <Badge variant="outline">Locked</Badge>
                    )}
                    {/* Generic-only badge when terminology arrays are empty */}
                    {profile.profile?.global?.terminology &&
                      profile.profile.global.terminology.preferred.length === 0 &&
                      profile.profile.global.terminology.taboo.length === 0 && (
                        <Badge variant="secondary">Generic Only</Badge>
                    )}
                  </div>

                    <div className="flex items-center gap-2">
                      <Button onClick={exportProfile} variant="outline" size="sm">
                        Export JSON
                      </Button>
                      <Button
                        onClick={async () => {
                          if (!user?.tenant_id) return
                          if (!confirm('This will delete all learned style profiles for this user. Continue?')) return
                          try {
                            const resp = await fetch(`/api/tenants/${user.tenant_id}/users/${selectedUserId}/style/unlearn`, {
                              method: 'POST',
                              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
                            })
                            if (resp.ok) {
                              setProfile(null)
                              setCurrentJob(null)
                              setError('')
                            } else {
                              const e = await resp.json()
                              alert(e.error || 'Failed to unlearn')
                            }
                          } catch (e) {
                            console.error('Unlearn failed', e)
                            alert('Network error')
                          }
                        }}
                        variant="destructive" size="sm"
                      >
                        Unlearn
                      </Button>
                      {!profile.lockedAt && isAdmin && (
                        <Button onClick={lockProfile} variant="outline" size="sm">
                          Lock Profile
                        </Button>
                      )}
                    </div>
                  </div>

                  {profile.profile && (
                    <>
                      {/* Training Metadata */}
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <h4 className="font-semibold text-blue-900 mb-2">📊 Training Summary</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="font-medium text-blue-800">Samples Used</div>
                            <div className="text-blue-700">{profile.profile.metadata.training_samples}</div>
                          </div>
                          <div>
                            <div className="font-medium text-blue-800">Total Tokens</div>
                            <div className="text-blue-700">{profile.profile.metadata.total_tokens.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="font-medium text-blue-800">Consistency Score</div>
                            <div className="text-blue-700">{(profile.profile.metadata.entropy_score * 100).toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="font-medium text-blue-800">Style Coverage</div>
                            <div className="text-blue-700">{(profile.profile.metadata.coverage_score * 100).toFixed(1)}%</div>
                          </div>
                        </div>
                        {profile.profile.metadata.jurisdiction_hints && profile.profile.metadata.jurisdiction_hints.length > 0 && (
                          <div className="mt-2">
                            <div className="font-medium text-blue-800">Jurisdictions</div>
                            <div className="text-blue-700">{profile.profile.metadata.jurisdiction_hints.join(', ')}</div>
                          </div>
                        )}
                      </div>

                      {/* Diagnostics */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">🧪 Diagnostics</CardTitle>
                          <CardDescription>Data sufficiency and section coverage</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <div className="font-medium">Tokens Analyzed</div>
                              <div className="text-gray-700">{profile.profile.metadata.total_tokens.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="font-medium">Samples Used</div>
                              <div className="text-gray-700">{profile.profile.metadata.training_samples}</div>
                            </div>
                            <div>
                              <div className="font-medium">Consistency (entropy)</div>
                              <div className="text-gray-700">{(profile.profile.metadata.entropy_score * 100).toFixed(1)}%</div>
                            </div>
                            <div>
                              <div className="font-medium">Style Coverage</div>
                              <div className="text-gray-700">{(profile.profile.metadata.coverage_score * 100).toFixed(1)}%</div>
                            </div>
                            {/* New style metrics if available */}
                            {(() => {
                              const md: any = (profile.profile as any).metadata || {}
                              return (
                                <>
                                  {typeof md.style_confidence === 'number' && (
                                    <div>
                                      <div className="font-medium">Style Confidence</div>
                                      <div className="text-gray-700">{(md.style_confidence * 100).toFixed(1)}%</div>
                                    </div>
                                  )}
                                  {md.style_metrics && (
                                    <div className="col-span-2">
                                      <div className="font-medium">Readability</div>
                                      <div className="text-gray-700 text-sm">{md.style_metrics.readability_scale}: {md.style_metrics.readability_score?.toFixed ? md.style_metrics.readability_score.toFixed(1) : md.style_metrics.readability_score}</div>
                                      {md.style_metrics.interpretation && <div className="text-xs text-gray-500">{md.style_metrics.interpretation}</div>}
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                          <div className="mt-2">
                            <div className="font-medium mb-1">Section Presence</div>
                            {(() => {
                              const pres = deriveSectionPresence((profile.profile as any).sections)
                              const entries = Object.entries(pres)
                              return (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {entries.map(([name, ok]) => (
                                    <div key={name} className="flex items-center gap-2 text-gray-700">
                                      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-600' : 'bg-gray-300'}`}></span>
                                      <span className="text-xs">{String(name).replace('_',' ')}</span>
                                    </div>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Global Writing Style */}
                      <div className="grid md:grid-cols-2 gap-6">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">🎭 Writing Style</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex justify-between">
                              <span className="font-medium">Tone:</span>
                              <Badge variant="secondary">{profile.profile.global.tone}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium">Verbosity:</span>
                              <Badge variant="secondary">{profile.profile.global.verbosity}</Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="font-medium">Passive Voice:</span>
                              <span>{(profile.profile.global.passive_ratio * 100).toFixed(1)}%</span>
                            </div>
                            {profile.profile.global.formatting_habits.visual_style && (
                              <div className="flex justify-between">
                                <span className="font-medium">Visual Style:</span>
                                <Badge variant="outline">{profile.profile.global.formatting_habits.visual_style}</Badge>
                              </div>
                            )}
                            {/* Modality ratios */}
                            <div>
                              <div className="font-medium mb-1">Modality</div>
                              <div className="text-sm space-y-1">
                                <div>Imperative: {(profile.profile.global.modality.imperative_ratio * 100).toFixed(1)}%</div>
                                <div>Indicative: {(profile.profile.global.modality.indicative_ratio * 100).toFixed(1)}%</div>
                                <div>Subjunctive: {(profile.profile.global.modality.subjunctive_ratio * 100).toFixed(1)}%</div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">📏 Sentence Structure</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="font-medium">Average Length:</span>
                                <span>{profile.profile.global.sentence_length_stats.mean.toFixed(1)} words</span>
                              </div>
                              <div className="text-xs text-gray-600">
                                Range: {profile.profile.global.sentence_length_stats.min}-{profile.profile.global.sentence_length_stats.max} words
                              </div>
                            </div>
                            <div>
                              <div className="font-medium mb-1">Punctuation Style:</div>
                              <div className="text-sm space-y-1">
                                <div>Commas: {profile.profile.global.punctuation_cadence.comma_per_sentence.toFixed(2)} per sentence</div>
                                <div>Semicolons: {profile.profile.global.punctuation_cadence.semicolon_per_sentence.toFixed(2)} per sentence</div>
                                <div>Colons: {profile.profile.global.punctuation_cadence.colon_per_sentence.toFixed(2)} per sentence</div>
                                <div>Dashes: {profile.profile.global.punctuation_cadence.dash_per_sentence.toFixed(2)} per sentence</div>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-2">Generic connector whitelist enforced.</div>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Language Patterns */}
                      <div className="grid md:grid-cols-2 gap-6">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">🔗 Connectors & Transitions</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div>
                              <div className="font-medium mb-2">Preferred Connectors:</div>
                              <div className="flex flex-wrap gap-1">
                                {profile.profile.global.preferred_connectors.slice(0, 6).map((connector: string, idx: number) => (
                                  <Badge key={idx} variant="outline" className="text-xs">{connector}</Badge>
                                ))}
                                {profile.profile.global.preferred_connectors.length > 6 && (
                                  <Badge variant="outline" className="text-xs">+{profile.profile.global.preferred_connectors.length - 6} more</Badge>
                                )}
                              </div>
                            </div>
                            {profile.profile.global.avoid_connectors.length > 0 && (
                              <div>
                                <div className="font-medium mb-2">Avoided Connectors:</div>
                                <div className="flex flex-wrap gap-1">
                                  {profile.profile.global.avoid_connectors.slice(0, 4).map((connector: string, idx: number) => (
                                    <Badge key={idx} variant="destructive" className="text-xs">{connector}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">🧩 Lexical Patterns</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {(() => {
                              const claims = (profile.profile.sections as any)?.CLAIMS
                              const lexical: string[] = claims?.micro_rules?.lexical_rules || []
                              return (
                                <>
                                  <div className="text-sm text-gray-600">Generic phrases frequently used in claims</div>
                                  {lexical.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {lexical.slice(0, 10).map((p, i) => (
                                        <Badge key={i} variant="default" className="text-xs">{p}</Badge>
                                      ))}
                                      {lexical.length > 10 && (
                                        <Badge variant="default" className="text-xs">+{lexical.length - 10} more</Badge>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-sm text-gray-500">No lexical patterns detected</div>
                                  )}
                                  {profile.profile.global.terminology.preferred.length === 0 && (
                                    <div className="text-xs text-gray-500 mt-2">Generic-only sanitization active: domain terms suppressed.</div>
                                  )}
                                </>
                              )
                            })()}
                          </CardContent>
                        </Card>
                      </div>

                      {/* Claims Style */}
                      {(() => {
                        const claims = (profile.profile.sections as any)?.CLAIMS
                        if (!claims) return null
                        const dep = claims.micro_rules?.dependency_usage?.multiple_dependency
                        const ab = claims.micro_rules?.antecedent_basis?.strictness
                        const maxLines = claims.micro_rules?.length_constraints?.independent?.max_lines
                        const numPolicy = claims.micro_rules?.numeral_policy
                        const openingPhrases: string[] = Array.isArray(claims.micro_rules?.opening_phrases) ? claims.micro_rules.opening_phrases : []
                        const numbering = claims.micro_rules?.numbering_pattern
                        return (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">⚖️ Claims Style</CardTitle>
                            </CardHeader>
                            <CardContent className="grid md:grid-cols-3 gap-4 text-sm">
                              <div>
                                <div className="font-medium">Claim Style</div>
                                <div className="text-gray-700">{claims.micro_rules?.claim_style || '—'}</div>
                              </div>
                              <div>
                                <div className="font-medium">Opening Markers</div>
                                <div className="text-gray-700">
                                  {openingPhrases.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {openingPhrases.slice(0, 5).map((p, i) => (
                                        <Badge key={i} variant="outline" className="text-xs">{p.trim()}</Badge>
                                      ))}
                                    </div>
                                  ) : '—'}
                                </div>
                              </div>
                              <div>
                                <div className="font-medium">Multiple Dependency</div>
                                <div className="text-gray-700">{dep || '—'}</div>
                              </div>
                              <div>
                                <div className="font-medium">Antecedent Basis</div>
                                <div className="text-gray-700">{ab || '—'}</div>
                              </div>
                              <div>
                                <div className="font-medium">Independent Max Lines</div>
                                <div className="text-gray-700">{typeof maxLines === 'number' ? maxLines : '—'}</div>
                              </div>
                              <div>
                                <div className="font-medium">Numeral Policy</div>
                                <div className="text-gray-700">{numPolicy || '—'}</div>
                              </div>
                              {numbering && (
                                <>
                                  <div>
                                    <div className="font-medium">Numbering Start</div>
                                    <div className="text-gray-700">{numbering.start ?? '—'}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium">Numbering End</div>
                                    <div className="text-gray-700">{numbering.end ?? '—'}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium">Avg Gap</div>
                                    <div className="text-gray-700">{numbering.average_gap ?? '—'}</div>
                                  </div>
                                  <div>
                                    <div className="font-medium">Dependencies Style</div>
                                    <div className="text-gray-700">{numbering.dependencies_style || '—'}</div>
                                  </div>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        )
                      })()}

                      {/* Formatting Habits */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">🎨 Formatting & Structure</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                              <div className={`text-2xl mb-1 ${profile.profile.global.formatting_habits.bullet_points ? 'text-green-600' : 'text-gray-400'}`}>
                                {profile.profile.global.formatting_habits.bullet_points ? '•' : '○'}
                              </div>
                              <div className="text-sm font-medium">Bullet Points</div>
                            </div>
                            <div className="text-center">
                              <div className={`text-2xl mb-1 ${profile.profile.global.formatting_habits.numbered_lists ? 'text-green-600' : 'text-gray-400'}`}>
                                {profile.profile.global.formatting_habits.numbered_lists ? '1.' : '○'}
                              </div>
                              <div className="text-sm font-medium">Numbered Lists</div>
                            </div>
                            <div className="text-center">
                              <div className={`text-2xl mb-1 ${profile.profile.global.formatting_habits.section_headers ? 'text-green-600' : 'text-gray-400'}`}>
                                {profile.profile.global.formatting_habits.section_headers ? '§' : '○'}
                              </div>
                              <div className="text-sm font-medium">Section Headers</div>
                            </div>
                            <div className="text-center">
                              <div className={`text-2xl mb-1 ${profile.profile.global.formatting_habits.emphasis_markers.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                {profile.profile.global.formatting_habits.emphasis_markers.length > 0 ? '*' : '○'}
                              </div>
                              <div className="text-sm font-medium">Emphasis</div>
                            </div>
                          </div>
                          {profile.profile.global.formatting_habits.emphasis_markers.length > 0 && (
                            <div className="mt-3">
                              <div className="font-medium mb-2">Emphasis Styles:</div>
                              <div className="flex flex-wrap gap-1">
                                {profile.profile.global.formatting_habits.emphasis_markers.map((style: string, idx: number) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{style}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Section-Specific Patterns */}
                      {Object.keys(profile.profile.sections).length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">📄 Section-Specific Patterns</CardTitle>
                            <CardDescription>
                              How your writing style varies across different patent sections
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                          <div className="grid md:grid-cols-2 gap-4">
                              {Object.entries(profile.profile.sections).map(([section, rules]) => (
                                <div key={section} className="border rounded-lg p-3">
                                  <h5 className="font-semibold text-sm mb-2 uppercase">{section}</h5>
                                  <div className="space-y-1 text-xs">
                                    {(rules as any).word_count_range && Array.isArray((rules as any).word_count_range) && (
                                      <div>Words: {(rules as any).word_count_range[0]}–{(rules as any).word_count_range[1]}</div>
                                    )}
                                    {(rules as any).sentence_count_range && Array.isArray((rules as any).sentence_count_range) && (
                                      <div>Sentences: {(rules as any).sentence_count_range[0]}–{(rules as any).sentence_count_range[1]}</div>
                                    )}
                                    {(rules as any).paragraph_structure && (
                                      <div>Paragraphs: <Badge variant="outline" className="text-xs">{(rules as any).paragraph_structure}</Badge></div>
                                    )}
                                    {/* Show figure numbering if present in DETAILED_DESCRIPTION */}
                                    {section === 'DETAILED_DESCRIPTION' && (rules as any).micro_rules?.figure_numbering && (
                                      <div className="mt-1">
                                        <div className="font-medium">Figure Numbering</div>
                                        <div className="text-gray-700">Style: {(rules as any).micro_rules.figure_numbering.style || '—'}</div>
                                        <div className="text-gray-700">Series: {(rules as any).micro_rules.figure_numbering.series_hint || '—'}</div>
                                        <div className="text-gray-700">Range: {(rules as any).micro_rules.figure_numbering.start ?? '—'}–{(rules as any).micro_rules.figure_numbering.end ?? '—'}</div>
                                        <div className="text-gray-700">Avg Gap: {(rules as any).micro_rules.figure_numbering.average_gap ?? '—'}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                          </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Multimodal Analysis */}
                      {profile.profile.metadata.multimodal_analysis && (
                        <div className="bg-purple-50 p-4 rounded-lg">
                          <h4 className="font-semibold text-purple-900 mb-2">🖼️ Visual Analysis Included</h4>
                          <p className="text-sm text-purple-700">
                            This profile was trained using both text content and visual elements from your documents,
                            providing a more comprehensive understanding of your writing and presentation style.
                          </p>
                        </div>
                      )}

                      {/* Raw JSON (Collapsible) */}
                      <details className="group">
                        <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                          🔧 View Raw Profile Data
                        </summary>
                        <div className="mt-3 p-3 bg-gray-50 rounded-md">
                          <pre className="text-xs overflow-auto max-h-64">
                            {JSON.stringify(profile.profile, null, 2)}
                          </pre>
                        </div>
                      </details>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-gray-400 text-4xl mb-4">📝</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Style Profile Found</h3>
                  <p className="text-gray-600 mb-4">
                    Start by uploading sample documents to train the AI on your writing style.
                  </p>
                  <Button onClick={() => setActiveTab('training')} variant="outline">
                    Start Training
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}



