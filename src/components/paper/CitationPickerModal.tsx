'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface CitationPickerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  authToken: string | null
  citations: any[]
  onInsert: (citationKeys: string[]) => void
  onCitationsUpdated?: (citations: any[]) => void
}

const RECENT_STORAGE_PREFIX = 'paper_recent_citations_'

export default function CitationPickerModal({
  open,
  onOpenChange,
  sessionId,
  authToken,
  citations,
  onInsert,
  onCitationsUpdated
}: CitationPickerModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [doiInput, setDoiInput] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [recentKeys, setRecentKeys] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected([])
      setImportMessage(null)
    }
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem(`${RECENT_STORAGE_PREFIX}${sessionId}`)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          setRecentKeys(parsed)
        }
      } catch {
        setRecentKeys([])
      }
    }
  }, [sessionId])

  const filtered = useMemo(() => {
    if (!query.trim()) return citations
    const lower = query.toLowerCase()
    return citations.filter(citation => {
      return (
        citation.title?.toLowerCase().includes(lower) ||
        citation.authors?.join(' ').toLowerCase().includes(lower) ||
        citation.citationKey?.toLowerCase().includes(lower) ||
        String(citation.year || '').includes(lower)
      )
    })
  }, [citations, query])

  const recentCitations = useMemo(() => {
    if (recentKeys.length === 0) return []
    const map = new Map(citations.map(citation => [citation.citationKey, citation]))
    return recentKeys.map(key => map.get(key)).filter(Boolean)
  }, [citations, recentKeys])

  const toggleSelection = (key: string) => {
    setSelected(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key])
  }

  const handleInsert = () => {
    if (selected.length === 0) return
    onInsert(selected)
    const merged = Array.from(new Set([...selected, ...recentKeys])).slice(0, 8)
    setRecentKeys(merged)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${RECENT_STORAGE_PREFIX}${sessionId}`, JSON.stringify(merged))
    }
    onOpenChange(false)
  }

  const handleImportDoi = async () => {
    if (!doiInput.trim()) return
    try {
      setImportMessage(null)
      const response = await fetch(`/api/papers/${sessionId}/citations/import-doi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ doi: doiInput.trim() })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'DOI import failed')
      }

      setImportMessage('DOI imported.')
      setDoiInput('')
      if (onCitationsUpdated) {
        const updated = [...citations, data.citation]
        onCitationsUpdated(updated)
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'DOI import failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Insert citations</DialogTitle>
          <DialogDescription>Select one or more citations to insert at the cursor.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-xs font-semibold text-gray-600">Quick add DOI</div>
            <div className="flex gap-2">
              <Input
                value={doiInput}
                onChange={event => setDoiInput(event.target.value)}
                placeholder="10.xxxx/xxxxx"
              />
              <Button variant="secondary" onClick={handleImportDoi} disabled={!doiInput.trim()}>
                Import
              </Button>
            </div>
            {importMessage && <div className="text-xs text-gray-600">{importMessage}</div>}
          </div>

          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search by title, author, year, or key"
          />

          {recentCitations.length > 0 && (
            <div className="grid gap-2">
              <div className="text-xs font-semibold text-gray-600">Recently used</div>
              <div className="grid gap-2">
                {recentCitations.map(citation => (
                  <label key={citation.id} className="flex items-start gap-2 rounded border border-gray-200 p-2 text-sm">
                    <Checkbox
                      checked={selected.includes(citation.citationKey)}
                      onCheckedChange={() => toggleSelection(citation.citationKey)}
                    />
                    <div>
                      <div className="font-medium text-gray-900">{citation.title}</div>
                      <div className="text-xs text-gray-500">{citation.preview?.inText || citation.citationKey}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 max-h-[320px] overflow-y-auto border border-gray-200 rounded-md p-2">
            {filtered.length === 0 && (
              <div className="text-sm text-gray-500">No citations match your search.</div>
            )}
            {filtered.map(citation => (
              <label key={citation.id} className="flex items-start gap-2 rounded border border-gray-100 p-2 text-sm">
                <Checkbox
                  checked={selected.includes(citation.citationKey)}
                  onCheckedChange={() => toggleSelection(citation.citationKey)}
                />
                <div>
                  <div className="font-medium text-gray-900">{citation.title}</div>
                  <div className="text-xs text-gray-500">
                    {citation.preview?.inText || citation.citationKey} - {citation.year || 'n.d.'}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="grid gap-2">
            <div className="text-xs font-semibold text-gray-600">Preview</div>
            <Textarea
              value={
                selected.length === 0
                  ? 'Select citations to preview.'
                  : selected.map(key => citations.find(c => c.citationKey === key)?.preview?.inText || `[CITE:${key}]`).join(' ')
              }
              readOnly
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleInsert} disabled={selected.length === 0}>
              Insert {selected.length > 0 ? `(${selected.length})` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
