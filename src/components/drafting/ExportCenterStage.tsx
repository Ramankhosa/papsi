'use client'

import React, { useEffect, useState } from 'react'
interface ExportCenterStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function ExportCenterStage({ session, patent, onComplete, onRefresh }: ExportCenterStageProps) {
  const [issues, setIssues] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [rich, setRich] = useState<any>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportOptions, setExportOptions] = useState({
    autoNumberParagraphs: false
  })

  const loadPreview = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ action: 'preview_export', sessionId: session?.id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Preview failed')
      setIssues(data.issues || [])
    } catch (e:any) {
      setIssues([e?.message || 'Preview failed'])
    } finally {
      setLoading(false)
    }
  }

  const loadRich = async () => {
    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ action: 'get_export_preview', sessionId: session?.id })
      })
      const data = await res.json()
      if (res.ok) setRich(data)
    } catch {}
  }

  useEffect(() => { loadPreview(); loadRich() }, [])

  const handleExport = async () => {
    if (!showExportModal) {
      setShowExportModal(true)
      return
    }

    try {
      const res = await fetch(`/api/patents/${patent.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          action: 'export_docx',
          sessionId: session?.id,
          autoNumberParagraphs: exportOptions.autoNumberParagraphs
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(()=>({ error: 'Export failed' }))
        alert(data?.error || 'Export failed')
        setShowExportModal(false)
        return
      }
      const disp = res.headers.get('Content-Disposition') || ''
      const isDocx = (res.headers.get('Content-Type')||'').includes('officedocument')
      const filename = /filename="?([^";]+)"?/i.test(disp) ? RegExp.$1 : `annexure_${session?.id}.${isDocx?'docx':'txt'}`
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      setShowExportModal(false)
    } catch (e) {
      alert('Export failed')
      setShowExportModal(false)
    }
  }

  return (
    <div className="p-8">
      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Export Options</h3>

            <div className="space-y-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="autoNumber"
                  checked={exportOptions.autoNumberParagraphs}
                  onChange={(e) => setExportOptions(prev => ({ ...prev, autoNumberParagraphs: e.target.checked }))}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="autoNumber" className="ml-2 text-sm text-gray-900">
                  Auto-number paragraphs ([0001] style)
                </label>
              </div>

            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
              >
                Export DOCX
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 7: Export Center</h2>
          <div className="flex items-center gap-2">
            <button onClick={loadPreview} className="px-4 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Refresh Preview</button>
            <button onClick={handleExport} className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">Export DOCX</button>
          </div>
        </div>
        <p className="text-gray-600">
          Export your complete patent annexure in various formats.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Export Annexure (DOCX)</h3>
          <button onClick={handleExport} className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">Export DOCX</button>
        </div>
        <p className="text-sm text-gray-600">The export includes all approved and autosaved sections, formatted in Form-2 order with configurable paragraph numbering and abstract placement options. Attorneys can edit the DOCX further.</p>
      </div>

      {/* Live preview */}
      <div className="mt-6">
        {/* Rich preview with images only */}
        <div className="border rounded-lg bg-white">
          <div className="flex items-center justify-between p-4 border-b">
            <h4 className="font-semibold text-gray-900">Preview (rich layout with images)</h4>
            <div className="flex items-center gap-2">
              <button onClick={loadPreview} className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Run Guards</button>
              <button onClick={loadRich} className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-50">Refresh</button>
            </div>
          </div>
          {issues.length>0 && (
            <div className="p-4 bg-yellow-50 text-yellow-800 text-sm border-b">
              <div className="font-medium mb-1">Pre-export issues:</div>
              <ul className="list-disc ml-5">
                {issues.map((i,idx)=>(<li key={idx}>{i}</li>))}
              </ul>
            </div>
          )}
          <div className="p-4 space-y-6">
            {rich ? (
              <div className="prose max-w-none">
                <h2 className="text-xl font-bold">{String(rich.title||'').toUpperCase()}</h2>
                <h3 className="font-semibold text-gray-900">FIELD OF THE INVENTION</h3>
                <p className="whitespace-pre-wrap">{rich.fieldOfInvention}</p>
                <h3 className="font-semibold text-gray-900">BACKGROUND OF THE INVENTION</h3>
                <p className="whitespace-pre-wrap">{rich.background}</p>
                <h3 className="font-semibold text-gray-900">SUMMARY OF THE INVENTION</h3>
                <p className="whitespace-pre-wrap">{rich.summary}</p>
                <h3 className="font-semibold text-gray-900">BRIEF DESCRIPTION OF THE DRAWINGS</h3>
                <p className="whitespace-pre-wrap">{rich.briefDescriptionOfDrawings}</p>
                <h3 className="font-semibold text-gray-900">DETAILED DESCRIPTION OF THE INVENTION</h3>
                <p className="whitespace-pre-wrap">{rich.detailedDescription}</p>
                <h3 className="font-semibold text-gray-900">INDUSTRIAL APPLICABILITY</h3>
                <p className="whitespace-pre-wrap">{rich.industrialApplicability}</p>
                <h3 className="font-semibold text-gray-900">CLAIMS</h3>
                <p className="whitespace-pre-wrap">{rich.claims}</p>
                <h3 className="font-semibold text-gray-900">DRAWINGS / FIGURES</h3>
                <div className="space-y-6">
                  {(rich.figures||[]).map((f:any)=>(
                    <div key={f.figureNo} className="border rounded p-3">
                      <div className="text-sm font-medium mb-2">{`Fig. ${f.figureNo} — ${f.caption}`}</div>
                      {f.imageUrl ? (
                        <img src={`/api/patents/${patent.id}/drafting?image=figure&sessionId=${session?.id}&figureNo=${f.figureNo}`} alt={`Figure ${f.figureNo}`} className="max-w-full h-auto border" />
                      ) : (
                        <div className="text-xs text-gray-500">No image available</div>
                      )}
                    </div>
                  ))}
                </div>
                <h3 className="font-semibold text-gray-900">ABSTRACT</h3>
                <p className="whitespace-pre-wrap">{rich.abstract}</p>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No visual preview yet. Click Refresh.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-center">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Drafting Complete!</h3>
            <p className="text-gray-600 mb-4">You can export your annexure now.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={loadPreview} className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50">Refresh Preview</button>
              <button onClick={handleExport} className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">Export DOCX</button>
            <button
              onClick={() => window.location.href = '/dashboard'}
                className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
            >
              Return to Dashboard
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
