'use client';

import React, { useMemo } from 'react';
import Stage4ResultsDisplay from './Stage4ResultsDisplay';

interface ConsolidatedNoveltyReportProps {
  searchId: string;
  searchData: any; // full search payload or results blob
}

export default function ConsolidatedNoveltyReport({ searchId, searchData }: ConsolidatedNoveltyReportProps) {
  const stage0 = searchData?.stage0Results || searchData?.stage0 || {};
  const stage1 = searchData?.stage1Results || searchData?.stage1 || {};
  const stage35 = searchData?.stage35Results || searchData?.stage35 || {};
  const stage4 = searchData?.stage4Results || searchData?.stage4 || {};

  const features: string[] = Array.isArray(stage0?.inventionFeatures) ? stage0.inventionFeatures : [];
  const pqai: any[] = Array.isArray(stage1?.pqaiResults) ? stage1.pqaiResults : [];
  const aiRel = stage1?.aiRelevance || null;

  const featureUniq: any[] = Array.isArray(stage35?.per_feature_uniqueness)
    ? stage35.per_feature_uniqueness
    : (Array.isArray(stage35) ? [] : []);
  const perPatentCov: any[] = Array.isArray(stage35?.per_patent_coverage)
    ? stage35.per_patent_coverage
    : (Array.isArray(stage35) ? [] : []);
  const featureMaps: any[] = Array.isArray((stage35 as any)?.feature_map)
    ? (stage35 as any).feature_map
    : (Array.isArray(stage35) ? (stage35 as any) : []);

  const sanitizedTitle = (searchData?.title || 'Consolidated Novelty Report').toString();

  const topPqai = useMemo(() => {
    if (!Array.isArray(pqai)) return [];
    return pqai.slice(0, 8).map((p) => ({
      pn: p.pn || p.publicationNumber || p.publication_number || 'Unknown PN',
      title: p.title || '(untitled)'
    }));
  }, [pqai]);

  const printPortrait = () => window.print();

  const printLandscape = () => {
    // Inject temporary landscape @page rule for printing, then remove
    const style = document.createElement('style');
    style.setAttribute('data-temp-landscape', 'true');
    style.media = 'print';
    style.innerHTML = `@page { size: A4 landscape; margin: 12mm; }`;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => {
      style.remove();
    }, 1000);
  };

  // Helper: status code for matrix cell from Stage 3.5 feature_analysis
  const getMatrixStatus = (pm: any, feature: string): 'P' | 'Pt' | 'A' | '-' => {
    const fa = Array.isArray(pm?.feature_analysis) ? pm.feature_analysis : [];
    const cell = fa.find((c: any) => c.feature === feature);
    if (!cell) return '-';
    if (cell.status === 'Present') return 'P';
    if (cell.status === 'Partial') return 'Pt';
    if (cell.status === 'Absent') return 'A';
    return '-';
  };

  return (
    <div className="consolidated-wrapper">
      {/* Controls (hidden in print) */}
      <div className="no-print flex items-center justify-end gap-2 mb-4">
        <button onClick={printPortrait} className="px-3 py-2 bg-slate-700 text-white rounded-md text-sm">Print</button>
        <button onClick={printLandscape} className="px-3 py-2 bg-slate-700 text-white rounded-md text-sm">Print (Landscape)</button>
      </div>

      {/* Header */}
      <section className="report-section">
        <div className="rounded-xl border bg-white p-5">
          <div className="text-xs text-gray-500">Novelty Search • Consolidated</div>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">{sanitizedTitle}</h1>
          <div className="text-xs text-gray-600 mt-1">Search ID: {searchId} • {new Date().toISOString().slice(0,10)}</div>
        </div>
      </section>

      {/* Stage 0 */}
      <section className="report-section">
        <h2 className="section-title">Stage 0 — Invention Normalization</h2>
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <div>
            <div className="text-xs text-gray-500">Search Query</div>
            <div className="text-sm text-gray-900 whitespace-pre-wrap">{stage0?.searchQuery || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Invention Features</div>
            {Array.isArray(features) && features.length > 0 ? (
              <ul className="list-disc list-inside text-sm text-gray-900">
                {features.map((f, idx) => (<li key={idx}>{f}</li>))}
              </ul>
            ) : (
              <div className="text-xs text-gray-600">No features available.</div>
            )}
          </div>
        </div>
      </section>

      {/* Stage 1 */}
      <section className="report-section">
        <h2 className="section-title">Stage 1 — Patent Search (Patent Database)</h2>
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total Results" value={Array.isArray(pqai) ? pqai.length : '—'} />
            <Kpi label="AI Accepted" value={aiRel?.accepted?.length ?? aiRel?.accepted ?? stage1?.ai_relevance_accepted ?? '—'} />
            <Kpi label="AI Borderline" value={aiRel?.borderline?.length ?? aiRel?.borderline ?? stage1?.ai_relevance_borderline ?? '—'} />
            <Kpi label="Jurisdiction" value={stage0?.jurisdiction || stage1?.jurisdiction || '—'} />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Top Results</div>
            {topPqai.length > 0 ? (
              <ul className="text-sm text-gray-900 space-y-1">
                {topPqai.map((p, idx) => (
                  <li key={idx} className="break-inside-avoid">
                    <span className="font-medium">{p.pn}</span> — {p.title}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-600">No results.</div>
            )}
          </div>

          {/* Detailed Results (same structure as Stage 1 UI) */}
          <div className="pt-2">
            <h4 className="font-medium text-gray-900 mb-3">Patent Database Results (Sorted by Relevance)</h4>
            <div className="space-y-3 max-h-[40rem] overflow-y-auto pr-1">
              {Array.isArray(pqai) && pqai.length > 0 ? (
                pqai.map((r: any, i: number) => {
                  const patentNumber = r.publicationNumber || r.pn || r.patent_number || r.publication_number || 'N/A';
                  const title = r.title || r.invention_title || patentNumber || 'Untitled';
                  const abstract = r.abstract || r.snippet || r.description || '';
                  const pubDate = r.year || r.publication_date || r.filing_date || '';
                  const relevanceScore = r.relevanceScore || r.score || r.relevance || 0;
                  const inventors = r.inventors || r.inventor_names || [];
                  const assignees = r.assignees || r.assignee_names || [];
                  const cpcCodes = r.cpcCodes || r.cpc_codes || [];
                  const ipcCodes = r.ipcCodes || r.ipc_codes || [];

                  const lensHref = `https://lens.org/${encodeURIComponent(String(patentNumber)).replace(/\s+/g, '-')}`;

                  return (
                    <div key={i} className="py-4 px-3 border rounded-lg bg-gray-50 break-inside-avoid">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm flex-shrink-0">
                          {i + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {patentNumber !== 'N/A' ? (
                                <a className="font-medium text-indigo-700 hover:underline text-sm" href={lensHref} target="_blank" rel="noreferrer">
                                  {title}
                                </a>
                              ) : (
                                <div className="font-medium text-gray-800 text-sm">{title}</div>
                              )}
                              <div className="text-xs text-gray-500 mt-1">
                                {patentNumber !== 'N/A' && `Patent: ${patentNumber}`}
                                {pubDate && `${patentNumber !== 'N/A' ? ' • ' : ''}Published: ${String(pubDate).slice(0,10)}`}
                                {relevanceScore !== null && ` • Relevance: ${(Number(relevanceScore) * 100).toFixed(1)}%`}
                              </div>
                            </div>
                          </div>

                          {abstract && (
                            <div className="mt-3">
                              <div className="text-xs font-medium text-gray-700 mb-1">Abstract/Summary:</div>
                              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded border leading-relaxed">
                                {abstract}
                              </div>
                            </div>
                          )}

                          {((Array.isArray(inventors) && inventors.length) ||
                            (Array.isArray(assignees) && assignees.length) ||
                            (Array.isArray(cpcCodes) && cpcCodes.length) ||
                            (Array.isArray(ipcCodes) && ipcCodes.length)) && (
                            <div className="mt-3 text-xs text-gray-600">
                              {Array.isArray(inventors) && inventors.length > 0 && (
                                <div><strong>Inventors:</strong> {inventors.join(', ')}</div>
                              )}
                              {Array.isArray(assignees) && assignees.length > 0 && (
                                <div><strong>Assignees:</strong> {assignees.join(', ')}</div>
                              )}
                              {Array.isArray(cpcCodes) && cpcCodes.length > 0 && (
                                <div>
                                  <strong>CPC Codes:</strong>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {cpcCodes.map((code: string, idx: number) => (
                                      <span key={idx} className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">{code}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {Array.isArray(ipcCodes) && ipcCodes.length > 0 && (
                                <div>
                                  <strong>IPC Codes:</strong>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {ipcCodes.map((code: string, idx: number) => (
                                      <span key={idx} className="bg-purple-50 text-purple-700 px-2 py-1 rounded text-xs">{code}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-500">No patent results available</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stage 3.5 */}
      <section className="report-section">
        <h2 className="section-title">Stage 3.5 - Feature Mapping & Aggregation</h2>
        <div className="rounded-lg border bg-white p-4 space-y-4">
          {/* Feature Uniqueness Table */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Per-feature Uniqueness</div>
            {Array.isArray(featureUniq) && featureUniq.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">Feature</th>
                      <th className="py-2 pr-3">Uniqueness</th>
                      <th className="py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featureUniq.map((u: any, idx: number) => (
                      <tr key={idx} className="align-top border-b break-inside-avoid">
                        <td className="py-2 pr-3 min-w-[12rem]">{u.feature || u.name || `Feature ${idx+1}`}</td>
                        <td className="py-2 pr-3">{typeof u.uniqueness === 'number' ? (Math.round(u.uniqueness * 1000)/10).toFixed(1) + '%' : (u.uniqueness || '—')}</td>
                        <td className="py-2 whitespace-pre-wrap">{u.notes || u.rationale || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-gray-600">No feature aggregation available.</div>
            )}
          </div>

          {/* Per-Patent Coverage Summary */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Per-patent Coverage</div>
            {Array.isArray(perPatentCov) && perPatentCov.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">Patent</th>
                      <th className="py-2 pr-3">Present</th>
                      <th className="py-2 pr-3">Partial</th>
                      <th className="py-2">Absent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perPatentCov.map((p: any, idx: number) => (
                      <tr key={idx} className="align-top border-b break-inside-avoid">
                        <td className="py-2 pr-3 min-w-[10rem]">{p.pn || p.publicationNumber || p.patent_number || 'Unknown PN'}</td>
                        <td className="py-2 pr-3">{p.present_count ?? '—'}</td>
                        <td className="py-2 pr-3">{p.partial_count ?? '—'}</td>
                        <td className="py-2">{p.absent_count ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-gray-600">No coverage data available.</div>
            )}
          </div>

          {/* Patent-wise Feature Comparison Matrix (Patents as rows, Features as columns) */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Patent-wise Feature Comparison Matrix</div>
            {Array.isArray(featureMaps) && featureMaps.length > 0 && Array.isArray(features) && features.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left">Patent</th>
                      {features.map((f: string, idx: number) => {
                        const label = f.length > 18 ? f.substring(0, 16) + '..' : f;
                        return (
                          <th key={idx} className="border p-1 text-center font-semibold text-[11px]">{label}</th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {featureMaps.map((pm: any, rIdx: number) => {
                      const pn = String(pm.pn || pm.publicationNumber || pm.publication_number || 'PN');
                      const pnLabel = pn.length > 16 ? pn.substring(0, 14) + '..' : pn;
                      return (
                        <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-gray-50' : ''}>
                          <td className="border p-2 align-top text-[11px] font-medium">{pnLabel}</td>
                          {features.map((f: string, cIdx: number) => {
                            const status = getMatrixStatus(pm, f);
                            const bg =
                              status === 'P'
                                ? 'bg-green-100 text-green-700 border-green-300'
                                : status === 'Pt'
                                ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                : status === 'A'
                                ? 'bg-red-100 text-red-700 border-red-300'
                                : 'bg-gray-100 text-gray-600 border-gray-300';
                            return (
                              <td key={cIdx} className={`border p-1 text-center font-semibold ${bg}`}>{status}</td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Legend */}
                <div className="mt-2 flex gap-4 text-[11px] text-gray-700">
                  <span><span className="inline-block w-3 h-3 mr-1 align-middle bg-green-500"></span>P = Present</span>
                  <span><span className="inline-block w-3 h-3 mr-1 align-middle bg-yellow-400"></span>Pt = Partial</span>
                  <span><span className="inline-block w-3 h-3 mr-1 align-middle bg-red-500"></span>A = Absent</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-600">Feature mapping matrix not available.</div>
            )}
          </div>
        </div>
      </section>

      {/* Stage 4 (reuse existing display) */}
      <section className="report-section">
        <h2 className="section-title">Stage 4 — Final Assessment</h2>
        <Stage4ResultsDisplay stage4Results={stage4} searchId={searchId} />
      </section>

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body, html { background: #fff; }
          .consolidated-wrapper { padding: 0 !important; }
          .report-section { page-break-inside: auto; break-inside: auto; }
          .report-section .rounded-xl,
          .report-section .rounded-lg { box-shadow: none !important; }
          .report-section .max-h-\[28rem\] { max-height: none !important; }
          .report-section .max-h-96 { max-height: none !important; }
          .report-section .max-h-\[40rem\] { max-height: none !important; }
          .report-section .overflow-auto { overflow: visible !important; }
          .report-section .overflow-y-auto { overflow: visible !important; }

          /* Avoid breaking inside small repeated items */
          .report-section .space-y-2 > div,
          .report-section .space-y-3 > div,
          .report-section li,
          .report-section .py-4.px-3.border { break-inside: avoid; page-break-inside: avoid; }
          .report-section table thead { display: table-header-group; }
          .report-section table tfoot { display: table-footer-group; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          h1, h2, h3 { break-after: avoid; }
          @page { size: A4 portrait; margin: 12mm; }
        }
        .report-section { margin-bottom: 1rem; }
        .section-title { font-size: 1.125rem; font-weight: 600; color: rgb(17 24 39); margin: 0 0 0.5rem 0; }
      `}</style>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{String(value ?? '�')}</div>
    </div>
  );
}




