'use client'

import { useState } from 'react'

interface ReviewFixStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

export default function ReviewFixStage({ session, patent, onComplete, onRefresh }: ReviewFixStageProps) {
  const [extReport, setExtReport] = useState<any>(null)
  const [checkList, setCheckList] = useState<Array<{ label: string; ok: boolean; remark: string; status: 'pending'|'pass'|'fail' }>>([])
  const runChecks = async () => {
    const res = await onComplete({ action: 'run_review_checks', sessionId: session?.id })
    setExtReport(res)
    // Build check items and animate one-by-one
    const er = res?.extendedReport || {}
    const rows: Array<{label:string; ok:boolean; remark:string}> = []
    const wc = (v:number, lo:number, hi:number) => v>=lo && v<=hi
    // Abstract
    rows.push({ label: 'Abstract length 130–150', ok: wc(er.abstract?.length||0,130,150), remark: `length=${er.abstract?.length}` })
    rows.push({ label: 'Abstract starts with Title', ok: !!er.abstract?.startsWithTitle, remark: er.abstract?.startsWithTitle ? '' : 'Must begin exactly with approved title' })
    rows.push({ label: 'Abstract forbidden terms absent', ok: !(er.abstract?.forbiddenHits||[]).length, remark: (er.abstract?.forbiddenHits||[]).join(', ') })
    // BDOD
    rows.push({ label: 'BDOD has all figures', ok: !(er.bdod?.missingFigures||[]).length, remark: (er.bdod?.missingFigures||[]).join(', ') })
    rows.push({ label: 'BDOD has no extra figures', ok: !(er.bdod?.extraFigures||[]).length, remark: (er.bdod?.extraFigures||[]).join(', ') })
    const bdodFormatOk = !(er.bdod?.formatViolations||[]).length && !(er.bdod?.overlengthLines||[]).length
    rows.push({ label: 'BDOD format/length OK', ok: bdodFormatOk, remark: `formatViolations=${(er.bdod?.formatViolations||[]).join(', ')||'0'} overlengthLines=${(er.bdod?.overlengthLines||[]).join(', ')||'0'}` })
    // IA
    rows.push({ label: 'Industrial Applicability present', ok: !!er.industrialApplicability?.present, remark: er.industrialApplicability?.present ? '' : 'Add 50–100 words section' })
    rows.push({ label: 'IA starts with required phrase', ok: !!er.industrialApplicability?.startsWith, remark: er.industrialApplicability?.startsWith ? '' : 'Must begin with required phrase' })
    rows.push({ label: 'IA length 50–100', ok: wc(er.industrialApplicability?.length||0,50,100), remark: `length=${er.industrialApplicability?.length}` })
    // Figures/Numerals
    rows.push({ label: 'No invalid figure references', ok: !(er.figures?.invalidReferences||[]).length, remark: (er.figures?.invalidReferences||[]).join(', ') })
    rows.push({ label: 'No numerals used-not-declared', ok: !(er.numerals?.usedNotDeclared||[]).length, remark: (er.numerals?.usedNotDeclared||[]).join(', ') })
    rows.push({ label: 'No duplicate numerals in text', ok: !(er.numerals?.duplicates||[]).length, remark: (er.numerals?.duplicates||[]).join(', ') })
    // Claims
    rows.push({ label: 'Claims ≤ 12', ok: (er.claims?.total||0) <= 12, remark: `total=${er.claims?.total||0}` })
    rows.push({ label: 'Independent claim ≤150 words', ok: (er.claims?.maxIndependentWords||0) <= 150, remark: `independentWords=${er.claims?.maxIndependentWords||0}` })
    rows.push({ label: 'No forbidden claim tokens', ok: !(er.claims?.forbiddenHits||[]).length, remark: (er.claims?.forbiddenHits||[]).join(', ') })

    setCheckList(rows.map(r => ({ ...r, status: 'pending' })))
    rows.forEach((r, idx) => {
      setTimeout(() => {
        setCheckList(prev => prev.map((it, i) => i===idx ? ({ ...it, status: r.ok ? 'pass' : 'fail' }) : it))
      }, 120 * idx)
    })
    return res
  }

  const handleAutoFix = async () => {
    // Placeholder for future auto-fix actions
    await onRefresh()
  }

  const lastDraft = session?.annexureDrafts?.[0]
  const report = lastDraft?.validationReport

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Stage 6: Review & Fix</h2>
        <p className="text-gray-600">
          Review consistency and fix any validation issues.
        </p>
      </div>

      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Consistency & Validation</h3>
          <div className="space-x-2">
            <button onClick={runChecks} className="px-3 py-2 text-sm rounded bg-indigo-600 text-white">Run Checks</button>
            <button onClick={handleAutoFix} className="px-3 py-2 text-sm rounded border border-gray-200 text-gray-700">Apply Quick Fixes</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Numeral Consistency</div>
            <div className="text-sm">{report?.numeralConsistency ? 'OK' : 'Needs Attention'}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Figure References</div>
            <div className="text-sm">{report?.figureReferences ? 'OK' : 'Invalid refs present'}</div>
          </div>
          <div className="p-3 rounded bg-gray-50">
            <div className="text-xs text-gray-500">Issues</div>
            <div className="text-sm">Missing: {(report?.missingNumerals||[]).join(', ') || '—'} | Unused: {(report?.unusedNumerals||[]).join(', ') || '—'}</div>
          </div>
        </div>
        {extReport?.extendedReport && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded border">
              <div className="font-medium text-gray-900 mb-2">Abstract</div>
              <div className="text-sm text-gray-700">Starts with title: {String(extReport.extendedReport.abstract?.startsWithTitle)}</div>
              <div className="text-sm text-gray-700">Length: {extReport.extendedReport.abstract?.length}</div>
              <div className="text-sm text-gray-700">Digits: {String(extReport.extendedReport.abstract?.digits)}</div>
            </div>
            <div className="p-4 rounded border">
              <div className="font-medium text-gray-900 mb-2">BDOD</div>
              <div className="text-sm text-gray-700">Missing: {(extReport.extendedReport.bdod?.missingFigures||[]).join(', ') || '—'}</div>
              <div className="text-sm text-gray-700">Extra: {(extReport.extendedReport.bdod?.extraFigures||[]).join(', ') || '—'}</div>
              <div className="text-sm text-gray-700">Overlength lines: {(extReport.extendedReport.bdod?.overlengthLines||[]).join(', ') || '—'}</div>
            </div>
            <div className="p-4 rounded border">
              <div className="font-medium text-gray-900 mb-2">Claims</div>
              <div className="text-sm text-gray-700">Total: {extReport.extendedReport.claims?.total}</div>
              <div className="text-sm text-gray-700">Max independent words: {extReport.extendedReport.claims?.maxIndependentWords}</div>
              <div className="text-sm text-gray-700">Forbidden: {(extReport.extendedReport.claims?.forbiddenHits||[]).join(', ') || '—'}</div>
            </div>
            <div className="p-4 rounded border">
              <div className="font-medium text-gray-900 mb-2">Industrial Applicability</div>
              <div className="text-sm text-gray-700">Present: {String(extReport.extendedReport.industrialApplicability?.present)}</div>
              <div className="text-sm text-gray-700">Starts with phrase: {String(extReport.extendedReport.industrialApplicability?.startsWith)}</div>
              <div className="text-sm text-gray-700">Length: {extReport.extendedReport.industrialApplicability?.length}</div>
            </div>
          </div>
        )}
        {checkList.length>0 && (
          <div className="mt-6">
            <div className="font-medium text-gray-900 mb-2">Checklist (sequential)</div>
            <ul className="space-y-1">
              {checkList.map((c, i) => (
                <li key={i} className="flex items-center justify-between p-2 rounded border bg-white">
                  <div className="text-sm text-gray-800">{c.label}</div>
                  <div className="flex items-center gap-3">
                    {c.status==='pending' && <span className="text-xs text-gray-500">…</span>}
                    {c.status==='pass' && <span className="text-green-600">✔</span>}
                    {c.status==='fail' && <span className="text-red-600">✖</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {extReport?.extendedReport && (
          <div className="mt-6">
            <div className="font-medium text-gray-900 mb-2">Detailed checks</div>
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Check</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-left">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(() => {
                    const er = extReport.extendedReport || {}
                    const rows: Array<{label:string; ok:boolean; remark:string}> = []
                    const ok = (v:boolean) => !!v
                    // Abstract
                    rows.push({ label: 'Abstract length 130–150', ok: er.abstract?.length>=130 && er.abstract?.length<=150, remark: `length=${er.abstract?.length}` })
                    rows.push({ label: 'Abstract starts with Title', ok: er.abstract?.startsWithTitle, remark: er.abstract?.startsWithTitle ? '' : 'Must begin exactly with approved title' })
                    rows.push({ label: 'Abstract forbidden terms absent', ok: !(er.abstract?.forbiddenHits||[]).length, remark: (er.abstract?.forbiddenHits||[]).join(', ') })
                    // BDOD
                    rows.push({ label: 'BDOD has all figures', ok: !(er.bdod?.missingFigures||[]).length, remark: (er.bdod?.missingFigures||[]).join(', ') })
                    rows.push({ label: 'BDOD has no extra figures', ok: !(er.bdod?.extraFigures||[]).length, remark: (er.bdod?.extraFigures||[]).join(', ') })
                    rows.push({ label: 'BDOD format/length OK', ok: !(er.bdod?.formatViolations||[]).length && !(er.bdod?.overlengthLines||[]).length, remark: `formatViolations=${(er.bdod?.formatViolations||[]).join(', ')||'0'} overlengthLines=${(er.bdod?.overlengthLines||[]).join(', ')||'0'}` })
                    // Industrial Applicability
                    rows.push({ label: 'IA present', ok: er.industrialApplicability?.present, remark: er.industrialApplicability?.present ? '' : 'Add Industrial Applicability (50–100 words)' })
                    rows.push({ label: 'IA starts with required phrase', ok: er.industrialApplicability?.startsWith, remark: er.industrialApplicability?.startsWith ? '' : 'Must begin: "The invention is industrially applicable to"' })
                    rows.push({ label: 'IA length 50–100', ok: er.industrialApplicability?.length>=50 && er.industrialApplicability?.length<=100, remark: `length=${er.industrialApplicability?.length}` })
                    // Figures/numerals
                    rows.push({ label: 'No invalid figure references', ok: !(er.figures?.invalidReferences||[]).length, remark: (er.figures?.invalidReferences||[]).join(', ') })
                    rows.push({ label: 'No numerals used-not-declared', ok: !(er.numerals?.usedNotDeclared||[]).length, remark: (er.numerals?.usedNotDeclared||[]).join(', ') })
                    rows.push({ label: 'No duplicate numerals in text', ok: !(er.numerals?.duplicates||[]).length, remark: (er.numerals?.duplicates||[]).join(', ') })
                    // Claims
                    rows.push({ label: 'Claims ≤ 12', ok: (er.claims?.total||0) <= 12, remark: `total=${er.claims?.total||0}` })
                    rows.push({ label: 'Independent claim ≤150 words', ok: (er.claims?.maxIndependentWords||0) <= 150, remark: `independentWords=${er.claims?.maxIndependentWords||0}` })
                    rows.push({ label: 'No forbidden claim tokens', ok: !(er.claims?.forbiddenHits||[]).length, remark: (er.claims?.forbiddenHits||[]).join(', ') })
                    // Best Method
                    rows.push({ label: 'Best Method has numeric parameter', ok: !!er.bestMethod?.hasNumeric, remark: er.bestMethod?.hasNumeric ? '' : 'Add at least one numeric/procedural setting' })
                    rows.push({ label: 'Best Method hedging density ≤3%', ok: (er.bestMethod?.hedgingDensity||0) <= 0.03, remark: `density=${(er.bestMethod?.hedgingDensity||0).toFixed(3)}` })

                    return rows.map((r, idx) => (
                      <tr key={idx} className="text-gray-800">
                        <td className="px-3 py-2 align-top">{r.label}</td>
                        <td className="px-3 py-2 text-center">{r.ok ? <span className="text-green-600">✔</span> : <span className="text-red-600">✖</span>}</td>
                        <td className="px-3 py-2 text-gray-600">{r.ok ? '' : (r.remark || 'Please adjust to meet IPO guidelines')}</td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
          </div>
        </div>
        )}
        {extReport?.extendedReport && (
          <div className="mt-6 p-4 rounded bg-gray-50">
            <div className="font-medium text-gray-900 mb-2">Recommendations</div>
            <ul className="list-disc ml-6 text-sm text-gray-700 space-y-1">
              {!extReport.extendedReport.abstract?.startsWithTitle && <li>Abstract should begin exactly with the approved Title.</li>}
              {extReport.extendedReport.abstract?.length>150 && <li>Trim Abstract to ≤150 words.</li>}
              {(extReport.extendedReport.bdod?.missingFigures||[]).length>0 && <li>Add BDOD lines for all figures and ensure format “Fig. X — …”.</li>}
              {(extReport.extendedReport.claims?.forbiddenHits||[]).length>0 && <li>Remove forbidden claim terms (and/or, etc., approximately, substantially).</li>}
              {!extReport.extendedReport.industrialApplicability?.present && <li>Add Industrial Applicability (50–100 words) starting with the required phrase.</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <div className="flex justify-end">
          <button
            onClick={() => onRefresh()}
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Next Stage
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
