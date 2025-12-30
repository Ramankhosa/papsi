'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import BibliographyPreview from '@/components/paper/BibliographyPreview';

interface ReviewExportStageProps {
  sessionId: string;
  authToken: string | null;
}

export default function ReviewExportStage({ sessionId, authToken }: ReviewExportStageProps) {
  const [structure, setStructure] = useState<any | null>(null);
  const [wordCounts, setWordCounts] = useState<any | null>(null);
  const [unused, setUnused] = useState<any[]>([]);
  const [bibtex, setBibtex] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [citationCheck, setCitationCheck] = useState<any | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);

  const loadChecks = async () => {
    setMessage(null);
    const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    const [structureRes, wordRes, unusedRes] = await Promise.all([
      fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'analyze_structure' })
      }),
      fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'word_count' })
      }),
      fetch(`/api/papers/${sessionId}/citations/unused`, { headers })
    ]);

    if (structureRes.ok) {
      const data = await structureRes.json();
      setStructure(data);
    }

    if (wordRes.ok) {
      const data = await wordRes.json();
      setWordCounts(data);
    }

    if (unusedRes.ok) {
      const data = await unusedRes.json();
      setUnused(data.citations || []);
    }
  };

  const loadDraftContent = async () => {
    try {
      const response = await fetch(`/api/papers/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!response.ok) return;
      const data = await response.json();
      const drafts = Array.isArray(data.session?.annexureDrafts) ? data.session.annexureDrafts : [];
      const paperDraft = drafts
        .filter((draft: any) => (draft.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((a: any, b: any) => (b?.version || 0) - (a?.version || 0))[0];
      if (!paperDraft?.extraSections) {
        setDraftContent('');
        return;
      }
      const extraSections = typeof paperDraft.extraSections === 'string'
        ? JSON.parse(paperDraft.extraSections)
        : paperDraft.extraSections;
      const content = Object.values(extraSections || {}).join('\n\n');
      setDraftContent(content);
    } catch {
      setDraftContent('');
    }
  };

  const checkCitations = async () => {
    if (!draftContent.trim()) {
      setCitationCheck({ total: 0, missing: [], found: [] });
      return;
    }
    const response = await fetch(`/api/papers/${sessionId}/drafting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({ action: 'check_citations', content: draftContent })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Failed to check citations');
      return;
    }
    setCitationCheck(data);
  };

  const downloadFile = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'docx' | 'latex' | 'bibtex') => {
    try {
      if (!authToken) return;
      setExporting(format);
      setMessage(null);

      const response = await fetch(`/api/papers/${sessionId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }

      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename=\"?([^\";]+)\"?/i.exec(disposition);
      const fallbackName = `paper_${sessionId}.${format === 'bibtex' ? 'bib' : format}`;
      const filename = match?.[1] || fallbackName;

      if (format === 'docx') {
        const blob = await response.blob();
        downloadFile(blob, filename);
        return;
      }

      const text = await response.text();
      if (format === 'bibtex') {
        setBibtex(text);
      }

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      downloadFile(blob, filename);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (sessionId && authToken) {
      loadChecks().catch(() => undefined);
      loadDraftContent().catch(() => undefined);
    }
  }, [sessionId, authToken]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Pre-export Checks</CardTitle>
          <CardDescription>Review completeness and citation usage.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Button variant="secondary" onClick={loadChecks}>Refresh Checks</Button>
            <div className="text-sm text-gray-700">
              <div>Missing required sections: {structure?.validation?.missingRequiredSections?.length || 0}</div>
              <div>Total word count: {wordCounts?.total || 0}</div>
              <div>Unused citations: {unused.length}</div>
            </div>
            {structure?.validation?.missingRequiredSections?.length > 0 && (
              <div className="text-sm text-red-600">
                Missing sections: {structure.validation.missingRequiredSections.join(', ')}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={checkCitations}>Check citations</Button>
              {citationCheck && (
                <Badge variant="secondary">
                  Missing citation keys: {citationCheck.missing?.length || 0}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>Export your paper in preferred formats.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => handleExport('docx')}
                disabled={exporting !== null}
              >
                {exporting === 'docx' ? 'Exporting DOCX...' : 'Export DOCX'}
              </Button>
              <Button variant="secondary" disabled>
                Export PDF (soon)
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleExport('latex')}
                disabled={exporting !== null}
              >
                {exporting === 'latex' ? 'Exporting LaTeX...' : 'Export LaTeX'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleExport('bibtex')}
                disabled={exporting !== null}
              >
                {exporting === 'bibtex' ? 'Exporting BibTeX...' : 'Export BibTeX'}
              </Button>
              <Button variant="secondary" disabled>Export Markdown (soon)</Button>
            </div>
            <Textarea value={bibtex} readOnly rows={8} />
            <div className="text-xs text-gray-500">
              Exported files should include a bibliography and proper citation formatting.
            </div>
          </div>
        </CardContent>
      </Card>

      <BibliographyPreview sessionId={sessionId} authToken={authToken} />

      <Card>
        <CardHeader>
          <CardTitle>Disclosure</CardTitle>
          <CardDescription>Academic integrity and AI usage notes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-600">
            Ensure you follow your institution's guidance on AI-assisted writing, citation accuracy, and originality checks.
          </div>
        </CardContent>
      </Card>

      {message && <div className="text-sm text-red-600">{message}</div>}
    </div>
  );
}
