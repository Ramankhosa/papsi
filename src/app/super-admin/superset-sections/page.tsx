'use client'
/* eslint-disable react/no-unescaped-entities */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

interface SupersetSection {
  id: string
  sectionKey: string
  aliases: string[]
  displayOrder: number
  label: string
  description: string | null
  instruction: string
  constraints: any[]
  isRequired: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function SuperAdminSupersetSectionsPage() {
  noStore()

  const { user } = useAuth()
  const [sections, setSections] = useState<SupersetSection[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSection, setEditingSection] = useState<SupersetSection | null>(null)
  const [newAlias, setNewAlias] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchSections = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/super-admin/superset-sections', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      })
      if (response.ok) {
        const data = await response.json()
        setSections(data.sections || [])
      }
    } catch (err) {
      console.error('Failed to fetch sections:', err)
      showToast('error', 'Failed to load superset sections')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some(role => role === 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
    fetchSections()
  }, [user, fetchSections])

  const handleAddAlias = async () => {
    if (!editingSection || !newAlias.trim()) return
    
    const alias = newAlias.trim()
    if (editingSection.aliases.includes(alias)) {
      showToast('error', 'Alias already exists')
      return
    }
    
    try {
      const response = await fetch('/api/super-admin/superset-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'add_alias',
          sectionKey: editingSection.sectionKey,
          alias
        })
      })
      
      if (response.ok) {
        setEditingSection({
          ...editingSection,
          aliases: [...editingSection.aliases, alias]
        })
        setNewAlias('')
        showToast('success', `Added alias "${alias}"`)
        fetchSections() // Refresh list
      } else {
        const data = await response.json()
        showToast('error', data.error || 'Failed to add alias')
      }
    } catch (err) {
      showToast('error', 'Failed to add alias')
    }
  }

  const handleRemoveAlias = async (alias: string) => {
    if (!editingSection) return
    
    try {
      const response = await fetch('/api/super-admin/superset-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'remove_alias',
          sectionKey: editingSection.sectionKey,
          alias
        })
      })
      
      if (response.ok) {
        setEditingSection({
          ...editingSection,
          aliases: editingSection.aliases.filter(a => a !== alias)
        })
        showToast('success', `Removed alias "${alias}"`)
        fetchSections() // Refresh list
      } else {
        const data = await response.json()
        showToast('error', data.error || 'Failed to remove alias')
      }
    } catch (err) {
      showToast('error', 'Failed to remove alias')
    }
  }

  const handleToggleActive = async (section: SupersetSection) => {
    try {
      const response = await fetch('/api/super-admin/superset-sections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'toggle_active',
          sectionKey: section.sectionKey,
          isActive: !section.isActive
        })
      })
      
      if (response.ok) {
        showToast('success', `Section ${section.isActive ? 'deactivated' : 'activated'}`)
        fetchSections()
      } else {
        showToast('error', 'Failed to update section')
      }
    } catch (err) {
      showToast('error', 'Failed to update section')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-400">Loading superset sections...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">🧩 Superset Sections</h1>
            <p className="text-slate-400 mt-1">
              Manage canonical section definitions and aliases
            </p>
          </div>
          <a 
            href="/super-admin"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm"
          >
            ← Back to Admin
          </a>
        </div>

        {/* Info box */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
          <p className="text-blue-200 text-sm">
            <strong>Aliases</strong> allow different jurisdictions to use their own section IDs 
            that map to the same canonical section. For example, India uses <code className="bg-slate-800 px-1 rounded">"objects"</code> which 
            maps to the canonical <code className="bg-slate-800 px-1 rounded">"objectsOfInvention"</code>.
          </p>
        </div>

        {/* Sections table */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">#</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Section Key</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Label</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Aliases</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Required</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sections.map((section) => (
                <tr key={section.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-500">{section.displayOrder}</td>
                  <td className="px-4 py-3">
                    <code className="text-violet-400 bg-slate-800 px-2 py-1 rounded text-sm">
                      {section.sectionKey}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm">{section.label}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {section.aliases.length > 0 ? (
                        section.aliases.map(alias => (
                          <span key={alias} className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-xs">
                            {alias}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500 text-xs">No aliases</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${
                      section.isRequired ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {section.isRequired ? 'Required' : 'Optional'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${
                      section.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {section.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setEditingSection(section)}
                      className="px-3 py-1 bg-violet-600 hover:bg-violet-500 rounded text-xs mr-2"
                    >
                      Edit Aliases
                    </button>
                    <button
                      onClick={() => handleToggleActive(section)}
                      className={`px-3 py-1 rounded text-xs ${
                        section.isActive 
                          ? 'bg-slate-700 hover:bg-slate-600' 
                          : 'bg-emerald-600 hover:bg-emerald-500'
                      }`}
                    >
                      {section.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Stats */}
        <div className="mt-6 flex gap-4">
          <div className="bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <p className="text-slate-400 text-xs">Total Sections</p>
            <p className="text-2xl font-bold">{sections.length}</p>
          </div>
          <div className="bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <p className="text-slate-400 text-xs">Total Aliases</p>
            <p className="text-2xl font-bold">{sections.reduce((sum, s) => sum + s.aliases.length, 0)}</p>
          </div>
          <div className="bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <p className="text-slate-400 text-xs">Required</p>
            <p className="text-2xl font-bold">{sections.filter(s => s.isRequired).length}</p>
          </div>
          <div className="bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <p className="text-slate-400 text-xs">Active</p>
            <p className="text-2xl font-bold text-emerald-400">{sections.filter(s => s.isActive).length}</p>
          </div>
        </div>
      </div>

      {/* Edit Aliases Modal */}
      {editingSection && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl border border-slate-700 max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">
                Edit Aliases for <code className="text-violet-400">{editingSection.sectionKey}</code>
              </h2>
              <button
                onClick={() => setEditingSection(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mb-6">
              <p className="text-slate-400 text-sm mb-2">Label: {editingSection.label}</p>
              <p className="text-slate-500 text-xs">
                {editingSection.description || 'No description'}
              </p>
            </div>

            {/* Current aliases */}
            <div className="mb-6">
              <h3 className="text-sm font-medium mb-2">Current Aliases</h3>
              {editingSection.aliases.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {editingSection.aliases.map(alias => (
                    <span 
                      key={alias} 
                      className="bg-amber-500/20 text-amber-300 px-3 py-1 rounded flex items-center gap-2"
                    >
                      {alias}
                      <button
                        onClick={() => handleRemoveAlias(alias)}
                        className="text-amber-400 hover:text-red-400"
                        title="Remove alias"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-sm">No aliases defined</p>
              )}
            </div>

            {/* Add new alias */}
            <div>
              <h3 className="text-sm font-medium mb-2">Add New Alias</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="e.g. objects_of_invention"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddAlias()}
                />
                <button
                  onClick={handleAddAlias}
                  disabled={!newAlias.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm"
                >
                  Add
                </button>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Use snake_case or camelCase for consistency
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setEditingSection(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

