'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Stage4ResultsDisplay from './Stage4ResultsDisplay';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Loader2, Search, FileText, AlertCircle, CheckCircle, XCircle, FolderOpen, Check, Eye, AlertTriangle } from 'lucide-react';
// import { NoveltySearchStatus, NoveltySearchStage } from '@prisma/client';

// Local string constants for UI mapping
const NoveltySearchStatus = {
  PENDING: 'PENDING',
  STAGE_0_COMPLETED: 'STAGE_0_COMPLETED',
  STAGE_1_COMPLETED: 'STAGE_1_COMPLETED',
  STAGE_3_5_COMPLETED: 'STAGE_3_5_COMPLETED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const NoveltySearchStage = {
  STAGE_0: 'STAGE_0',
  STAGE_1: 'STAGE_1',
  STAGE_3_5: 'STAGE_3_5',
  STAGE_4: 'STAGE_4',
} as const;

// Stage constants for UI display
const STAGE_LABELS = {
  PENDING: 'Start Search',
  STAGE_0_COMPLETED: 'Query Generation',
  STAGE_1_COMPLETED: 'Patent Search',
  STAGE_3_5_COMPLETED: 'Feature Analysis',
  COMPLETED: 'Report Complete'
};

const STAGE_PROGRESS = {
  PENDING: 0,
  STAGE_0_COMPLETED: 25,
  STAGE_1_COMPLETED: 50,
  STAGE_3_5_COMPLETED: 75,
  COMPLETED: 100
};

const STAGE_ORDER = ['PENDING', 'STAGE_0_COMPLETED', 'STAGE_1_COMPLETED', 'STAGE_3_5_COMPLETED', 'COMPLETED'];

interface Project {
  id: string;
  name: string;
  createdAt: string;
  patents?: { id: string }[];
  collaborators?: { id: string }[];
}

interface NoveltySearchWorkflowProps {
  patentId?: string;
  projectId?: string;
  onComplete?: (searchId: string) => void;
}

interface SearchState {
  searchId: string | null;
  status: string | null;
  currentStage: string | null;
  results: any;
  error: string | null;
  isLoading: boolean;
}


const STATUS_COLORS = {
  [NoveltySearchStatus.PENDING]: 'bg-gray-500',
  [NoveltySearchStatus.STAGE_0_COMPLETED]: 'bg-blue-500',
  [NoveltySearchStatus.STAGE_1_COMPLETED]: 'bg-yellow-500',
  [NoveltySearchStatus.STAGE_3_5_COMPLETED]: 'bg-orange-500',
  [NoveltySearchStatus.COMPLETED]: 'bg-green-500',
  [NoveltySearchStatus.FAILED]: 'bg-red-500'
} as const;

export default function NoveltySearchWorkflow({ patentId, projectId: initialProjectId, onComplete }: NoveltySearchWorkflowProps) {
  const [formData, setFormData] = useState({
    title: '',
    inventionDescription: '',
    jurisdiction: 'IN'
  });

  const [searchState, setSearchState] = useState<SearchState>({
    searchId: null,
    status: null,
    currentStage: null,
    results: null,
    error: null,
    isLoading: false
  });

  // State for showing idea bank
  const [showIdeaBank, setShowIdeaBank] = useState(false);

  const [stageProgress, setStageProgress] = useState({
    stage0: 0,
    stage1: 0,
    stage3_5: 0,
    stage4: 0
  });

  const [completedStages, setCompletedStages] = useState<string[]>([]);
  // Stage view tabs: 0, 1, 1.5, 3.5, 4
  const STAGE_TABS = ['0','1','1.5','3.5','4'] as const;
  const [selectedStageTab, setSelectedStageTab] = useState<string>('0');

  // selectedProject is derived after state initializations (memoized)
  // Note: defined later once projects/selectedProjectId states exist

  // Compute default selected tab when status/results change
  useEffect(() => {
    const s = searchState.status;
    if (!s) return;
    if (s === NoveltySearchStatus.PENDING) { setSelectedStageTab('0'); return; }
    if (s === NoveltySearchStatus.STAGE_0_COMPLETED) { setSelectedStageTab('1'); return; }
    if (s === NoveltySearchStatus.STAGE_1_COMPLETED) {
      // If AI Relevance (Stage 1.5) is available, show that tab; otherwise stay on Stage 1
      setSelectedStageTab(hasStage15() ? '1.5' : '1');
      return;
    }
    if (s === NoveltySearchStatus.STAGE_3_5_COMPLETED) {
      // Combined Stage 3.5 (feature mapping + aggregation)
      setSelectedStageTab('3.5');
      return;
    }
    if (s === NoveltySearchStatus.COMPLETED) { setSelectedStageTab('4'); return; }
  }, [searchState.status, searchState.results]);

  // Evidence panel state (Stage 3.5 matrix cell details)
  const [selectedEvidence, setSelectedEvidence] = useState<null | {
    pn: string;
    patentTitle?: string;
    feature: string;
    status: string;
    quote?: string;
    reason?: string;
    field?: string;
    confidence?: number;
    link?: string;
  }>(null);

  // Stage 1 simulation state
  const [isStage1Simulating, setIsStage1Simulating] = useState(false);
  const [stage1Message, setStage1Message] = useState('');

  // Borrowed progress steps from Stage 3.5 related art search
  const stage1Messages = [
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Scanning through 12M+ global patent database...',
    'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¯ Applying advanced semantic analysis to your invention...',
    'ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â  Using proprietary AI algorithms for relevance matching...',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã…Â  Calculating multi-dimensional similarity scores...',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¬ Cross-referencing with CPC/IPC classification systems...',
    'ÃƒÂ¢Ã…Â¡Ã‚Â¡ Filtering results through novelty assessment engine...',
    'ÃƒÂ¢Ã…â€œÃ‚Â¨ Ranking patents by technical relevance and impact...',
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Â¹ Preparing final results with comprehensive metadata...'
  ];

  // Stage 3.5 simulation state
  const [isStage35Simulating, setIsStage35Simulating] = useState(false);
  const [stage35Message, setStage35Message] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Stage 3.5a simulation state
  const [isStage35aSimulating, setIsStage35aSimulating] = useState(false);
  const [stage35aMessage, setStage35aMessage] = useState('');

  // Stage 0 editing state
  const [isEditingStage0, setIsEditingStage0] = useState(false);
  const [editedSearchQuery, setEditedSearchQuery] = useState('');
  const [editedFeatures, setEditedFeatures] = useState<string[]>([]);
  const [editingFeatureIndex, setEditingFeatureIndex] = useState<number | null>(null);
  const [newFeatureText, setNewFeatureText] = useState('');


  const stage35Messages = [
    'Comparing invention claims with patent claimsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦',
    'Analyzing technical differencesÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦',
    'Evaluating novelty impactÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦',
    'Assessing obviousnessÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦',
    'Reviewing prior art citationsÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦',
    'Generating assessment reportÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦'
  ];

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  // Derive the selected project object for display (memoized)
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);


  // Helper function to get current stage display info
  const getCurrentStageInfo = () => {
    const currentStatus = searchState.status || 'PENDING';
    return {
      label: STAGE_LABELS[currentStatus as keyof typeof STAGE_LABELS] || 'Start Search',
      progress: STAGE_PROGRESS[currentStatus as keyof typeof STAGE_PROGRESS] || 0
    };
  };

  // Helper function to get previous/next tabs (UI navigation only)
  const getPrevNextStages = () => {
    const idx = STAGE_TABS.indexOf(selectedStageTab as any);
    const prev = idx > 0 ? STAGE_TABS[idx - 1] : null;
    const next = idx >= 0 && idx < STAGE_TABS.length - 1 ? STAGE_TABS[idx + 1] : null;
    return { prev, next };
  };

  // Helper: has Stage 1.5 (AI Relevance) been computed and attached to results?
  const hasStage15 = (): boolean => {
    const r: any = searchState.results || {};
    const gate = r?.aiRelevance || r?.stage1?.aiRelevance;
    return !!(gate && (Array.isArray(gate.accepted) || Array.isArray(gate.borderline) || Array.isArray(gate.rejected)));
  };

  // Map status to specific stage execution numbers
  const getStageNumberForStatus = (status: string): string | null => {
    switch (status) {
      case 'PENDING':
      case NoveltySearchStatus.STAGE_0_COMPLETED:
        return '1';
      case NoveltySearchStatus.STAGE_1_COMPLETED:
        // If Stage 1.5 AI Relevance hasnÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢t been run yet, run it next; otherwise run combined 3.5 (a+b)
        return hasStage15() ? '3.5' : '1.5';
      case NoveltySearchStatus.STAGE_3_5_COMPLETED:
        // After combined Stage 3.5, always move forward to Stage 4
        return '4';
      case NoveltySearchStatus.COMPLETED:
        return null; // Already at final stage
      default:
        return null;
    }
  };

  const getStageNumberForPrevStatus = (status: string): string | null => {
    switch (status) {
      case NoveltySearchStatus.STAGE_0_COMPLETED:
        return '0';
      case NoveltySearchStatus.STAGE_1_COMPLETED:
        // Navigate back to Stage 0 view (no API call); return '0' sentinel
        return '0';
      case NoveltySearchStatus.STAGE_3_5_COMPLETED:
        // If Stage 1.5 exists, allow stepping back to it; else back to combined Stage 3.5
        return hasStage15() ? '1.5' : '3.5';
      case NoveltySearchStatus.COMPLETED:
        return '4';
      default:
        return null;
    }
  };

  // Fetch projects on component mount
  useEffect(() => {
    fetchProjects();
  }, []);

  // Manual stage progression: Users explicitly control when each stage executes
  // No automatic stage advancement - each stage must be manually triggered

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const userProjects = data.projects || [];
        setProjects(userProjects);

        // If no initial project ID (coming from dashboard), set default project
        if (!initialProjectId && userProjects.length > 0) {
          const defaultProject = userProjects.find((p: Project) => p.name === 'Default Project');
          if (defaultProject) {
            setSelectedProjectId(defaultProject.id);
          } else {
            setSelectedProjectId(userProjects[0].id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const startNoveltySearch = async () => {
    if (!formData.title.trim() || !formData.inventionDescription.trim()) {
      setSearchState(prev => ({ ...prev, error: 'Title and invention description are required' }));
      return;
    }

    // Validate selected project exists
    const validProjectId = selectedProjectId && projects.find(p => p.id === selectedProjectId) ? selectedProjectId : null;

    setSearchState({ ...searchState, isLoading: true, error: null });
    console.log('Starting novelty search with data:', { patentId, projectId: validProjectId, ...formData });
    console.log('Selected project details:', { selectedProjectId, validProjectId, projects: projects.map(p => ({ id: p.id, name: p.name })) });

    try {
      const response = await fetch('/api/novelty-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          patentId,
          projectId: validProjectId,
          ...formData,
          config: {
            jurisdiction: formData.jurisdiction,
            stage4: {
              reportFormat: 'JSON',
              includeExecutiveSummary: true,
              includeTechnicalDetails: true,
              colorCoding: true,
              modelPreference: 'gemini-2.5-flash-lite'
            }
          }
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start novelty search');
      }

      console.log('Novelty search started successfully:', { searchId: data.searchId, status: data.status });
      setSearchState(prev => ({
        ...prev,
        searchId: data.searchId,
        status: data.status,
        currentStage: data.currentStage,
        results: data.results,
        isLoading: false
      }));

      setStageProgress(prev => ({ ...prev, stage0: 100 }));

    } catch (error) {
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start search',
        isLoading: false
      }));
    }
  };

  const executeStage = async (stageNumber: string) => {
    if (!searchState.searchId) return;

    console.log(`[Execution] Attempting to execute stage: ${stageNumber}`);
    setSearchState(prev => ({ ...prev, isLoading: true, error: null }));

    if (stageNumber === '1') {
      setIsStage1Simulating(true);
      console.log('[Stage1][Client] Starting Stage 1. Current results snapshot:', searchState.results);
      console.log('[Stage1][Client] Stage 0 searchQuery (if available):', (searchState.results as any)?.stage0?.searchQuery);
      // Simulate sophisticated progress similar to RelatedArtStage
      for (let i = 0; i < stage1Messages.length; i++) {
        setStage1Message(stage1Messages[i]);
        // 1.8s per step to mirror RelatedArtStage UX
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
      setStage1Message('ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¡ Finalizing patent analysis and generating comprehensive report...');
    } else if (stageNumber === '3.5') {
      setIsStage35Simulating(true);
      setStage35Message(stage35Messages[0]); // Set first message immediately
      const s0q = (searchState.results as any)?.stage0?.searchQuery;
      console.log('[Stage3.5][Client] Preparing to call Stage 3.5 with searchQuery:', s0q);
    } else if (stageNumber === '3.5a') {
      setIsStage35aSimulating(true);
      const stage35aMessages = [
        '?? Selecting top patents by PQAI relevance...',
        '?? Applying 50% selection with max 20 and min 10...',
        '?? Canonicalizing patents for feature mapping...',
        '?? Mapping invention features to patent evidence...',
        '? Computing coverage and extracting references...'
      ];
      setStage35aMessage(stage35aMessages[0]);
      for (let i = 1; i < stage35aMessages.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 1200));
        setStage35aMessage(stage35aMessages[i]);
      }
    } else if (stageNumber === '3.5b') {
      setIsStage35Simulating(true);
      setStage35Message('Aggregating coverage and computing novelty metrics...');
    } else if (stageNumber === '3.5c') {
      setIsStage35Simulating(true);
      setStage35Message('Generating patent-by-patent remarks...');
    }

    try {
      // Prepare optional payload for stage 3.5
      let fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      };

      if (stageNumber === '3.5a') {
        // No selection needed; server will use saved Stage 1 PQAI results
        console.log('[Stage3.5a][Client] Calling Stage 3.5a without selection; server uses Stage 1 PQAI results');
        fetchOptions = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        };
      }

      const response = await fetch(`/api/novelty-search/${searchState.searchId}/stage/${stageNumber}`, fetchOptions);

      const data = await response.json();

      console.log(`[Execution] Response from stage ${stageNumber}:`, data);
      if (stageNumber === '3.5a') {
        console.log('[Stage3.5a][Client] Detailed response:', {
          success: data.success,
          status: data.status,
          resultsKeys: data.results ? Object.keys(data.results) : [],
          stage35: data.results?.stage35 ? 'present' : 'missing',
          stage35Keys: data.results?.stage35 ? Object.keys(data.results.stage35) : []
        });
      }
      if (stageNumber === '1') {
        console.log('[Stage1][Client] Received results keys:', data?.results ? Object.keys(data.results) : 'no results');
        console.log('[Stage1][Client] PQAI results count:', Array.isArray(data?.results?.pqaiResults) ? data.results.pqaiResults.length : 'n/a');
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to execute stage ${stageNumber}`);
      }

      // If Stage 1, show the final count message before updating UI
      if (stageNumber === '1') {
        const items = Array.isArray(data?.results?.pqaiResults)
          ? data.results.pqaiResults
          : (Array.isArray(data?.results?.stage1?.pqaiResults) ? data.results.stage1.pqaiResults : []);
        setStage1Message(`ÃƒÂ¢Ã…â€œÃ‚Â¨ Analysis complete! Found ${items.length} highly relevant patent${items.length !== 1 ? 's' : ''} from millions of global records.`);
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      // Update progress first
      const stageKey = (stageNumber === '3.5' || stageNumber === '3.5a' || stageNumber === '3.5b' ) ? 'stage3_5' : `stage${stageNumber}`;
      setStageProgress(prev => ({ ...prev, [stageKey]: 100 }));

      // Refresh full aggregated results so navigation can use all stages' data
      try {
        const fullRes = await fetch(`/api/novelty-search/${searchState.searchId}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
          cache: 'no-store'
        });
        const fullJson = await fullRes.json();
        if (fullRes.ok && fullJson?.success !== false && fullJson?.search) {
          setSearchState(prev => ({
            ...prev,
            status: fullJson.search.status,
            currentStage: fullJson.search.currentStage,
            results: fullJson.search.results,
            isLoading: false
          }));
        } else {
          // Fallback to stage response payload
          setSearchState(prev => ({
            ...prev,
            status: data.status,
            currentStage: data.currentStage,
            results: data.results,
            isLoading: false
          }));
        }
      } catch {
        setSearchState(prev => ({
          ...prev,
          status: data.status,
          currentStage: data.currentStage,
          results: data.results,
          isLoading: false
        }));
      }

      console.log(`[Execution] Stage ${stageNumber} complete. New state:`, { status: data.status, currentStage: data.currentStage });

      if (data.status === NoveltySearchStatus.COMPLETED && onComplete) {
        onComplete(data.searchId);
      }

    } catch (error) {
      console.error(`[Execution] Error executing stage ${stageNumber}:`, error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : `Failed to execute stage ${stageNumber}`,
        isLoading: false
      }));
    } finally {
      if (stageNumber === '1') {
        setIsStage1Simulating(false);
      } else if (stageNumber === '3.5') {
        setIsStage35Simulating(false);
      } else if (stageNumber === '3.5a') {
        setIsStage35aSimulating(false);
      } else if (stageNumber === '3.5b') {
        setIsStage35Simulating(false);
      } else if (stageNumber === '3.5c') {
        setIsStage35Simulating(false);
      }
    }
  };

  // Simple wrapper to start a stage by number (used by child components)
  const handleStartStage = async (stageNumber: string) => {
    await executeStage(stageNumber);
  };

  const fetchSearchStatus = async () => {
    if (!searchState.searchId) return;

    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      console.warn('[Polling] No auth token found, skipping status fetch');
      setSearchState(prev => ({
        ...prev,
        error: 'Authentication token missing. Please log in again.'
      }));
      return;
    }

    console.log(`[Polling] Fetching status for searchId: ${searchState.searchId}`);

    try {
      const response = await fetch(`/api/novelty-search/${searchState.searchId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        cache: 'no-store'
      });

      const data = await response.json();

      if (response.ok) {
        console.log('[Polling] Received status data:', data);
        setSearchState(prev => ({
          ...prev,
          status: data.search.status,
          currentStage: data.search.currentStage,
          results: data.search.results
        }));

        // Update progress based on completed stages
        const completedStages: string[] = [];
        if (data.search.stage0CompletedAt) completedStages.push('stage0');
        if (data.search.stage1CompletedAt) completedStages.push('stage1');
        if (data.search.stage35CompletedAt) completedStages.push('stage3_5');
        if (data.search.stage4CompletedAt) completedStages.push('stage4');

        setCompletedStages(completedStages);

        setStageProgress(prev => {
          const newProgress = { ...prev };
          completedStages.forEach(stage => {
            (newProgress as any)[stage] = 100;
          });
          return newProgress;
        });
      } else {
        // Handle authentication errors
        if (response.status === 401 || data.error?.includes('token') || data.error?.includes('auth')) {
          console.warn('[Polling] Authentication error:', data.error);
          setSearchState(prev => ({
            ...prev,
            error: 'Your session has expired. Please log in again.',
            status: NoveltySearchStatus.FAILED
          }));
          // Stop polling on auth errors
          return;
        }

        console.error('[Polling] API error:', response.status, data);
        setSearchState(prev => ({
          ...prev,
          error: data.error || `Failed to fetch search status (${response.status})`
        }));
      }
    } catch (error) {
      console.error('Failed to fetch search status:', error);
    }
  };


  // Stage 0 editing functions
  const startEditingStage0 = () => {
    const s0 = (searchState.results?.stage0) || (searchState.results as any) || {};
    if (s0) {
      setEditedSearchQuery(s0.searchQuery || '');
      setEditedFeatures([...(s0.inventionFeatures || [])]);
      setIsEditingStage0(true);
    }
  };

  const saveStage0Edits = async () => {
    if (!searchState.searchId) return;

    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Saving Stage 0 edits:', {
      searchId: searchState.searchId,
      searchQuery: editedSearchQuery,
      inventionFeatures: editedFeatures
    });

    try {
      const response = await fetch(`/api/novelty-search/${searchState.searchId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          stage: 'stage0',
          searchQuery: editedSearchQuery,
          inventionFeatures: editedFeatures
        })
      });

      console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¡ PATCH response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ PATCH response error:', errorText);
        throw new Error(`Failed to save Stage 0 edits: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ PATCH response:', result);

      // Update local state
      setSearchState(prev => ({
        ...prev,
        results: {
          ...prev.results,
          stage0: {
            ...prev.results?.stage0,
            searchQuery: editedSearchQuery,
            inventionFeatures: editedFeatures
          },
          // Keep top-level fields in sync for initial Stage 0 shape
          searchQuery: editedSearchQuery,
          inventionFeatures: editedFeatures
        }
      }));

      setIsEditingStage0(false);
    } catch (error) {
      console.error('Save Stage 0 edits error:', error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save edits'
      }));
    }
  };

  const cancelStage0Edits = () => {
    setIsEditingStage0(false);
    setEditingFeatureIndex(null);
    setNewFeatureText('');
  };

  const addFeature = () => {
    if (newFeatureText.trim()) {
      setEditedFeatures([...editedFeatures, newFeatureText.trim()]);
      setNewFeatureText('');
    }
  };

  const removeFeature = (index: number) => {
    setEditedFeatures(editedFeatures.filter((_, i) => i !== index));
  };

  const startEditingFeature = (index: number) => {
    setEditingFeatureIndex(index);
  };

  const saveFeatureEdit = (index: number, newText: string) => {
    const updated = [...editedFeatures];
    updated[index] = newText.trim();
    setEditedFeatures(updated);
    setEditingFeatureIndex(null);
  };

  const resumeSearch = async () => {
    if (!searchState.searchId) return;

    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      setSearchState(prev => ({
        ...prev,
        error: 'Authentication token missing. Please log in again.'
      }));
      return;
    }

    setSearchState(prev => ({
      ...prev,
      isLoading: true,
      error: null
    }));

    try {
      const response = await fetch(`/api/novelty-search/${searchState.searchId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        setSearchState(prev => ({
          ...prev,
          error: data.error || 'Failed to resume search',
          isLoading: false
        }));
        return;
      }

      // Update search state with resume result
      setSearchState(prev => ({
        ...prev,
        status: data.status,
        currentStage: data.currentStage,
        results: data.results,
        isLoading: false
      }));

      console.log('[Resume] Search resumed successfully:', { status: data.status, currentStage: data.currentStage });

    } catch (error) {
      console.error('[Resume] Error resuming search:', error);
      setSearchState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to resume search',
        isLoading: false
      }));
    }
  };

  const renderForm = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Start Novelty Search
        </CardTitle>
        <CardDescription>
          Enter your invention details to begin a comprehensive novelty assessment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Project Display */}
        <div>
          <Label className="flex items-center gap-2">
            Project
          </Label>
          <div className="flex items-center space-x-3 p-3 bg-purple-50 border border-purple-200 rounded-lg mt-1">
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900">{selectedProject?.name || 'Project'}</div>
              <div className="text-xs text-gray-500">{selectedProject?.name === 'Default Project' ? 'Quick drafts and searches' : 'Selected project'}</div>
            </div>
            {selectedProject?.name === 'Default Project' && (
              <Badge variant="secondary" className="text-xs">Default</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Your novelty search results will be saved to {selectedProject?.name ? `the ${selectedProject.name}` : 'your project'} for quick access.
          </p>
        </div>

        <div>
          <Label htmlFor="title">Invention Title</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            placeholder="Enter a clear, concise title for your invention"
          />
        </div>

        <div>
          <Label htmlFor="description">Invention Description</Label>
          <Textarea
            id="description"
            value={formData.inventionDescription}
            onChange={(e) => setFormData(prev => ({ ...prev, inventionDescription: e.target.value }))}
            placeholder="Describe your invention in detail, including the problem it solves, how it works, and its key features..."
            rows={8}
          />
        </div>

        <div>
          <Label htmlFor="jurisdiction">Jurisdiction</Label>
          <select
            id="jurisdiction"
            value={formData.jurisdiction}
            onChange={(e) => setFormData(prev => ({ ...prev, jurisdiction: e.target.value }))}
            className="w-full p-2 border border-gray-300 rounded-md"
          >
            <option value="IN">India (IN)</option>
            <option value="US">United States (US)</option>
            <option value="EP">European Patent (EP)</option>
            <option value="WO">PCT (WO)</option>
          </select>
        </div>

        {searchState.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{searchState.error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={startNoveltySearch}
          disabled={searchState.isLoading}
          className="w-full"
        >
          {searchState.isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting Novelty Search...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Start Novelty Search
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );

  const renderProgress = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Novelty Search Progress
        </CardTitle>
        <CardDescription>
          Search ID: {searchState.searchId}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 mb-1">
              {getCurrentStageInfo().label}
            </div>
            {searchState.isLoading && (
              <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing...</span>
              </div>
            )}
            {searchState.status === NoveltySearchStatus.COMPLETED && (
              <div className="flex items-center justify-center gap-2 text-sm text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span>Search completed successfully</span>
              </div>
            )}
          </div>
        </div>

        {/* Manual Progression Notice */}
        {searchState.status !== NoveltySearchStatus.COMPLETED &&
         searchState.status !== NoveltySearchStatus.PENDING &&
         !searchState.isLoading && (
          <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-700">
              ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¯ Manual stage progression - click "Next" to advance to the next stage
            </p>
          </div>
        )}

        {/* Stage 3.5 Progress */}
        {isStage35aSimulating && stage35aMessage && (
          <div className="p-4 bg-gradient-to-r from-purple-50 to-teal-50 border border-purple-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-purple-900 mb-1">Feature Mapping (Stage 3.5)</div>
                <div className="text-sm text-purple-800">{stage35aMessage}</div>
                <div className="mt-2 bg-purple-200 rounded-full h-2">
                  <div className="bg-purple-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stage 1 Sophisticated Progress */}
        {isStage1Simulating && stage1Message && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-blue-900 mb-1">Advanced Patent Intelligence Analysis</div>
                <div className="text-sm text-blue-800">{stage1Message}</div>
                <div className="mt-2 bg-blue-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {searchState.error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{searchState.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );

  const currentStageInfo = getCurrentStageInfo();
  const { prev: prevStage, next: nextStage } = getPrevNextStages();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Search className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">AI Novelty Search</h1>
                <p className="text-sm text-gray-600">Intelligent patent novelty assessment</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm text-gray-500">Stage: {currentStageInfo.label}</div>
                <div className="text-xs text-gray-400">Progress: {currentStageInfo.progress}%</div>
              </div>

              {/* Stage Navigation Buttons */}
              {searchState.searchId && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={async () => {
                      if (!prevStage) return;
                      const stageNumber = getStageNumberForPrevStatus(searchState.status || 'PENDING');
                      if (!stageNumber) return;
                      if (stageNumber === '0') {
                        // Navigate to Stage 0 view without re-running anything
                        await fetchSearchStatus();
                        startEditingStage0();
                        return;
                      }
                      await executeStage(stageNumber);
                    }}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-75 disabled:cursor-not-allowed"
                    disabled={!prevStage}
                    title="Go to previous stage"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </button>

                  <button
                    onClick={async () => {
                      if (!nextStage) return;
                      // For manual progression, execute the next stage based on current status
                      const stageNumber = getStageNumberForStatus(searchState.status || 'PENDING');
                      if (stageNumber) {
                        await executeStage(stageNumber);
                      }
                    }}
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-75 disabled:cursor-not-allowed"
                    disabled={!nextStage}
                    title="Go to next stage"
                  >
                    Next
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-purple-600 to-teal-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${currentStageInfo.progress}%` }}
                ></div>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {currentStageInfo.progress}% Complete
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Stage Tabs */}
        <div className="bg-white rounded-lg border p-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {STAGE_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setSelectedStageTab(tab)}
                className={`px-3 py-1.5 rounded-md text-sm border ${selectedStageTab === tab ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                title={`View Stage ${tab}`}
              >
                Stage {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {!searchState.searchId ? renderForm() : renderProgress()}
        </div>

        {/* Current Stage Results Only */}
        <div className="mt-8 space-y-6">
          {/* Stage 3.5c Ã¢â‚¬â€ Patent-by-Patent Remarks (light fallback card) */}
          {selectedStageTab === '3.5c' && (() => {
            const root: any = (searchState.results as any) || {};
            const stage4 = root.stage4;
            const aggShape = (root?.per_patent_coverage && root?.per_feature_uniqueness) ? root : undefined;
            const carrier: any = stage4 || aggShape || {};
            const remarks: any[] = Array.isArray(carrier?.per_patent_remarks) ? carrier.per_patent_remarks : [];
            return (
              <Card className="border-indigo-200 bg-indigo-50/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center">
                        <CheckCircle className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Stage 3.5c: Patent-by-Patent Remarks</CardTitle>
                        <CardDescription>Concise remarks per reference to feed the final report</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => executeStage('3.5c')} disabled={searchState.isLoading}>
                        {searchState.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Generate Remarks (3.5c)
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {remarks.length === 0 ? (
                    <div className="text-sm text-gray-600">No remarks available yet. Click "Generate Remarks (3.5c)" to create perÃ¢â‚¬â€˜patent remarks.</div>
                  ) : (
                    <div className="space-y-3">
                      {remarks.map((it: any, idx: number) => (
                        <div key={idx} className="rounded-lg border bg-white p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">{idx + 1}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold text-gray-900">{it.pn || 'Unknown PN'}</div>
                              {it.decision && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                  it.decision === 'obvious' ? 'bg-red-50 text-red-700 border-red-200' :
                                  it.decision === 'partial_novelty' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`} title="PerÃ¢â‚¬â€˜patent decision">
                                  {it.decision}
                                </span>
                              )}
                            </div>
                            {it.title && <div className="text-xs text-gray-700">{it.title}</div>}
                            {it.abstract && <div className="mt-1 text-xs text-gray-600 line-clamp-3" title={it.abstract}>{it.abstract}</div>}
                            <div className="mt-2 text-sm text-gray-900 whitespace-pre-wrap">{it.remarks || '-'}</div>
                          </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
          {/* Stage 0 Results (tab-gated) */}
          {selectedStageTab === '0' && (() => {
            const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
            const hasS0 = !!(s0.searchQuery || (Array.isArray(s0.inventionFeatures) && s0.inventionFeatures.length > 0));
            return hasS0;
          })() && (
            <Card className="border-green-200 bg-green-50/30">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Stage 0: Query Generation</CardTitle>
                      <CardDescription>
                        {isEditingStage0 ? 'Edit search query and features before proceeding' : 'Search query and feature extraction completed'}
                      </CardDescription>
                    </div>
                  </div>
                  {!isEditingStage0 && searchState.status === NoveltySearchStatus.STAGE_0_COMPLETED && (
                    <Button
                      onClick={startEditingStage0}
                      variant="outline"
                      size="sm"
                      className="text-green-700 border-green-300 hover:bg-green-50"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit Results
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditingStage0 ? (
                  <div className="space-y-6">
                    {/* Search Query Editing */}
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">Search Query</label>
                      <Textarea
                        value={editedSearchQuery}
                        onChange={(e) => setEditedSearchQuery(e.target.value)}
                        placeholder="Enter search query..."
                        className="min-h-[80px]"
                      />
                    </div>

                    {/* Features Editing */}
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        Invention Features ({editedFeatures.length})
                      </label>

                      {/* Existing Features */}
                      <div className="space-y-2 mb-4">
                        {editedFeatures.map((feature: string, idx: number) => (
                          <div key={idx} className="flex items-center space-x-2 p-3 bg-white rounded-lg border">
                            <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-1 rounded">
                              {idx + 1}
                            </span>
                            {editingFeatureIndex === idx ? (
                              <Input
                                value={feature}
                                onChange={(e) => {
                                  const updated = [...editedFeatures];
                                  updated[idx] = e.target.value;
                                  setEditedFeatures(updated);
                                }}
                                onBlur={() => setEditingFeatureIndex(null)}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    setEditingFeatureIndex(null);
                                  }
                                }}
                                className="flex-1"
                                autoFocus
                              />
                            ) : (
                              <span className="text-sm text-gray-700 flex-1">{feature}</span>
                            )}
                            <div className="flex space-x-1">
                              <Button
                                onClick={() => startEditingFeature(idx)}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-gray-500 hover:text-blue-600"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </Button>
                              <Button
                                onClick={() => removeFeature(idx)}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Evidence Panel (opens when a matrix cell is clicked) */}
                      {selectedEvidence && (
                        <div className="mt-4 rounded-lg border bg-white p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm text-gray-500">Evidence</div>
                              <div className="text-base font-medium text-gray-900 mt-0.5">
                                {selectedEvidence.feature} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {selectedEvidence.status}
                              </div>
                              <div className="text-xs text-gray-600 mt-0.5">
                                Patent: {selectedEvidence.pn}{selectedEvidence.patentTitle ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${selectedEvidence.patentTitle}` : ''}
                              </div>
                            </div>
                            <div>
                              <Button variant="outline" size="sm" onClick={() => setSelectedEvidence(null)}>Close</Button>
                            </div>
                          </div>

                          <div className="mt-3 text-sm text-gray-800">
                            {(selectedEvidence.status === 'Present' || selectedEvidence.status === 'Partial') && (
                              <>
                                <div className="text-gray-600 text-xs mb-1">Verbatim quote{selectedEvidence.field ? ` (${selectedEvidence.field})` : ''}{typeof selectedEvidence.confidence === 'number' ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ confidence ${selectedEvidence.confidence.toFixed(2)}` : ''}</div>
                                <div className="whitespace-pre-wrap border rounded p-2 bg-gray-50">{selectedEvidence.quote || 'No evidence provided'}</div>
                              </>
                            )}
                            {selectedEvidence.status === 'Absent' && (
                              <>
                                <div className="text-gray-600 text-xs mb-1">Reason</div>
                                <div className="whitespace-pre-wrap border rounded p-2 bg-gray-50">{selectedEvidence.reason || 'No direct evidence in title/abstract'}</div>
                              </>
                            )}
                          </div>

                          <div className="mt-3 flex gap-2">
                            {selectedEvidence.link && (
                              <a className="text-xs inline-flex items-center px-2 py-1 border rounded hover:bg-gray-50" href={selectedEvidence.link} target="_blank" rel="noreferrer">
                                Open on Google Patents
                              </a>
                            )}
                            <button
                              type="button"
                              className="text-xs inline-flex items-center px-2 py-1 border rounded hover:bg-gray-50"
                              onClick={() => {
                                const text = [
                                  `Patent: ${selectedEvidence.pn}${selectedEvidence.patentTitle ? ' ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ' + selectedEvidence.patentTitle : ''}`,
                                  `Feature: ${selectedEvidence.feature}`,
                                  `Status: ${selectedEvidence.status}${typeof selectedEvidence.confidence === 'number' ? ' ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ' + selectedEvidence.confidence.toFixed(2) : ''}`,
                                  selectedEvidence.quote ? `Quote: "${selectedEvidence.quote}"` : (selectedEvidence.reason ? `Reason: ${selectedEvidence.reason}` : '')
                                ].filter(Boolean).join('\n');
                                navigator.clipboard?.writeText(text).catch(() => {});
                              }}
                            >
                              Copy evidence
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Add New Feature */}
                      <div className="flex space-x-2">
                        <Input
                          value={newFeatureText}
                          onChange={(e) => setNewFeatureText(e.target.value)}
                          placeholder="Add new feature..."
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              addFeature();
                            }
                          }}
                        />
                        <Button
                          onClick={addFeature}
                          disabled={!newFeatureText.trim()}
                          variant="outline"
                          size="sm"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add
                        </Button>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-3 pt-4 border-t">
                      <Button
                        onClick={cancelStage0Edits}
                        variant="outline"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={saveStage0Edits}
                        className="bg-green-600 hover:bg-green-700"
                        disabled={!editedSearchQuery.trim() || editedFeatures.length === 0}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Save & Continue
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Search Query</h4>
                      <div className="p-3 bg-white rounded-lg border">
                        {(() => {
                          const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
                          return (
                            <p className="text-sm text-gray-700">"{s0.searchQuery}"</p>
                          );
                        })()}
                      </div>
                    </div>
                    <div>
                      {(() => {
                        const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
                        const features = Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures : [];
                        return (
                          <h4 className="font-medium text-gray-900 mb-2">Extracted Features ({features.length || 0})</h4>
                        );
                      })()}
                      <div className="space-y-2">
                        {(() => {
                          const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
                          const features = Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures : [];
                          return features.length > 0 ? (
                            features.map((feature: string, idx: number) => (
                              <div key={idx} className="flex items-center space-x-2 p-2 bg-white rounded border">
                                <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-1 rounded">
                                  {idx + 1}
                                </span>
                                <span className="text-sm text-gray-700">{feature}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-gray-500">No features extracted</p>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stage 1 Results (tab-gated) */}
          {selectedStageTab === '1' && (((searchState.results as any).pqaiResults || (searchState.results as any)?.stage1?.pqaiResults)) && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Stage 1: Patent Search</CardTitle>
                    <CardDescription>Patent database search and relevance-based selection</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const pqaiResults = (searchState.results as any).pqaiResults || (searchState.results as any)?.stage1?.pqaiResults || [];
                  const aiRel = (searchState.results as any)?.aiRelevance || (searchState.results as any)?.stage1?.aiRelevance || null;
                  const highRelevanceCount = pqaiResults.filter((p: any) => p.relevanceScore && p.relevanceScore > 0.5).length || 0;
                  const avgRelevance = pqaiResults.length > 0 ?
                    (pqaiResults.reduce((avg: number, p: any) => avg + (p.relevanceScore || 0), 0) / pqaiResults.length * 100) : 0;

                  return (
                    <>
                      <div className="grid md:grid-cols-3 gap-4 mb-6">
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-blue-600">{pqaiResults.length}</div>
                          <div className="text-sm text-gray-600">Patents Found</div>
                        </div>
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-green-600">{highRelevanceCount}</div>
                          <div className="text-sm text-gray-600">High Relevance</div>
                        </div>
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-purple-600">{avgRelevance.toFixed(1)}%</div>
                          <div className="text-sm text-gray-600">Avg Relevance</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mb-4">
                        <div className="text-sm text-gray-600">
                          {aiRel ? 'AI Relevance (Stage 1.5) computed.' : 'Run AI Relevance (Stage 1.5) to filter candidates before feature mapping.'}
                        </div>
                        <div className="flex gap-2">
                          {!aiRel && (
                            <Button size="sm" variant="outline" onClick={async () => { await executeStage('1.5'); }}>
                              Run AI Relevance (Stage 1.5)
                            </Button>
                          )}
                          {aiRel && (
                            <Button size="sm" variant="outline" onClick={async () => { await executeStage('3.5'); }}>
                              Run Feature Mapping + Aggregation (3.5)
                            </Button>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Patent Database Results (Sorted by Relevance)</h4>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {pqaiResults.map((r: any, i: number) => {
                            const patentNumber = r.publicationNumber || r.pn || r.patent_number || r.publication_number || 'N/A'
                            const title = r.title || r.invention_title || patentNumber || 'Untitled'
                            const abstract = r.abstract || r.snippet || r.description || ''
                            const pubDate = r.year || r.publication_date || r.filing_date || ''
                            const relevanceScore = r.relevanceScore || r.score || r.relevance || 0
                            const inventors = r.inventors || r.inventor_names || []
                            const assignees = r.assignees || r.assignee_names || []
                            const cpcCodes = r.cpcCodes || r.cpc_codes || []
                            const ipcCodes = r.ipcCodes || r.ipc_codes || []

                            return (
                              <div key={i} className="py-4 px-3 border rounded-lg mb-3 bg-gray-50">
                                <div className="flex items-start gap-3">
                                  {/* Item Number */}
                                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-semibold text-sm flex-shrink-0">
                                    {i + 1}
                                  </div>

                                  <div className="flex-1">
                                    {/* Header with title and score */}
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <a className="font-medium text-indigo-700 hover:underline text-sm" target="_blank" href={`https://lens.org/${encodeURIComponent(patentNumber).replace(/\s+/g,'-')}`}>
                                          {title}
                                        </a>
                                        <div className="text-xs text-gray-500 mt-1">
                                          {patentNumber !== 'N/A' && `Patent: ${patentNumber}`}
                                          {pubDate && (patentNumber !== 'N/A' ? ' Ãƒâ€šÃ‚Â· ' : '') + `Published: ${String(pubDate).slice(0,10)}`}
                                          {relevanceScore !== null && ` Ãƒâ€šÃ‚Â· Relevance: ${(relevanceScore * 100).toFixed(1)}%`}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Snippet/Abstract */}
                                    {abstract && (
                                      <div className="mt-3">
                                        <div className="text-xs font-medium text-gray-700 mb-1">Abstract/Summary:</div>
                                        <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded border leading-relaxed">
                                          {abstract}
                                        </div>
                                      </div>
                                    )}

                                    {/* Additional metadata */}
                                    {((Array.isArray(inventors) && inventors.length) ||
                                      (Array.isArray(assignees) && assignees.length) ||
                                      (Array.isArray(cpcCodes) && cpcCodes.length) ||
                                      (Array.isArray(ipcCodes) && ipcCodes.length)) && (
                                      <div className="mt-3 text-xs text-gray-600">
                                        {Array.isArray(inventors) && inventors.length > 0 && <div><strong>Inventors:</strong> {inventors.join(', ')}</div>}
                                        {Array.isArray(assignees) && assignees.length > 0 && <div><strong>Assignees:</strong> {assignees.join(', ')}</div>}
                                        {Array.isArray(cpcCodes) && cpcCodes.length > 0 && (
                                          <div>
                                            <strong>CPC Codes:</strong>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              {cpcCodes.map((code: string, idx: number) => (
                                                <span key={idx} className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">
                                                  {code}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {Array.isArray(ipcCodes) && ipcCodes.length > 0 && (
                                          <div>
                                            <strong>IPC Codes:</strong>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              {ipcCodes.map((code: string, idx: number) => (
                                                <span key={idx} className="bg-purple-50 text-purple-700 px-2 py-1 rounded text-xs">
                                                  {code}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                          {pqaiResults.length === 0 && <p className="text-sm text-gray-500">No patent results available</p>}
                        </div>
                      </div>
                  </>
                );
              })()}
              </CardContent>
            </Card>
          )}

          {/* Stage 1.5 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â AI Relevance Summary (tab-gated) */}
          {selectedStageTab === '1.5' && (
            (() => {
              const aiRel = (searchState.results as any)?.aiRelevance || (searchState.results as any)?.stage1?.aiRelevance;
              if (!aiRel) return null;
              const acc = Array.isArray(aiRel.accepted) ? aiRel.accepted.length : 0;
              const bor = Array.isArray(aiRel.borderline) ? aiRel.borderline.length : 0;
              const rej = Array.isArray(aiRel.rejected) ? aiRel.rejected.length : 0;
              const total = acc + bor + rej;
              const sampleList = (list: string[], max = 10) => list.slice(0, max).map((pn, i) => (
                <li key={i} className="truncate">{pn}</li>
              ));
              return (
                <Card className="mt-4">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">Stage 1.5: AI Relevance</CardTitle>
                      <div className="text-xs text-gray-500">Thresholds: High {(aiRel.thresholds?.high ?? 0.6)}, Medium {(aiRel.thresholds?.medium ?? 0.4)}</div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                      <div className="text-center p-4 bg-white rounded-lg border">
                        <div className="text-sm text-gray-600">Accepted</div>
                        <div className="text-2xl font-bold text-emerald-600">{acc}</div>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg border">
                        <div className="text-sm text-gray-600">Borderline</div>
                        <div className="text-2xl font-bold text-amber-600">{bor}</div>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg border">
                        <div className="text-sm text-gray-600">Rejected</div>
                        <div className="text-2xl font-bold text-red-600">{rej}</div>
                      </div>
                      <div className="text-center p-4 bg-white rounded-lg border">
                        <div className="text-sm text-gray-600">Total Scored</div>
                        <div className="text-2xl font-bold text-indigo-600">{total}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <div className="text-sm font-semibold text-gray-700 mb-2">Accepted (sample)</div>
                        <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                          {sampleList(Array.isArray(aiRel.accepted) ? aiRel.accepted : [])}
                        </ul>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-700 mb-2">Borderline (sample)</div>
                        <ul className="list-disc list-inside text-sm text-gray-800 space-y-1">
                          {sampleList(Array.isArray(aiRel.borderline) ? aiRel.borderline : [])}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()
          )}

          {/* Stage 3.5 Results (tab-gated) */}
          {selectedStageTab === '3.5' && (() => {
            const stage35Any: any = (searchState.results as any)?.stage35;
            const hasResults = Array.isArray((searchState.results as any)?.feature_map) || Array.isArray(stage35Any?.feature_map);
            console.log('[Stage3.5a][UI] Status check:', {
              status: searchState.status,
              expectedStatus: NoveltySearchStatus.STAGE_3_5_COMPLETED,
              hasResults,
              stage35_has_feature_map: Array.isArray(stage35Any?.feature_map),
              top_feature_map: Array.isArray((searchState.results as any)?.feature_map),
              resultsKeys: searchState.results ? Object.keys(searchState.results) : []
            });
            const statusOk = searchState.status === NoveltySearchStatus.STAGE_3_5_COMPLETED || searchState.status === NoveltySearchStatus.COMPLETED;
            return statusOk && hasResults && (
            <Card className="border-purple-200 bg-purple-50/30">
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Stage 3.5: Feature Analysis</CardTitle>
                    <CardDescription>AI-powered feature-to-patent mapping with evidence extraction</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  const stage35 = (searchState.results as any)?.stage35;
                  const topFeatureMap = (searchState.results as any)?.feature_map;
                  const items = Array.isArray(stage35?.feature_map)
                    ? stage35.feature_map
                    : (Array.isArray(topFeatureMap) ? topFeatureMap : []);
                  const presentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.present || 0), 0);
                  const partialSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.partial || 0), 0);
                  const absentSum = items.reduce((sum: number, p: any) => sum + (p.coverage?.absent || 0), 0);

                  return (
                    <>
                      <div className="grid md:grid-cols-4 gap-4 mb-6">
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-purple-600">{items.length}</div>
                          <div className="text-sm text-gray-600">Patents Analyzed</div>
                        </div>
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-green-600">{presentSum}</div>
                          <div className="text-sm text-gray-600">Present Features</div>
                        </div>
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-yellow-600">{partialSum}</div>
                          <div className="text-sm text-gray-600">Partial Features</div>
                        </div>
                        <div className="text-center p-4 bg-white rounded-lg border">
                          <div className="text-2xl font-bold text-red-600">{absentSum}</div>
                          <div className="text-sm text-gray-600">Absent Features</div>
                        </div>
                      </div>

                      {/* Detailed Feature-Patent Matrix */}
                      <div className="mt-6">
                        <h4 className="font-medium text-gray-900 mb-3">Detailed Feature-Patent Matrix</h4>
                        {(() => {
                          const s0 = (searchState.results as any)?.stage0 || (searchState.results as any) || {};
                          const featuresFromS0: string[] = Array.isArray(s0.inventionFeatures) ? s0.inventionFeatures : [];
                          const featuresFromMaps: string[] = Array.from(new Set(
                            items.flatMap((p: any) => Array.isArray(p?.feature_analysis) ? p.feature_analysis.map((c: any) => c.feature).filter(Boolean) : [])
                          ));
                          const features: string[] = (featuresFromS0 && featuresFromS0.length > 0) ? featuresFromS0 : featuresFromMaps;

                          if (!Array.isArray(items) || items.length === 0 || features.length === 0) {
                            return <p className="text-sm text-gray-500">No feature mapping data available to display.</p>;
                          }

                          // Limit for readability
                          const visiblePatents = items.slice(0, 20);
                          const visibleFeatures = features.slice(0, 18);

                          const getStatusClass = (status: string | undefined) => {
                            switch (status) {
                              case 'Present': return 'bg-green-100 text-green-700 border-green-300';
                              case 'Partial': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
                              case 'Absent': return 'bg-red-100 text-red-700 border-red-300';
                              default: return 'bg-gray-100 text-gray-600 border-gray-300';
                            }
                          };

                          return (
                            <div className="overflow-auto border rounded-lg">
                              <table className="min-w-full text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-44">Patent</th>
                                    {visibleFeatures.map((f: string, idx: number) => (
                                      <th key={idx} className="px-2 py-2 text-left font-medium text-gray-700 border-b min-w-[120px] max-w-[140px]">
                                        <div className="text-xs leading-tight break-words">{f}</div>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="bg-white">
                                  {visiblePatents.map((patent: any, rowIdx: number) => {
                                    const pn = patent.pn || patent.publicationNumber || patent.patent_number || patent.publication_number || 'N/A';
                                    const cellsArray = Array.isArray(patent.feature_analysis)
                                      ? patent.feature_analysis
                                      : [
                                          ...Array.isArray(patent.present) ? patent.present : [],
                                          ...Array.isArray(patent.partial) ? patent.partial : [],
                                          ...Array.isArray(patent.absent) ? patent.absent : []
                                        ];
                                    const featureToStatus = new Map<string, string>();
                                    for (const c of cellsArray) {
                                      if (c && typeof c.feature === 'string' && c.feature) {
                                        featureToStatus.set(c.feature, c.status || 'Unknown');
                                      }
                                    }

                                    return (
                                      <tr key={rowIdx} className="border-t border-gray-100">
                                        <td className="px-3 py-2 align-top">
                                          <div className="font-medium text-gray-900">{pn}</div>
                                          {patent.title && (
                                            <div className="text-xs text-gray-500 mt-1 max-w-xs truncate" title={patent.title}>
                                              {patent.title.split(' ').slice(0, 2).join(' ')}{patent.title.split(' ').length > 2 ? '...' : ''}
                                            </div>
                                          )}
                                        </td>
                                        {visibleFeatures.map((f: string, colIdx: number) => {
                                          const status = featureToStatus.get(f) || 'Unknown';
                                          // Find full cell object for tooltip/details
                                          const cellObj = (() => {
                                            const byExact = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature === f);
                                            if (byExact) return byExact;
                                            const byLower = cellsArray.find((c: any) => c && typeof c.feature === 'string' && c.feature.toLowerCase() === f.toLowerCase());
                                            return byLower || null;
                                          })();

                                          const quote = (cellObj && (cellObj.quote || cellObj.evidence)) ? String(cellObj.quote || cellObj.evidence) : '';
                                          const reason = cellObj && cellObj.reason ? String(cellObj.reason) : '';
                                          const field = cellObj && cellObj.field ? String(cellObj.field) : undefined;
                                          const confidence = (cellObj && typeof cellObj.confidence === 'number') ? cellObj.confidence : undefined;
                                          const link = (patent.link || (pn && `https://patents.google.com/patent/${pn}`)) as string | undefined;

                                          const tooltip = (() => {
                                            if (status === 'Present' || status === 'Partial') {
                                              const snip = quote ? (quote.length > 160 ? quote.slice(0, 157) + 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : quote) : 'No evidence provided';
                                              const conf = (typeof confidence === 'number') ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${confidence.toFixed(2)}` : '';
                                              const fld = field ? ` (${field})` : '';
                                              return `${status}${conf}${fld}: "${snip}"`;
                                            }
                                            if (status === 'Absent') {
                                              const r = reason || 'No direct evidence in title/abstract';
                                              return `${status}: ${r}`;
                                            }
                                            return 'Unknown: No analysis available';
                                          })();

                                          return (
                                            <td key={colIdx} className="px-2 py-1 align-top">
                                              <button
                                                type="button"
                                                title={tooltip}
                                                onClick={() => setSelectedEvidence({
                                                  pn,
                                                  patentTitle: patent.title,
                                                  feature: f,
                                                  status,
                                                  quote: quote || undefined,
                                                  reason: reason || undefined,
                                                  field,
                                                  confidence,
                                                  link
                                                })}
                                                className={`w-full text-left cursor-pointer inline-block text-xs px-2 py-1 rounded border ${getStatusClass(status)} hover:opacity-90`}
                                              >
                                                {status}
                                              </button>
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {(items.length > visiblePatents.length || features.length > visibleFeatures.length) && (
                                <div className="p-2 text-xs text-gray-500 border-t bg-gray-50">
                                  Showing {visiblePatents.length}/{items.length} patents and {visibleFeatures.length}/{features.length} features. Refine to view more.
                                </div>
                              )}
                              <div className="p-2 text-xs text-gray-600 flex gap-3 border-t bg-white">
                                <span><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-green-500"></span>Present</span>
                                <span><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-yellow-500"></span>Partial</span>
                                <span><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-red-500"></span>Absent</span>
                                <span><span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-gray-400"></span>Unknown</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      {/* Per-Patent Remarks from Stage 3.5a */}
                      {Array.isArray(items) && items.some((p: any) => p.remarks) && (
                        <div className="mt-6">
                          <h4 className="font-medium text-gray-900 mb-2">Per-Patent Remarks</h4>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {items
                              .filter((p: any) => p.remarks)
                              .map((p: any, idx: number) => (
                                <div key={p.pn || idx} className="rounded border bg-white p-2">
                                  <div className="text-xs font-semibold text-gray-900">
                                    {p.pn || 'Unknown PN'}
                                  </div>
                                  {p.title && (
                                    <div className="text-[11px] text-gray-600 truncate" title={p.title}>
                                      {p.title}
                                    </div>
                                  )}
                                  <div className="mt-1 text-xs text-gray-800 whitespace-pre-wrap">
                                    {p.remarks}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
            );

          {/* Stage 3.5c ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Patent-by-Patent Remarks */}
          {selectedStageTab === '3.5c' && (() => {
            const root: any = (searchState.results as any) || {};
            const stage4OrAgg = root.stage4 || ((root?.per_patent_coverage && root?.per_feature_uniqueness) ? root : undefined);
            const remarks: any[] = Array.isArray(stage4OrAgg?.per_patent_remarks) ? stage4OrAgg.per_patent_remarks : [];
            const canRun35c = !!stage4OrAgg && remarks.length === 0;
            const hasAgg = !!stage4OrAgg;
            return (
              <Card className="border-indigo-200 bg-indigo-50/30">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center">
                        <CheckCircle className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Stage 3.5c: Patent-by-Patent Remarks</CardTitle>
                        <CardDescription>Concise remarks per reference to feed the final report</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasAgg ? (
                        <Button size="sm" variant="outline" onClick={() => executeStage('3.5c')} disabled={!canRun35c || searchState.isLoading}>
                          {searchState.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {canRun35c ? 'Generate Remarks (3.5c)' : 'Remarks Ready'}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => executeStage('3.5')} disabled={searchState.isLoading}>
                          {searchState.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Run 3.5 (Map + Aggregate)
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {!hasAgg ? (
                    <div className="text-sm text-gray-600">Aggregation not available. Run Stage 3.5 to compute metrics, then generate remarks.</div>
                  ) : remarks.length === 0 ? (
                    <div className="text-sm text-gray-600">No remarks generated yet. Click "Generate Remarks (3.5c)" to create perÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Ëœpatent remarks.</div>
                  ) : (
                    <div className="space-y-3">
                      {remarks.map((it: any, idx: number) => (
                        <div key={idx} className="rounded-lg border bg-white p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm font-semibold">{idx + 1}</div>
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-gray-900">{it.pn || 'Unknown PN'}</div>
                              {it.title && <div className="text-xs text-gray-700">{it.title}</div>}
                              {it.abstract && <div className="mt-1 text-xs text-gray-600 line-clamp-3" title={it.abstract}>{it.abstract}</div>}
                              <div className="mt-2 text-sm text-gray-900 whitespace-pre-wrap">{it.remarks || 'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
          })()}

          {/* Stage 4 Results (Report) - New UI */}
          {selectedStageTab === '4' && (searchState.results as any) && (() => {
            const root: any = (searchState.results as any) || {};
            const r = root.stage4 || root;
            return (
              <Stage4ResultsDisplay
                stage4Results={r}
                searchId={searchState.searchId as any}
                onRerun={async () => {
                  await handleStartStage('4');
                }}
              />
            );
          })()}

          {/* Legacy Stage 4 (removed) */}
        </div>
      </main>
    </div>
  );
}













