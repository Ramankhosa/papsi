'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface FullTextEvidenceExtractionStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
}

interface CandidateRow {
  citationId: string;
  citationKey: string;
  title: string;
  depthLabel: string;
  referenceArchetype: string;
  deepAnalysisStatus: string | null;
  evidenceCardCount: number;
  ready: boolean;
  readinessReason: string | null;
  documentId: string | null;
  referenceId: string | null;
  parserCandidate: 'GROBID' | 'REGEX_FALLBACK' | null;
}

interface CandidatePayload {
  ready: CandidateRow[];
  notReady: CandidateRow[];
  totalEligible: number;
}

interface DeepAnalysisStatusPayload {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL';
  totalJobs: number;
  completed: number;
  failed: number;
  inProgress: number;
  totalCardsExtracted: number;
  totalMappingsCreated: number;
  estimatedSecondsRemaining: number | null;
  jobs: Array<{
    jobId: string;
    citationId: string;
    citationKey: string;
    status: string;
    cardsExtracted: number | null;
    error: string | null;
  }>;
}

interface CoveragePayload {
  overallCoverage: number;
  gaps: string[];
  totalCards: number;
  matrix: Array<{
    citationKey: string;
    sections: Record<string, number>;
  }>;
  dimensionCoverage: Array<{
    sectionKey: string;
    dimension: string;
    cardCount: number;
    paperCount: number;
    minConfidence: string;
  }>;
}

interface EvidenceCardRow {
  id: string;
  citationKey: string;
  citationId: string;
  claim: string;
  claimType: string;
  quantitativeDetail: string | null;
  conditions: string | null;
  doesNotSupport: string | null;
  studyDesign: string | null;
  sourceFragment: string;
  pageHint: string | null;
  confidence: string;
  sourceSection: string | null;
  quoteVerified: boolean;
  mappings: Array<{
    sectionKey: string;
    dimension: string;
    useAs: string;
    mappingConfidence: string;
  }>;
}

interface CardsPayload {
  totalCards: number;
  page: number;
  limit: number;
  cards: EvidenceCardRow[];
}

type ActionState =
  | 'starting'
  | 'stopping'
  | 'retrying'
  | 'remapping'
  | null;

type ViewMode = 'paper' | 'dimension' | 'section';

function statusBadgeClass(status: string): string {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'COMPLETED') return 'bg-emerald-100 text-emerald-800';
  if (normalized === 'FAILED') return 'bg-red-100 text-red-800';
  if (normalized === 'EXTRACTING' || normalized === 'MAPPING' || normalized === 'PREPARING') {
    return 'bg-amber-100 text-amber-800';
  }
  if (normalized === 'RUNNING' || normalized === 'PENDING') return 'bg-blue-100 text-blue-800';
  return 'bg-slate-100 text-slate-700';
}

function claimTypeBadgeClass(claimType: string): string {
  const normalized = String(claimType || '').toUpperCase();
  if (normalized === 'FINDING') return 'bg-emerald-100 text-emerald-800';
  if (normalized === 'LIMITATION') return 'bg-amber-100 text-amber-800';
  if (normalized === 'GAP') return 'bg-rose-100 text-rose-800';
  if (normalized === 'METHOD') return 'bg-sky-100 text-sky-800';
  return 'bg-slate-100 text-slate-700';
}

export default function FullTextEvidenceExtractionStage({
  sessionId,
  authToken,
  onSessionUpdated
}: FullTextEvidenceExtractionStageProps) {
  const [readyCandidates, setReadyCandidates] = useState<CandidateRow[]>([]);
  const [notReadyCandidates, setNotReadyCandidates] = useState<CandidateRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [statusPayload, setStatusPayload] = useState<DeepAnalysisStatusPayload | null>(null);
  const [coveragePayload, setCoveragePayload] = useState<CoveragePayload | null>(null);
  const [cardsPayload, setCardsPayload] = useState<CardsPayload | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('paper');
  const [claimTypeFilter, setClaimTypeFilter] = useState<string>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('ALL');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'true' | 'false'>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [expandedPaperGroups, setExpandedPaperGroups] = useState<Set<string>>(new Set());

  const [lastEstimatedSeconds, setLastEstimatedSeconds] = useState<number | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [cardsLoading, setCardsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fullTextModalCandidate, setFullTextModalCandidate] = useState<CandidateRow | null>(null);
  const [fullTextModalContent, setFullTextModalContent] = useState<string>('');
  const [fullTextModalError, setFullTextModalError] = useState<string | null>(null);
  const [loadingFullTextCitationId, setLoadingFullTextCitationId] = useState<string | null>(null);
  const hasInitializedSelectionRef = useRef(false);
  const cardsRequestIdRef = useRef(0);
  const refreshRequestIdRef = useRef(0);
  const onSessionUpdatedRef = useRef(onSessionUpdated);

  const authHeaders = useMemo<Record<string, string>>(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : ({} as Record<string, string>)),
    [authToken]
  );

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  const loadSession = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}`, { headers: authHeaders });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to load session');
    }
    onSessionUpdatedRef.current?.(payload.session);
  }, [authHeaders, authToken, sessionId]);

  const loadCandidates = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/candidates`, { headers: authHeaders });
    const payload: CandidatePayload = await response.json();
    if (!response.ok) {
      throw new Error((payload as any)?.error || 'Failed to load deep-analysis candidates');
    }
    setReadyCandidates(Array.isArray(payload.ready) ? payload.ready : []);
    setNotReadyCandidates(Array.isArray(payload.notReady) ? payload.notReady : []);
  }, [authHeaders, authToken, sessionId]);

  const loadStatus = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/status`, { headers: authHeaders });
    const payload: DeepAnalysisStatusPayload = await response.json();
    if (!response.ok) {
      throw new Error((payload as any)?.error || 'Failed to load deep-analysis status');
    }
    setStatusPayload(payload);
  }, [authHeaders, authToken, sessionId]);

  const loadCoverage = useCallback(async () => {
    if (!authToken) return;
    const response = await fetch(`/api/papers/${sessionId}/deep-analysis/coverage`, { headers: authHeaders });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to load deep-analysis coverage');
    }
    setCoveragePayload({
      overallCoverage: Number(payload?.overallCoverage || 0),
      gaps: Array.isArray(payload?.gaps) ? payload.gaps : [],
      totalCards: Number(payload?.totalCards || 0),
      matrix: Array.isArray(payload?.matrix) ? payload.matrix : [],
      dimensionCoverage: Array.isArray(payload?.dimensionCoverage) ? payload.dimensionCoverage : [],
    });
  }, [authHeaders, authToken, sessionId]);

  const loadCards = useCallback(async () => {
    if (!authToken) return;
    const requestId = ++cardsRequestIdRef.current;
    setCardsLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('view', viewMode);
      query.set('limit', '200');
      if (claimTypeFilter !== 'ALL') query.set('claimType', claimTypeFilter);
      if (confidenceFilter !== 'ALL') query.set('confidence', confidenceFilter);
      if (verifiedFilter !== 'all') query.set('verified', verifiedFilter);

      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/cards?${query.toString()}`, { headers: authHeaders });
      const payload: CardsPayload = await response.json();
      if (!response.ok) {
        throw new Error((payload as any)?.error || 'Failed to load evidence cards');
      }
      if (requestId !== cardsRequestIdRef.current) {
        return;
      }
      setCardsPayload(payload);
    } finally {
      if (requestId === cardsRequestIdRef.current) {
        setCardsLoading(false);
      }
    }
  }, [authHeaders, authToken, claimTypeFilter, confidenceFilter, sessionId, verifiedFilter, viewMode]);

  const refreshAll = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setIsRefreshing(true);
    setError(null);
    try {
      await Promise.all([
        loadSession(),
        loadCandidates(),
        loadStatus(),
        loadCoverage(),
        loadCards()
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh full-text evidence extraction state');
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [loadCandidates, loadCards, loadCoverage, loadSession, loadStatus]);

  const refreshAllRef = useRef(refreshAll);

  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    if (!authToken) return;
    void refreshAllRef.current();
  }, [authToken, sessionId]);

  useEffect(() => {
    setSelectedIds(prev => {
      const readySet = new Set(readyCandidates.map(candidate => candidate.citationId));
      if (readySet.size === 0) {
        hasInitializedSelectionRef.current = false;
        return new Set();
      }

      if (!hasInitializedSelectionRef.current) {
        hasInitializedSelectionRef.current = true;
        return readySet;
      }

      return new Set(Array.from(prev).filter(id => readySet.has(id)));
    });
  }, [readyCandidates]);

  useEffect(() => {
    if (statusPayload?.status !== 'RUNNING') return;
    const timer = window.setInterval(() => {
      void Promise.all([loadStatus(), loadCoverage(), loadCards()]).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadCards, loadCoverage, loadStatus, statusPayload?.status]);

  useEffect(() => {
    if (statusPayload?.status === 'IDLE') {
      setLastEstimatedSeconds(null);
    }
  }, [statusPayload?.status]);

  useEffect(() => {
    void loadCards().catch(() => undefined);
  }, [loadCards]);

  const handleStart = useCallback(async () => {
    if (!authToken || selectedIds.size === 0) return;
    setActionState('starting');
    setError(null);
    setLastEstimatedSeconds(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ citationIds: Array.from(selectedIds) })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to start deep analysis');
      }
      setLastEstimatedSeconds(Number(payload?.estimatedSeconds || 0) || null);
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start deep analysis');
    } finally {
      setActionState(null);
    }
  }, [authToken, loadCandidates, loadCards, loadSession, loadStatus, selectedIds, sessionId]);

  const handleStop = useCallback(async () => {
    if (!authToken) return;
    setActionState('stopping');
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/stop`, {
        method: 'POST',
        headers: authHeaders
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to stop deep analysis');
      }
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop deep analysis');
    } finally {
      setActionState(null);
    }
  }, [authHeaders, authToken, loadCandidates, loadCards, loadSession, loadStatus, sessionId]);

  const handleRetryFailed = useCallback(async () => {
    if (!authToken || !statusPayload) return;
    const failed = statusPayload.jobs.filter(job => String(job.status || '').toUpperCase() === 'FAILED');
    if (failed.length === 0) return;

    setActionState('retrying');
    setError(null);
    setLastEstimatedSeconds(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ jobIds: failed.map(job => job.jobId) })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to retry failed jobs');
      }
      await Promise.all([loadStatus(), loadCandidates(), loadSession(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry failed jobs');
    } finally {
      setActionState(null);
    }
  }, [authToken, loadCandidates, loadCards, loadSession, loadStatus, sessionId, statusPayload]);

  const handleRemap = useCallback(async () => {
    if (!authToken) return;
    setActionState('remapping');
    setError(null);
    try {
      const response = await fetch(`/api/papers/${sessionId}/deep-analysis/remap`, {
        method: 'POST',
        headers: authHeaders
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to remap evidence cards');
      }
      await Promise.all([loadStatus(), loadCoverage(), loadCards()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remap evidence cards');
    } finally {
      setActionState(null);
    }
  }, [authHeaders, authToken, loadCards, loadCoverage, loadStatus, sessionId]);

  const handleViewExtractedText = useCallback(async (candidate: CandidateRow) => {
    if (!authToken) return;

    setFullTextModalCandidate(candidate);
    setFullTextModalContent('');
    setFullTextModalError(null);

    if (!candidate.referenceId) {
      setFullTextModalError('This citation is not linked to a library reference yet.');
      return;
    }

    setLoadingFullTextCitationId(candidate.citationId);
    try {
      const response = await fetch(`/api/references/${candidate.referenceId}/full-text`, {
        headers: authHeaders,
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load extracted full text');
      }

      const text = String(payload?.text || '').trim();
      if (!text) {
        throw new Error('Extracted text is not available yet.');
      }

      setFullTextModalContent(text);
    } catch (err) {
      setFullTextModalError(err instanceof Error ? err.message : 'Failed to load extracted full text');
    } finally {
      setLoadingFullTextCitationId(null);
    }
  }, [authHeaders, authToken]);

  const eligibleCount = readyCandidates.length + notReadyCandidates.length;

  const selectedReadyCount = useMemo(() => {
    return readyCandidates.filter(candidate => selectedIds.has(candidate.citationId)).length;
  }, [readyCandidates, selectedIds]);

  const failedJobCount = statusPayload?.jobs?.filter(job => String(job.status || '').toUpperCase() === 'FAILED').length || 0;
  const estimatedCostLabel = useMemo(() => {
    if (selectedReadyCount <= 0) return '~$0.00';
    const low = selectedReadyCount * 0.03;
    const high = selectedReadyCount * 0.09;
    return low === high
      ? `~$${low.toFixed(2)}`
      : `~$${low.toFixed(2)} - $${high.toFixed(2)}`;
  }, [selectedReadyCount]);

  const progressPercent = useMemo(() => {
    if (!statusPayload || statusPayload.totalJobs === 0) return 0;
    return Math.round(((statusPayload.completed + statusPayload.failed) / statusPayload.totalJobs) * 100);
  }, [statusPayload]);

  const filteredCards = useMemo(() => {
    const cards = Array.isArray(cardsPayload?.cards) ? cardsPayload.cards : [];
    const query = searchFilter.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter(card => {
      const text = [
        card.citationKey,
        card.claim,
        card.quantitativeDetail || '',
        card.conditions || '',
        card.doesNotSupport || '',
        card.sourceFragment || ''
      ].join(' ').toLowerCase();
      return text.includes(query);
    });
  }, [cardsPayload?.cards, searchFilter]);

  const paperGroups = useMemo(() => {
    const groups = new Map<string, { citationKey: string; citationId: string; cards: EvidenceCardRow[] }>();
    for (const card of filteredCards) {
      const key = `${card.citationId}::${card.citationKey}`;
      if (!groups.has(key)) {
        groups.set(key, { citationKey: card.citationKey, citationId: card.citationId, cards: [] });
      }
      groups.get(key)!.cards.push(card);
    }
    return Array.from(groups.values()).sort((a, b) => b.cards.length - a.cards.length || a.citationKey.localeCompare(b.citationKey));
  }, [filteredCards]);

  const dimensionGroups = useMemo(() => {
    const groups = new Map<string, { sectionKey: string; dimension: string; cards: EvidenceCardRow[] }>();
    for (const card of filteredCards) {
      for (const mapping of card.mappings || []) {
        const key = `${mapping.sectionKey}::${mapping.dimension}`;
        if (!groups.has(key)) {
          groups.set(key, { sectionKey: mapping.sectionKey, dimension: mapping.dimension, cards: [] });
        }
        groups.get(key)!.cards.push(card);
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      return a.sectionKey.localeCompare(b.sectionKey) || a.dimension.localeCompare(b.dimension);
    });
  }, [filteredCards]);

  const sectionGroups = useMemo(() => {
    const sections = new Map<string, Array<{ dimension: string; cards: EvidenceCardRow[] }>>();
    for (const group of dimensionGroups) {
      if (!sections.has(group.sectionKey)) {
        sections.set(group.sectionKey, []);
      }
      sections.get(group.sectionKey)!.push({
        dimension: group.dimension,
        cards: group.cards
      });
    }
    return Array.from(sections.entries())
      .map(([sectionKey, dimensions]) => ({
        sectionKey,
        dimensions: dimensions.sort((a, b) => a.dimension.localeCompare(b.dimension)),
        cardCount: dimensions.reduce((sum, dim) => sum + dim.cards.length, 0)
      }))
      .sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));
  }, [dimensionGroups]);

  const running = statusPayload?.status === 'RUNNING';
  const isMutating = actionState !== null;

  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-indigo-900">Full-Text Evidence Extraction</CardTitle>
          <CardDescription className="text-indigo-800/80">
            Select ready papers, run deep extraction jobs, and map evidence cards to blueprint dimensions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge className="bg-indigo-100 text-indigo-800">Eligible: {eligibleCount}</Badge>
            <Badge className="bg-emerald-100 text-emerald-800">Ready: {readyCandidates.length}</Badge>
            <Badge className="bg-amber-100 text-amber-800">Not Ready: {notReadyCandidates.length}</Badge>
            <Badge className="bg-blue-100 text-blue-800">Selected: {selectedReadyCount}</Badge>
            <Badge className="bg-emerald-100 text-emerald-800">Completed: {statusPayload?.completed || 0}</Badge>
            <Badge className="bg-red-100 text-red-800">Failed: {statusPayload?.failed || 0}</Badge>
            <Badge className="bg-slate-100 text-slate-700">Cards: {statusPayload?.totalCardsExtracted || 0}</Badge>
            <Badge className="bg-indigo-100 text-indigo-800">Mappings: {statusPayload?.totalMappingsCreated || 0}</Badge>
          </div>

          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="text-xs text-slate-700">
            {running && statusPayload?.estimatedSecondsRemaining !== null
              ? `Estimated remaining: ~${statusPayload.estimatedSecondsRemaining}s`
              : lastEstimatedSeconds
                ? `Last estimate: ~${lastEstimatedSeconds}s`
                : 'Run estimate will appear after start'}
          </div>
          <div className="text-xs text-slate-700">Estimated cost: {estimatedCostLabel}</div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleStart}
              disabled={isMutating || running || selectedReadyCount === 0}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {actionState === 'starting' ? 'Starting...' : `Start Deep Analysis (${selectedReadyCount})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={isMutating || !running}
            >
              {actionState === 'stopping' ? 'Stopping...' : 'Stop Processing'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryFailed}
              disabled={isMutating || failedJobCount === 0}
            >
              {actionState === 'retrying' ? 'Retrying...' : `Retry Failed (${failedJobCount})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRemap}
              disabled={isMutating}
            >
              {actionState === 'remapping' ? 'Remapping...' : 'Re-map Cards'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={isMutating || isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="border rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border-b">
                Ready for Analysis ({readyCandidates.length})
              </div>
              <div className="max-h-56 overflow-auto">
                {readyCandidates.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600">No ready papers.</div>
                )}
                {readyCandidates.map(candidate => {
                  const checked = selectedIds.has(candidate.citationId);
                  const status = String(candidate.deepAnalysisStatus || 'PENDING').toUpperCase();
                  return (
                    <div
                      key={candidate.citationId}
                      className="flex items-start gap-2 px-3 py-2 border-b last:border-b-0 text-xs"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (event.target.checked) next.add(candidate.citationId);
                            else next.delete(candidate.citationId);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-800 truncate">
                          {candidate.citationKey} - {candidate.title}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge className="bg-slate-100 text-slate-700">{candidate.depthLabel}</Badge>
                          <Badge className="bg-slate-100 text-slate-700">{candidate.referenceArchetype}</Badge>
                          <Badge className={statusBadgeClass(status)}>{status}</Badge>
                          {candidate.parserCandidate && (
                            <Badge className="bg-indigo-100 text-indigo-800">{candidate.parserCandidate}</Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] whitespace-nowrap"
                        onClick={() => void handleViewExtractedText(candidate)}
                        disabled={!candidate.referenceId || loadingFullTextCitationId === candidate.citationId}
                      >
                        {loadingFullTextCitationId === candidate.citationId ? 'Loading...' : 'View Text'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border-b">
                Not Ready ({notReadyCandidates.length})
              </div>
              <div className="max-h-56 overflow-auto">
                {notReadyCandidates.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600">All eligible papers are ready.</div>
                )}
                {notReadyCandidates.map(candidate => (
                  <div
                    key={candidate.citationId}
                    className="px-3 py-2 border-b last:border-b-0 text-xs"
                  >
                    <div className="font-medium text-slate-800 truncate">
                      {candidate.citationKey} - {candidate.title}
                    </div>
                    <div className="mt-1 text-red-700">
                      {candidate.readinessReason || 'No extractable text available'}
                    </div>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void handleViewExtractedText(candidate)}
                        disabled={!candidate.referenceId || loadingFullTextCitationId === candidate.citationId}
                      >
                        {loadingFullTextCitationId === candidate.citationId ? 'Loading...' : 'View Text'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {statusPayload?.jobs?.length ? (
            <div className="text-xs text-slate-700 space-y-1">
              <div className="font-medium text-slate-900">Recent Job States</div>
              {statusPayload.jobs.slice(0, 8).map(job => (
                <div key={job.jobId} className="flex items-center gap-2">
                  <span className="font-medium">[{job.citationKey}]</span>
                  <Badge className={statusBadgeClass(job.status)}>{job.status}</Badge>
                  {typeof job.cardsExtracted === 'number' && (
                    <span className="text-slate-500">{job.cardsExtracted} cards</span>
                  )}
                  {job.error && <span className="text-red-600 truncate">{job.error}</span>}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Evidence Review</CardTitle>
          <CardDescription>
            Browse extracted cards by paper, dimension, or section before drafting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={viewMode === 'paper' ? 'default' : 'outline'}
              onClick={() => setViewMode('paper')}
            >
              By Paper
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'dimension' ? 'default' : 'outline'}
              onClick={() => setViewMode('dimension')}
            >
              By Dimension
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'section' ? 'default' : 'outline'}
              onClick={() => setViewMode('section')}
            >
              By Section
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <select
              className="h-9 rounded-md border px-2 text-xs"
              value={claimTypeFilter}
              onChange={(event) => setClaimTypeFilter(event.target.value)}
            >
              <option value="ALL">All Types</option>
              <option value="FINDING">FINDING</option>
              <option value="METHOD">METHOD</option>
              <option value="DEFINITION">DEFINITION</option>
              <option value="FRAMEWORK">FRAMEWORK</option>
              <option value="LIMITATION">LIMITATION</option>
              <option value="GAP">GAP</option>
            </select>
            <select
              className="h-9 rounded-md border px-2 text-xs"
              value={confidenceFilter}
              onChange={(event) => setConfidenceFilter(event.target.value)}
            >
              <option value="ALL">All Confidence</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
            <select
              className="h-9 rounded-md border px-2 text-xs"
              value={verifiedFilter}
              onChange={(event) => setVerifiedFilter(event.target.value as 'all' | 'true' | 'false')}
            >
              <option value="all">All Quotes</option>
              <option value="true">Verified Only</option>
              <option value="false">Unverified Only</option>
            </select>
            <input
              className="h-9 rounded-md border px-2 text-xs"
              placeholder="Search claims..."
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
            />
          </div>

          <div className="text-xs text-slate-700">
            {cardsLoading ? 'Loading evidence cards...' : `${cardsPayload?.totalCards || 0} cards loaded`} | showing {filteredCards.length} after search | coverage{' '}
            {Math.round(Number(coveragePayload?.overallCoverage || 0) * 100)}%
            {' '}| mapped dimensions {coveragePayload?.dimensionCoverage?.length || 0}
            {' '}| matrix rows {coveragePayload?.matrix?.length || 0}
            {' '}| coverage cards {coveragePayload?.totalCards || 0}
            {coveragePayload?.gaps?.length ? ` | gaps: ${coveragePayload.gaps.join(', ')}` : ''}
          </div>
          <div className="max-h-[32rem] overflow-auto border rounded-md">
            {viewMode === 'paper' && (
              <div className="divide-y">
                {paperGroups.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600">No evidence cards found.</div>
                )}
                {paperGroups.map(group => {
                  const groupKey = `${group.citationId}::${group.citationKey}`;
                  const expanded = expandedPaperGroups.has(groupKey);
                  const visibleCards = expanded ? group.cards : group.cards.slice(0, 5);
                  return (
                  <div key={groupKey} className="px-3 py-3">
                    <div className="text-xs font-semibold text-slate-900">
                      {group.citationKey} ({group.cards.length} cards)
                    </div>
                    <div className="mt-2 space-y-2">
                      {visibleCards.map(card => (
                        <div key={card.id} className="rounded border p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge className={claimTypeBadgeClass(card.claimType)}>{card.claimType}</Badge>
                            <Badge className={statusBadgeClass(card.confidence)}>{card.confidence}</Badge>
                            <Badge className={card.quoteVerified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>
                              {card.quoteVerified ? 'Quote Verified' : 'Quote Unverified'}
                            </Badge>
                          </div>
                          <div className="mt-1 text-slate-800">{card.claim}</div>
                          {card.quantitativeDetail && <div className="mt-1 text-slate-700">Detail: {card.quantitativeDetail}</div>}
                          {card.doesNotSupport && <div className="mt-1 text-amber-800">Does NOT support: {card.doesNotSupport}</div>}
                        </div>
                      ))}
                    </div>
                    {group.cards.length > 5 && (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setExpandedPaperGroups(prev => {
                              const next = new Set(prev);
                              if (expanded) next.delete(groupKey);
                              else next.add(groupKey);
                              return next;
                            });
                          }}
                        >
                          {expanded ? 'Show Less' : `Show All (${group.cards.length})`}
                        </Button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            {viewMode === 'dimension' && (
              <div className="divide-y">
                {dimensionGroups.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600">No dimension mappings found.</div>
                )}
                {dimensionGroups.map(group => (
                  <div key={`${group.sectionKey}::${group.dimension}`} className="px-3 py-3">
                    <div className="text-xs font-semibold text-slate-900">
                      {group.sectionKey} / {group.dimension} ({group.cards.length} cards)
                    </div>
                    <div className="mt-2 space-y-2">
                      {group.cards.slice(0, 5).map(card => (
                        <div key={card.id} className="rounded border p-2 text-xs">
                          <div className="font-medium text-slate-800">[{card.citationKey}] {card.claim}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge className={statusBadgeClass(card.confidence)}>{card.confidence}</Badge>
                            {card.mappings
                              .filter(mapping => mapping.sectionKey === group.sectionKey && mapping.dimension === group.dimension)
                              .slice(0, 2)
                              .map(mapping => (
                                <Badge key={`${card.id}-${mapping.useAs}-${mapping.sectionKey}`} className="bg-indigo-100 text-indigo-800">
                                  {mapping.useAs}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'section' && (
              <div className="divide-y">
                {sectionGroups.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-600">No section mappings found.</div>
                )}
                {sectionGroups.map(section => (
                  <div key={section.sectionKey} className="px-3 py-3">
                    <div className="text-xs font-semibold text-slate-900">
                      {section.sectionKey} ({section.cardCount} cards)
                    </div>
                    <div className="mt-2 space-y-2">
                      {section.dimensions.map(dimension => (
                        <div key={`${section.sectionKey}::${dimension.dimension}`} className="rounded border p-2 text-xs">
                          <div className="font-medium text-slate-800">
                            {dimension.dimension} ({dimension.cards.length})
                          </div>
                          <div className="mt-1 text-slate-700">
                            {Array.from(new Set(dimension.cards.map(card => card.citationKey))).slice(0, 6).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(fullTextModalCandidate)}
        onOpenChange={(open) => {
          if (!open) {
            setFullTextModalCandidate(null);
            setFullTextModalContent('');
            setFullTextModalError(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl bg-white border-gray-200 shadow-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Extracted Full Text</DialogTitle>
            <DialogDescription>
              {fullTextModalCandidate
                ? `${fullTextModalCandidate.citationKey} - ${fullTextModalCandidate.title}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {fullTextModalError ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {fullTextModalError}
            </div>
          ) : (
            <div className="overflow-y-auto border rounded-md p-3 bg-gray-50 max-h-[62vh]">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-800 font-sans">
                {fullTextModalContent}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
