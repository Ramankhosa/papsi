'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  AlertCircle,
  Settings2,
  RefreshCw,
  Image as ImageIcon,
  X,
  Eye,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import CitationPickerModal from '@/components/paper/CitationPickerModal';

import PaperMarkdownEditor, {
  type PaperMarkdownEditorRef,
  type PaperCitationDisplayMeta,
  type PaperFigureDisplayMeta
} from '@/components/paper/PaperMarkdownEditor';

// Import shared components from patent drafting
import BackendActivityPanel from '@/components/drafting/BackendActivityPanel';
import WritingSamplesModal from '@/components/drafting/WritingSamplesModal';
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager';
// Paper-specific components
import PaperInstructionsModal from './PaperInstructionsModal';
import PaperSectionInstructionPopover from './PaperSectionInstructionPopover';
import FloatingWritingPanel from '@/components/paper/FloatingWritingPanel';
import { polishDraftMarkdown } from '@/lib/markdown-draft-formatter';
import InlineDimensionProposal from '@/components/paper/InlineDimensionProposal';
import DimensionPlanPills from '@/components/paper/DimensionPlanPills';
import SectionFloatingToolbar from '@/components/paper/SectionFloatingToolbar';

// ============================================================================
// Types
// ============================================================================

interface SectionDraftingStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  selectedSection?: string;
  onSectionSelect?: (sectionKey: string) => void;
  onNavigateToStage?: (stageKey: string) => void;
}

type SectionConfig = {
  keys: string[];
  label: string;
  description?: string;
  constraints?: string[];
  required?: boolean;
  wordLimit?: number;
};

interface UserInstruction {
  id?: string;
  instruction: string;
  emphasis?: string;
  avoid?: string;
  style?: string;
  wordCount?: number;
  isActive?: boolean;
  isPersistent?: boolean;
  updatedAt?: string;
}

type SectionCitationValidation = {
  disallowedKeys: string[];
  unknownKeys: string[];
};

type ReferenceDraftSectionView = {
  sectionKey: string;
  displayName: string;
  status: string;
  hasContent: boolean;
  content: string;
  wordCount: number;
  generatedAt: string | null;
  source: 'pass1_artifact' | 'base_content_internal' | 'none';
  updatedAt: string | null;
};

type DimensionPlanStatus = 'accepted' | 'pending' | 'todo';

interface DimensionPlanItem {
  dimensionKey: string;
  dimensionLabel: string;
  objective: string;
  mustUseCitationKeys: string[];
  avoidClaims: string[];
  bridgeHint: string;
  status: DimensionPlanStatus;
}

interface DimensionCitationValidation {
  allowedCitationKeys: string[];
  disallowedKeys: string[];
  unknownKeys: string[];
  missingRequiredKeys: string[];
}

type DimensionRole = 'introduction' | 'body' | 'conclusion' | 'intro_conclusion';

interface DimensionPass1Memory {
  keyPoints: string[];
  termsIntroduced: string[];
  mainClaims: string[];
  forwardReferences: string[];
  sectionIntent?: string;
  openingStrategy?: string;
  closingStrategy?: string;
  sectionOutline?: string[];
}

interface DimensionPass1SourceReview {
  source: 'pass1_section_draft';
  contentFingerprint: string;
  wordCount: number;
  preview: string;
  generatedAt?: string;
  reused: boolean;
  memory?: DimensionPass1Memory | null;
}

interface DimensionProposalReviewTrace {
  pass1Fingerprint: string;
  pass1WordCount: number;
  role: DimensionRole;
  bridgeHint: string;
  requiredCitationKeys: string[];
  previousDimensionLabel?: string | null;
  nextDimensionLabel?: string | null;
  acceptedBlockCount: number;
  acceptedContextHash: string;
  acceptedSummary: string;
  acceptedContextPreview: string;
  pass1DimensionSummary?: string;
  targetEvidenceSummary?: string;
}

interface DimensionProposal {
  dimensionKey: string;
  content: string;
  contextHash: string;
  citationValidation: DimensionCitationValidation;
  createdAt: string;
  reviewTrace: DimensionProposalReviewTrace | null;
}

interface DimensionProgress {
  total: number;
  accepted: number;
  remaining: number;
}

interface DimensionDraftUIState {
  initialized: boolean;
  started: boolean;
  loading: boolean;
  accepting: boolean;
  rejecting: boolean;
  error: string | null;
  stitchedContent: string;
  plan: DimensionPlanItem[];
  progress: DimensionProgress;
  completed: boolean;
  nextDimensionKey: string | null;
  nextDimensionLabel: string | null;
  activeDimensionKey: string | null;
  activeDimensionLabel: string | null;
  proposalText: string;
  proposalValidation: DimensionCitationValidation | null;
  proposalReviewTrace: DimensionProposalReviewTrace | null;
  pass1Source: DimensionPass1SourceReview | null;
  feedback: string;
  showReject: boolean;
  editMode: boolean;
  streamCursor: number;
  isStreaming: boolean;
}

const EMPTY_DIMENSION_PROGRESS: DimensionProgress = {
  total: 0,
  accepted: 0,
  remaining: 0
};

function createInitialDimensionUIState(): DimensionDraftUIState {
  return {
    initialized: false,
    started: false,
    loading: false,
    accepting: false,
    rejecting: false,
    error: null,
    stitchedContent: '',
    plan: [],
    progress: { ...EMPTY_DIMENSION_PROGRESS },
    completed: false,
    nextDimensionKey: null,
    nextDimensionLabel: null,
    activeDimensionKey: null,
    activeDimensionLabel: null,
    proposalText: '',
    proposalValidation: null,
    proposalReviewTrace: null,
    pass1Source: null,
    feedback: '',
    showReject: false,
    editMode: false,
    streamCursor: 0,
    isStreaming: false
  };
}

function normalizeDimensionPlanItem(raw: any): DimensionPlanItem {
  return {
    dimensionKey: String(raw?.dimensionKey || '').trim(),
    dimensionLabel: String(raw?.dimensionLabel || raw?.dimensionKey || '').trim(),
    objective: String(raw?.objective || '').trim(),
    mustUseCitationKeys: Array.isArray(raw?.mustUseCitationKeys)
      ? raw.mustUseCitationKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    avoidClaims: Array.isArray(raw?.avoidClaims)
      ? raw.avoidClaims.map((text: unknown) => String(text || '').trim()).filter(Boolean)
      : [],
    bridgeHint: String(raw?.bridgeHint || '').trim(),
    status: raw?.status === 'accepted' || raw?.status === 'pending'
      ? raw.status
      : 'todo'
  };
}

function toDimensionValidation(raw: any): DimensionCitationValidation | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    allowedCitationKeys: Array.isArray(raw.allowedCitationKeys)
      ? raw.allowedCitationKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    disallowedKeys: Array.isArray(raw.disallowedKeys)
      ? raw.disallowedKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    unknownKeys: Array.isArray(raw.unknownKeys)
      ? raw.unknownKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : [],
    missingRequiredKeys: Array.isArray(raw.missingRequiredKeys)
      ? raw.missingRequiredKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
      : []
  };
}

function toDimensionPass1Memory(raw: any): DimensionPass1Memory | null {
  if (!raw || typeof raw !== 'object') return null;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const termsIntroduced = Array.isArray(raw.termsIntroduced)
    ? raw.termsIntroduced.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const mainClaims = Array.isArray(raw.mainClaims)
    ? raw.mainClaims.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const forwardReferences = Array.isArray(raw.forwardReferences)
    ? raw.forwardReferences.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  const sectionIntent = String(raw.sectionIntent || '').trim() || undefined;
  const openingStrategy = String(raw.openingStrategy || '').trim() || undefined;
  const closingStrategy = String(raw.closingStrategy || '').trim() || undefined;
  const sectionOutline = Array.isArray(raw.sectionOutline)
    ? raw.sectionOutline.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];

  if (
    keyPoints.length === 0
    && termsIntroduced.length === 0
    && mainClaims.length === 0
    && forwardReferences.length === 0
    && !sectionIntent
    && !openingStrategy
    && !closingStrategy
    && sectionOutline.length === 0
  ) {
    return null;
  }

  return {
    keyPoints,
    termsIntroduced,
    mainClaims,
    forwardReferences,
    sectionIntent,
    openingStrategy,
    closingStrategy,
    sectionOutline
  };
}

function toDimensionPass1Source(raw: any): DimensionPass1SourceReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const contentFingerprint = String(raw.contentFingerprint || '').trim();
  if (!contentFingerprint) return null;
  return {
    source: 'pass1_section_draft',
    contentFingerprint,
    wordCount: Number(raw.wordCount || 0),
    preview: String(raw.preview || ''),
    generatedAt: String(raw.generatedAt || '').trim() || undefined,
    reused: Boolean(raw.reused),
    memory: toDimensionPass1Memory(raw.memory)
  };
}

function toDimensionProposalReviewTrace(raw: any): DimensionProposalReviewTrace | null {
  if (!raw || typeof raw !== 'object') return null;
  const role = String(raw.role || '').trim();
  if (!role || !String(raw.pass1Fingerprint || '').trim()) return null;
  if (role !== 'introduction' && role !== 'body' && role !== 'conclusion' && role !== 'intro_conclusion') {
    return null;
  }

  return {
    pass1Fingerprint: String(raw.pass1Fingerprint || '').trim(),
    pass1WordCount: Number(raw.pass1WordCount || 0),
    role: role as DimensionRole,
    bridgeHint: String(raw.bridgeHint || '').trim(),
    requiredCitationKeys: Array.isArray(raw.requiredCitationKeys)
      ? raw.requiredCitationKeys.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [],
    previousDimensionLabel: String(raw.previousDimensionLabel || '').trim() || null,
    nextDimensionLabel: String(raw.nextDimensionLabel || '').trim() || null,
    acceptedBlockCount: Number(raw.acceptedBlockCount || 0),
    acceptedContextHash: String(raw.acceptedContextHash || '').trim(),
    acceptedSummary: String(raw.acceptedSummary || ''),
    acceptedContextPreview: String(raw.acceptedContextPreview || ''),
    pass1DimensionSummary: String(raw.pass1DimensionSummary || '').trim() || undefined,
    targetEvidenceSummary: String(raw.targetEvidenceSummary || '').trim() || undefined
  };
}

function normalizeDimensionResponse(data: any): {
  started: boolean;
  stitchedContent: string;
  pass1Source: DimensionPass1SourceReview | null;
  completed: boolean;
  plan: DimensionPlanItem[];
  progress: DimensionProgress;
  nextDimensionKey: string | null;
  nextDimensionLabel: string | null;
  proposal: DimensionProposal | null;
} {
  const plan = Array.isArray(data?.plan)
    ? data.plan.map((item: any) => normalizeDimensionPlanItem(item)).filter((item: DimensionPlanItem) => item.dimensionKey.length > 0)
    : [];
  const progress = (data?.progress && typeof data.progress === 'object')
    ? {
        total: Number(data.progress.total || 0),
        accepted: Number(data.progress.accepted || 0),
        remaining: Number(data.progress.remaining || 0)
      }
    : {
        total: plan.length,
        accepted: plan.filter((item: DimensionPlanItem) => item.status === 'accepted').length,
        remaining: plan.filter((item: DimensionPlanItem) => item.status !== 'accepted').length
      };
  const nextDimension = data?.nextDimension && typeof data.nextDimension === 'object'
    ? data.nextDimension
    : null;
  const pass1Source = toDimensionPass1Source(data?.pass1Source || data?.flow?.pass1Source || null);
  const rawProposal = data?.proposal
    || data?.flow?.pendingProposal
    || null;
  const proposal = rawProposal && typeof rawProposal === 'object'
    ? {
        dimensionKey: String(rawProposal.dimensionKey || '').trim(),
        content: String(rawProposal.content || ''),
        contextHash: String(rawProposal.contextHash || ''),
        citationValidation: toDimensionValidation(rawProposal.citationValidation) || {
          allowedCitationKeys: [],
          disallowedKeys: [],
          unknownKeys: [],
          missingRequiredKeys: []
        },
        createdAt: String(rawProposal.createdAt || ''),
        reviewTrace: toDimensionProposalReviewTrace(rawProposal.reviewTrace)
      }
    : null;

  return {
    started: Boolean(data?.started ?? data?.flow),
    stitchedContent: String(data?.stitchedContent || ''),
    pass1Source,
    completed: Boolean(data?.completed),
    plan,
    progress,
    nextDimensionKey: nextDimension ? String(nextDimension.dimensionKey || '').trim() || null : null,
    nextDimensionLabel: nextDimension ? String(nextDimension.dimensionLabel || nextDimension.dimensionKey || '').trim() || null : null,
    proposal: proposal && proposal.dimensionKey ? proposal : null
  };
}


// AI Review Issue Type
interface AIReviewIssue {
  id: string;
  sectionKey: string;
  sectionLabel: string;
  type: 'error' | 'warning' | 'suggestion';
  category: 'consistency' | 'citation' | 'completeness' | 'academic' | 'clarity' | 'structure';
  title: string;
  description: string;
  suggestion: string;
  fixPrompt: string;
  relatedSections?: string[];
  severity: number;
}

// ============================================================================
// Tooltip Component
// ============================================================================

function Tooltip({ content, position = 'bottom', children }: {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };
  
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-lg whitespace-nowrap ${positionClasses[position]}`}>
          {content}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Inline Diff View Component
// ============================================================================

function InlineDiffView({ original, revised }: { original: string; revised: string }) {
  const computeDiff = useMemo(() => {
    try {
      if (!original && !revised) return [];
      if (!original) return [{ type: 'add' as const, text: revised }];
      if (!revised) return [{ type: 'remove' as const, text: original }];
      if (original === revised) return [{ type: 'same' as const, text: '(No changes)' }];
      
      const MAX_CHARS = 30000;
      if (original.length > MAX_CHARS || revised.length > MAX_CHARS) {
        return [{ type: 'same' as const, text: '⚠️ Content too long for diff.' }];
      }
      
      const originalWords = original.split(/(\s+)/);
      const revisedWords = revised.split(/(\s+)/);
      const MAX_ELEMENTS = 4000;
      if (originalWords.length > MAX_ELEMENTS || revisedWords.length > MAX_ELEMENTS) {
        return [{ type: 'same' as const, text: '⚠️ Content too complex for diff.' }];
      }
      
      const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
      const lcs = (a: string[], b: string[]): number[][] => {
        const m = a.length, n = b.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
        return dp;
      };
      
      const dp = lcs(originalWords, revisedWords);
      let i = originalWords.length, j = revisedWords.length;
      const stack: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && originalWords[i - 1] === revisedWords[j - 1]) {
          stack.push({ type: 'same', text: originalWords[i - 1] }); i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          stack.push({ type: 'add', text: revisedWords[j - 1] }); j--;
        } else if (i > 0) {
          stack.push({ type: 'remove', text: originalWords[i - 1] }); i--;
        }
      }
      while (stack.length > 0) result.push(stack.pop()!);
      
      const merged: typeof result = [];
      for (const seg of result) {
        if (merged.length > 0 && merged[merged.length - 1].type === seg.type) {
          merged[merged.length - 1].text += seg.text;
        } else {
          merged.push({ ...seg });
        }
      }
      return merged;
    } catch {
      return [{ type: 'same' as const, text: '⚠️ Could not compute diff.' }];
    }
  }, [original, revised]);
  
  if (computeDiff.length === 0) return <span className="text-gray-400 italic">No changes detected</span>;
  
  return (
    <div className="text-sm leading-relaxed">
      {computeDiff.map((seg, idx) => {
        if (seg.type === 'same') return <span key={idx} className="text-gray-700">{seg.text}</span>;
        if (seg.type === 'add') return <span key={idx} className="bg-emerald-200 text-emerald-900 px-0.5 rounded">{seg.text}</span>;
        return <span key={idx} className="bg-red-200 text-red-900 line-through px-0.5 rounded">{seg.text}</span>;
      })}
    </div>
  );
}

// ============================================================================
// AI Review Panel Component
// ============================================================================

interface PaperValidationPanelProps {
  sessionId: string;
  paperId: string;
  draft: Record<string, string>;
  onFix: (sectionKey: string, fixedContent: string) => void;
  authToken: string | null;
}

function PaperValidationPanel({ sessionId, paperId, draft, onFix, authToken }: PaperValidationPanelProps) {
  const [aiIssues, setAiIssues] = useState<AIReviewIssue[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<{
    totalIssues: number; errors: number; warnings: number; suggestions: number;
    overallScore: number; recommendation: string;
  } | null>(null);
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null);
  const [lastAICheck, setLastAICheck] = useState<string | null>(null);
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set());
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warning' | 'suggestion'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [pendingFix, setPendingFix] = useState<{
    issue: AIReviewIssue; sectionKey: string; originalContent: string; fixedContent: string;
  } | null>(null);

  const runAIReview = useCallback(async () => {
    if (!sessionId || !paperId) return;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken || ''}` },
        body: JSON.stringify({ action: 'run_ai_review', sessionId, draft })
      });
      const data = await res.json();
      if (data.success) {
        setAiIssues(data.issues || []);
        setAiSummary(data.summary || null);
        setCurrentReviewId(data.reviewId || null);
        setLastAICheck(new Date().toLocaleTimeString());
        setIgnoredIssues(new Set());
        setAppliedFixes(new Set());
      }
    } catch (err) {
      console.error('AI review error:', err);
    } finally {
      setAiLoading(false);
    }
  }, [sessionId, paperId, draft, authToken]);

  const generateFixPreview = useCallback(async (issue: AIReviewIssue) => {
    if (!sessionId || !paperId) return;
    setFixingIssue(issue.id);
    try {
      const originalContent = draft[issue.sectionKey] || '';
      const relatedContent: Record<string, string> = {};
      if (issue.relatedSections) {
        for (const key of issue.relatedSections) {
          if (draft[key]) relatedContent[key] = draft[key];
        }
      }
      const res = await fetch(`/api/papers/${paperId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken || ''}` },
        body: JSON.stringify({
          action: 'apply_ai_fix', sessionId, sectionKey: issue.sectionKey, issue,
          currentContent: originalContent, relatedContent, previewOnly: true
        })
      });
      const data = await res.json();
      if (data.success && data.fixedContent) {
        setPendingFix({ issue, sectionKey: issue.sectionKey, originalContent, fixedContent: data.fixedContent });
      }
    } catch (err) {
      console.error('Generate fix preview error:', err);
    } finally {
      setFixingIssue(null);
    }
  }, [sessionId, paperId, draft, authToken]);

  const approveFix = useCallback(() => {
    if (!pendingFix) return;
    onFix(pendingFix.sectionKey, pendingFix.fixedContent);
    setAppliedFixes(prev => new Set([...Array.from(prev), pendingFix.issue.id]));
    setAiIssues(prev => prev.filter(i => i.id !== pendingFix.issue.id));
    setPendingFix(null);
  }, [pendingFix, onFix]);

  const ignoreIssue = useCallback((issueId: string) => {
    setIgnoredIssues(prev => new Set(Array.from(prev).concat(issueId)));
  }, []);

  const allActiveAiIssues = aiIssues.filter(i => !ignoredIssues.has(i.id) && !appliedFixes.has(i.id));
  const aiErrorCount = allActiveAiIssues.filter(i => i.type === 'error').length;
  const aiWarningCount = allActiveAiIssues.filter(i => i.type === 'warning').length;
  const aiSuggestionCount = allActiveAiIssues.filter(i => i.type === 'suggestion').length;
  const fixedCount = appliedFixes.size;
  const activeAiIssues = allActiveAiIssues.filter(i => {
    if (filterType !== 'all' && i.type !== filterType) return false;
    if (filterCategory !== 'all' && i.category !== filterCategory) return false;
    return true;
  });
  const uniqueCategories = Array.from(new Set(allActiveAiIssues.map(i => i.category)));

  const getCategoryStyle = (category: string) => {
    const styles: Record<string, { icon: string; bg: string; border: string; text: string }> = {
      consistency: { icon: '🔗', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
      citation: { icon: '📚', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
      completeness: { icon: '📋', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
      academic: { icon: '🎓', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700' },
      clarity: { icon: '💡', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
      structure: { icon: '🏗️', bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' },
    };
    return styles[category] || { icon: '📝', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' };
  };

  return (
    <div className="space-y-6">
      {/* Intelligence Dashboard */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
              <span className="text-xl">🔬</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Paper Intelligence</h3>
              <p className="text-slate-400 text-xs">Academic Quality Analysis</p>
            </div>
          </div>
          {aiSummary ? (
            <div className="relative">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-700" />
                <circle cx="18" cy="18" r="15" fill="none" strokeWidth="2" strokeLinecap="round"
                  stroke={aiSummary.overallScore >= 90 ? '#10b981' : aiSummary.overallScore >= 80 ? '#f59e0b' : '#ef4444'}
                  strokeDasharray={`${aiSummary.overallScore * 0.94} 100`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-lg font-bold ${aiSummary.overallScore >= 90 ? 'text-emerald-400' : aiSummary.overallScore >= 80 ? 'text-amber-400' : 'text-red-400'}`}>{aiSummary.overallScore}</span>
              </div>
            </div>
          ) : (
            <div className="text-center px-4 py-2 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="text-slate-500 text-xs">Run AI Review</div>
              <div className="text-slate-400 text-xs">for score</div>
            </div>
          )}
        </div>
        {aiSummary?.recommendation && (
          <div className="px-6 py-3 bg-slate-800/30 border-b border-slate-700/50">
            <div className="flex items-start gap-2">
              <span className="text-violet-400 mt-0.5">💡</span>
              <p className="text-sm text-slate-300 leading-relaxed">{aiSummary.recommendation}</p>
            </div>
          </div>
        )}
        <div className="p-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { type: 'error', count: aiErrorCount, color: 'red' },
              { type: 'warning', count: aiWarningCount, color: 'amber' },
              { type: 'suggestion', count: aiSuggestionCount, color: 'blue' },
            ].map(({ type, count, color }) => (
              <button key={type} onClick={() => setFilterType(filterType === type ? 'all' : type as any)}
                className={`group relative rounded-xl p-3 text-center transition-all ${filterType === type ? `bg-${color}-500/20 ring-2 ring-${color}-500/50` : 'bg-slate-800/50 hover:bg-slate-700/50'}`}>
                <div className={`text-2xl font-bold text-${color}-400`}>{count}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider capitalize">{type}s</div>
              </button>
            ))}
            <div className="rounded-xl p-3 text-center bg-slate-800/50">
              <div className="text-2xl font-bold text-emerald-400">{fixedCount}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Fixed</div>
            </div>
          </div>
        </div>
        {uniqueCategories.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5 justify-center">
            {uniqueCategories.map(cat => {
              const style = getCategoryStyle(cat);
              const count = allActiveAiIssues.filter(i => i.category === cat).length;
              return (
                <button key={cat} onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all ${filterCategory === cat ? `${style.bg} ${style.text} ring-1 ${style.border}` : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'}`}>
                  <span>{style.icon}</span><span className="capitalize">{cat}</span><span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="px-4 pb-4">
          <button onClick={runAIReview} disabled={aiLoading}
            className="w-full px-3 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg font-medium hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-lg transition-all">
            {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</> : <><span>🤖</span> AI Review</>}
          </button>
        </div>
        {lastAICheck && (
          <div className="px-4 pb-3 text-[10px] text-slate-500 border-t border-slate-700/30 pt-2">
            🤖 Last check: {lastAICheck} {currentReviewId && <span className="ml-2 font-mono text-slate-600">ID: {currentReviewId.slice(0, 8)}</span>}
          </div>
        )}
      </div>

      {/* Fix Preview Modal */}
      {pendingFix && (
        <div className="bg-white rounded-xl border-2 border-emerald-300 shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200 flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-gray-900 flex items-center gap-2"><span>🔍</span> Review Changes</h4>
              <p className="text-sm text-gray-600 mt-1">Section: <strong>{pendingFix.issue.sectionLabel}</strong></p>
            </div>
            <button onClick={() => setPendingFix(null)} className="p-2 text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <div className="text-xs font-medium text-amber-700 mb-1">💡 Issue: {pendingFix.issue.title}</div>
              <p className="text-sm text-amber-800">{pendingFix.issue.description}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-5 max-h-[400px] overflow-y-auto">
              <InlineDiffView original={pendingFix.originalContent} revised={pendingFix.fixedContent} />
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-3">
            <button onClick={() => setPendingFix(null)} className="px-4 py-2 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Reject</button>
            <button onClick={approveFix} className="px-6 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">Apply Changes</button>
          </div>
        </div>
      )}

      {/* Issues List */}
      {allActiveAiIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <h4 className="font-medium text-gray-700 text-sm">📋 Issues ({activeAiIssues.length}/{allActiveAiIssues.length})</h4>
          </div>
          <div className="divide-y divide-gray-100">
            {activeAiIssues.map((issue) => {
              const style = getCategoryStyle(issue.category);
              return (
                <div key={issue.id} className={`px-6 py-5 ${style.bg}`}>
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-2xl">{style.icon}</span>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <div key={n} className={`w-1.5 h-1.5 rounded-full ${n <= issue.severity ? (issue.type === 'error' ? 'bg-red-500' : issue.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500') : 'bg-gray-300'}`} />
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>{issue.category}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${issue.type === 'error' ? 'bg-red-100 text-red-700' : issue.type === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{issue.type}</span>
                        <span className="text-xs text-gray-500">{issue.sectionLabel}</span>
                      </div>
                      <h5 className="font-medium text-gray-900 mb-1">{issue.title}</h5>
                      <p className="text-sm text-gray-600 mb-2">{issue.description}</p>
                      {issue.suggestion && <div className="text-sm text-gray-700 bg-white/60 rounded p-2 border border-gray-100 mb-3"><strong>💡</strong> {issue.suggestion}</div>}
                      <div className="flex items-center gap-2">
                        <button onClick={() => generateFixPreview(issue)} disabled={fixingIssue === issue.id}
                          className="px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1">
                          {fixingIssue === issue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : '🔧'} Auto-Fix
                        </button>
                        <button onClick={() => ignoreIssue(issue.id)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200">Ignore</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function parseExtraSections(value: any): Record<string, string> {
  const normalize = (sections: Record<string, unknown>): Record<string, string> => {
    const normalized: Record<string, string> = {};
    for (const [key, sectionValue] of Object.entries(sections)) {
      if (typeof sectionValue === 'string') {
        normalized[key] = polishDraftMarkdown(sectionValue);
      }
    }
    return normalized;
  };

  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? normalize(parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return normalize(value as Record<string, unknown>);
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeSectionKey(sectionKey: string): string {
  return sectionKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

const SINGLE_PASS_SECTION_KEYS = new Set(['abstract', 'conclusion']);
const PASS1_EXCLUDED_SECTION_KEYS = new Set(['references', 'reference', 'bibliography']);

function supportsDimensionFlow(sectionKey: string): boolean {
  const normalized = normalizeSectionKey(sectionKey);
  return !SINGLE_PASS_SECTION_KEYS.has(normalized) && !PASS1_EXCLUDED_SECTION_KEYS.has(normalized);
}

function isPass1ExcludedSection(sectionKey: string): boolean {
  return PASS1_EXCLUDED_SECTION_KEYS.has(normalizeSectionKey(sectionKey));
}

const LEGACY_CITATION_SPAN_REGEX = /<span\b[^>]*data-cite-key=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/span>/gi;

function normalizeCitationMarkupForExtraction(content: string): string {
  const raw = String(content || '');
  if (!raw) return '';

  const decodeHtmlEntities = (value: string): string => value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  const replaceLegacySpans = (value: string): string => value.replace(
    LEGACY_CITATION_SPAN_REGEX,
    (_full, keyA, keyB) => {
      const citationKey = String(keyA || keyB || '').trim();
      return citationKey ? `[CITE:${citationKey}]` : _full;
    }
  );

  const normalized = replaceLegacySpans(raw);
  if (!normalized.includes('data-cite-key') && !normalized.includes('&lt;span')) {
    return normalized;
  }

  return replaceLegacySpans(decodeHtmlEntities(normalized));
}

function parseCitationStyleMeta(raw: unknown): {
  styleCode: string;
  sortOrder: 'alphabetical' | 'order_of_appearance';
  isNumericStyle: boolean;
  orderedCitationKeys: string[];
  numberingByKey: Record<string, number>;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const styleCode = String(data.styleCode || '').trim().toUpperCase();
  if (!styleCode) return null;

  const sortOrder = data.sortOrder === 'order_of_appearance'
    ? 'order_of_appearance'
    : 'alphabetical';
  const isNumericStyle = Boolean(data.isNumericStyle);
  const orderedCitationKeys = Array.isArray(data.orderedCitationKeys)
    ? data.orderedCitationKeys.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const numberingByKey: Record<string, number> = {};
  if (data.numberingByKey && typeof data.numberingByKey === 'object' && !Array.isArray(data.numberingByKey)) {
    for (const [key, value] of Object.entries(data.numberingByKey as Record<string, unknown>)) {
      const parsed = Number(value);
      if (key && Number.isFinite(parsed) && parsed > 0) {
        numberingByKey[key] = Math.trunc(parsed);
      }
    }
  }

  return {
    styleCode,
    sortOrder,
    isNumericStyle,
    orderedCitationKeys,
    numberingByKey
  };
}

const displayName: Record<string, string> = {
  title: 'Title', abstract: 'Abstract', introduction: 'Introduction',
  literature_review: 'Literature Review', related_work: 'Related Work',
  methodology: 'Methodology', results: 'Results', discussion: 'Discussion',
  conclusion: 'Conclusion', acknowledgments: 'Acknowledgments', references: 'References',
  appendix: 'Appendix', future_work: 'Future Work', future_directions: 'Future Directions',
  main_content: 'Main Content', case_studies: 'Case Studies', case_description: 'Case Description',
  analysis: 'Analysis', recommendations: 'Recommendations', main_findings: 'Main Findings', publications: 'Publications'
};

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract', wordLimit: 300 },
  { keys: ['introduction'], label: 'Introduction', wordLimit: 1000 },
  { keys: ['literature_review'], label: 'Literature Review', wordLimit: 2000 },
  { keys: ['methodology'], label: 'Methodology', wordLimit: 1500 },
  { keys: ['results'], label: 'Results', wordLimit: 1200 },
  { keys: ['discussion'], label: 'Discussion', wordLimit: 1500 },
  { keys: ['conclusion'], label: 'Conclusion', wordLimit: 600 },
  { keys: ['references'], label: 'References' }
];

const DEFAULT_CITATION_ELIGIBLE_SECTIONS = new Set([
  'introduction',
  'literature_review',
  'methodology'
]);

// Auto-save debounce delay in ms - increased for stability
const AUTO_SAVE_DELAY = 3000;

// ============================================================================
// Main Component
// ============================================================================

export default function SectionDraftingStage({ 
  sessionId, authToken, onSessionUpdated, onNavigateToStage 
}: SectionDraftingStageProps) {
  // Session State
  const [session, setSession] = useState<any>(null);
  const [paperTypeCode, setPaperTypeCode] = useState<string>('');
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Draft Content State - Always in edit mode
  const [content, setContent] = useState<Record<string, string>>({});
  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const autoSaveTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Generation State
  const [loading, setLoading] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null);
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({});
  const [mappedEvidenceBySection, setMappedEvidenceBySection] = useState<Record<string, boolean>>({});
  const [citationEligibleBySection, setCitationEligibleBySection] = useState<Record<string, boolean>>({});

  // Auto Mode
  const [autoMode, setAutoMode] = useState(false);
  const [autoModeRunning, setAutoModeRunning] = useState(false);
  const [autoModeProgress, setAutoModeProgress] = useState<{ current: number; total: number; currentSection: string } | null>(null);
  const autoModeCancelledRef = useRef(false);

  // Persona & Style
  const [usePersonaStyle, setUsePersonaStyle] = useState(false);
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null);
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false);
  const [showPersonaManager, setShowPersonaManager] = useState(false);
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined);

  // UI State
  const [showActivity, setShowActivity] = useState(true);
  const [debugSteps, setDebugSteps] = useState<any[]>([]);
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  // User Instructions (loaded from API)
  const [userInstructions, setUserInstructions] = useState<Record<string, UserInstruction>>({});
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null);
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false);

  // Citations
  const [citations, setCitations] = useState<any[]>([]);
  const [citationStyleMeta, setCitationStyleMeta] = useState<{
    styleCode: string;
    sortOrder: 'alphabetical' | 'order_of_appearance';
    isNumericStyle: boolean;
    orderedCitationKeys: string[];
    numberingByKey: Record<string, number>;
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertCitationTarget, setInsertCitationTarget] = useState<string | null>(null);
  const insertCitationTargetRef = useRef<string | null>(null);
  const editorRefs = useRef<Record<string, PaperMarkdownEditorRef | null>>({});
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const [bibliographyContent, setBibliographyContent] = useState<string>('');
  const [generatingBibliography, setGeneratingBibliography] = useState(false);
  const [bibliographyStyle, setBibliographyStyle] = useState<string>('APA7');
  const [bibliographySortOrder, setBibliographySortOrder] = useState<'alphabetical' | 'order_of_appearance'>('alphabetical');
  const [sequenceInfo, setSequenceInfo] = useState<{
    styleCode: string;
    version: number | null;
    changed: boolean;
    added: number;
    removed: number;
    renumbered: number;
    historyCount: number;
  } | null>(null);
  const isNumericOrderBibliography = useMemo(
    () => ['IEEE', 'VANCOUVER'].includes((bibliographyStyle || '').toUpperCase()),
    [bibliographyStyle]
  );
  

  // Floating Panel State
  const [figures, setFigures] = useState<Array<{
    id: string;
    figureNo: number;
    title: string;
    caption?: string;
    description?: string;
    imagePath?: string;
    status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
    category?: string;
    figureType?: string;
  }>>([]);
  const [selectedText, setSelectedText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [previewFigure, setPreviewFigure] = useState<{
    id: string;
    figureNo: number;
    title: string;
    imagePath?: string;
    description?: string;
  } | null>(null);

  // Background generation (two-pass pipeline)
  const [bgGenStatus, setBgGenStatus] = useState<string | null>(null);
  const [bgGenProgress, setBgGenProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    sections?: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
  } | null>(null);
  const [bgGenRetrying, setBgGenRetrying] = useState(false);
  const [bgSectionSelectorOpen, setBgSectionSelectorOpen] = useState(false);
  const [bgSelectedSectionKeys, setBgSelectedSectionKeys] = useState<string[]>([]);
  const [showReferenceDraftModal, setShowReferenceDraftModal] = useState(false);
  const [referenceDraftLoading, setReferenceDraftLoading] = useState(false);
  const [referenceDraftError, setReferenceDraftError] = useState<string | null>(null);
  const [referenceDraftSections, setReferenceDraftSections] = useState<ReferenceDraftSectionView[]>([]);
  const [referenceDraftSummary, setReferenceDraftSummary] = useState<{
    totalSections: number;
    withPass1Content: number;
    withoutPass1Content: number;
  } | null>(null);
  const [referenceDraftFetchedAt, setReferenceDraftFetchedAt] = useState<string | null>(null);
  const [sectionCitationValidation, setSectionCitationValidation] = useState<Record<string, SectionCitationValidation>>({});
  const [dimensionPanelOpen, setDimensionPanelOpen] = useState<Record<string, boolean>>({});
  const [dimensionBySection, setDimensionBySection] = useState<Record<string, DimensionDraftUIState>>({});

  // Regeneration
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({});
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({});

  // REMOVED: View mode toggle - always in edit mode for stability
  // const [viewMode, setViewMode] = useState<Record<string, 'edit' | 'preview'>>({});

  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning'>('success');
  const mappedEvidenceStorageKey = useMemo(
    () => (sessionId ? `paper:${sessionId}:mapped-evidence` : ''),
    [sessionId]
  );

  const showMsg = (msg: string, type: 'success' | 'error' | 'warning') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  };

  const getDimensionState = useCallback((sectionKey: string): DimensionDraftUIState => {
    const normalized = normalizeSectionKey(sectionKey);
    return dimensionBySection[normalized] || createInitialDimensionUIState();
  }, [dimensionBySection]);

  const setDimensionState = useCallback((
    sectionKey: string,
    updater: (prev: DimensionDraftUIState) => DimensionDraftUIState
  ) => {
    const normalized = normalizeSectionKey(sectionKey);
    setDimensionBySection(prev => {
      const current = prev[normalized] || createInitialDimensionUIState();
      return {
        ...prev,
        [normalized]: updater(current)
      };
    });
  }, []);

  const isCitationEligibleForSection = useCallback(
    (sectionKey: string) => citationEligibleBySection[normalizeSectionKey(sectionKey)] === true,
    [citationEligibleBySection]
  );

  const isMappedEvidenceEnabled = useCallback(
    (sectionKey: string) => {
      const normalized = normalizeSectionKey(sectionKey);
      if (citationEligibleBySection[normalized] !== true) return false;
      return mappedEvidenceBySection[normalized] !== false;
    },
    [mappedEvidenceBySection, citationEligibleBySection]
  );

  const clearCitationValidationForSection = useCallback((sectionKey: string) => {
    const normalized = normalizeSectionKey(sectionKey);
    setSectionCitationValidation(prev => {
      if (!prev[normalized]) return prev;
      const next = { ...prev };
      delete next[normalized];
      return next;
    });
  }, []);

  const setCitationValidationForSection = useCallback((sectionKey: string, payload: any) => {
    const normalized = normalizeSectionKey(sectionKey);
    const disallowedKeys = Array.isArray(payload?.citationValidation?.disallowedKeys)
      ? payload.citationValidation.disallowedKeys
          .map((key: unknown) => String(key || '').trim())
          .filter(Boolean)
      : [];
    const unknownKeys = Array.isArray(payload?.citationValidation?.unknownKeys)
      ? payload.citationValidation.unknownKeys
          .map((key: unknown) => String(key || '').trim())
          .filter(Boolean)
      : [];

    if (disallowedKeys.length === 0 && unknownKeys.length === 0) {
      clearCitationValidationForSection(sectionKey);
      return { disallowedKeys, unknownKeys };
    }

    setSectionCitationValidation(prev => ({
      ...prev,
      [normalized]: { disallowedKeys, unknownKeys }
    }));
    return { disallowedKeys, unknownKeys };
  }, [clearCitationValidationForSection]);

  // Helper: Extract figure references from content
  const getReferencedFigures = useCallback((sectionContent: string) => {
    if (!sectionContent || figures.length === 0) return [];
    
    // Match patterns like [Figure 1], [Figure 2], etc.
    const figurePattern = /\[Figure\s+(\d+)\]/gi;
    const figureNos = new Set<number>();

    let match: RegExpExecArray | null = null;
    while ((match = figurePattern.exec(sectionContent)) !== null) {
      figureNos.add(parseInt(match[1], 10));
    }
    
    // Return matching figures
    return figures.filter(f => figureNos.has(f.figureNo) && f.status === 'GENERATED');
  }, [figures]);

  // ============================================================================
  // Data Loading
  // ============================================================================

  const loadSession = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      setProfileLoading(true);
      const res = await fetch(`/api/papers/${sessionId}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) { setProfileError('Failed to load session'); return; }
      const data = await res.json();
      const sess = data.session;
      setSession(sess);
      const sessionStyleCode = typeof sess?.citationStyle?.code === 'string'
        ? sess.citationStyle.code
        : null;
      if (sessionStyleCode) {
        setBibliographyStyle(sessionStyleCode);
        if (['IEEE', 'VANCOUVER'].includes(sessionStyleCode.toUpperCase())) {
          setBibliographySortOrder('order_of_appearance');
        }
      }
      const code = sess?.paperType?.code || 'JOURNAL_ARTICLE';
      setPaperTypeCode(code);

      // Load draft content
      const drafts = Array.isArray(sess?.annexureDrafts) ? sess.annexureDrafts : [];
      const paperDraft = drafts.filter((d: any) => (d.jurisdiction || '').toUpperCase() === 'PAPER')
        .sort((a: any, b: any) => b.version - a.version)[0];
      if (paperDraft) setContent(parseExtraSections(paperDraft.extraSections));

      // Load paper type sections
      const typeRes = await fetch(`/api/paper-types/${code}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (typeRes.ok) {
        const typeData = await typeRes.json();
        const pt = typeData.paperType;
        if (pt) {
          const sectionOrder = Array.isArray(pt.sectionOrder) ? pt.sectionOrder : [];
          const requiredSections = Array.isArray(pt.requiredSections) ? pt.requiredSections : [];
          const wordLimits = pt.defaultWordLimits || {};
          const configs: SectionConfig[] = sectionOrder.map((key: string) => ({
            keys: [key], label: displayName[key] || formatSectionLabel(key),
            required: requiredSections.includes(key), wordLimit: wordLimits[key] || undefined
          }));
          setSectionConfigs(configs.length > 0 ? configs : fallbackSections);

          const policies = pt.sectionContextPolicies && typeof pt.sectionContextPolicies === 'object'
            ? pt.sectionContextPolicies as Record<string, { requiresCitations?: boolean }>
            : {};
          const eligibility: Record<string, boolean> = {};
          for (const key of sectionOrder) {
            const normalized = normalizeSectionKey(key);
            const policy = policies[key] || policies[normalized];
            eligibility[normalized] = typeof policy?.requiresCitations === 'boolean'
              ? policy.requiresCitations
              : DEFAULT_CITATION_ELIGIBLE_SECTIONS.has(normalized);
          }
          setCitationEligibleBySection(eligibility);
        } else {
          setSectionConfigs(fallbackSections);
          setCitationEligibleBySection({});
        }
      } else {
        setSectionConfigs(fallbackSections);
        setCitationEligibleBySection({});
      }

      // Check persona availability
      const personaRes = await fetch('/api/personas', { headers: { Authorization: `Bearer ${authToken}` } });
      if (personaRes.ok) {
        const pd = await personaRes.json();
        setStyleAvailable((pd.myPersonas?.length || 0) + (pd.orgPersonas?.length || 0) > 0);
      }

      // Load user instructions
      const instrRes = await fetch(`/api/papers/${sessionId}/drafting/user-instructions?sessionId=${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (instrRes.ok) {
        const instrData = await instrRes.json();
        setUserInstructions(instrData.grouped || {});
      }

      setProfileError(null);
    } catch (err) {
      console.error('Load session error:', err);
      setProfileError('Failed to load session');
    } finally {
      setProfileLoading(false);
    }
  }, [sessionId, authToken]);

  const loadCitations = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/citations`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        setCitations(data.citations || []);
        setCitationStyleMeta(parseCitationStyleMeta(data.citationStyleMeta));
      }
    } catch (err) {
      console.error('Load citations error:', err);
    }
  }, [sessionId, authToken]);

  const loadFigures = useCallback(async () => {
    if (!sessionId || !authToken) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/figures`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        const figs = (data.figures || []).map((f: any) => ({
          id: f.id,
          figureNo: f.figureNo,
          title: f.title,
          caption: f.caption || f.nodes?.caption || f.description,
          description: f.description,
          imagePath: f.imagePath || f.nodes?.imagePath,
          status: f.status || f.nodes?.status || (f.imagePath ? 'GENERATED' : 'PLANNED'),
          category: f.category || f.nodes?.category || 'CHART',
          figureType: f.figureType || f.nodes?.figureType || 'auto'
        }));
        setFigures(figs);
      }
    } catch (err) {
      console.error('Load figures error:', err);
    }
  }, [sessionId, authToken]);

  useEffect(() => {
    setDimensionPanelOpen({});
    setDimensionBySection({});
    setBgSectionSelectorOpen(false);
    setBgSelectedSectionKeys([]);
    setShowReferenceDraftModal(false);
    setReferenceDraftLoading(false);
    setReferenceDraftError(null);
    setReferenceDraftSections([]);
    setReferenceDraftSummary(null);
    setReferenceDraftFetchedAt(null);
  }, [sessionId]);

  useEffect(() => { loadSession(); loadCitations(); loadFigures(); }, [loadSession, loadCitations, loadFigures]);

  // Load and poll background generation status (two-pass pipeline)
  const loadBgGenStatus = useCallback(async () => {
    if (!authToken || !sessionId) return;
    try {
      const res = await fetch(`/api/papers/${sessionId}/sections/prepare`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (res.ok) {
        const normalizedStatus = typeof data.status === 'string' && data.status.trim().length > 0
          ? data.status.trim().toUpperCase()
          : 'IDLE';
        setBgGenStatus(normalizedStatus);
        setBgGenProgress(data.progress || null);
      }
    } catch { /* non-critical */ }
  }, [authToken, sessionId]);

  const handleRetryBgPreparation = useCallback(async (options?: { force?: boolean; retryFailedOnly?: boolean; sectionKeys?: string[] }) => {
    if (!authToken || !sessionId || bgGenRetrying) return;
    const force = options?.force === true;
    const retryFailedOnly = options?.retryFailedOnly === true;
    const sectionKeys = Array.isArray(options?.sectionKeys)
      ? Array.from(new Set(options.sectionKeys.map((key) => normalizeSectionKey(String(key || ''))).filter(Boolean)))
      : [];
    setBgGenRetrying(true);
    try {
      const res = await fetch(`/api/papers/${sessionId}/sections/prepare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          ...(force ? { force: true } : {}),
          ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
          ...(sectionKeys.length > 0 ? { sectionKeys } : {})
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to retry section preparation');
      }

      setBgGenStatus(data.status || 'RUNNING');
      if (data.progress) {
        setBgGenProgress(data.progress);
      }
      if (sectionKeys.length > 0) {
        setBgSectionSelectorOpen(false);
      }
      const totalSectionsPlanned = Number(data?.totalSectionsPlanned || 0);
      showMsg(
        sectionKeys.length > 0
          ? `Pass 1 started for ${sectionKeys.length} selected section(s) (0/${sectionKeys.length} generated)`
          : retryFailedOnly
            ? 'Retrying failed sections only'
            : force
              ? totalSectionsPlanned > 0
                ? `Pass 1 rerun started (0/${totalSectionsPlanned} generated)`
                : 'Pass 1 rerun started'
              : totalSectionsPlanned > 0
                ? `Pass 1 started (0/${totalSectionsPlanned} generated)`
                : 'Pass 1 started',
        'success'
      );
      await loadBgGenStatus();
    } catch (err) {
      showMsg(err instanceof Error ? err.message : 'Failed to retry section preparation', 'error');
    } finally {
      setBgGenRetrying(false);
    }
  }, [authToken, bgGenRetrying, loadBgGenStatus, sessionId, showMsg]);

  const loadReferenceDraftOutput = useCallback(async () => {
    if (!authToken || !sessionId) return;
    setReferenceDraftLoading(true);
    setReferenceDraftError(null);
    try {
      const res = await fetch(`/api/papers/${sessionId}/reference-draft`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch reference draft output');
      }

      const sections = Array.isArray(data?.sections)
        ? data.sections.map((section: any) => ({
            sectionKey: normalizeSectionKey(String(section?.sectionKey || '')),
            displayName: String(section?.displayName || section?.sectionKey || 'Untitled Section'),
            status: String(section?.status || 'NOT_STARTED'),
            hasContent: Boolean(section?.hasContent),
            content: String(section?.content || ''),
            wordCount: Number(section?.wordCount || 0),
            generatedAt: section?.generatedAt ? String(section.generatedAt) : null,
            source: section?.source === 'pass1_artifact' || section?.source === 'base_content_internal'
              ? section.source
              : 'none',
            updatedAt: section?.updatedAt ? String(section.updatedAt) : null
          } as ReferenceDraftSectionView))
          .filter((section: ReferenceDraftSectionView) => !isPass1ExcludedSection(section.sectionKey))
        : [];

      setReferenceDraftSections(sections);
      setReferenceDraftSummary({
        totalSections: sections.length,
        withPass1Content: sections.filter((section: ReferenceDraftSectionView) => section.hasContent).length,
        withoutPass1Content: sections.filter((section: ReferenceDraftSectionView) => !section.hasContent).length
      });
      setReferenceDraftFetchedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch reference draft output';
      setReferenceDraftError(message);
      showMsg(message, 'error');
    } finally {
      setReferenceDraftLoading(false);
    }
  }, [authToken, sessionId, showMsg]);

  const handleOpenReferenceDraftModal = useCallback(async () => {
    setShowReferenceDraftModal(true);
    await loadReferenceDraftOutput();
  }, [loadReferenceDraftOutput]);

  useEffect(() => { loadBgGenStatus(); }, [loadBgGenStatus]);

  useEffect(() => {
    if (bgGenStatus !== 'RUNNING') return;
    const timer = window.setInterval(() => {
      void loadBgGenStatus().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [bgGenStatus, loadBgGenStatus]);

  const bgGenLiveCounts = useMemo(() => {
    if (!bgGenProgress) return null;
    const sectionStates = bgGenProgress.sections ? Object.values(bgGenProgress.sections) : [];
    if (sectionStates.length === 0) {
      const running = bgGenStatus === 'RUNNING'
        ? Math.max(0, bgGenProgress.total - bgGenProgress.completed - bgGenProgress.failed)
        : 0;
      return {
        waiting: 0,
        running,
        done: bgGenProgress.completed,
        failed: bgGenProgress.failed,
      };
    }
    return {
      waiting: sectionStates.filter(state => state === 'pending').length,
      running: sectionStates.filter(state => state === 'running').length,
      done: sectionStates.filter(state => state === 'done').length,
      failed: sectionStates.filter(state => state === 'failed').length,
    };
  }, [bgGenProgress, bgGenStatus]);

  const bgSelectableSections = useMemo(() => {
    const source = sectionConfigs || fallbackSections;
    const seen = new Set<string>();
    const sectionsForSelection: Array<{ key: string; label: string }> = [];
    for (const section of source) {
      for (const rawKey of section.keys || []) {
        const key = normalizeSectionKey(String(rawKey || ''));
        if (!key || seen.has(key) || isPass1ExcludedSection(key)) continue;
        seen.add(key);
        sectionsForSelection.push({
          key,
          label: displayName[key] || formatSectionLabel(key)
        });
      }
    }
    return sectionsForSelection;
  }, [sectionConfigs]);

  useEffect(() => {
    if (bgSelectableSections.length === 0) {
      setBgSelectedSectionKeys([]);
      return;
    }

    const validKeys = new Set(bgSelectableSections.map(section => section.key));
    setBgSelectedSectionKeys(prev => {
      const filtered = prev.filter(key => validKeys.has(key));
      return filtered.length > 0
        ? filtered
        : bgSelectableSections.map(section => section.key);
    });
  }, [bgSelectableSections]);

  const bgSelectedSectionSet = useMemo(() => new Set(bgSelectedSectionKeys), [bgSelectedSectionKeys]);

  const toggleBgSectionSelection = useCallback((sectionKey: string) => {
    setBgSelectedSectionKeys(prev => (
      prev.includes(sectionKey)
        ? prev.filter(key => key !== sectionKey)
        : [...prev, sectionKey]
    ));
  }, []);

  const selectAllBgSections = useCallback(() => {
    setBgSelectedSectionKeys(bgSelectableSections.map(section => section.key));
  }, [bgSelectableSections]);

  const clearBgSectionSelection = useCallback(() => {
    setBgSelectedSectionKeys([]);
  }, []);

  useEffect(() => {
    if (!isNumericOrderBibliography) return;
    if (bibliographySortOrder !== 'order_of_appearance') {
      setBibliographySortOrder('order_of_appearance');
    }
  }, [isNumericOrderBibliography, bibliographySortOrder]);

  useEffect(() => {
    if (!sequenceInfo) return;
    const currentStyle = (bibliographyStyle || '').toUpperCase();
    if ((sequenceInfo.styleCode || '').toUpperCase() !== currentStyle) {
      setSequenceInfo(null);
    }
  }, [bibliographyStyle, sequenceInfo]);

  useEffect(() => {
    if (!mappedEvidenceStorageKey) return;
    try {
      const raw = localStorage.getItem(mappedEvidenceStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const normalized: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'boolean') {
            normalized[normalizeSectionKey(key)] = value;
          }
        }
        setMappedEvidenceBySection(normalized);
      }
    } catch (err) {
      console.warn('[SectionDrafting] Failed to load mapped evidence preferences:', err);
    }
  }, [mappedEvidenceStorageKey]);

  useEffect(() => {
    const allKeys = (sectionConfigs || fallbackSections).flatMap(s => s.keys).filter(Boolean);
    if (allKeys.length === 0) return;
    setMappedEvidenceBySection(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of allKeys) {
        const normalized = normalizeSectionKey(key);
        const eligibleValue = citationEligibleBySection[normalized];
        if (eligibleValue === true) {
          if (typeof next[normalized] !== 'boolean') {
            next[normalized] = true;
            changed = true;
          }
        } else if (eligibleValue === false && next[normalized] !== false) {
          next[normalized] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sectionConfigs, citationEligibleBySection]);

  useEffect(() => {
    if (!mappedEvidenceStorageKey) return;
    try {
      localStorage.setItem(mappedEvidenceStorageKey, JSON.stringify(mappedEvidenceBySection));
    } catch (err) {
      console.warn('[SectionDrafting] Failed to persist mapped evidence preferences:', err);
    }
  }, [mappedEvidenceBySection, mappedEvidenceStorageKey]);

  // REMOVED: Auto-switch to preview mode - always stay in edit mode for stability

  const refreshSession = useCallback(async () => {
    if (!onSessionUpdated) return;
    const res = await fetch(`/api/papers/${sessionId}`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    onSessionUpdated(data.session);
    setSession(data.session);
  }, [sessionId, authToken, onSessionUpdated]);

  // ============================================================================
  // Auto-Save Handler
  // ============================================================================

  const saveSection = useCallback(async (sectionKey: string, sectionContent: string) => {
    setSaving(prev => ({ ...prev, [sectionKey]: true }));
    try {
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'save_section', sectionKey, content: sectionContent })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        clearCitationValidationForSection(sectionKey);
        setPendingChanges(prev => { const next = new Set(prev); next.delete(sectionKey); return next; });
      } else if (res.status === 422) {
        setCitationValidationForSection(sectionKey, data);
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(prev => ({ ...prev, [sectionKey]: false }));
    }
  }, [sessionId, authToken, clearCitationValidationForSection, setCitationValidationForSection]);

  const handleContentChange = useCallback((sectionKey: string, newContent: string) => {
    setContent(prev => ({ ...prev, [sectionKey]: newContent }));
    setPendingChanges(prev => new Set(prev).add(sectionKey));

    // Clear existing timer
    if (autoSaveTimers.current[sectionKey]) {
      clearTimeout(autoSaveTimers.current[sectionKey]);
    }

    // Set new auto-save timer
    autoSaveTimers.current[sectionKey] = setTimeout(() => {
      saveSection(sectionKey, newContent);
    }, AUTO_SAVE_DELAY);
  }, [saveSection]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(autoSaveTimers.current).forEach(clearTimeout);
    };
  }, []);

  // Save on blur (immediate)
  const handleBlur = useCallback((sectionKey: string) => {
    if (pendingChanges.has(sectionKey)) {
      if (autoSaveTimers.current[sectionKey]) {
        clearTimeout(autoSaveTimers.current[sectionKey]);
      }
      saveSection(sectionKey, content[sectionKey] || '');
    }
  }, [pendingChanges, content, saveSection]);

  // ============================================================================
  // Dimension Flow Drafting
  // ============================================================================

  const requestDraftingAction = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/papers/${sessionId}/drafting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(String(data?.error || 'Request failed'));
      (err as any).status = res.status;
      (err as any).payload = data;
      throw err;
    }
    return data;
  }, [sessionId, authToken]);

  const applyDimensionResponse = useCallback((sectionKey: string, data: any) => {
    const normalized = normalizeDimensionResponse(data);
    const normalizedKey = normalizeSectionKey(sectionKey);

    if (normalized.started && typeof normalized.stitchedContent === 'string') {
      setContent(prev => (
        prev[sectionKey] === normalized.stitchedContent
          ? prev
          : { ...prev, [sectionKey]: normalized.stitchedContent }
      ));
      setPendingChanges(prev => {
        if (!prev.has(sectionKey)) return prev;
        const next = new Set(prev);
        next.delete(sectionKey);
        return next;
      });
    }

    setDimensionBySection(prev => {
      const current = prev[normalizedKey] || createInitialDimensionUIState();
      const incomingProposal = normalized.proposal;
      const proposalChanged = Boolean(
        incomingProposal
        && (
          incomingProposal.dimensionKey !== current.activeDimensionKey
          || incomingProposal.content !== current.proposalText
        )
      );

      const next: DimensionDraftUIState = {
        ...current,
        initialized: true,
        started: normalized.started,
        error: null,
        stitchedContent: normalized.stitchedContent,
        pass1Source: normalized.pass1Source || current.pass1Source,
        plan: normalized.plan,
        progress: normalized.progress,
        completed: normalized.completed,
        nextDimensionKey: normalized.nextDimensionKey,
        nextDimensionLabel: normalized.nextDimensionLabel
      };

      if (incomingProposal) {
        next.activeDimensionKey = incomingProposal.dimensionKey;
        const planLabel = normalized.plan.find(item => item.dimensionKey === incomingProposal.dimensionKey)?.dimensionLabel || null;
        next.activeDimensionLabel = planLabel || incomingProposal.dimensionKey;
        next.proposalText = incomingProposal.content;
        next.proposalValidation = incomingProposal.citationValidation;
        next.proposalReviewTrace = incomingProposal.reviewTrace;
        next.showReject = false;
        next.feedback = '';
        next.editMode = proposalChanged ? false : current.editMode;
        next.streamCursor = proposalChanged ? 0 : Math.min(current.streamCursor, incomingProposal.content.length);
        next.isStreaming = proposalChanged && incomingProposal.content.length > 0;
      } else if (normalized.completed) {
        next.activeDimensionKey = null;
        next.activeDimensionLabel = null;
        next.proposalText = '';
        next.proposalValidation = null;
        next.proposalReviewTrace = null;
        next.feedback = '';
        next.showReject = false;
        next.editMode = false;
        next.streamCursor = 0;
        next.isStreaming = false;
      }

      return {
        ...prev,
        [normalizedKey]: next
      };
    });

    return normalized;
  }, []);

  const generateDimensionDraft = useCallback(async (
    sectionKey: string,
    options?: {
      dimensionKey?: string;
      feedback?: string;
      forceRegenerate?: boolean;
      silent?: boolean;
    }
  ) => {
    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      loading: true,
      error: null,
      rejecting: false,
      showReject: false,
      editMode: false
    }));

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const payload: Record<string, unknown> = {
        action: 'generate_dimension',
        sectionKey,
        useMappedEvidence
      };
      if (options?.dimensionKey) payload.dimensionKey = options.dimensionKey;
      if (options?.feedback) payload.feedback = options.feedback;
      if (options?.forceRegenerate) payload.forceRegenerate = true;

      const data = await requestDraftingAction(payload);
      const normalized = applyDimensionResponse(sectionKey, data);
      if (!options?.silent && normalized.proposal) {
        const label = normalized.plan.find(item => item.dimensionKey === normalized.proposal?.dimensionKey)?.dimensionLabel
          || normalized.proposal.dimensionKey
          || 'dimension';
        showMsg(`Drafted ${label}`, 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate dimension';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      if (!options?.silent) showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        loading: false
      }));
    }
  }, [applyDimensionResponse, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg]);

  const startDimensionFlow = useCallback(async (sectionKey: string) => {
    const instruction = userInstructions[sectionKey];
    const instructions = instruction?.isActive !== false ? instruction?.instruction || '' : '';
    const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      loading: true,
      error: null
    }));
    setDimensionPanelOpen(prev => ({ ...prev, [normalizeSectionKey(sectionKey)]: true }));

    try {
      const data = await requestDraftingAction({
        action: 'start_dimension_flow',
        sectionKey,
        instructions,
        useMappedEvidence
      });
      applyDimensionResponse(sectionKey, data);
      // Let the dimension-plan UI commit before kicking off the first LLM draft.
      await new Promise(resolve => setTimeout(resolve, 100));
      showMsg('Dimension plan ready. Drafting first dimension...', 'success');
      await generateDimensionDraft(sectionKey, { silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start dimension flow';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        loading: false
      }));
    }
  }, [applyDimensionResponse, generateDimensionDraft, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg, userInstructions]);

  const acceptDimensionDraft = useCallback(async (
    sectionKey: string,
    continueToNext: boolean,
    options?: { allowCitationBypass?: boolean }
  ) => {
    const state = getDimensionState(sectionKey);
    if (!state.activeDimensionKey || !state.proposalText.trim()) {
      showMsg('Generate dimension content first', 'warning');
      return;
    }

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      accepting: true,
      error: null,
      showReject: false
    }));

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const data = await requestDraftingAction({
        action: 'accept_dimension',
        sectionKey,
        dimensionKey: state.activeDimensionKey,
        content: state.proposalText,
        prefetchNext: continueToNext,
        useMappedEvidence,
        allowCitationBypass: options?.allowCitationBypass === true
      });
      const normalized = applyDimensionResponse(sectionKey, data);
      clearCitationValidationForSection(sectionKey);
      await refreshSession();

      if (continueToNext && !normalized.completed) {
        await generateDimensionDraft(sectionKey, {
          dimensionKey: normalized.nextDimensionKey || undefined,
          silent: true
        });
      } else {
        if (options?.allowCitationBypass) {
          showMsg('Dimension accepted with citation warnings', 'warning');
        } else {
          showMsg('Dimension accepted', 'success');
        }
      }
    } catch (error) {
      const payload = (error as any)?.payload;
      const validation = toDimensionValidation(payload?.citationValidation);
      const message = error instanceof Error ? error.message : 'Failed to accept dimension';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message,
        proposalValidation: validation || prev.proposalValidation
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        accepting: false
      }));
    }
  }, [
    applyDimensionResponse,
    clearCitationValidationForSection,
    generateDimensionDraft,
    getDimensionState,
    isMappedEvidenceEnabled,
    refreshSession,
    requestDraftingAction,
    setDimensionState,
    showMsg
  ]);

  const rejectDimensionDraft = useCallback(async (sectionKey: string) => {
    const state = getDimensionState(sectionKey);
    if (!state.activeDimensionKey) {
      showMsg('No pending dimension to rewrite', 'warning');
      return;
    }

    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    setDimensionState(sectionKey, prev => ({
      ...prev,
      rejecting: true,
      error: null
    }));

    try {
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const data = await requestDraftingAction({
        action: 'reject_dimension',
        sectionKey,
        dimensionKey: state.activeDimensionKey,
        feedback: state.feedback || undefined,
        useMappedEvidence
      });
      applyDimensionResponse(sectionKey, data);
      showMsg('Rewrote dimension draft', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rewrite dimension';
      setDimensionState(sectionKey, prev => ({
        ...prev,
        error: message
      }));
      showMsg(message, 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
      setDimensionState(sectionKey, prev => ({
        ...prev,
        rejecting: false
      }));
    }
  }, [applyDimensionResponse, getDimensionState, isMappedEvidenceEnabled, requestDraftingAction, setDimensionState, showMsg]);

  const beginStructuredDraft = useCallback(async (sectionKey: string) => {
    if (!supportsDimensionFlow(sectionKey)) {
      showMsg('Abstract and conclusion are generated as single-pass sections', 'warning');
      return;
    }
    const normalized = normalizeSectionKey(sectionKey);
    setDimensionPanelOpen(prev => ({ ...prev, [normalized]: true }));
    const state = getDimensionState(sectionKey);
    if (state.started) {
      if (state.completed) {
        showMsg('All dimensions are already accepted for this section', 'warning');
        return;
      }
      await generateDimensionDraft(sectionKey, {
        dimensionKey: state.nextDimensionKey || undefined
      });
      return;
    }
    await startDimensionFlow(sectionKey);
  }, [generateDimensionDraft, getDimensionState, showMsg, startDimensionFlow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDimensionBySection(prev => {
        let changed = false;
        const next: Record<string, DimensionDraftUIState> = { ...prev };
        for (const [sectionKey, state] of Object.entries(prev)) {
          if (!state.isStreaming) continue;
          const total = state.proposalText.length;
          if (total === 0) {
            next[sectionKey] = { ...state, isStreaming: false, streamCursor: 0 };
            changed = true;
            continue;
          }
          if (state.streamCursor >= total) {
            next[sectionKey] = { ...state, isStreaming: false, streamCursor: total };
            changed = true;
            continue;
          }
          const step = Math.max(8, Math.ceil(total / 90));
          const streamCursor = Math.min(total, state.streamCursor + step);
          next[sectionKey] = {
            ...state,
            streamCursor,
            isStreaming: streamCursor < total
          };
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 24);

    return () => window.clearInterval(timer);
  }, []);

  // ============================================================================
  // Floating Panel Handlers
  // ============================================================================

  const handleInsertFigure = useCallback((figureId: string) => {
    const figure = figures.find(f => f.id === figureId);
    if (!figure) return;

    const figureRef = `[Figure ${figure.figureNo}]`;

    const targetSection = focusedSection || insertCitationTargetRef.current;
    if (!targetSection) {
      showMsg('Please click in a section first to insert the figure', 'warning');
      return;
    }

    const editor = editorRefs.current[targetSection];
    if (!editor) {
      showMsg('Editor is not ready for this section', 'warning');
      return;
    }

    editor.insertTextAtCursor(figureRef);
    showMsg(`Inserted Figure ${figure.figureNo}`, 'success');
  }, [figures, focusedSection]);

  const handleTextAction = useCallback(async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple',
    text: string,
    customInstructions?: string
  ): Promise<string> => {
    if (!authToken || !text.trim()) {
      throw new Error('Missing required parameters');
    }

    // CRITICAL: Save the editor selection range BEFORE the async API call.
    // By the time the response arrives, the editor may have lost focus/selection.
    const targetSection = focusedSection;
    let savedRange: { from: number; to: number } | null = null;
    if (targetSection) {
      const editor = editorRefs.current[targetSection];
      if (editor) {
        savedRange = editor.saveSelection();
      }
    }

    try {
      const response = await fetch(`/api/papers/${sessionId}/text-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action,
          selectedText: text,
          context: targetSection ? content[targetSection]?.slice(0, 500) : '',
          sectionKey: targetSection,
          customInstructions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Text action failed');
      }

      if (targetSection) {
        const editor = editorRefs.current[targetSection];
        if (editor) {
          if (savedRange && savedRange.from !== savedRange.to) {
            // Use precise range replacement to avoid issues with lost selection
            editor.replaceRange(savedRange.from, savedRange.to, data.transformedText);
          } else {
            // Fallback: try replaceSelection which checks saved selection internally
            editor.replaceSelection(data.transformedText);
          }
        }
        setSelectedText(null);
        showMsg(`Text ${action}d successfully`, 'success');
      }

      return data.transformedText;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, sessionId, focusedSection, content]);

  const handleGenerateFigure = useCallback(async (description: string, meta?: Record<string, any>) => {
    if (!authToken || !description.trim()) {
      throw new Error('Missing required parameters');
    }

    try {
      // Derive category and type from suggestion meta if available
      const category = meta?.category || 'DIAGRAM';
      const figureType = meta?.suggestedType || 'auto';
      const title = meta?.title || description.slice(0, 100);

      // Build suggestionMeta for the figure plan so the generate route can use it
      const suggestionMeta: Record<string, any> = {};
      if (meta?.relevantSection) suggestionMeta.relevantSection = meta.relevantSection;
      if (meta?.importance) suggestionMeta.importance = meta.importance;
      if (meta?.dataNeeded) suggestionMeta.dataNeeded = meta.dataNeeded;
      if (meta?.whyThisFigure) suggestionMeta.whyThisFigure = meta.whyThisFigure;
      if (meta?.rendererPreference) suggestionMeta.rendererPreference = meta.rendererPreference;
      if (meta?.diagramSpec) suggestionMeta.diagramSpec = meta.diagramSpec;
      if (meta?.sketchStyle) suggestionMeta.sketchStyle = meta.sketchStyle;
      if (meta?.sketchPrompt) suggestionMeta.sketchPrompt = meta.sketchPrompt;
      if (meta?.sketchMode) suggestionMeta.sketchMode = meta.sketchMode;

      // First create the figure plan with full suggestion context
      const createRes = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title,
          caption: description,
          description,
          category,
          figureType,
          notes: description,
          suggestionMeta: Object.keys(suggestionMeta).length > 0 ? suggestionMeta : undefined
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || 'Failed to create figure');
      }

      // Then generate the figure – pass suggestion meta so the generate route
      // can enrich the LLM prompt and choose the right renderer
      const generateRes = await fetch(
        `/api/papers/${sessionId}/figures/${createData.figure.id}/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            title,
            description,
            category,
            figureType,
            useLLM: true,
            theme: 'academic',
            suggestionMeta: Object.keys(suggestionMeta).length > 0 ? suggestionMeta : undefined
          })
        }
      );

      const generateData = await generateRes.json();
      if (!generateRes.ok) {
        throw new Error(generateData.error || 'Failed to generate figure');
      }

      // Refresh figures list
      await loadFigures();
      showMsg('Figure generated successfully', 'success');

      return generateData;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Figure generation failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, sessionId, loadFigures]);

  const handleOpenCitationPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  // ============================================================================
  // Generation
  // ============================================================================

  const generateSingleSection = useCallback(async (sectionKey: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const instr = userInstructions[sectionKey];
      const instructions = instr?.isActive !== false ? instr?.instruction || '' : '';
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const generationMode = isPass1ExcludedSection(sectionKey) ? 'topup_final' : 'two_pass';
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'generate_section',
          sectionKey,
          instructions,
          useMappedEvidence,
          generationMode,
          autoCitationRepair: false,
          usePersonaStyle,
          personaSelection
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const { disallowedKeys: disallowed, unknownKeys: unknown } = setCitationValidationForSection(sectionKey, data);
        const detailParts: string[] = [];
        if (disallowed.length > 0) {
          detailParts.push(`disallowed: ${disallowed.slice(0, 5).join(', ')}`);
        }
        if (unknown.length > 0) {
          detailParts.push(`unknown: ${unknown.slice(0, 5).join(', ')}`);
        }
        const details = detailParts.length ? ` (${detailParts.join(' | ')})` : '';
        const hint = typeof data?.hint === 'string' ? ` ${data.hint}` : '';
        return { success: false, error: `${data.error || 'Generation failed'}${details}${hint}` };
      }
      if (data.content) {
        clearCitationValidationForSection(sectionKey);
        return { success: true, content: data.content };
      }
      return { success: false, error: 'No content returned' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [sessionId, authToken, userInstructions, usePersonaStyle, personaSelection, isMappedEvidenceEnabled, setCitationValidationForSection, clearCitationValidationForSection]);

  const handleGenerate = useCallback(async (keys: string[]) => {
    if (loading) return;
    setLoading(true);
    setShowActivity(true);
    setCurrentKeys(keys);
    try {
      const sections = keys.filter(Boolean);
      if (sections.length === 0) throw new Error('No sections to generate');
      const generatedContent: Record<string, string> = {};
      for (const sectionKey of sections) {
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
        const result = await generateSingleSection(sectionKey);
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
        if (result.success && result.content) {
          generatedContent[sectionKey] = result.content;
          setDebugSteps(prev => [...prev, { step: `generate_${sectionKey}`, status: 'done' }]);
        } else {
          throw new Error(`Failed: ${result.error}`);
        }
      }
      setContent(prev => ({ ...prev, ...generatedContent }));
      setDimensionPanelOpen(prev => {
        const next = { ...prev };
        for (const sectionKey of sections) {
          delete next[normalizeSectionKey(sectionKey)];
        }
        return next;
      });
      setDimensionBySection(prev => {
        const next = { ...prev };
        for (const sectionKey of sections) {
          delete next[normalizeSectionKey(sectionKey)];
        }
        return next;
      });
      showMsg(`Generated ${sections.length} section(s)`, 'success');
      await refreshSession();
    } catch (error) {
      showMsg(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setLoading(false);
      setCurrentKeys(null);
    }
  }, [loading, generateSingleSection, refreshSession]);

  const handleAutoGenerateAll = useCallback(async () => {
    const emptySections = (sectionConfigs || fallbackSections).flatMap(c => c.keys).filter(key => !content[key] || computeWordCount(content[key]) === 0);
    if (emptySections.length === 0) { showMsg('All sections have content!', 'warning'); return; }
    autoModeCancelledRef.current = false;
    setAutoModeRunning(true);
    setShowActivity(true);
    let successCount = 0;
    try {
      for (let i = 0; i < emptySections.length; i++) {
        if (autoModeCancelledRef.current) break;
        const sectionKey = emptySections[i];
        setAutoModeProgress({ current: i + 1, total: emptySections.length, currentSection: displayName[sectionKey] || formatSectionLabel(sectionKey) });
        setCurrentKeys([sectionKey]);
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
        let result = await generateSingleSection(sectionKey);
        if (!result.success && !autoModeCancelledRef.current) {
          await new Promise(r => setTimeout(r, 1000));
          result = await generateSingleSection(sectionKey);
        }
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
        if (result.success && result.content) {
          setContent(prev => ({ ...prev, [sectionKey]: result.content! }));
          // REMOVED: Auto-switch to preview - stay in edit mode
          successCount++;
        } else {
          showMsg(`Failed at ${displayName[sectionKey] || sectionKey}`, 'error');
          break;
        }
        if (i < emptySections.length - 1 && !autoModeCancelledRef.current) await new Promise(r => setTimeout(r, 500));
      }
      await refreshSession();
      showMsg(autoModeCancelledRef.current ? `Stopped. ${successCount} section(s) generated.` : `Complete! ${successCount} section(s) generated.`, autoModeCancelledRef.current ? 'warning' : 'success');
    } catch (error) {
      showMsg(`Auto-generation failed`, 'error');
    } finally {
      setAutoModeRunning(false);
      setAutoModeProgress(null);
      setCurrentKeys(null);
      autoModeCancelledRef.current = false;
    }
  }, [sectionConfigs, content, generateSingleSection, refreshSession]);

  const handleRegenerateSection = useCallback(async (sectionKey: string) => {
    setSectionLoading(prev => ({ ...prev, [sectionKey]: true }));
    try {
      const remarks = regenRemarks[sectionKey] || '';
      const useMappedEvidence = isMappedEvidenceEnabled(sectionKey);
      const generationMode = isPass1ExcludedSection(sectionKey) ? 'topup_final' : 'two_pass';
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'regenerate_section',
          sectionKey,
          instructions: remarks,
          useMappedEvidence,
          generationMode,
          autoCitationRepair: false,
          usePersonaStyle,
          personaSelection
        })
      });
      const data = await res.json();
      if (res.ok && data.content) {
        clearCitationValidationForSection(sectionKey);
        setContent(prev => ({ ...prev, [sectionKey]: data.content }));
        setDimensionPanelOpen(prev => {
          const next = { ...prev };
          delete next[normalizeSectionKey(sectionKey)];
          return next;
        });
        setDimensionBySection(prev => {
          const next = { ...prev };
          delete next[normalizeSectionKey(sectionKey)];
          return next;
        });
        // REMOVED: Auto-switch to preview - stay in edit mode
        setRegenOpen(prev => ({ ...prev, [sectionKey]: false }));
        setRegenRemarks(prev => ({ ...prev, [sectionKey]: '' }));
        showMsg('Section regenerated', 'success');
        await refreshSession();
      } else {
        const { disallowedKeys: disallowed, unknownKeys: unknown } = setCitationValidationForSection(sectionKey, data);
        const detailParts: string[] = [];
        if (disallowed.length > 0) {
          detailParts.push(`disallowed: ${disallowed.slice(0, 5).join(', ')}`);
        }
        if (unknown.length > 0) {
          detailParts.push(`unknown: ${unknown.slice(0, 5).join(', ')}`);
        }
        const details = detailParts.length ? ` (${detailParts.join(' | ')})` : '';
        const hint = typeof data?.hint === 'string' ? ` ${data.hint}` : '';
        showMsg(`${data.error || 'Regeneration failed'}${details}${hint}`, 'error');
      }
    } catch {
      showMsg('Regeneration failed', 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
    }
  }, [sessionId, authToken, regenRemarks, usePersonaStyle, personaSelection, refreshSession, isMappedEvidenceEnabled, setCitationValidationForSection, clearCitationValidationForSection]);

  // ============================================================================
  // Citations & Bibliography
  // ============================================================================

  // Insert a single citation at cursor position (used by sidebar CitationManager)
  const handleInsertSingleCitation = useCallback((citationKey: string) => {
    // Get target section - use focused section or cursor position
    const activeSections = sectionConfigs || fallbackSections;
    const target = focusedSection || (activeSections.length > 0 ? activeSections[0].keys[0] : null);
    if (!target) return;

    const insertText = `[CITE:${citationKey}]`;
    const editor = editorRefs.current[target];
    if (editor) {
      editor.insertTextAtCursor(insertText);
      editor.focus();
    } else {
      const updated = `${content[target] || ''} ${insertText}`.trim();
      setContent(prev => ({ ...prev, [target]: updated }));
      setPendingChanges(prev => new Set(prev).add(target));
      setTimeout(() => saveSection(target, updated), 100);
    }

    showMsg(`Citation [${citationKey}] inserted`, 'success');
  }, [content, saveSection, focusedSection, sectionConfigs]);

  const handleInsertSelectedCitations = useCallback((keys: string[]) => {
    const target = insertCitationTargetRef.current;
    if (!target || keys.length === 0) return;
    
    const insertText = keys.map(k => `[CITE:${k}]`).join(' ');
    const editor = editorRefs.current[target];
    if (editor) {
      editor.insertTextAtCursor(insertText);
      editor.focus();
    } else {
      const updated = `${content[target] || ''} ${insertText}`.trim();
      setContent(prev => ({ ...prev, [target]: updated }));
      setPendingChanges(prev => new Set(prev).add(target));
      setTimeout(() => saveSection(target, updated), 100);
    }

    setPickerOpen(false);
    setInsertCitationTarget(null);
    insertCitationTargetRef.current = null;
    setFocusedSection(target);
    showMsg(`${keys.length} citation(s) inserted`, 'success');
  }, [content, saveSection]);

  // Extract citation keys from content in canonical section order (for IEEE sequence accuracy).
  const extractUsedCitationKeys = useCallback(() => {
    const normalizedContent: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(content)) {
      const sectionKey = normalizeSectionKey(rawKey);
      if (!sectionKey) continue;
      const value = String(rawValue || '');
      if (!value.trim()) continue;
      const existing = normalizedContent[sectionKey];
      normalizedContent[sectionKey] = existing ? `${existing}\n\n${value}` : value;
    }

    const canonicalLookup = new Map<string, string>();
    for (const citation of citations) {
      const key = String(citation?.citationKey || '').trim();
      if (!key) continue;
      canonicalLookup.set(key.toLowerCase(), key);
    }

    const configuredOrder = (sectionConfigs || fallbackSections)
      .flatMap(section => section.keys || [])
      .map(key => normalizeSectionKey(key));
    const orderedSections = Array.from(new Set([
      ...configuredOrder,
      ...Object.keys(normalizedContent)
    ]));

    const usedKeys: string[] = [];
    const seen = new Set<string>();
    const markerRegex = /\[CITE:([^\]]+)\]/gi;

    for (const sectionKey of orderedSections) {
      const sectionContent = normalizeCitationMarkupForExtraction(normalizedContent[sectionKey] || '');
      if (!sectionContent.trim()) continue;

      markerRegex.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = markerRegex.exec(sectionContent)) !== null) {
        const keysInMarker = String(match[1] || '')
          .split(/[;,]/)
          .map(key => key.trim())
          .filter(Boolean);

        for (const rawKey of keysInMarker) {
          const canonical = canonicalLookup.get(rawKey.toLowerCase()) || rawKey;
          const identity = canonical.toLowerCase();
          if (seen.has(identity)) continue;
          seen.add(identity);
          usedKeys.push(canonical);
        }
      }

      // Fallback: recover canonical keys from bare bracket markers like [Lee2025].
      if (canonicalLookup.size > 0) {
        const bareMarkerRegex = /\[([^\[\]]+)\]/g;
        bareMarkerRegex.lastIndex = 0;
        while ((match = bareMarkerRegex.exec(sectionContent)) !== null) {
          const token = String(match[1] || '').trim();
          if (!token || /^CITE:/i.test(token) || /^Figure\s+\d+/i.test(token)) continue;
          const keysInMarker = token
            .split(/[;,]/)
            .map((key) => key.trim())
            .filter(Boolean);
          for (const rawKey of keysInMarker) {
            const canonical = canonicalLookup.get(rawKey.toLowerCase());
            if (!canonical) continue;
            const identity = canonical.toLowerCase();
            if (seen.has(identity)) continue;
            seen.add(identity);
            usedKeys.push(canonical);
          }
        }
      }
    }

    // ── Rendered-label reverse lookup (last-resort recovery) ───────────
    // If explicit markers were lost (e.g. content was saved before the
    // CitationNode fix), try to match rendered in-text citation labels
    // back to their citation keys.  This handles labels such as
    // "(Smith, 2024)", "(Smith & Lee, 2024)", "(1)", "[1]", etc.
    if (usedKeys.length === 0 && citations.length > 0) {
      const allSectionText = orderedSections
        .map(key => normalizedContent[key] || '')
        .join('\n\n');

      if (allSectionText.trim()) {
        for (const citation of citations) {
          const citationKey = String(citation?.citationKey || '').trim();
          if (!citationKey) continue;
          const identity = citationKey.toLowerCase();
          if (seen.has(identity)) continue;

          // Check rendered preview label from server
          const previewInText = typeof citation?.preview?.inText === 'string'
            ? citation.preview.inText.trim()
            : '';

          // Also check raw citation key appearing as plain text
          const searchTerms: string[] = [];
          if (previewInText) searchTerms.push(previewInText);
          // Match bare citation key as word boundary (e.g. "Smith2024")
          searchTerms.push(citationKey);

          const found = searchTerms.some(term => {
            if (!term) return false;
            // Escape regex special chars for literal match
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(escaped, 'i').test(allSectionText);
          });

          if (found) {
            seen.add(identity);
            usedKeys.push(citationKey);
          }
        }
      }
    }

    return usedKeys;
  }, [content, citations, sectionConfigs]);

  const citationDisplayMeta = useMemo<PaperCitationDisplayMeta>(() => {
    const styleCode = String(bibliographyStyle || citationStyleMeta?.styleCode || 'APA7').trim().toUpperCase();
    const isNumericStyle = ['IEEE', 'VANCOUVER'].includes(styleCode);
    const displayByKey: Record<string, string> = {};
    const orderByKey: Record<string, number> = {};

    for (const citation of citations) {
      const citationKey = String(citation?.citationKey || '').trim();
      if (!citationKey) continue;
      const previewInText = typeof citation?.preview?.inText === 'string'
        ? citation.preview.inText.trim()
        : '';
      displayByKey[citationKey] = previewInText || `[${citationKey}]`;
    }

    if (isNumericStyle) {
      const numbering: Record<string, number> = {};
      const serverMetaMatchesStyle = citationStyleMeta?.styleCode?.toUpperCase() === styleCode;
      if (serverMetaMatchesStyle && citationStyleMeta) {
        for (const [citationKey, numberValue] of Object.entries(citationStyleMeta.numberingByKey || {})) {
          const parsed = Number(numberValue);
          if (citationKey && Number.isFinite(parsed) && parsed > 0) {
            numbering[citationKey] = Math.trunc(parsed);
          }
        }
      }

      const orderedUsedKeys = extractUsedCitationKeys();
      for (let index = 0; index < orderedUsedKeys.length; index += 1) {
        const citationKey = orderedUsedKeys[index];
        numbering[citationKey] = index + 1;
      }

      const usedNumbers = Object.values(numbering).filter((value) => Number.isFinite(value) && value > 0);
      let nextNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
      for (const citation of citations) {
        const citationKey = String(citation?.citationKey || '').trim();
        if (!citationKey) continue;
        if (!numbering[citationKey]) {
          numbering[citationKey] = nextNumber;
          nextNumber += 1;
        }
      }

      for (const [citationKey, numberValue] of Object.entries(numbering)) {
        const parsed = Number(numberValue);
        if (!Number.isFinite(parsed) || parsed <= 0) continue;
        const order = Math.trunc(parsed);
        orderByKey[citationKey] = order;
        displayByKey[citationKey] = styleCode === 'VANCOUVER'
          ? `(${order})`
          : `[${order}]`;
      }
    }

    const signatureParts = Object.keys(displayByKey)
      .sort((left, right) => left.localeCompare(right))
      .map((citationKey) => {
        const order = orderByKey[citationKey];
        return `${citationKey}:${displayByKey[citationKey]}:${typeof order === 'number' ? order : ''}`;
      });

    return {
      styleCode,
      displayByKey,
      orderByKey: Object.keys(orderByKey).length > 0 ? orderByKey : undefined,
      signature: `${styleCode}|${signatureParts.join('|')}`
    };
  }, [bibliographyStyle, citationStyleMeta, citations, extractUsedCitationKeys]);

  const figureDisplayMeta = useMemo<PaperFigureDisplayMeta>(() => {
    const byNo: Record<number, { title?: string; imagePath?: string }> = {};

    for (const figure of figures) {
      const rawNo = Number(figure?.figureNo);
      if (!Number.isFinite(rawNo) || rawNo <= 0) continue;
      const figureNo = Math.trunc(rawNo);
      const title = typeof figure?.title === 'string' ? figure.title.trim() : '';
      const imagePath = typeof figure?.imagePath === 'string' ? figure.imagePath.trim() : '';

      byNo[figureNo] = {
        title: title || undefined,
        imagePath: imagePath || undefined,
      };
    }

    const signature = Object.keys(byNo)
      .map((key) => Number(key))
      .sort((left, right) => left - right)
      .map((figureNo) => {
        const meta = byNo[figureNo];
        return `${figureNo}:${meta?.imagePath || ''}:${meta?.title || ''}`;
      })
      .join('|');

    return { byNo, signature };
  }, [figures]);

  const generateBibliography = useCallback(async () => {
    // ── 1. Primary: extract [CITE:key] markers from in-memory content ──
    const extractedCitationKeys = extractUsedCitationKeys();

    // ── 2. Fallback: citations with tracked server-side usage ──────────
    const usageFallbackKeys = citations
      .filter((citation) => {
        const usageCount = Number(citation?.usageCount || 0);
        const hasUsages = Array.isArray(citation?.usages) && citation.usages.length > 0;
        return usageCount > 0 || hasUsages;
      })
      .map((citation) => String(citation?.citationKey || '').trim())
      .filter(Boolean);

    let usedCitationKeys = extractedCitationKeys.length > 0
      ? extractedCitationKeys
      : Array.from(new Set(usageFallbackKeys));

    // ── 3. Last-resort: let the server extract from DB draft ───────────
    // If both client-side paths returned nothing, send an empty array so
    // the server will read the authoritative draft from the database and
    // extract citation keys itself (it already has this logic).
    const clientExtractionFailed = usedCitationKeys.length === 0;
    if (clientExtractionFailed) {
      // Don't block here — let the server decide.  We still show a soft
      // warning but proceed with the request.
      console.warn('[Bibliography] Client-side citation extraction found 0 keys; delegating to server.');
    }
    
    setGeneratingBibliography(true);
    try {
      const pendingKeys = Array.from(pendingChanges);
      if (pendingKeys.length > 0) {
        await Promise.all(
          pendingKeys.map(key => saveSection(key, content[key] || ''))
        );
      }

      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ 
          action: 'generate_bibliography',
          // When client extraction failed, send empty so the server falls
          // through to its own draft-based extraction.
          citationKeys: clientExtractionFailed ? [] : usedCitationKeys,
          sortOrder: bibliographySortOrder,
          styleCode: bibliographyStyle
        })
      });
      const data = await res.json();
      if (res.ok && data.bibliography) {
        setBibliographyContent(data.bibliography);
        // Also update references section if it exists
        if (sectionConfigs?.some(s => s.keys.includes('references'))) {
          setContent(prev => ({ ...prev, references: data.bibliography }));
          await saveSection('references', data.bibliography);
        }
        const usedCount = typeof data.usedCount === 'number' ? data.usedCount : usedCitationKeys.length;
        const added = Array.isArray(data?.sequence?.changes?.added) ? data.sequence.changes.added.length : 0;
        const removed = Array.isArray(data?.sequence?.changes?.removed) ? data.sequence.changes.removed.length : 0;
        const renumbered = Array.isArray(data?.sequence?.changes?.renumbered) ? data.sequence.changes.renumbered.length : 0;
        const version = typeof data?.sequence?.version === 'number' ? data.sequence.version : null;
        const historyCount = typeof data?.sequence?.historyCount === 'number' ? data.sequence.historyCount : 0;
        const changed = Boolean(data?.sequence?.changed);

        setSequenceInfo({
          styleCode: String(data?.styleCode || bibliographyStyle),
          version,
          changed,
          added,
          removed,
          renumbered,
          historyCount
        });

        const sequenceLabel = version ? `, seq v${version}` : '';
        const deltaLabel = changed
          ? `, Δ +${added}/-${removed}, renumbered ${renumbered}`
          : '';
        const recoveryLabel = clientExtractionFailed
          ? ', recovered from server draft'
          : extractedCitationKeys.length === 0 && usageFallbackKeys.length > 0
            ? ', recovered from usage metadata'
            : '';
        showMsg(
          `Bibliography generated (${bibliographyStyle}, ${usedCount} citations${sequenceLabel}${deltaLabel}${recoveryLabel})`,
          'success'
        );
        await loadCitations();
      } else {
        const serverMsg = typeof data?.error === 'string' ? data.error : '';
        showMsg(serverMsg || 'Failed to generate bibliography', 'error');
      }
    } catch {
      showMsg('Bibliography generation failed', 'error');
    } finally {
      setGeneratingBibliography(false);
    }
  }, [
    sessionId,
    authToken,
    sectionConfigs,
    saveSection,
    bibliographyStyle,
    bibliographySortOrder,
    extractUsedCitationKeys,
    citations,
    pendingChanges,
    content,
    loadCitations
  ]);

  // ============================================================================
  // Instructions Handler
  // ============================================================================

  const handleSaveInstruction = useCallback((instr: UserInstruction) => {
    const key = instructionPopoverKey;
    if (!key) return;
    setUserInstructions(prev => ({
      ...prev,
      [key]: instr.instruction ? instr : undefined
    } as any));
  }, [instructionPopoverKey]);

  // Handle AI fix
  const handleFix = useCallback((sectionKey: string, fixedContent: string) => {
    setContent(prev => ({ ...prev, [sectionKey]: fixedContent }));
    // REMOVED: Auto-switch to preview - stay in edit mode
    saveSection(sectionKey, fixedContent);
  }, [saveSection]);

  // Total word count
  const totalWordCount = useMemo(() => Object.values(content).reduce((acc, c) => acc + computeWordCount(c), 0), [content]);
  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-slate-600">Loading paper configuration...</span>
      </div>
    );
  }

  if (profileError || !paperTypeCode) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{profileError || 'Select a paper type to start drafting.'}</p>
        </div>
      </div>
    );
  }

  const sections = sectionConfigs || fallbackSections;

  return (
    <div className="min-h-screen bg-gray-100 pb-12">
      {/* Toast Messages */}
      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${messageType === 'success' ? 'bg-emerald-500 text-white' : messageType === 'error' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'}`}>
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Panel */}
      {showHelpPanel && (
        <div className="fixed top-20 right-4 z-40 w-80 bg-white rounded-xl shadow-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">📚 Drafting Guide</h3>
            <button onClick={() => setShowHelpPanel(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><h4 className="font-semibold text-gray-900 mb-1">✍️ Always-Edit Mode</h4><p className="text-gray-600 text-xs">Content is always editable. Changes auto-save after 2 seconds of inactivity or when you click away.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">💬 Instructions</h4><p className="text-gray-600 text-xs">Add custom instructions per section. Toggle ON/OFF to control when they're used. Use "Save for all papers" to reuse across drafts.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">📚 Citations</h4><p className="text-gray-600 text-xs">Click the citation button in section toolbar to insert. Generate bibliography uses your selected citation style.</p></div>
            <div><h4 className="font-semibold text-gray-900 mb-1">🔬 AI Review</h4><p className="text-gray-600 text-xs">Run AI Review to check consistency, citations, and academic quality. Auto-fix issues with one click.</p></div>
          </div>
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="max-w-[850px] mx-auto mb-6 px-8 pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Paper Draft</h2>
            <p className="text-sm text-gray-500">
              {totalWordCount} words
              {pendingChanges.size > 0 && <span className="ml-2 text-amber-500">• Saving...</span>}
            </p>
              </div>
          <Tooltip content="Help guide" position="left">
            <button onClick={() => setShowHelpPanel(!showHelpPanel)}
              className={`p-2.5 rounded-full transition-all ${showHelpPanel ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' : 'bg-white border text-gray-500 hover:bg-gray-50 shadow-sm'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </Tooltip>
            </div>

        {/* Controls */}
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Writing Style */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Enable AI to use your writing style" position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${usePersonaStyle ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <button onClick={() => setUsePersonaStyle(!usePersonaStyle)}
                    className={`relative w-9 h-5 rounded-full ${usePersonaStyle ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${usePersonaStyle ? 'left-4' : 'left-0.5'}`} />
              </button>
                  <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-gray-500'}`}>Style</span>
                </div>
              </Tooltip>
              <Tooltip content="Choose persona" position="bottom">
                <button onClick={() => setShowPersonaManager(true)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border ${personaSelection?.primaryPersonaName ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  👤 {personaSelection?.primaryPersonaName || 'Persona'}
              </button>
              </Tooltip>
              <Tooltip content="Writing samples" position="bottom">
                <button onClick={() => setShowWritingSamplesModal(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">
                  ✍️ Samples
              </button>
              </Tooltip>
            </div>

            {/* Auto Mode */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-200">
              <Tooltip content="Auto-generate all sections" position="bottom">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${autoModeRunning ? 'bg-amber-50' : autoMode ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <button onClick={() => setAutoMode(!autoMode)} disabled={autoModeRunning}
                    className={`relative w-9 h-5 rounded-full ${autoMode ? 'bg-emerald-500' : 'bg-gray-300'} ${autoModeRunning ? 'opacity-50' : ''}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoMode ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className={`text-xs font-medium ${autoMode ? 'text-emerald-700' : 'text-gray-500'}`}>{autoModeRunning ? '⏳ Running...' : 'Auto'}</span>
          </div>
              </Tooltip>
              {autoMode && !autoModeRunning && (
                <button onClick={handleAutoGenerateAll} disabled={loading} className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium disabled:opacity-50">Generate All</button>
              )}
              {autoModeRunning && (
                <>
                  {autoModeProgress && (
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-50 border border-blue-100">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-xs font-medium text-blue-700">{autoModeProgress.current}/{autoModeProgress.total}</span>
                      <span className="text-xs text-blue-600 max-w-[100px] truncate">{autoModeProgress.currentSection}</span>
        </div>
                  )}
                  <button onClick={() => { autoModeCancelledRef.current = true; }} className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium">Stop</button>
                </>
              )}
            </div>

            {/* Tools */}
              <div className="flex items-center gap-2">
              <Tooltip content="Section instructions" position="bottom">
                <button onClick={() => setShowAllInstructionsModal(true)}
                  className={`p-2 rounded-lg border relative ${Object.keys(userInstructions).length > 0 ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  <Settings2 className="w-4 h-4" />
                  {Object.values(userInstructions).filter(i => i?.isActive !== false).length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-500 rounded-full text-[9px] text-white flex items-center justify-center font-medium">
                      {Object.values(userInstructions).filter(i => i?.isActive !== false).length}
                    </span>
                  )}
                </button>
              </Tooltip>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">{paperTypeCode}</span>
            </div>
              </div>
            </div>
          </div>

        {session?.archetypeEvidenceStale && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Evidence packs may be outdated after archetype changes. Refresh literature analysis and blueprint mapping before final drafting.
          </div>
        )}

        {/* Background section preparation status (two-pass pipeline) */}
        {(bgGenStatus === 'IDLE' || bgGenStatus === null) && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full shrink-0 bg-slate-400" />
              <div className="flex-1">
                <p className="text-sm text-slate-800">
                  Pass 1 reference draft is not prepared yet. Generate it for non-reference sections from base prompts to speed up section drafting.
                </p>
              </div>
              <button
                onClick={() => handleRetryBgPreparation()}
                disabled={bgGenRetrying}
                className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bgGenRetrying ? 'Preparing...' : 'Generate Reference Draft (Pass 1)'}
              </button>
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="text-xs font-medium text-slate-700">Run Pass 1 only for selected non-reference sections</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {bgSelectableSections.map(section => (
                    <label
                      key={section.key}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={bgSelectedSectionSet.has(section.key)}
                        onChange={() => toggleBgSectionSelection(section.key)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllBgSections}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearBgSectionSelection}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetryBgPreparation({ force: true, sectionKeys: bgSelectedSectionKeys })}
                    disabled={bgGenRetrying || bgSelectedSectionKeys.length === 0}
                    className="px-3 py-1 text-xs rounded-md border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bgGenRetrying ? 'Preparing...' : 'Run Pass 1 for Selected'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {bgGenStatus === 'RUNNING' && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-indigo-800">
                Generating Pass 1 reference drafts...
              </p>
              {bgGenProgress && bgGenProgress.total > 0 && bgGenLiveCounts && (
                <p className="text-xs text-indigo-600 mt-0.5">
                  {bgGenLiveCounts.done}/{bgGenProgress.total} generated • {bgGenLiveCounts.waiting} waiting • {bgGenLiveCounts.running} in progress
                  {bgGenLiveCounts.failed > 0 && ` • ${bgGenLiveCounts.failed} failed`}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                void handleOpenReferenceDraftModal();
              }}
              disabled={referenceDraftLoading}
              className="px-3 py-1.5 text-xs rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
            </button>
          </div>
        )}
        {(bgGenStatus === 'COMPLETED' || bgGenStatus === 'PARTIAL') && bgGenProgress && (
          <div className={`mt-4 max-w-[850px] mx-auto rounded-lg border px-4 py-3 ${
            bgGenStatus === 'PARTIAL'
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`inline-flex h-3 w-3 rounded-full shrink-0 ${
                bgGenStatus === 'PARTIAL' ? 'bg-amber-500' : 'bg-emerald-500'
              }`} />
              <div className="flex-1">
                <p className={`text-sm ${bgGenStatus === 'PARTIAL' ? 'text-amber-800' : 'text-emerald-800'}`}>
                {bgGenStatus === 'PARTIAL'
                  ? `Paper structure partially ready — ${bgGenProgress.completed} of ${bgGenProgress.total} sections prepared (${bgGenProgress.failed} failed).`
                  : 'Paper structure ready — sections will generate faster with pre-built evidence drafts.'
                }
                </p>
              </div>
              {(bgGenStatus === 'PARTIAL' || bgGenStatus === 'COMPLETED') && (
                <button
                  onClick={() => handleRetryBgPreparation({ force: bgGenStatus === 'COMPLETED' })}
                  disabled={bgGenRetrying}
                  className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${
                    bgGenStatus === 'COMPLETED'
                      ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                      : 'border-amber-300 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  {bgGenRetrying
                    ? 'Preparing...'
                    : bgGenStatus === 'COMPLETED'
                      ? 'Rerun Section Prep'
                      : 'Retry Section Prep'}
                </button>
              )}
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${
                  bgGenStatus === 'PARTIAL'
                    ? 'border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              {bgGenStatus === 'PARTIAL' && (bgGenLiveCounts?.failed || 0) > 0 && (
                <button
                  onClick={() => handleRetryBgPreparation({ retryFailedOnly: true })}
                  disabled={bgGenRetrying}
                  className="px-3 py-1.5 text-xs rounded-lg border border-amber-400 text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bgGenRetrying ? 'Retrying...' : 'Retry Failed Only'}
                </button>
              )}
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className={`px-3 py-1.5 text-xs rounded-lg border ${
                  bgGenStatus === 'PARTIAL'
                    ? 'border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              <div className="mt-3 border-t border-white/60 pt-3">
                <p className={`text-xs font-medium ${bgGenStatus === 'PARTIAL' ? 'text-amber-800' : 'text-emerald-800'}`}>
                  Run Pass 1 only for selected non-reference sections
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {bgSelectableSections.map(section => (
                    <label
                      key={section.key}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={bgSelectedSectionSet.has(section.key)}
                        onChange={() => toggleBgSectionSelection(section.key)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllBgSections}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearBgSectionSelection}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetryBgPreparation({ force: true, sectionKeys: bgSelectedSectionKeys })}
                    disabled={bgGenRetrying || bgSelectedSectionKeys.length === 0}
                    className="px-3 py-1 text-xs rounded-md border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bgGenRetrying ? 'Preparing...' : 'Run Pass 1 for Selected'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {bgGenStatus === 'FAILED' && (
          <div className="mt-4 max-w-[850px] mx-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 rounded-full shrink-0 bg-red-500" />
              <div className="flex-1">
                <p className="text-sm text-red-800">
                  Paper structure preparation failed. Retry generation to pre-build section drafts.
                </p>
              </div>
              {(bgGenLiveCounts?.failed || 0) > 0 && (
                <button
                  onClick={() => handleRetryBgPreparation({ retryFailedOnly: true })}
                  disabled={bgGenRetrying}
                  className="px-3 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bgGenRetrying ? 'Retrying...' : 'Retry Failed Only'}
                </button>
              )}
              <button
                onClick={() => handleRetryBgPreparation()}
                disabled={bgGenRetrying}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bgGenRetrying ? 'Retrying...' : 'Retry Section Prep'}
              </button>
              <button
                onClick={() => {
                  void handleOpenReferenceDraftModal();
                }}
                disabled={referenceDraftLoading}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {referenceDraftLoading ? 'Loading...' : 'View Reference Draft'}
              </button>
              <button
                onClick={() => setBgSectionSelectorOpen(prev => !prev)}
                className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-800 hover:bg-red-100"
              >
                {bgSectionSelectorOpen ? 'Hide Sections' : 'Select Sections'}
              </button>
            </div>

            {bgSectionSelectorOpen && (
              <div className="mt-3 border-t border-red-200 pt-3">
                <p className="text-xs font-medium text-red-800">Run Pass 1 only for selected non-reference sections</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {bgSelectableSections.map(section => (
                    <label
                      key={section.key}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={bgSelectedSectionSet.has(section.key)}
                        onChange={() => toggleBgSectionSelection(section.key)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllBgSections}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearBgSectionSelection}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetryBgPreparation({ force: true, sectionKeys: bgSelectedSectionKeys })}
                    disabled={bgGenRetrying || bgSelectedSectionKeys.length === 0}
                    className="px-3 py-1 text-xs rounded-md border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bgGenRetrying ? 'Preparing...' : 'Run Pass 1 for Selected'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      {/* Paper Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[1100px] px-[60px] py-[60px] relative border border-gray-100">
        {showActivity && (currentKeys || autoModeRunning) && (
          <div className="absolute top-4 right-4 z-10">
            <BackendActivityPanel isVisible={true} onClose={() => setShowActivity(false)}
              steps={(debugSteps || []).map((s: any) => ({ id: String(s.step || ''), state: s.status === 'fail' ? 'error' : (s.status || 'running') }))} />
        </div>
        )}

        <div className="space-y-2">
          {sections.map((section, idx) => {
            const isGenerating = loading && currentKeys?.some(k => section.keys.includes(k));
            const isRegenerating = section.keys.some(k => sectionLoading[k]);
            const isWorking = isGenerating || isRegenerating;
            const isSavingSection = section.keys.some(k => saving[k]);
            const hasPending = section.keys.some(k => pendingChanges.has(k));
            const primarySectionKey = section.keys[0] || '';
            const primaryDimensionState = primarySectionKey ? getDimensionState(primarySectionKey) : createInitialDimensionUIState();
            const primarySupportsDimensionFlow = primarySectionKey ? supportsDimensionFlow(primarySectionKey) : false;
            const sectionWordCount = section.keys.reduce((acc, key) => acc + computeWordCount(content[key] || ''), 0);

            const sectionCitationIssue = (() => {
              const disallowedSet = new Set<string>();
              const unknownSet = new Set<string>();
              for (const key of section.keys) {
                const issue = sectionCitationValidation[normalizeSectionKey(key)];
                if (!issue) continue;
                for (const disallowed of issue.disallowedKeys || []) disallowedSet.add(disallowed);
                for (const unknown of issue.unknownKeys || []) unknownSet.add(unknown);
              }
              const disallowedKeys = Array.from(disallowedSet);
              const unknownKeys = Array.from(unknownSet);
              if (disallowedKeys.length === 0 && unknownKeys.length === 0) return null;
              return { disallowedKeys, unknownKeys };
            })();

            return (
              <div key={section.keys.join('|') || idx} className="relative py-2">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3
                      className="mb-1 text-slate-800"
                      style={{
                        fontFamily: '"Times New Roman", "Noto Serif", Georgia, serif',
                        fontSize: '16px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                    </h3>

                    {primarySupportsDimensionFlow && primaryDimensionState.started && primaryDimensionState.plan.length > 0 && (
                      <DimensionPlanPills
                        plan={primaryDimensionState.plan}
                        activeDimensionKey={primaryDimensionState.activeDimensionKey || primaryDimensionState.nextDimensionKey}
                        acceptedCount={primaryDimensionState.progress.accepted}
                        totalCount={primaryDimensionState.progress.total}
                        disabled={isWorking || autoModeRunning}
                        onSelect={(dimensionKey) => {
                          setDimensionPanelOpen(prev => ({ ...prev, [normalizeSectionKey(primarySectionKey)]: true }));
                          void generateDimensionDraft(primarySectionKey, { dimensionKey });
                        }}
                      />
                    )}

                    {sectionCitationIssue && (
                      <p className="mt-1 text-[11px] text-rose-600">
                        Remove invalid citation: {[
                          ...sectionCitationIssue.disallowedKeys,
                          ...sectionCitationIssue.unknownKeys
                        ].slice(0, 6).join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    {isSavingSection && <span className="animate-pulse text-amber-500">Saving...</span>}
                    {hasPending && !isSavingSection && <span>Unsaved</span>}
                    {section.wordLimit && (
                      <span>{sectionWordCount} / {section.wordLimit}</span>
                    )}
                  </div>
                </div>

                <div className="space-y-4 text-gray-800 text-justify">
                  {section.keys.map(keyName => {
                    const normalizedKey = normalizeSectionKey(keyName);
                    const sectionSupportsDimensionFlow = supportsDimensionFlow(keyName);
                    const dimensionState = getDimensionState(keyName);
                    const dimensionBusy = dimensionState.loading || dimensionState.accepting || dimensionState.rejecting;
                    const showInlineDimension = sectionSupportsDimensionFlow && Boolean(
                      dimensionPanelOpen[normalizedKey]
                      || dimensionState.started
                      || dimensionState.activeDimensionKey
                      || (dimensionState.loading && dimensionState.proposalText)
                    );
                    const hasDraftContent = Boolean(String(content[keyName] || '').trim());
                    const autoCitationAvailable = isCitationEligibleForSection(keyName);
                    const autoCitationEnabled = autoCitationAvailable ? isMappedEvidenceEnabled(keyName) : false;
                    const instruction = userInstructions[keyName];
                    const instructionActive = Boolean(instruction?.instruction) && instruction?.isActive !== false;

                    return (
                      <div key={keyName} className="section-wrapper group/section relative">
                        {section.keys.length > 1 && (
                          <h4 className="mb-1 mt-2 text-[12px] font-semibold uppercase tracking-[0.3px] text-slate-500">
                            {displayName[keyName] || keyName}
                          </h4>
                        )}

                        <SectionFloatingToolbar
                          onGenerate={() => {
                            if (!sectionSupportsDimensionFlow) {
                              void handleGenerate([keyName]);
                              return;
                            }
                            setDimensionPanelOpen(prev => ({ ...prev, [normalizedKey]: true }));
                            if (dimensionState.started && !dimensionState.completed) {
                              void generateDimensionDraft(keyName, {
                                dimensionKey: dimensionState.nextDimensionKey || undefined
                              });
                              return;
                            }
                            if (!dimensionState.started && !hasDraftContent) {
                              void beginStructuredDraft(keyName);
                              return;
                            }
                            void handleGenerate([keyName]);
                          }}
                          onRegenerate={() => {
                            if (sectionLoading[keyName]) return;
                            setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }));
                          }}
                          onInstructions={() => {
                            setInstructionPopoverKey(prev => (prev === keyName ? null : keyName));
                          }}
                          onToggleAutoCitations={
                            autoCitationAvailable
                              ? () => {
                                setMappedEvidenceBySection(prev => ({
                                  ...prev,
                                  [normalizedKey]: !autoCitationEnabled
                                }));
                              }
                              : undefined
                          }
                          autoCitationsAvailable={autoCitationAvailable}
                          autoCitationsEnabled={autoCitationEnabled}
                          generating={dimensionState.loading || sectionLoading[keyName]}
                          regenerating={sectionLoading[keyName]}
                          instructionActive={instructionActive}
                          disabled={isWorking || autoModeRunning || loading}
                        />

                        {instructionPopoverKey === keyName && (
                          <div className="relative z-20 mb-2">
                            <PaperSectionInstructionPopover
                              sectionKey={keyName}
                              sectionLabel={displayName[keyName] || formatSectionLabel(keyName)}
                              sessionId={session?.id || ''}
                              paperTypeCode={paperTypeCode}
                              existingInstruction={instruction || null}
                              onSave={handleSaveInstruction}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          </div>
                        )}

                        <div className="relative">
                          <PaperMarkdownEditor
                            ref={(editor) => { editorRefs.current[keyName] = editor; }}
                            value={content[keyName] || ''}
                            onChange={(markdown) => handleContentChange(keyName, markdown)}
                            citationDisplayMeta={citationDisplayMeta}
                            figureDisplayMeta={figureDisplayMeta}
                            onBlur={() => {
                              handleBlur(keyName);
                            }}
                            onFocus={() => setFocusedSection(keyName)}
                            onSelectionChange={(selection) => {
                              if (!selection || !selection.text) {
                                if (focusedSection === keyName) setSelectedText(null);
                                return;
                              }
                              setFocusedSection(keyName);
                              setSelectedText({
                                text: selection.text,
                                start: selection.start,
                                end: selection.end
                              });
                              const editor = editorRefs.current[keyName];
                              if (editor) {
                                editor.saveSelection();
                              }
                            }}
                            placeholder={isWorking ? 'Generating...' : 'Write polished section content with headings, bullets, and academic structure.'}
                            disabled={isWorking}
                            className="min-h-[190px]"
                          />
                        </div>

                        {!isWorking && !dimensionState.started && (!hasDraftContent || sectionSupportsDimensionFlow) && (
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            {!hasDraftContent && (
                              <button
                                type="button"
                                onClick={() => void handleGenerate([keyName])}
                                disabled={loading || autoModeRunning}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Draft
                              </button>
                            )}
                            {sectionSupportsDimensionFlow && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDimensionPanelOpen(prev => ({ ...prev, [normalizedKey]: true }));
                                  void beginStructuredDraft(keyName);
                                }}
                                disabled={loading || autoModeRunning}
                                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                {hasDraftContent ? 'Structured from Pass 1' : 'Structured'}
                              </button>
                            )}
                          </div>
                        )}

                        {showInlineDimension && dimensionState.error && (
                          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                            {dimensionState.error}
                          </div>
                        )}

                        {showInlineDimension && !dimensionState.activeDimensionKey && dimensionState.started && !dimensionState.completed && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => void generateDimensionDraft(keyName, { dimensionKey: dimensionState.nextDimensionKey || undefined })}
                              disabled={dimensionBusy || sectionLoading[keyName]}
                              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {dimensionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              Generate next dimension
                            </button>
                          </div>
                        )}

                        {showInlineDimension && dimensionState.activeDimensionKey && (
                          <InlineDimensionProposal
                            dimensionLabel={dimensionState.activeDimensionLabel || dimensionState.activeDimensionKey}
                            proposalText={dimensionState.proposalText}
                            isStreaming={dimensionState.isStreaming}
                            streamCursor={dimensionState.streamCursor}
                            isLoading={dimensionState.loading}
                            isAccepting={dimensionState.accepting}
                            isRewriting={dimensionState.rejecting}
                            isEditing={dimensionState.editMode}
                            showRewriteInput={dimensionState.showReject}
                            feedback={dimensionState.feedback}
                            validation={dimensionState.proposalValidation}
                            reviewTrace={dimensionState.proposalReviewTrace}
                            pass1Source={dimensionState.pass1Source}
                            onAccept={() => acceptDimensionDraft(keyName, true)}
                            onAcceptBypass={() => acceptDimensionDraft(keyName, true, { allowCitationBypass: true })}
                            onToggleRewrite={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                showReject: !prev.showReject
                              }));
                            }}
                            onToggleEdit={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                editMode: !prev.editMode
                              }));
                            }}
                            onProposalChange={(value) => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                proposalText: value
                              }));
                            }}
                            onFeedbackChange={(value) => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                feedback: value
                              }));
                            }}
                            onRewrite={() => rejectDimensionDraft(keyName)}
                            onSkipAnimation={() => {
                              setDimensionState(keyName, prev => ({
                                ...prev,
                                isStreaming: false,
                                streamCursor: prev.proposalText.length
                              }));
                            }}
                          />
                        )}

                        {showInlineDimension && dimensionState.completed && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700"
                          >
                            Structured draft complete for this section.
                          </motion.div>
                        )}

                        {(() => {
                          const referencedFigs = getReferencedFigures(content[keyName] || '');
                          if (referencedFigs.length === 0) return null;

                          return (
                            <div className="mt-3 rounded-lg border border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-2">
                              <div className="mb-2 flex items-center gap-2">
                                <ImageIcon className="h-3.5 w-3.5 text-violet-600" />
                                <span className="text-xs font-medium text-violet-700">
                                  Referenced Figures ({referencedFigs.length})
                                </span>
                                <span className="text-[10px] text-violet-500">click to preview</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {referencedFigs.map(fig => (
                                  <button
                                    key={fig.id}
                                    onClick={() => setPreviewFigure({
                                      id: fig.id,
                                      figureNo: fig.figureNo,
                                      title: fig.title,
                                      imagePath: fig.imagePath,
                                      description: fig.description
                                    })}
                                    className="group relative flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-2 py-1.5 transition-all hover:border-violet-400 hover:shadow-md"
                                  >
                                    <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-slate-100">
                                      {fig.imagePath ? (
                                        <img
                                          src={fig.imagePath}
                                          alt={fig.title}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <ImageIcon className="h-4 w-4 text-slate-300" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-left">
                                      <p className="text-xs font-medium text-slate-700">Figure {fig.figureNo}</p>
                                      <p className="max-w-[120px] truncate text-[10px] text-slate-500">{fig.title}</p>
                                    </div>
                                    <Eye className="h-3.5 w-3.5 text-violet-500 opacity-0 transition-opacity group-hover:opacity-100" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {regenOpen[keyName] && (
                          <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 shadow-sm">
                            <div className="mb-2 flex items-center gap-2">
                              <RefreshCw className="h-4 w-4 text-indigo-600" />
                              <label className="text-xs font-semibold text-indigo-900">Refinement Instructions</label>
                            </div>
                            <textarea
                              className="w-full rounded-md border-indigo-200 bg-white p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                              value={regenRemarks[keyName] || ''}
                              onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                              placeholder="E.g., 'Make it more concise', 'Add more citations'..."
                              rows={3}
                            />
                            <div className="mt-3 flex justify-end gap-2">
                              <button
                                onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))}
                                className="rounded border border-transparent px-3 py-1.5 text-xs text-gray-600 hover:border-gray-200 hover:bg-white"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleRegenerateSection(keyName)}
                                disabled={sectionLoading[keyName]}
                                className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {sectionLoading[keyName] && <Loader2 className="h-3 w-3 animate-spin" />}
                                {sectionLoading[keyName] ? 'Regenerating...' : 'Regenerate'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* AI Review Panel */}
          {Object.keys(content).some(k => content[k]) && (
            <div className="mt-16 border-t pt-8">
              <PaperValidationPanel sessionId={session?.id || ''} paperId={sessionId} draft={content} onFix={handleFix} authToken={authToken} />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <CitationPickerModal open={pickerOpen} onOpenChange={setPickerOpen} sessionId={sessionId} authToken={authToken}
        citations={citations} onInsert={handleInsertSelectedCitations} onCitationsUpdated={setCitations} />

      {showPersonaManager && (
        <PersonaManager isOpen={showPersonaManager} onClose={() => setShowPersonaManager(false)}
          onSelectPersona={setPersonaSelection} currentSelection={personaSelection} showSelector={true} />
      )}

      {showWritingSamplesModal && <WritingSamplesModal onClose={() => setShowWritingSamplesModal(false)} />}

      <PaperInstructionsModal isOpen={showAllInstructionsModal} onClose={() => setShowAllInstructionsModal(false)}
        sections={(sectionConfigs || fallbackSections).flatMap(s => s.keys.map(k => ({ key: k, label: displayName[k] || formatSectionLabel(k) })))}
        instructions={userInstructions} onSaveAll={(newInstr) => setUserInstructions(newInstr as Record<string, UserInstruction>)} />

      {/* Reference Draft (Pass 1) Preview Modal */}
      <AnimatePresence>
        {showReferenceDraftModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowReferenceDraftModal(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3 bg-slate-50">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Reference Draft Output (Pass 1)</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Review base-prompt outputs across all configured sections.
                  </p>
                  {referenceDraftSummary && (
                    <p className="text-xs text-slate-600 mt-1">
                      {referenceDraftSummary.withPass1Content} / {referenceDraftSummary.totalSections} sections have Pass 1 output
                    </p>
                  )}
                  {referenceDraftFetchedAt && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Last fetched: {formatDateTime(referenceDraftFetchedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void loadReferenceDraftOutput(); }}
                    disabled={referenceDraftLoading}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {referenceDraftLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    onClick={() => setShowReferenceDraftModal(false)}
                    className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center"
                  >
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                {referenceDraftLoading && referenceDraftSections.length === 0 && (
                  <div className="flex items-center justify-center py-10 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading reference draft output...
                  </div>
                )}

                {!referenceDraftLoading && referenceDraftError && referenceDraftSections.length === 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {referenceDraftError}
                  </div>
                )}

                {!referenceDraftLoading && !referenceDraftError && referenceDraftSections.length === 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    No eligible non-reference sections found for Pass 1 preview.
                    </div>
                )}

                {referenceDraftSections.map((section) => (
                  <div key={section.sectionKey} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-800">{section.displayName}</h4>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          section.hasContent
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {section.hasContent ? 'Pass 1 Ready' : 'No Pass 1 Output'}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">
                          {section.wordCount} words
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-500">
                          status: {section.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        generated: {formatDateTime(section.generatedAt)} {section.source !== 'none' ? ` • source: ${section.source}` : ''}
                      </p>
                    </div>
                    <div className="p-4 bg-white">
                      {section.content ? (
                        <pre className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800 font-sans">
                          {section.content}
                        </pre>
                      ) : (
                        <p className="text-sm text-slate-500 italic">
                          Pass 1 output not generated for this section yet.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Figure Preview Modal */}
      <AnimatePresence>
        {previewFigure && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewFigure(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-violet-50 to-white">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs font-semibold rounded">
                      Figure {previewFigure.figureNo}
                    </span>
                  </div>
                  <h3 className="font-semibold text-slate-800 text-lg">{previewFigure.title}</h3>
                  {previewFigure.description && (
                    <p className="text-sm text-slate-500 mt-1 max-w-lg">{previewFigure.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setPreviewFigure(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              {/* Image */}
              <div className="p-6 bg-slate-50 flex items-center justify-center min-h-[300px] max-h-[60vh] overflow-auto">
                {previewFigure.imagePath ? (
                  <img
                    src={previewFigure.imagePath}
                    alt={previewFigure.title}
                    className="max-w-full h-auto rounded-lg shadow-lg"
                  />
                ) : (
                  <div className="text-center py-12">
                    <ImageIcon className="w-16 h-16 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">Image not available</p>
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white">
                <p className="text-xs text-slate-500">
                  Reference in text: <code className="px-1.5 py-0.5 bg-slate-100 rounded text-violet-600">[Figure {previewFigure.figureNo}]</code>
                </p>
                <div className="flex gap-2">
                  {previewFigure.imagePath && (
                    <a
                      href={previewFigure.imagePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open Full Size
                    </a>
                  )}
                  <button
                    onClick={() => setPreviewFigure(null)}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Writing Assistant Panel */}
      <FloatingWritingPanel
        sessionId={sessionId}
        authToken={authToken}
        currentSection={focusedSection || undefined}
        currentContent={focusedSection ? content[focusedSection] : undefined}
        figures={figures}
        citations={citations}
        onInsertFigure={handleInsertFigure}
        onInsertCitation={(citation) => {
          if (citation.citationKey) {
            handleInsertSingleCitation(citation.citationKey);
          }
        }}
        onTextAction={handleTextAction}
        onGenerateFigure={handleGenerateFigure}
        selectedText={selectedText}
        onRefreshFigures={loadFigures}
        onRefreshCitations={loadCitations}
        onNavigateToStage={onNavigateToStage}
        isVisible={true}
        // Bibliography management (merged from Citations Panel)
        bibliographyStyle={bibliographyStyle}
        onBibliographyStyleChange={setBibliographyStyle}
        bibliographySortOrder={bibliographySortOrder}
        onBibliographySortOrderChange={setBibliographySortOrder}
        onGenerateBibliography={generateBibliography}
        generatingBibliography={generatingBibliography}
        usedCitationCount={extractUsedCitationKeys().length}
        isNumericStyleBibliography={isNumericOrderBibliography}
        sequenceInfo={sequenceInfo}
        onAddCitationViaPicker={() => {
          const activeSections = sectionConfigs || fallbackSections;
          const targetSection = focusedSection || (activeSections.length > 0 ? activeSections[0].keys[0] : null);
          if (targetSection) {
            insertCitationTargetRef.current = targetSection;
            setInsertCitationTarget(targetSection);
          }
          setPickerOpen(true);
        }}
        onCitationsUpdated={setCitations}
      />
    </div>
  );
}

