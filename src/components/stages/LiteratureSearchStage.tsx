'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CitationManager from '@/components/paper/CitationManager';
import { useToast } from '@/components/ui/toast';

interface LiteratureSearchStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
}

const SOURCE_OPTIONS = [
  { value: 'google_scholar', label: 'Google Scholar', description: 'Broad academic search' },
  { value: 'semantic_scholar', label: 'Semantic Scholar', description: 'Rich abstracts & citations' },
  { value: 'crossref', label: 'CrossRef', description: 'Authoritative DOI data' },
  { value: 'openalex', label: 'OpenAlex', description: 'Open academic graph' }
];

const SOURCE_ABSTRACT_SUPPORT: Record<string, boolean> = {
  google_scholar: false, // Only snippets
  semantic_scholar: true, // Full abstracts
  crossref: true, // Sometimes has abstracts
  openalex: true, // Full abstracts (reconstructed)
};

// Intelligent loading messages that rotate while searching
const SEARCH_LOADING_MESSAGES = [
  { text: 'Querying academic databases...', icon: '🔍' },
  { text: 'Searching Semantic Scholar for relevant papers...', icon: '📚' },
  { text: 'Cross-referencing citations in CrossRef...', icon: '🔗' },
  { text: 'Analyzing OpenAlex knowledge graph...', icon: '🧠' },
  { text: 'Matching keywords to research topics...', icon: '🎯' },
  { text: 'Filtering by publication year and venue...', icon: '📅' },
  { text: 'Ranking results by citation impact...', icon: '📊' },
  { text: 'Extracting abstracts and metadata...', icon: '📝' },
  { text: 'Deduplicating across sources...', icon: '🔄' },
  { text: 'Preparing your personalized results...', icon: '✨' },
];

export default function LiteratureSearchStage({ sessionId, authToken, onSessionUpdated }: LiteratureSearchStageProps) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [sources, setSources] = useState<string[]>(['semantic_scholar', 'crossref', 'openalex']);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [citations, setCitations] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [bibtexInput, setBibtexInput] = useState('');
  const [doiInput, setDoiInput] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [gapAnalysis, setGapAnalysis] = useState<any | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);
  
  // Expandable abstracts
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());
  
  // Add Citations mode: 'search' | 'library' | 'import'
  const [addMode, setAddMode] = useState<'search' | 'library' | 'import'>('search');
  
  // Manual entry modal
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  
  // Gap Analysis modal
  const [gapModalOpen, setGapModalOpen] = useState(false);
  
  // Citations panel - search and selection
  const [citationSearch, setCitationSearch] = useState('');
  const [selectedCitations, setSelectedCitations] = useState<Set<string>>(new Set());
  
  // Libraries for "Save to Library" feature
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [saveToLibraryResult, setSaveToLibraryResult] = useState<{ resultId: string; success: boolean; libraryName: string } | null>(null);

  // AI Relevance Suggestion feature
  const [searchRunId, setSearchRunId] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, { isRelevant: boolean; score: number; reasoning: string }>>(new Map());
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const importedKeys = useMemo(() => new Set(citations.map(c => c.doi || c.title)), [citations]);
  
  // Load libraries for "Save to Library" feature
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/collections', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken]);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  // Rotate loading messages while searching
  useEffect(() => {
    if (!loading) {
      setLoadingMessageIndex(0);
      return;
    }
    
    const interval = setInterval(() => {
      setLoadingMessageIndex(prev => (prev + 1) % SEARCH_LOADING_MESSAGES.length);
    }, 2000); // Change message every 2 seconds
    
    return () => clearInterval(interval);
  }, [loading]);

  // Save search result to library
  const handleSaveToLibrary = async (result: any, libraryId: string) => {
    if (!authToken) return;
    
    const library = libraries.find(l => l.id === libraryId);
    const libraryName = library?.name || 'Library';
    
    try {
      // First, add to personal library
      const createResponse = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          title: result.title,
          authors: result.authors || [],
          year: result.year,
          venue: result.venue,
          doi: result.doi,
          url: result.url,
          abstract: result.abstract,
          sourceType: 'JOURNAL_ARTICLE'
        })
      });
      
      if (!createResponse.ok) {
        const data = await createResponse.json();
        throw new Error(data.error || 'Failed to save');
      }
      
      const { reference } = await createResponse.json();
      
      // Then add to specific library/collection
      await fetch(`/api/library/collections/${libraryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'addReferences',
          referenceIds: [reference.id]
        })
      });
      
      // Show success toast
      showToast({
        type: 'success',
        title: 'Saved to Library',
        message: `"${result.title.slice(0, 50)}${result.title.length > 50 ? '...' : ''}" added to ${libraryName}`,
        duration: 4000
      });
      
      setSaveToLibraryResult({ resultId: result.id, success: true, libraryName });
      loadLibraries();
      
      // Clear state after 3 seconds
      setTimeout(() => setSaveToLibraryResult(null), 3000);
    } catch (err) {
      console.error('Failed to save to library:', err);
      
      // Show error toast
      showToast({
        type: 'error',
        title: 'Failed to Save',
        message: err instanceof Error ? err.message : 'Could not save citation to library',
        duration: 5000
      });
      
      setSaveToLibraryResult({ resultId: result.id, success: false, libraryName: '' });
      setTimeout(() => setSaveToLibraryResult(null), 3000);
    }
  };
  
  const toggleAbstract = useCallback((id: string) => {
    setExpandedAbstracts(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const refreshSession = async () => {
    if (!authToken) return;
    const sessionRes = await fetch(`/api/papers/${sessionId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (sessionRes.ok) {
      const sessionData = await sessionRes.json();
      setSession(sessionData.session);
      onSessionUpdated?.(sessionData.session);
    }
  };

  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}/literature/suggestions`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    };

    const loadCitations = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}/citations`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setCitations(data.citations || []);
      } catch {
        setCitations([]);
      }
    };

    if (sessionId && authToken) {
      loadSuggestions();
      loadCitations();
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch(`/api/papers/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        setSession(data.session);
      } catch {
        setSession(null);
      }
    };

    if (sessionId && authToken) {
      loadSession();
    }
  }, [sessionId, authToken]);

  const toggleSource = (value: string) => {
    setSources(prev => prev.includes(value)
      ? prev.filter(item => item !== value)
      : [...prev, value]
    );
  };

  const citationTargets = useMemo(() => {
    const type = session?.paperType || {};
    const min = type.minCitations || type.minimumCitations;
    const recommended = type.recommendedCitations || type.citationRange;
    if (Array.isArray(recommended) && recommended.length === 2) {
      return { min, recommended: `${recommended[0]}-${recommended[1]}` };
    }
    if (typeof recommended === 'string') {
      return { min, recommended };
    }
    return { min, recommended: null };
  }, [session?.paperType]);

  const handleBibtexFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setBibtexInput(text);
    };
    reader.readAsText(file);
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/papers/${sessionId}/literature/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          query,
          sources,
          yearFrom: yearFrom ? parseInt(yearFrom, 10) : undefined,
          yearTo: yearTo ? parseInt(yearTo, 10) : undefined
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setResults(data.results || []);
      setSearchRunId(data.searchRunId || null); // Store for AI analysis
      // Clear previous AI suggestions on new search
      setAiSuggestions(new Map());
      setAiSummary(null);
      setAiError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // AI Relevance Analysis - batch all papers in single LLM call
  const handleAiRelevanceAnalysis = async () => {
    if (!searchRunId || !authToken || results.length === 0) return;
    
    try {
      setAiAnalyzing(true);
      setAiError(null);
      
      const response = await fetch(`/api/papers/${sessionId}/literature/select-relevant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          searchRunId,
          maxSuggestions: 10
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI analysis failed');
      }

      // Build suggestions map from response
      const suggestionsMap = new Map<string, { isRelevant: boolean; score: number; reasoning: string }>();
      for (const suggestion of data.analysis?.suggestions || []) {
        suggestionsMap.set(suggestion.paperId, {
          isRelevant: suggestion.isRelevant,
          score: suggestion.relevanceScore,
          reasoning: suggestion.reasoning
        });
      }
      
      setAiSuggestions(suggestionsMap);
      setAiSummary(data.analysis?.summary || null);
      
      showToast({
        type: 'success',
        title: 'AI Analysis Complete',
        message: `Found ${suggestionsMap.size} relevant papers`,
        duration: 4000
      });
    } catch (err) {
      console.error('AI analysis failed:', err);
      setAiError(err instanceof Error ? err.message : 'AI analysis failed');
      showToast({
        type: 'error',
        title: 'Analysis Failed',
        message: err instanceof Error ? err.message : 'Could not analyze papers',
        duration: 5000
      });
    } finally {
      setAiAnalyzing(false);
    }
  };

  // Add all AI-suggested papers at once
  const handleAddAllSuggested = async () => {
    const suggestedPapers = results.filter(r => aiSuggestions.has(r.id) && !importedKeys.has(r.doi || r.title));
    
    if (suggestedPapers.length === 0) {
      showToast({
        type: 'info',
        title: 'No Papers to Add',
        message: 'All suggested papers are already in your citations',
        duration: 3000
      });
      return;
    }

    // Import each suggested paper
    for (const paper of suggestedPapers) {
      await handleImport(paper);
    }
    
    showToast({
      type: 'success',
      title: 'Papers Added',
      message: `Added ${suggestedPapers.length} AI-suggested papers to citations`,
      duration: 4000
    });
  };

  const handleImport = async (result: any) => {
    try {
      setImportMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ searchResult: result })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setCitations(prev => [...prev, data.citation]);
      setImportMessage('Citation imported.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleDoiImport = async () => {
    if (!doiInput.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/citations/import-doi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ doi: doiInput.trim() })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'DOI import failed');
      }

      setCitations(prev => [...prev, data.citation]);
      setDoiInput('');
      setImportMessage('DOI imported.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'DOI import failed');
    }
  };

  const handleBibtexImport = async () => {
    if (!bibtexInput.trim()) return;
    try {
      setImportMessage(null);
      const response = await fetch(`/api/papers/${sessionId}/citations/import-bibtex`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ bibtex: bibtexInput })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'BibTeX import failed');
      }

      setCitations(prev => [...prev, ...(data.citations || [])]);
      setBibtexInput('');
      setImportMessage('BibTeX import complete.');
      await refreshSession();
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'BibTeX import failed');
    }
  };

  const runGapAnalysis = async () => {
    if (!authToken) return;
    try {
      setGapLoading(true);
      setGapError(null);
      const response = await fetch(`/api/papers/${sessionId}/literature/gap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({})
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Gap analysis failed');
      }

      setGapAnalysis(data.analysis || null);
    } catch (err) {
      setGapError(err instanceof Error ? err.message : 'Gap analysis failed');
    } finally {
      setGapLoading(false);
    }
  };

  // Filter citations for display
  const filteredCitations = useMemo(() => {
    if (!citationSearch.trim()) return citations;
    const search = citationSearch.toLowerCase();
    return citations.filter(c => 
      c.title?.toLowerCase().includes(search) ||
      c.authors?.some((a: string) => a.toLowerCase().includes(search)) ||
      c.citationKey?.toLowerCase().includes(search)
    );
  }, [citations, citationSearch]);

  // Handle removing selected citations (bulk delete)
  const handleRemoveSelected = async () => {
    if (selectedCitations.size === 0) return;
    if (!confirm(`Remove ${selectedCitations.size} citation(s) from this paper?`)) return;
    
    const idsToDelete = Array.from(selectedCitations);
    
    // Optimistic update
    setCitations(prev => prev.filter(c => !selectedCitations.has(c.id)));
    setSelectedCitations(new Set());
    
    try {
      const response = await fetch(`/api/papers/${sessionId}/citations/bulk-delete`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}` 
        },
        body: JSON.stringify({ citationIds: idsToDelete })
      });
      
      if (!response.ok) {
        throw new Error('Bulk delete failed');
      }
      
      await refreshSession();
    } catch (err) {
      console.error('Failed to delete citations:', err);
      // Refresh to get actual state on error
      try {
        const response = await fetch(`/api/papers/${sessionId}/citations`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          setCitations(data.citations || []);
        }
      } catch {}
    }
  };

  // Main tab state
  const [mainTab, setMainTab] = useState<'find' | 'citations'>('find');
  
  // Fetch abstract for a search result
  const [fetchingAbstract, setFetchingAbstract] = useState<string | null>(null);
  
  const handleFetchAbstract = async (resultId: string, doi?: string) => {
    if (!doi) return;
    setFetchingAbstract(resultId);
    try {
      // Try to fetch abstract from Semantic Scholar or CrossRef
      const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${doi}?fields=abstract`);
      if (response.ok) {
        const data = await response.json();
        if (data.abstract) {
          setResults(prev => prev.map(r => 
            r.id === resultId ? { ...r, abstract: data.abstract } : r
          ));
        }
      }
    } catch (err) {
      console.error('Failed to fetch abstract:', err);
    } finally {
      setFetchingAbstract(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Literature Review</h2>
          <p className="text-sm text-gray-500">Search, import, and manage citations for your paper</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold text-indigo-600">{citations.length}</div>
            <div className="text-xs text-gray-500">
              {citationTargets.recommended ? `of ${citationTargets.recommended} recommended` : 'citations'}
            </div>
          </div>
          {citationTargets.min && citations.length < citationTargets.min && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              Min: {citationTargets.min}
            </Badge>
          )}
          {citations.length >= (citationTargets.min || 0) && (
            <Badge className="bg-emerald-100 text-emerald-700">
              ✓ Met minimum
            </Badge>
          )}
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as 'find' | 'citations')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="find" className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Find & Add
          </TabsTrigger>
          <TabsTrigger value="citations" className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Paper Citations ({citations.length})
          </TabsTrigger>
        </TabsList>

        {/* FIND & ADD TAB */}
        <TabsContent value="find" className="space-y-4">
          <Card className="overflow-hidden">
            {/* Sub-tabs for different add methods */}
            <div className="border-b bg-gray-50/50">
              <div className="flex">
                <button
                  onClick={() => setAddMode('search')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'search'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search Online
                </button>
                <button
                  onClick={() => setAddMode('library')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'library'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                  </svg>
                  My Library
                </button>
                <button
                  onClick={() => setAddMode('import')}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 border-b-2 ${
                    addMode === 'import'
                      ? 'border-indigo-600 text-indigo-700 bg-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import
                </button>
              </div>
            </div>

            <CardContent className="p-0">
              {/* SEARCH MODE */}
              {addMode === 'search' && (
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        placeholder="Search papers, topics, or keywords..."
                        className="pr-20"
                      />
                      <Button 
                        size="sm" 
                        onClick={handleSearch} 
                        disabled={loading || !query.trim()}
                        className="absolute right-1 top-1 h-7"
                      >
                        {loading ? '...' : 'Search'}
                      </Button>
                    </div>
                    
                    {suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs text-gray-400">Suggestions:</span>
                        {suggestions.slice(0, 3).map(suggestion => (
                          <button
                            key={suggestion}
                            onClick={() => setQuery(suggestion)}
                            className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Compact filters */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-500">Year:</span>
                    <Input
                      type="number"
                      value={yearFrom}
                      onChange={e => setYearFrom(e.target.value)}
                      placeholder="From"
                      className="w-20 h-7 text-xs"
                    />
                    <span className="text-gray-400">-</span>
                    <Input
                      type="number"
                      value={yearTo}
                      onChange={e => setYearTo(e.target.value)}
                      placeholder="To"
                      className="w-20 h-7 text-xs"
                    />
                    <div className="flex-1" />
                    {SOURCE_OPTIONS.map(source => (
                      <label key={source.value} className="flex items-center gap-1 text-gray-600 cursor-pointer">
                        <Checkbox
                          checked={sources.includes(source.value)}
                          onCheckedChange={() => toggleSource(source.value)}
                          className="w-3.5 h-3.5"
                        />
                        <span>{source.label.split(' ')[0]}</span>
                      </label>
                    ))}
                  </div>

                  {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
                </div>
              )}

              {/* LIBRARY MODE */}
              {addMode === 'library' && (
                <InlineLibraryImport
                  authToken={authToken}
                  sessionId={sessionId}
                  onImported={async () => {
                    try {
                      const response = await fetch(`/api/papers/${sessionId}/citations`, {
                        headers: { Authorization: `Bearer ${authToken}` }
                      });
                      if (response.ok) {
                        const data = await response.json();
                        setCitations(data.citations || []);
                      }
                    } catch {}
                    await refreshSession();
                  }}
                />
              )}

              {/* IMPORT MODE */}
              {addMode === 'import' && (
                <div className="p-4 space-y-4">
                  {/* DOI Import */}
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1.5">Import by DOI</label>
                    <div className="flex gap-2">
                      <Input
                        value={doiInput}
                        onChange={e => setDoiInput(e.target.value)}
                        placeholder="10.1000/xyz123 or https://doi.org/..."
                        className="text-sm"
                      />
                      <Button size="sm" onClick={handleDoiImport} disabled={!doiInput.trim()}>
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* BibTeX Import */}
                  <div>
                    <label className="text-xs font-medium text-gray-700 block mb-1.5">Import BibTeX / RIS</label>
                    <Textarea
                      value={bibtexInput}
                      onChange={e => setBibtexInput(e.target.value)}
                      placeholder="Paste BibTeX or RIS entries..."
                      rows={4}
                      className="text-sm font-mono"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <Button size="sm" variant="secondary" onClick={handleBibtexImport} disabled={!bibtexInput.trim()}>
                        Import
                      </Button>
                      <label className="text-xs text-indigo-600 cursor-pointer hover:underline flex items-center gap-1">
                        <input
                          type="file"
                          accept=".bib,.bibtex,.ris,.txt"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleBibtexFile(file);
                          }}
                        />
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload file
                      </label>
                    </div>
                  </div>

                  {/* Manual Entry */}
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-sm"
                    onClick={() => setManualEntryOpen(true)}
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Add citation manually
                  </Button>

                  {importMessage && (
                    <div className={`text-xs p-2 rounded ${
                      importMessage.includes('failed') || importMessage.includes('error') 
                        ? 'bg-red-50 text-red-600' 
                        : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {importMessage}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Search Results - Only show when in search mode */}
          {addMode === 'search' && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Search Results</CardTitle>
                  <div className="flex items-center gap-2">
                    {!loading && <span className="text-sm text-gray-500">{results.length} found</span>}
                    {results.some(r => !r.abstract) && results.length > 0 && !loading && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                        Some missing abstracts
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="text-xs">
                  💡 Tip: Add citations with abstracts for better literature analysis
                </CardDescription>
                
                {/* AI Relevance Analysis Section */}
                {results.length > 0 && !loading && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleAiRelevanceAnalysis}
                          disabled={aiAnalyzing || !searchRunId}
                          size="sm"
                          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-sm"
                        >
                          {aiAnalyzing ? (
                            <>
                              <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              🤖 Help Me Find Relevant Papers
                            </>
                          )}
                        </Button>
                        {aiSuggestions.size > 0 && (
                          <Button
                            onClick={handleAddAllSuggested}
                            size="sm"
                            variant="outline"
                            className="text-violet-600 border-violet-300 hover:bg-violet-50"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add All Suggested ({aiSuggestions.size})
                          </Button>
                        )}
                      </div>
                      {aiSuggestions.size > 0 && (
                        <Badge className="bg-violet-100 text-violet-700 border-0">
                          {aiSuggestions.size} AI suggestions
                        </Badge>
                      )}
                    </div>
                    
                    {/* AI Summary */}
                    {aiSummary && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-2 p-2 bg-violet-50 rounded-lg border border-violet-200"
                      >
                        <p className="text-xs text-violet-700 flex items-start gap-2">
                          <span className="shrink-0">🤖</span>
                          <span>{aiSummary}</span>
                        </p>
                      </motion.div>
                    )}
                    
                    {/* AI Error */}
                    {aiError && (
                      <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs text-red-600">{aiError}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {/* Loading State with Intelligent Messages */}
                  {loading && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="py-12 px-4"
                    >
                      <div className="flex flex-col items-center">
                        {/* Animated Search Icon */}
                        <div className="relative mb-6">
                          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                            <svg className="w-8 h-8 text-indigo-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </div>
                          {/* Orbiting dots */}
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-indigo-500" />
                          </div>
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s', animationDelay: '1s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-purple-500" />
                          </div>
                          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s', animationDelay: '2s' }}>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-pink-500" />
                          </div>
                        </div>
                        
                        {/* Rotating Message */}
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={loadingMessageIndex}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                            className="text-center"
                          >
                            <span className="text-2xl mb-2 block">{SEARCH_LOADING_MESSAGES[loadingMessageIndex].icon}</span>
                            <p className="text-sm font-medium text-gray-700">
                              {SEARCH_LOADING_MESSAGES[loadingMessageIndex].text}
                            </p>
                          </motion.div>
                        </AnimatePresence>
                        
                        {/* Progress indicator */}
                        <div className="mt-6 flex gap-1">
                          {SEARCH_LOADING_MESSAGES.slice(0, 5).map((_, idx) => (
                            <div
                              key={idx}
                              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                idx <= loadingMessageIndex % 5 ? 'bg-indigo-500' : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                        
                        {/* Sources being searched */}
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                          {sources.map(source => (
                            <span
                              key={source}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 animate-pulse"
                            >
                              {SOURCE_OPTIONS.find(s => s.value === source)?.label || source}
                            </span>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                  {/* Empty State - only show when not loading */}
                  {!loading && results.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p className="text-sm">Search for papers above</p>
                    </div>
                  )}
                  
                  {/* Results - only show when not loading */}
                  {/* Sort results: AI-suggested first, then by original order */}
                  {!loading && (
                    <AnimatePresence mode="popLayout">
                      {[...results]
                        .sort((a, b) => {
                          const aIsSuggested = aiSuggestions.has(a.id);
                          const bIsSuggested = aiSuggestions.has(b.id);
                          if (aIsSuggested && !bIsSuggested) return -1;
                          if (!aIsSuggested && bIsSuggested) return 1;
                          // If both suggested, sort by score
                          if (aIsSuggested && bIsSuggested) {
                            return (aiSuggestions.get(b.id)?.score || 0) - (aiSuggestions.get(a.id)?.score || 0);
                          }
                          return 0;
                        })
                        .map((result, index) => {
                        const isImported = importedKeys.has(result.doi || result.title);
                        const hasAbstract = !!result.abstract;
                        const isExpanded = expandedAbstracts.has(result.id);
                        const isFetchingThis = fetchingAbstract === result.id;
                        const aiSuggestion = aiSuggestions.get(result.id);
                        const isAiSuggested = !!aiSuggestion;

                        return (
                          <motion.div
                            key={result.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ delay: index * 0.02 }}
                            className={`border rounded-lg p-3 transition-all ${
                              isImported 
                                ? 'bg-emerald-50/50 border-emerald-200' 
                                : isAiSuggested
                                  ? 'bg-violet-50/70 border-violet-300 ring-1 ring-violet-200 shadow-sm'
                                  : hasAbstract 
                                    ? 'bg-white hover:shadow-sm border-gray-200' 
                                    : 'bg-amber-50/30 border-amber-200 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2">
                                <h4 className="font-medium text-sm text-gray-900 leading-tight flex-1">
                                  {result.title}
                                </h4>
                                {/* AI Suggested Badge */}
                                {isAiSuggested && (
                                  <Badge className="shrink-0 text-[10px] bg-gradient-to-r from-violet-500 to-indigo-500 text-white border-0 shadow-sm">
                                    🤖 AI Pick
                                  </Badge>
                                )}
                                {hasAbstract ? (
                                  <Badge variant="secondary" className="shrink-0 text-[10px] bg-blue-50 text-blue-600">
                                    📄 Abstract
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-300">
                                    No abstract
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                {(result.authors || []).slice(0, 3).join(', ')}
                                {result.authors?.length > 3 && ' et al.'}
                                {result.year && ` • ${result.year}`}
                                {result.venue && ` • ${result.venue}`}
                              </p>
                              
                              {/* Abstract section */}
                              {hasAbstract ? (
                                <>
                                  <button
                                    onClick={() => toggleAbstract(result.id)}
                                    className="text-xs text-indigo-600 mt-1 hover:underline"
                                  >
                                    {isExpanded ? 'Hide abstract ▲' : 'Show abstract ▼'}
                                  </button>
                                  {isExpanded && (
                                    <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2 rounded leading-relaxed">
                                      {result.abstract}
                                    </p>
                                  )}
                                </>
                              ) : result.doi ? (
                                <button
                                  onClick={() => handleFetchAbstract(result.id, result.doi)}
                                  disabled={isFetchingThis}
                                  className="text-xs text-amber-600 mt-1 hover:underline flex items-center gap-1"
                                >
                                  {isFetchingThis ? (
                                    <>
                                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                      </svg>
                                      Fetching...
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                      Fetch abstract
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-400 mt-1 block">No DOI to fetch abstract</span>
                              )}
                              
                              {result.doi && (
                                <a
                                  href={`https://doi.org/${result.doi}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-indigo-500 hover:underline mt-1 inline-block"
                                >
                                  DOI: {result.doi} ↗
                                </a>
                              )}
                              
                              {/* AI Reasoning - Show why this paper was suggested */}
                              {isAiSuggested && aiSuggestion && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="mt-2 p-2.5 bg-gradient-to-r from-violet-50 to-indigo-50 rounded-lg border border-violet-200"
                                >
                                  <div className="flex items-start gap-2">
                                    <span className="text-violet-500 text-sm shrink-0">🤖</span>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">
                                          Why it's relevant
                                        </span>
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 rounded text-[10px] text-violet-600">
                                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                          </svg>
                                          {aiSuggestion.score}% match
                                        </div>
                                      </div>
                                      <p className="text-xs text-violet-800 leading-relaxed">
                                        {aiSuggestion.reasoning}
                                      </p>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                            <div className="shrink-0 flex flex-col gap-1">
                              <Button
                                size="sm"
                                onClick={() => handleImport(result)}
                                disabled={isImported}
                                className={`text-xs h-7 ${isImported ? 'bg-emerald-600' : isAiSuggested ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
                              >
                                {isImported ? '✓ Added' : '+ Add'}
                              </Button>
                              <div className="relative group">
                                <Button size="sm" variant="ghost" className="text-xs h-7 w-full px-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50" title="Save to library">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                                  </svg>
                                </Button>
                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl py-1.5 min-w-[160px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b mb-1">
                                    Save to Library
                                  </div>
                                  {libraries.length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-gray-500">No libraries created yet</div>
                                  ) : (
                                    libraries.map(lib => (
                                      <button
                                        key={lib.id}
                                        onClick={() => handleSaveToLibrary(result, lib.id)}
                                        className="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-xs flex items-center gap-2 transition-colors"
                                      >
                                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lib.color || '#6366f1' }} />
                                        <span className="truncate">{lib.name}</span>
                                        <span className="text-gray-400 text-[10px] ml-auto">{lib.referenceCount}</span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* PAPER CITATIONS TAB */}
        <TabsContent value="citations" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Citations in Your Paper
                </CardTitle>
                <Badge variant="secondary">{citations.length}</Badge>
              </div>
              <CardDescription>
                These citations will be used in your publication
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search and Actions */}
              <div className="flex gap-2">
                <Input
                  value={citationSearch}
                  onChange={e => setCitationSearch(e.target.value)}
                  placeholder="Search citations..."
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setGapModalOpen(true)}
                  disabled={citations.length === 0}
                  className="shrink-0 h-8"
                  title="Analyze literature gaps"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </Button>
              </div>

              {/* Selection actions */}
              {selectedCitations.size > 0 && (
                <div className="flex items-center justify-between bg-indigo-50 p-2 rounded text-sm">
                  <span className="text-indigo-700">{selectedCitations.size} selected</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedCitations(new Set())} className="h-6 text-xs">
                      Clear
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleRemoveSelected} className="h-6 text-xs">
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              {/* Citations List */}
              <div className="space-y-2 max-h-[450px] overflow-y-auto">
                {citations.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="text-sm font-medium">No citations yet</p>
                    <p className="text-xs mt-1">Search or import to add citations</p>
                  </div>
                ) : filteredCitations.length === 0 ? (
                  <div className="text-center py-4 text-gray-400 text-sm">
                    No citations match your search
                  </div>
                ) : (
                  <AnimatePresence>
                    {filteredCitations.map(citation => (
                      <motion.div
                        key={citation.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                          selectedCitations.has(citation.id)
                            ? 'bg-indigo-50 border-indigo-300'
                            : 'bg-white hover:bg-gray-50 border-gray-200'
                        }`}
                        onClick={() => {
                          setSelectedCitations(prev => {
                            const next = new Set(prev);
                            if (next.has(citation.id)) {
                              next.delete(citation.id);
                            } else {
                              next.add(citation.id);
                            }
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={selectedCitations.has(citation.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight">
                              {citation.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {citation.authors?.slice(0, 2).join(', ')}
                              {citation.authors?.length > 2 && ' et al.'}
                              {citation.year && ` (${citation.year})`}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <code className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                                {citation.citationKey || citation.preview?.inText}
                              </code>
                              {citation.doi && (
                                <a
                                  href={`https://doi.org/${citation.doi}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-indigo-600 hover:underline"
                                  onClick={e => e.stopPropagation()}
                                >
                                  DOI ↗
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Select all / Export / Gap Analysis */}
              {citations.length > 0 && (
                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedCitations.size === citations.length) {
                          setSelectedCitations(new Set());
                        } else {
                          setSelectedCitations(new Set(citations.map(c => c.id)));
                        }
                      }}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      {selectedCitations.size === citations.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => setGapModalOpen(true)}
                      className="h-7 text-xs"
                    >
                      📊 Gap Analysis
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      Export BibTeX
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Gap Analysis Modal */}
      <Dialog open={gapModalOpen} onOpenChange={setGapModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Literature Gap Analysis</DialogTitle>
            <DialogDescription>
              Analyze your {citations.length} citations for themes, gaps, and positioning opportunities
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Button
              onClick={runGapAnalysis}
              disabled={gapLoading || citations.length === 0}
              className="w-full"
            >
              {gapLoading ? 'Analyzing...' : 'Run Analysis'}
            </Button>

            {gapError && (
              <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{gapError}</div>
            )}

            {gapAnalysis && (
              <div className="space-y-4">
                {Array.isArray(gapAnalysis.themes) && gapAnalysis.themes.length > 0 && (
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-2">📚 Key Themes</h4>
                    <ul className="space-y-1 text-sm text-blue-800">
                      {gapAnalysis.themes.map((theme: string, i: number) => (
                        <li key={i}>• {theme}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(gapAnalysis.gaps) && gapAnalysis.gaps.length > 0 && (
                  <div className="bg-amber-50 p-4 rounded-lg">
                    <h4 className="font-medium text-amber-900 mb-2">🔍 Research Gaps</h4>
                    <ul className="space-y-1 text-sm text-amber-800">
                      {gapAnalysis.gaps.map((gap: string, i: number) => (
                        <li key={i}>• {gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(gapAnalysis.positioning) && gapAnalysis.positioning.length > 0 && (
                  <div className="bg-emerald-50 p-4 rounded-lg">
                    <h4 className="font-medium text-emerald-900 mb-2">🎯 Positioning Suggestions</h4>
                    <ul className="space-y-1 text-sm text-emerald-800">
                      {gapAnalysis.positioning.map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Entry Modal */}
      <ManualCitationModal
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        authToken={authToken}
        sessionId={sessionId}
        onSaved={async (citation) => {
          setCitations(prev => [...prev, citation]);
          await refreshSession();
        }}
      />
    </div>
  );
}

// Inline Library Import Component (for tab view)
const LIBRARY_PAGE_SIZE = 15;

function InlineLibraryImport({
  authToken,
  sessionId,
  onImported
}: {
  authToken: string | null;
  sessionId: string;
  onImported: () => void;
}) {
  const [references, setReferences] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [totalRefs, setTotalRefs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / LIBRARY_PAGE_SIZE);
  
  // Year filter
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Load libraries
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/collections', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
        setTotalRefs(data.totalReferences || 0);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken]);

  const loadReferences = useCallback(async (page = 1) => {
    if (!authToken) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedLibrary) params.set('collectionId', selectedLibrary);
      if (search) params.set('search', search);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      // API uses offset, not page - convert page to offset
      const offset = (page - 1) * LIBRARY_PAGE_SIZE;
      params.set('offset', offset.toString());
      params.set('limit', LIBRARY_PAGE_SIZE.toString());
      
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferences(data.references || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken, search, selectedLibrary, yearFrom, yearTo]);

  // Initial load
  useEffect(() => {
    if (authToken) {
      loadLibraries();
      loadReferences(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]); // Only depend on authToken for initial load

  // When library or filters change, reload from page 1
  useEffect(() => {
    if (authToken) {
      loadReferences(1);
      setSelected(new Set());
      setCurrentPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLibrary, yearFrom, yearTo, authToken]);
  
  // When page changes
  useEffect(() => {
    if (authToken && currentPage > 1) {
      loadReferences(currentPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, authToken]);
  
  const handleSelectAll = () => {
    if (references.every(r => selected.has(r.id))) {
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.add(r.id));
        return next;
      });
    }
  };
  
  const allOnPageSelected = references.length > 0 && references.every(r => selected.has(r.id));

  const handleImport = async () => {
    if (!authToken || selected.size === 0) return;
    try {
      setImporting(true);
      const response = await fetch('/api/library/copy-to-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ sessionId, referenceIds: Array.from(selected) })
      });
      if (response.ok) {
        const data = await response.json();
        setImportResult({ imported: data.imported, skipped: data.skipped || 0 });
        setSelected(new Set());
        onImported();
      }
    } catch (err) {
      console.error('Failed to import:', err);
    } finally {
      setImporting(false);
    }
  };

  // Success message
  if (importResult) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-6 text-center"
      >
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Import Successful!
        </h3>
        
        <p className="text-gray-600 mb-4">
          <span className="font-medium text-emerald-600">{importResult.imported} citation{importResult.imported !== 1 ? 's' : ''}</span> imported
          {importResult.skipped > 0 && (
            <span className="text-amber-600"> ({importResult.skipped} skipped as duplicates)</span>
          )}
        </p>

        <Button onClick={() => setImportResult(null)} variant="outline">
          Import More
        </Button>
      </motion.div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 h-[400px]">
        {/* Library Sidebar */}
        <div className="w-48 shrink-0 flex flex-col">
          <p className="text-xs font-medium text-gray-600 mb-2">Your Libraries</p>
          <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
            <button
              onClick={() => setSelectedLibrary(null)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b ${
                selectedLibrary === null 
                  ? 'bg-indigo-100 text-indigo-700' 
                  : 'hover:bg-white text-gray-700'
              }`}
            >
              <span className="font-medium">All References</span>
              <Badge variant="secondary" className="text-[10px]">{totalRefs}</Badge>
            </button>
            
            {libraries.map(lib => (
              <button
                key={lib.id}
                onClick={() => setSelectedLibrary(lib.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b last:border-b-0 ${
                  selectedLibrary === lib.id 
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'hover:bg-white text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div 
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: lib.color || '#6366f1' }}
                  />
                  <span className="truncate">{lib.name}</span>
                </div>
                <Badge variant="secondary" className="text-[10px] shrink-0">{lib.referenceCount}</Badge>
              </button>
            ))}
            
            {libraries.length === 0 && (
              <div className="p-3 text-xs text-gray-500 text-center">
                No libraries yet.
              </div>
            )}
          </div>
        </div>

        {/* References List */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search & Filters */}
          <div className="space-y-2 mb-3">
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search references..."
                className="flex-1 bg-white h-9"
                onKeyDown={e => e.key === 'Enter' && loadReferences(1)}
              />
              <Button size="sm" variant="secondary" onClick={() => { setCurrentPage(1); loadReferences(1); }}>
                Search
              </Button>
            </div>
            
            {/* Year Filters */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Year:</span>
              <Input
                value={yearFrom}
                onChange={e => setYearFrom(e.target.value)}
                placeholder="From"
                className="w-20 h-7 text-xs bg-white"
                type="number"
              />
              <span className="text-gray-400">-</span>
              <Input
                value={yearTo}
                onChange={e => setYearTo(e.target.value)}
                placeholder="To"
                className="w-20 h-7 text-xs bg-white"
                type="number"
              />
              {(yearFrom || yearTo) && (
                <button 
                  onClick={() => { setYearFrom(''); setYearTo(''); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              )}
            </div>
            
            {/* Select All */}
            {references.length > 0 && (
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <Checkbox 
                    checked={allOnPageSelected}
                    onCheckedChange={handleSelectAll}
                  />
                  Select all on page ({references.length})
                </label>
                <span className="text-xs text-gray-400">
                  Page {currentPage}/{totalPages || 1} • {totalCount} total
                </span>
              </div>
            )}
          </div>

          {/* References Grid */}
          <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
            {loading ? (
              <div className="p-6 text-center">
                <svg className="w-6 h-6 mx-auto mb-2 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-500 text-sm">Loading...</p>
              </div>
            ) : references.length === 0 ? (
              <div className="p-6 text-center">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-gray-500 font-medium text-sm">
                  {selectedLibrary ? 'Library is empty' : 'No references yet'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Add references via Reference Management
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 bg-white rounded-lg">
                {references.map(ref => (
                  <div 
                    key={ref.id} 
                    className={`p-2.5 cursor-pointer transition-colors ${
                      selected.has(ref.id) 
                        ? 'bg-indigo-50 border-l-4 border-l-indigo-500' 
                        : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                    }`}
                    onClick={() => {
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(ref.id)) {
                          next.delete(ref.id);
                        } else {
                          next.add(ref.id);
                        }
                        return next;
                      });
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox checked={selected.has(ref.id)} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 line-clamp-1">{ref.title}</p>
                        <p className="text-xs text-gray-500">
                          {ref.authors?.slice(0, 2).join(', ')}
                          {ref.authors?.length > 2 && ' et al.'}
                          {ref.year && ` (${ref.year})`}
                        </p>
                      </div>
                      {ref.isFavorite && (
                        <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1 || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </Button>
              <span className="text-xs text-gray-600 px-2">{currentPage}/{totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || loading} className="h-7 px-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
              </Button>
            </div>
          )}
        </div>
      </div>
      
      {/* Import Button */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
            {selected.size} selected
          </Badge>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">
              Clear
            </button>
          )}
        </div>
        <Button 
          onClick={handleImport} 
          disabled={selected.size === 0 || importing}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {importing ? (
            <>
              <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Importing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add {selected.size} to Paper
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// Library Import Modal Component (for backup/alternative use)
const LIBRARY_MODAL_PAGE_SIZE = 20;

function LibraryImportModal({
  open,
  onOpenChange,
  authToken,
  sessionId,
  onImported,
  onGoToManage
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
  sessionId: string;
  onImported: () => void;
  onGoToManage?: () => void;
}) {
  const [references, setReferences] = useState<any[]>([]);
  const [libraries, setLibraries] = useState<Array<{ id: string; name: string; color?: string; referenceCount: number }>>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<string | null>(null);
  const [totalRefs, setTotalRefs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / LIBRARY_MODAL_PAGE_SIZE);
  
  // Year filter
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Load libraries
  const loadLibraries = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch('/api/library/collections', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLibraries(data.collections || []);
        setTotalRefs(data.totalReferences || 0);
      }
    } catch (err) {
      console.error('Failed to load libraries:', err);
    }
  }, [authToken]);

  const loadReferences = useCallback(async (page = 1) => {
    if (!authToken) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedLibrary) params.set('collectionId', selectedLibrary);
      if (search) params.set('search', search);
      if (yearFrom) params.set('yearFrom', yearFrom);
      if (yearTo) params.set('yearTo', yearTo);
      // API uses offset, not page - convert page to offset
      const offset = (page - 1) * LIBRARY_MODAL_PAGE_SIZE;
      params.set('offset', offset.toString());
      params.set('limit', LIBRARY_MODAL_PAGE_SIZE.toString());
      
      const response = await fetch(`/api/library?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferences(data.references || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    } finally {
      setLoading(false);
    }
  }, [authToken, search, selectedLibrary, yearFrom, yearTo]);

  useEffect(() => {
    if (open && authToken) {
      loadLibraries();
      loadReferences(1);
      // Reset state when opening
      setImportResult(null);
      setSelected(new Set());
      setCurrentPage(1);
    }
  }, [open, authToken, loadLibraries, loadReferences]);

  useEffect(() => {
    if (open) {
      loadReferences(1);
      setSelected(new Set()); // Clear selection when changing library/filters
      setCurrentPage(1);
    }
  }, [selectedLibrary, yearFrom, yearTo, loadReferences, open]);
  
  // Load references when page changes
  useEffect(() => {
    if (open && authToken) {
      loadReferences(currentPage);
    }
  }, [currentPage, open, authToken, loadReferences]);
  
  // Select all on current page
  const handleSelectAll = () => {
    if (references.every(r => selected.has(r.id))) {
      // Deselect all on current page
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      // Select all on current page
      setSelected(prev => {
        const next = new Set(prev);
        references.forEach(r => next.add(r.id));
        return next;
      });
    }
  };
  
  const allOnPageSelected = references.length > 0 && references.every(r => selected.has(r.id));

  const handleImport = async () => {
    if (!authToken || selected.size === 0) return;
    try {
      setImporting(true);
      const response = await fetch('/api/library/copy-to-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ sessionId, referenceIds: Array.from(selected) })
      });
      if (response.ok) {
        const data = await response.json();
        setImportResult({ imported: data.imported, skipped: data.skipped || 0 });
        onImported();
      }
    } catch (err) {
      console.error('Failed to import:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setImportResult(null);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col bg-white border shadow-xl">
        {/* Success Screen */}
        {importResult ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-8 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Import Successful!
            </h3>
            
            <p className="text-gray-600 mb-6">
              <span className="font-medium text-emerald-600">{importResult.imported} citation{importResult.imported !== 1 ? 's' : ''}</span> imported successfully
              {importResult.skipped > 0 && (
                <span className="text-amber-600"> ({importResult.skipped} skipped as duplicates)</span>
              )}
            </p>

            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mx-auto max-w-md mb-6">
              <div className="flex items-start gap-3 text-left">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-indigo-900 text-sm">Where to find your citations</p>
                  <p className="text-xs text-indigo-700 mt-1">
                    Your imported references are now available in the <strong>"Manage citations"</strong> tab above. 
                    You can also see them in the <strong>"Imported Citations"</strong> panel on the right side of the Search tab.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => {
                setImportResult(null);
                setSelected(new Set());
                onGoToManage?.();
              }}>
                Go to Manage Citations
              </Button>
            </div>
          </motion.div>
        ) : (
          /* Selection Screen */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                </svg>
                Import from Personal Library
              </DialogTitle>
              <DialogDescription>
                Select a library, then choose references to add to this paper
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex gap-4 mt-4">
              {/* Library Sidebar */}
              <div className="w-48 shrink-0 flex flex-col">
                <p className="text-xs font-medium text-gray-600 mb-2">Your Libraries</p>
                <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
                  {/* All References */}
                  <button
                    onClick={() => setSelectedLibrary(null)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b ${
                      selectedLibrary === null 
                        ? 'bg-indigo-100 text-indigo-700' 
                        : 'hover:bg-white text-gray-700'
                    }`}
                  >
                    <span className="font-medium">All References</span>
                    <Badge variant="secondary" className="text-[10px]">{totalRefs}</Badge>
                  </button>
                  
                  {libraries.map(lib => (
                    <button
                      key={lib.id}
                      onClick={() => setSelectedLibrary(lib.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b last:border-b-0 ${
                        selectedLibrary === lib.id 
                          ? 'bg-indigo-100 text-indigo-700' 
                          : 'hover:bg-white text-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div 
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: lib.color || '#6366f1' }}
                        />
                        <span className="truncate">{lib.name}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{lib.referenceCount}</Badge>
                    </button>
                  ))}
                  
                  {libraries.length === 0 && (
                    <div className="p-3 text-xs text-gray-500 text-center">
                      No libraries yet.
                      <br />
                      Create one in Reference Management.
                    </div>
                  )}
                </div>
              </div>

              {/* References List */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Search & Filters */}
                <div className="space-y-2 mb-3">
                  <div className="flex gap-2">
                    <Input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search references..."
                      className="flex-1 bg-white"
                      onKeyDown={e => e.key === 'Enter' && loadReferences(1)}
                    />
                    <Button size="sm" variant="secondary" onClick={() => { setCurrentPage(1); loadReferences(1); }}>
                      Search
                    </Button>
                  </div>
                  
                  {/* Year Filters */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Year:</span>
                    <Input
                      value={yearFrom}
                      onChange={e => setYearFrom(e.target.value)}
                      placeholder="From"
                      className="w-20 h-7 text-xs bg-white"
                      type="number"
                    />
                    <span className="text-gray-400">-</span>
                    <Input
                      value={yearTo}
                      onChange={e => setYearTo(e.target.value)}
                      placeholder="To"
                      className="w-20 h-7 text-xs bg-white"
                      type="number"
                    />
                    {(yearFrom || yearTo) && (
                      <button 
                        onClick={() => { setYearFrom(''); setYearTo(''); }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  
                  {/* Select All for current page */}
                  {references.length > 0 && (
                    <div className="flex items-center justify-between px-1">
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <Checkbox 
                          checked={allOnPageSelected}
                          onCheckedChange={handleSelectAll}
                        />
                        Select all on this page ({references.length})
                      </label>
                      <span className="text-xs text-gray-400">
                        Page {currentPage} of {totalPages || 1} ({totalCount} total)
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto border rounded-lg bg-gray-50">
                  {loading ? (
                    <div className="p-8 text-center">
                      <svg className="w-8 h-8 mx-auto mb-3 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-gray-500">Loading references...</p>
                    </div>
                  ) : references.length === 0 ? (
                    <div className="p-8 text-center">
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <p className="text-gray-500 font-medium">
                        {selectedLibrary ? 'This library is empty' : 'No references yet'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {selectedLibrary 
                          ? 'Add references to this library from Reference Management'
                          : 'Add references to your library first'
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200 bg-white rounded-lg">
                      {references.map(ref => (
                        <div 
                          key={ref.id} 
                          className={`p-3 cursor-pointer transition-colors ${
                            selected.has(ref.id) 
                              ? 'bg-indigo-50 border-l-4 border-l-indigo-500' 
                              : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                          }`}
                          onClick={() => {
                            setSelected(prev => {
                              const next = new Set(prev);
                              if (next.has(ref.id)) {
                                next.delete(ref.id);
                              } else {
                                next.add(ref.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox 
                              checked={selected.has(ref.id)} 
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-gray-900">{ref.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {ref.authors?.slice(0, 2).join(', ')}
                                {ref.authors?.length > 2 && ' et al.'}
                                {ref.year && ` (${ref.year})`}
                              </p>
                              {ref.abstract && (
                                <p className="text-xs text-gray-400 mt-1 line-clamp-1">{ref.abstract}</p>
                              )}
                            </div>
                            {ref.isFavorite && (
                              <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2 mt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1 || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </Button>
                    <span className="text-xs text-gray-600 px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages || loading}
                      className="h-7 px-2"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t bg-white">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                  {selected.size} selected
                </Badge>
                {selected.size > 0 && (
                  <button 
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleImport} 
                  disabled={selected.size === 0 || importing}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {importing ? (
                    <>
                      <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Importing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Import {selected.size} reference{selected.size !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Manual Citation Entry Modal
function ManualCitationModal({
  open,
  onOpenChange,
  authToken,
  sessionId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authToken: string | null;
  sessionId: string;
  onSaved: (citation: any) => void;
}) {
  const [form, setForm] = useState({
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    url: '',
    abstract: '',
    sourceType: 'JOURNAL_ARTICLE'
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!authToken || !form.title.trim()) return;
    try {
      setSaving(true);
      const response = await fetch(`/api/papers/${sessionId}/citations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          searchResult: {
            title: form.title,
            authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
            year: form.year ? parseInt(form.year, 10) : undefined,
            venue: form.venue,
            doi: form.doi,
            url: form.url,
            abstract: form.abstract,
            source: 'manual'
          }
        })
      });
      if (response.ok) {
        const data = await response.json();
        onSaved(data.citation);
        onOpenChange(false);
        setForm({
          title: '',
          authors: '',
          year: '',
          venue: '',
          doi: '',
          url: '',
          abstract: '',
          sourceType: 'JOURNAL_ARTICLE'
        });
      }
    } catch (err) {
      console.error('Failed to save citation:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Citation Manually</DialogTitle>
          <DialogDescription>Enter the bibliographic details</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 mt-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Title *</label>
            <Input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Paper title"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Authors (comma-separated)</label>
              <Input
                value={form.authors}
                onChange={e => setForm(p => ({ ...p, authors: e.target.value }))}
                placeholder="John Smith, Jane Doe"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Year</label>
              <Input
                type="number"
                value={form.year}
                onChange={e => setForm(p => ({ ...p, year: e.target.value }))}
                placeholder="2024"
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Journal / Conference</label>
              <Input
                value={form.venue}
                onChange={e => setForm(p => ({ ...p, venue: e.target.value }))}
                placeholder="Nature, ICML 2024, etc."
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">DOI</label>
              <Input
                value={form.doi}
                onChange={e => setForm(p => ({ ...p, doi: e.target.value }))}
                placeholder="10.1000/xyz123"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Abstract</label>
            <Textarea
              value={form.abstract}
              onChange={e => setForm(p => ({ ...p, abstract: e.target.value }))}
              placeholder="Paper abstract (optional)"
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving...' : 'Add Citation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
