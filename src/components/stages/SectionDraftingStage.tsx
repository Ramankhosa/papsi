'use client';

import { useEffect, useMemo, useState, useCallback, useRef, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  AlertCircle,
  BookOpen,
  Settings2,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Image as ImageIcon,
  X,
  Eye,
  ExternalLink,
} from 'lucide-react';
import CitationPickerModal from '@/components/paper/CitationPickerModal';
import CitationManager from '@/components/paper/CitationManager';
import MarkdownRenderer from '@/components/paper/MarkdownRenderer';

// Import shared components from patent drafting
import BackendActivityPanel from '@/components/drafting/BackendActivityPanel';
import WritingSamplesModal from '@/components/drafting/WritingSamplesModal';
import PersonaManager, { type PersonaSelection } from '@/components/drafting/PersonaManager';
// Paper-specific components
import PaperInstructionsModal from './PaperInstructionsModal';
import PaperSectionInstructionPopover from './PaperSectionInstructionPopover';
import FloatingWritingPanel from '@/components/paper/FloatingWritingPanel';

// ============================================================================
// Types
// ============================================================================

interface SectionDraftingStageProps {
  sessionId: string;
  authToken: string | null;
  onSessionUpdated?: (session: any) => void;
  selectedSection?: string;
  onSectionSelect?: (sectionKey: string) => void;
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
// Auto-Resize Textarea Component - Grows to fit content
// ============================================================================

interface AutoResizeTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  minHeight?: number;
}

const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(({
  value,
  onChange,
  onBlur,
  onFocus,
  onSelect,
  onKeyUp,
  onClick,
  placeholder,
  disabled,
  className,
  style,
  minHeight = 100
}, ref) => {
  const internalRef = useRef<HTMLTextAreaElement | null>(null);

  // Combined ref callback
  const setRef = useCallback((element: HTMLTextAreaElement | null) => {
    internalRef.current = element;
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
    }
    // Initial resize when element mounts
    if (element) {
      element.style.height = 'auto';
      const newHeight = Math.max(element.scrollHeight, minHeight);
      element.style.height = `${newHeight}px`;
    }
  }, [ref, minHeight]);

  // Auto-resize on value change
  useEffect(() => {
    const textarea = internalRef.current;
    if (!textarea) return;
    
    // Reset height to auto to get accurate scrollHeight
    textarea.style.height = 'auto';
    // Set to scrollHeight (content height)
    const newHeight = Math.max(textarea.scrollHeight, minHeight);
    textarea.style.height = `${newHeight}px`;
  }, [value, minHeight]);

  // Also resize on window resize
  useEffect(() => {
    const handleResize = () => {
      const textarea = internalRef.current;
      if (!textarea) return;
      textarea.style.height = 'auto';
      const newHeight = Math.max(textarea.scrollHeight, minHeight);
      textarea.style.height = `${newHeight}px`;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [minHeight]);

  return (
    <textarea
      ref={setRef}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onFocus={onFocus}
      onSelect={onSelect}
      onKeyUp={onKeyUp}
      onClick={onClick}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      style={{
        ...style,
        overflow: 'hidden', // Hide scrollbar since we auto-resize
        resize: 'none', // Prevent manual resize
        minHeight: `${minHeight}px`
      }}
    />
  );
});

AutoResizeTextarea.displayName = 'AutoResizeTextarea';

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
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  if (typeof value === 'object') return value;
  return {};
}

function computeWordCount(content: string): number {
  const trimmed = content.replace(/<[^>]*>/g, ' ').trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function formatSectionLabel(sectionKey: string): string {
  return sectionKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

// Auto-save debounce delay in ms
const AUTO_SAVE_DELAY = 2000;

// ============================================================================
// Main Component
// ============================================================================

export default function SectionDraftingStage({ 
  sessionId, authToken, onSessionUpdated 
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(true);
  const [debugSteps, setDebugSteps] = useState<any[]>([]);
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  // User Instructions (loaded from API)
  const [userInstructions, setUserInstructions] = useState<Record<string, UserInstruction>>({});
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null);
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false);

  // Formatting
  const [showFormatting, setShowFormatting] = useState(false);
  const [fontFamily, setFontFamily] = useState('serif');
  const [fontSize, setFontSize] = useState('15px');
  const [lineHeight, setLineHeight] = useState('1.7');

  // Citations
  const [citations, setCitations] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [insertCitationTarget, setInsertCitationTarget] = useState<string | null>(null);
  const insertCitationTargetRef = useRef<string | null>(null);
  const cursorPositionRef = useRef<{ section: string; position: number } | null>(null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const [bibliographyContent, setBibliographyContent] = useState<string>('');
  const [generatingBibliography, setGeneratingBibliography] = useState(false);

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

  // Regeneration
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({});
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({});

  // View mode: 'edit' shows textarea, 'preview' shows formatted markdown
  const [viewMode, setViewMode] = useState<Record<string, 'edit' | 'preview'>>({});

  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning'>('success');

  const showMsg = (msg: string, type: 'success' | 'error' | 'warning') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  };

  // Helper: Extract figure references from content
  const getReferencedFigures = useCallback((sectionContent: string) => {
    if (!sectionContent || figures.length === 0) return [];
    
    // Match patterns like [Figure 1], [Figure 2], etc.
    const figurePattern = /\[Figure\s+(\d+)\]/gi;
    const matches = sectionContent.matchAll(figurePattern);
    const figureNos = new Set<number>();
    
    for (const match of matches) {
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
        } else {
          setSectionConfigs(fallbackSections);
        }
      } else {
        setSectionConfigs(fallbackSections);
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
          caption: f.nodes?.caption || f.description,
          description: f.description,
          imagePath: f.nodes?.imagePath || f.imagePath,
          status: f.nodes?.status || 'PLANNED',
          category: f.nodes?.category || 'CHART',
          figureType: f.nodes?.figureType || 'auto'
        }));
        setFigures(figs);
      }
    } catch (err) {
      console.error('Load figures error:', err);
    }
  }, [sessionId, authToken]);

  useEffect(() => { loadSession(); loadCitations(); loadFigures(); }, [loadSession, loadCitations, loadFigures]);

  // Set sections with content to preview mode by default
  useEffect(() => {
    const sectionsWithContent = Object.entries(content)
      .filter(([, value]) => value && value.trim().length > 0)
      .map(([key]) => key);
    
    if (sectionsWithContent.length > 0) {
      setViewMode(prev => {
        const updated = { ...prev };
        sectionsWithContent.forEach(key => {
          if (updated[key] === undefined) {
            updated[key] = 'preview';
          }
        });
        return updated;
      });
    }
  }, [content]);

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
      if (res.ok) {
        setPendingChanges(prev => { const next = new Set(prev); next.delete(sectionKey); return next; });
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(prev => ({ ...prev, [sectionKey]: false }));
    }
  }, [sessionId, authToken]);

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
  // Floating Panel Handlers
  // ============================================================================

  const handleInsertFigure = useCallback((figureId: string) => {
    const figure = figures.find(f => f.id === figureId);
    if (!figure) return;

    const figureRef = `[Figure ${figure.figureNo}]`;
    
    // Insert at cursor position if available
    if (cursorPositionRef.current) {
      const { section, position } = cursorPositionRef.current;
      const currentContent = content[section] || '';
      const newContent = currentContent.slice(0, position) + figureRef + currentContent.slice(position);
      handleContentChange(section, newContent);
      showMsg(`Inserted Figure ${figure.figureNo}`, 'success');
    } else if (focusedSection) {
      // Append to focused section
      const currentContent = content[focusedSection] || '';
      handleContentChange(focusedSection, currentContent + ' ' + figureRef);
      showMsg(`Inserted Figure ${figure.figureNo}`, 'success');
    } else {
      showMsg('Please click in a section first to insert the figure', 'warning');
    }
  }, [figures, content, focusedSection, handleContentChange]);

  const handleTextAction = useCallback(async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple',
    text: string,
    customInstructions?: string
  ): Promise<string> => {
    if (!authToken || !text.trim()) {
      throw new Error('Missing required parameters');
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
          context: focusedSection ? content[focusedSection]?.slice(0, 500) : '',
          sectionKey: focusedSection,
          customInstructions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Text action failed');
      }

      // Replace the selected text in the focused section
      if (focusedSection && cursorPositionRef.current?.section === focusedSection && selectedText) {
        const currentContent = content[focusedSection] || '';
        const beforeSelection = currentContent.slice(0, selectedText.start);
        const afterSelection = currentContent.slice(selectedText.end);
        const newContent = beforeSelection + data.transformedText + afterSelection;
        handleContentChange(focusedSection, newContent);
        setSelectedText(null);
        showMsg(`Text ${action}d successfully`, 'success');
      }

      return data.transformedText;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      showMsg(message, 'error');
      throw err;
    }
  }, [authToken, sessionId, focusedSection, content, selectedText, handleContentChange]);

  const handleGenerateFigure = useCallback(async (description: string) => {
    if (!authToken || !description.trim()) {
      throw new Error('Missing required parameters');
    }

    try {
      // First create the figure plan
      const createRes = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: description.slice(0, 100),
          description,
          category: 'AUTO',
          figureType: 'auto'
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || 'Failed to create figure');
      }

      // Then generate the figure
      const generateRes = await fetch(
        `/api/papers/${sessionId}/figures/${createData.figure.id}/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            description,
            useLLM: true,
            theme: 'academic'
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

  // Track text selection in textareas
  useEffect(() => {
    const handleSelectionChange = () => {
      if (focusedSection && textareaRefs.current[focusedSection]) {
        const textarea = textareaRefs.current[focusedSection];
        if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
          const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
          setSelectedText({
            text,
            start: textarea.selectionStart,
            end: textarea.selectionEnd
          });
        } else {
          setSelectedText(null);
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [focusedSection]);

  // ============================================================================
  // Generation
  // ============================================================================

  const generateSingleSection = useCallback(async (sectionKey: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      const instr = userInstructions[sectionKey];
      const instructions = instr?.isActive !== false ? instr?.instruction || '' : '';
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'generate_section', sectionKey, instructions, usePersonaStyle, personaSelection })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || 'Generation failed' };
      if (data.content) return { success: true, content: data.content };
      return { success: false, error: 'No content returned' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [sessionId, authToken, userInstructions, usePersonaStyle, personaSelection]);

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
          setViewMode(prev => ({ ...prev, [sectionKey]: 'preview' })); // Auto-switch to preview
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
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'generate_section', sectionKey, instructions: remarks, usePersonaStyle, personaSelection })
      });
      const data = await res.json();
      if (res.ok && data.content) {
        setContent(prev => ({ ...prev, [sectionKey]: data.content }));
        setViewMode(prev => ({ ...prev, [sectionKey]: 'preview' })); // Auto-switch to preview
        setRegenOpen(prev => ({ ...prev, [sectionKey]: false }));
        setRegenRemarks(prev => ({ ...prev, [sectionKey]: '' }));
        showMsg('Section regenerated', 'success');
        await refreshSession();
      } else {
        showMsg(data.error || 'Regeneration failed', 'error');
      }
    } catch {
      showMsg('Regeneration failed', 'error');
    } finally {
      setSectionLoading(prev => ({ ...prev, [sectionKey]: false }));
    }
  }, [sessionId, authToken, regenRemarks, usePersonaStyle, personaSelection, refreshSession]);

  // ============================================================================
  // Citations & Bibliography
  // ============================================================================

  // Insert a single citation at cursor position (used by sidebar CitationManager)
  const handleInsertSingleCitation = useCallback((citationKey: string) => {
    // Get target section - use focused section or cursor position
    const target = focusedSection || (sectionConfigs.length > 0 ? sectionConfigs[0].keys[0] : null);
    if (!target) return;

    const insertText = `[CITE:${citationKey}]`;
    const current = content[target] || '';
    
    // Check for cursor position
    const cursorInfo = cursorPositionRef.current;
    let updated: string;
    let newCursorPosition: number;
    
    if (cursorInfo && cursorInfo.section === target) {
      // Insert at cursor position
      const before = current.substring(0, cursorInfo.position);
      const after = current.substring(cursorInfo.position);
      updated = before + insertText + after;
      newCursorPosition = cursorInfo.position + insertText.length;
    } else {
      // Fallback: insert at end
      updated = current + ' ' + insertText;
      newCursorPosition = updated.length;
    }
    
    setContent(prev => ({ ...prev, [target]: updated }));
    setPendingChanges(prev => new Set(prev).add(target));
    setTimeout(() => saveSection(target, updated), 100);
    
    // Restore focus and cursor
    setTimeout(() => {
      const textarea = textareaRefs.current[target];
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
        cursorPositionRef.current = { section: target, position: newCursorPosition };
      }
    }, 50);
    
    showMsg(`Citation [${citationKey}] inserted`, 'success');
  }, [content, saveSection, focusedSection, sectionConfigs]);

  const handleInsertSelectedCitations = useCallback((keys: string[]) => {
    const target = insertCitationTargetRef.current;
    if (!target || keys.length === 0) return;
    
    const insertText = keys.map(k => `[CITE:${k}]`).join(' ');
    const current = content[target] || '';
    
    // Get cursor position - insert at cursor if available, otherwise at end
    const cursorInfo = cursorPositionRef.current;
    let updated: string;
    let newCursorPosition: number;
    
    if (cursorInfo && cursorInfo.section === target) {
      // Insert at cursor position
      const before = current.substring(0, cursorInfo.position);
      const after = current.substring(cursorInfo.position);
      updated = before + insertText + after;
      newCursorPosition = cursorInfo.position + insertText.length;
    } else {
      // Fallback: insert at end
      updated = current + ' ' + insertText;
      newCursorPosition = updated.length;
    }
    
    setContent(prev => ({ ...prev, [target]: updated }));
    setPendingChanges(prev => new Set(prev).add(target));
    setTimeout(() => saveSection(target, updated), 100);
    setPickerOpen(false);
    setInsertCitationTarget(null);
    insertCitationTargetRef.current = null;
    
    // Restore focus and cursor position to the textarea
    setTimeout(() => {
      const textarea = textareaRefs.current[target];
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }, 50);
  }, [content, saveSection]);

  // Extract citation keys from content (matches [CITE:key] patterns)
  const extractUsedCitationKeys = useCallback(() => {
    const allContent = Object.values(content).join(' ');
    const matches = allContent.match(/\[CITE:([^\]]+)\]/g) || [];
    const keys = matches.map(m => m.replace('[CITE:', '').replace(']', ''));
    // Return unique keys
    return [...new Set(keys)];
  }, [content]);

  const generateBibliography = useCallback(async () => {
    // Get only the citation keys that are actually used in the paper
    const usedCitationKeys = extractUsedCitationKeys();
    
    if (usedCitationKeys.length === 0) {
      showMsg('No citations found in the paper. Insert citations first using [CITE:key] format.', 'warning');
      return;
    }
    
    setGeneratingBibliography(true);
    try {
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ 
          action: 'generate_bibliography',
          citationKeys: usedCitationKeys,
          sortOrder: 'alphabetical'
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
        showMsg(`Bibliography generated for ${usedCitationKeys.length} citation(s)`, 'success');
    } else {
        showMsg('Failed to generate bibliography', 'error');
      }
    } catch {
      showMsg('Bibliography generation failed', 'error');
    } finally {
      setGeneratingBibliography(false);
    }
  }, [sessionId, authToken, sectionConfigs, saveSection]);

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
    setViewMode(prev => ({ ...prev, [sectionKey]: 'preview' })); // Auto-switch to preview
    saveSection(sectionKey, fixedContent);
  }, [saveSection]);

  // Copy section
  const copySection = (key: string) => {
    navigator.clipboard.writeText(content[key] || '');
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Total word count
  const totalWordCount = useMemo(() => Object.values(content).reduce((acc, c) => acc + computeWordCount(c), 0), [content]);

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
              <Tooltip content="Citations panel" position="bottom">
                <button onClick={() => setShowCitations(!showCitations)}
                  className={`p-2 rounded-lg border ${showCitations ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  <BookOpen className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip content="Text formatting" position="bottom">
                <div className="relative">
                  <button onClick={() => setShowFormatting(!showFormatting)}
                    className={`p-2 rounded-lg border ${showFormatting ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                  </button>
                  {showFormatting && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border rounded-xl shadow-xl z-50 p-4">
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Font</label>
                          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg">
                            <option value="serif">Serif</option><option value="sans-serif">Sans</option><option value="Georgia, serif">Georgia</option>
                          </select>
              </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Size</label>
                          <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg">
                            <option value="14px">14px</option><option value="15px">15px</option><option value="16px">16px</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-2">Line Height</label>
                          <select value={lineHeight} onChange={(e) => setLineHeight(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg">
                            <option value="1.5">1.5</option><option value="1.7">1.7</option><option value="2.0">2.0</option>
                          </select>
                        </div>
                        <button onClick={() => setShowFormatting(false)} className="w-full text-xs text-indigo-600 hover:text-indigo-800">Done</button>
                      </div>
                    </div>
                  )}
                </div>
              </Tooltip>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">{paperTypeCode}</span>
            </div>
              </div>
            </div>
          </div>

      {/* Citations Panel */}
          <AnimatePresence>
            {showCitations && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="fixed right-4 top-32 w-80 max-h-[60vh] bg-white rounded-xl shadow-2xl border z-40 overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-purple-500" />
                <span className="font-semibold text-gray-900">Citations ({citations.length})</span>
                    </div>
              <button onClick={() => setShowCitations(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
              <CitationManager sessionId={sessionId} authToken={authToken} citations={citations} onCitationsUpdated={setCitations} onInsertCitation={handleInsertSingleCitation} />
            </div>
            <div className="p-3 border-t space-y-2">
              <button onClick={() => { 
                  const targetSection = focusedSection || (sectionConfigs.length > 0 ? sectionConfigs[0].keys[0] : null);
                  if (targetSection) { 
                    insertCitationTargetRef.current = targetSection; 
                    setInsertCitationTarget(targetSection); 
                  } 
                  setPickerOpen(true); 
                }} 
                className="w-full flex items-center justify-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-700 py-2 border border-blue-200 rounded-lg hover:bg-blue-50">
                <Plus className="w-3 h-3" /> Add Citation
              </button>
              <button onClick={generateBibliography} disabled={generatingBibliography}
                className="w-full flex items-center justify-center gap-2 text-xs font-medium text-purple-600 hover:text-purple-700 py-2 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50"
                title="Generates bibliography only for citations used in the paper (via [CITE:key] markers)">
                {generatingBibliography ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                Generate Bibliography ({extractUsedCitationKeys().length} used)
              </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

      {/* Paper Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[1100px] px-[60px] py-[60px] relative border border-gray-100">
        {showActivity && (currentKeys || autoModeRunning) && (
          <div className="absolute top-4 right-4 z-10">
            <BackendActivityPanel isVisible={true} onClose={() => setShowActivity(false)}
              steps={(debugSteps || []).map((s: any) => ({ id: String(s.step || ''), state: s.status === 'fail' ? 'error' : (s.status || 'running') }))} />
        </div>
        )}

        <div className="space-y-10">
          {sections.map((section, idx) => {
            const isGenerating = loading && currentKeys?.some(k => section.keys.includes(k));
            const isRegenerating = section.keys.some(k => sectionLoading[k]);
            const isWorking = isGenerating || isRegenerating;
            const hasContent = section.keys.some(k => content[k]);
            const isSavingSection = section.keys.some(k => saving[k]);
            const hasPending = section.keys.some(k => pendingChanges.has(k));

            return (
              <div key={section.keys.join('|') || idx} className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg">
                {/* Section Header */}
                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                      {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                    </h3>
                    {/* Instruction controls */}
                    {(() => {
                      const key = section.keys[0];
                      const instr = userInstructions[key];
                      const hasInstr = !!instr?.instruction;
                      const isActive = instr?.isActive !== false;
                      return (
                        <div className="relative flex items-center gap-1">
                          {hasInstr && (
                            <span className={`text-[10px] px-2 py-1 rounded-full ${isActive ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                              {isActive ? 'INSTR ON' : 'INSTR OFF'}
                            </span>
                          )}
                          <button onClick={() => setInstructionPopoverKey(instructionPopoverKey === key ? null : key)}
                            className={`p-1.5 rounded-lg transition-colors ${hasInstr ? (isActive ? 'text-violet-600 bg-violet-50 hover:bg-violet-100' : 'text-gray-400 bg-gray-100') : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                            title={hasInstr ? 'Edit instruction' : 'Add instruction'}>
                            <svg className="w-4 h-4" fill={hasInstr ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
                          {instructionPopoverKey === key && (
                            <PaperSectionInstructionPopover sectionKey={key} sectionLabel={section.label || displayName[key] || key}
                              sessionId={session?.id || ''} paperTypeCode={paperTypeCode} existingInstruction={instr || null}
                              onSave={handleSaveInstruction} onClose={() => setInstructionPopoverKey(null)} />
                          )}
                        </div>
                      );
                    })()}
                    {/* Save indicator */}
                    {isSavingSection && <span className="text-xs text-amber-500 animate-pulse">Saving...</span>}
                    {hasPending && !isSavingSection && <span className="text-xs text-gray-400">Unsaved</span>}
                  </div>
                  {section.wordLimit && (
                    <span className="text-xs text-gray-400">{section.keys.reduce((acc, k) => acc + computeWordCount(content[k] || ''), 0)} / {section.wordLimit}</span>
                  )}
      </div>

                {/* Content Area - Always Editable */}
                <div className="text-gray-800 text-justify">
                  {!hasContent && !isWorking ? (
                    <div onClick={() => autoMode && !autoModeRunning ? handleAutoGenerateAll() : handleGenerate(section.keys)}
                      className={`border-2 border-dashed border-gray-100 rounded-lg p-8 text-center hover:border-indigo-100 hover:bg-indigo-50/30 cursor-pointer ${autoModeRunning ? 'opacity-50' : ''}`}>
                      <div className="text-gray-400 font-medium mb-1">{autoMode ? 'Auto-generate sections' : 'Section not generated'}</div>
                      <div className="text-xs text-gray-300">Click to draft with AI</div>
                    </div>
                  ) : (
                    <div>
                      {section.keys.map(keyName => (
                        <div key={keyName} className="mb-6 last:mb-0">
                          {section.keys.length > 1 && (
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-4">{displayName[keyName] || keyName}</h4>
                          )}
                          
                          {/* Section Toolbar */}
                          <div className="flex items-center justify-end gap-1 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Edit/Preview Toggle */}
                            {content[keyName] && (
                              <div className="flex items-center gap-0.5 mr-2 bg-gray-100 rounded-lg p-0.5">
                                <button 
                                  onClick={() => setViewMode(prev => ({ ...prev, [keyName]: 'edit' }))}
                                  className={`px-2 py-1 text-xs rounded-md transition-all ${
                                    (viewMode[keyName] || 'edit') === 'edit' 
                                      ? 'bg-white text-gray-900 shadow-sm' 
                                      : 'text-gray-500 hover:text-gray-700'
                                  }`}
                                  title="Edit mode"
                                >
                                  Edit
                                </button>
                                <button 
                                  onClick={() => setViewMode(prev => ({ ...prev, [keyName]: 'preview' }))}
                                  className={`px-2 py-1 text-xs rounded-md transition-all ${
                                    viewMode[keyName] === 'preview' 
                                      ? 'bg-white text-gray-900 shadow-sm' 
                                      : 'text-gray-500 hover:text-gray-700'
                                  }`}
                                  title="Preview formatted content"
                                >
                                  <Eye className="w-3 h-3 inline mr-1" />
                                  Preview
                                </button>
                              </div>
                            )}
                            <button onClick={() => { 
                                // Capture current cursor position from the textarea
                                const textarea = textareaRefs.current[keyName];
                                if (textarea) {
                                  cursorPositionRef.current = { section: keyName, position: textarea.selectionStart };
                                }
                                insertCitationTargetRef.current = keyName; 
                                setInsertCitationTarget(keyName); 
                                setPickerOpen(true); 
                              }}
                              className="p-1.5 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50" title="Insert citation">
                              <BookOpen className="w-4 h-4" />
                            </button>
                            <button onClick={() => copySection(keyName)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Copy">
                              {copiedKey === keyName ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button onClick={() => !sectionLoading[keyName] && setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                              className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50" title="Regenerate" disabled={sectionLoading[keyName]}>
                              <RefreshCw className="w-4 h-4" />
                            </button>
                            {!content[keyName] && (
                              <button onClick={() => handleGenerate([keyName])} disabled={loading || autoModeRunning}
                                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">Generate</button>
                            )}
                          </div>

                          {/* Selection Indicator - Shows when text is selected in this section */}
                          <AnimatePresence>
                            {selectedText && focusedSection === keyName && selectedText.text.length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                className="mb-2 p-2 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                    <span className="text-xs font-medium text-blue-700">
                                      {selectedText.text.length} characters selected
                                    </span>
                                    <span className="text-[10px] text-blue-500">
                                      ({selectedText.text.split(/\s+/).filter(Boolean).length} words)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-blue-500 bg-blue-100 px-2 py-0.5 rounded-full">
                                      Ready for AI actions →
                                    </span>
                                  </div>
                                </div>
                                <p className="mt-1.5 text-[11px] text-blue-600/80 line-clamp-1 italic">
                                  &ldquo;{selectedText.text.slice(0, 80)}{selectedText.text.length > 80 ? '...' : ''}&rdquo;
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Content Area - Edit mode (textarea) or Preview mode (formatted) */}
                          {viewMode[keyName] === 'preview' && content[keyName] ? (
                            // Preview Mode - Formatted Markdown (Elsevier/Academic Style)
                            <div 
                              className="relative p-6 bg-white rounded-lg border border-gray-200 min-h-[100px] cursor-pointer hover:border-gray-300 transition-colors shadow-sm"
                              onClick={() => setViewMode(prev => ({ ...prev, [keyName]: 'edit' }))}
                              title="Click to edit"
                            >
                              <MarkdownRenderer 
                                content={content[keyName]} 
                                className="text-gray-800"
                              />
                              <div className="absolute top-2 right-2 text-[10px] text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded">
                                <Eye className="w-3 h-3" />
                                Preview
                              </div>
                            </div>
                          ) : (
                            // Edit Mode - Textarea
                            <div className={`relative transition-all duration-200 rounded-lg ${
                              selectedText && focusedSection === keyName && selectedText.text.length > 0
                                ? 'ring-2 ring-blue-300 ring-offset-2 bg-blue-50/30'
                                : ''
                            }`}>
                            <AutoResizeTextarea
                              ref={(el) => { textareaRefs.current[keyName] = el; }}
                              value={content[keyName] || ''}
                              onChange={(e) => handleContentChange(keyName, e.target.value)}
                              onBlur={() => {
                                handleBlur(keyName);
                                // Switch back to preview mode after editing if there's content
                                if (content[keyName]) {
                                  setTimeout(() => setViewMode(prev => ({ ...prev, [keyName]: 'preview' })), 100);
                                }
                              }}
                              onFocus={() => setFocusedSection(keyName)}
                                onSelect={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  cursorPositionRef.current = { section: keyName, position: target.selectionStart };
                                }}
                                onKeyUp={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  cursorPositionRef.current = { section: keyName, position: target.selectionStart };
                                }}
                                onClick={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  cursorPositionRef.current = { section: keyName, position: target.selectionStart };
                                }}
                                placeholder={isWorking ? 'Generating...' : 'Start typing or click Generate to create content...\n\nTip: Use ### for subsections and - for bullet points'}
                                className={`w-full border-0 bg-transparent p-0 text-gray-800 focus:ring-0 focus:outline-none placeholder-gray-300 text-justify ${
                                  selectedText && focusedSection === keyName && selectedText.text.length > 0 ? 'selection:bg-blue-200 selection:text-blue-900' : ''
                                }`}
                                style={{ fontFamily, fontSize, lineHeight }}
                                disabled={isWorking}
                                minHeight={content[keyName] ? 50 : 100}
                              />
                            </div>
                          )}

                          {/* Referenced Figures Bar - Shows clickable thumbnails */}
                          {(() => {
                            const referencedFigs = getReferencedFigures(content[keyName] || '');
                            if (referencedFigs.length === 0) return null;
                            
                            return (
                              <div className="mt-3 p-2 bg-gradient-to-r from-violet-50 to-indigo-50 rounded-lg border border-violet-100">
                                <div className="flex items-center gap-2 mb-2">
                                  <ImageIcon className="w-3.5 h-3.5 text-violet-600" />
                                  <span className="text-xs font-medium text-violet-700">
                                    Referenced Figures ({referencedFigs.length})
                                  </span>
                                  <span className="text-[10px] text-violet-500">• Click to preview</span>
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
                                      className="group relative flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg border border-violet-200 hover:border-violet-400 hover:shadow-md transition-all"
                                    >
                                      {/* Thumbnail */}
                                      <div className="w-10 h-10 rounded overflow-hidden bg-slate-100 flex-shrink-0">
                                        {fig.imagePath ? (
                                          <img 
                                            src={fig.imagePath} 
                                            alt={fig.title}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <ImageIcon className="w-4 h-4 text-slate-300" />
                                          </div>
                                        )}
                                      </div>
                                      {/* Label */}
                                      <div className="text-left">
                                        <p className="text-xs font-medium text-slate-700">Figure {fig.figureNo}</p>
                                        <p className="text-[10px] text-slate-500 max-w-[120px] truncate">{fig.title}</p>
                                      </div>
                                      {/* Hover Icon */}
                                      <Eye className="w-3.5 h-3.5 text-violet-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Regeneration Dialog */}
                          {regenOpen[keyName] && (
                            <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 shadow-sm">
                              <div className="flex items-center gap-2 mb-2">
                                <RefreshCw className="w-4 h-4 text-indigo-600" />
                                <label className="text-xs font-semibold text-indigo-900">Refinement Instructions</label>
                              </div>
                              <textarea
                                className="w-full border-indigo-200 rounded-md p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                                value={regenRemarks[keyName] || ''}
                                onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                placeholder="E.g., 'Make it more concise', 'Add more citations'..."
                                rows={3}
                              />
                              <div className="flex justify-end gap-2 mt-3">
                                <button onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded border border-transparent hover:border-gray-200">Cancel</button>
                                <button onClick={() => handleRegenerateSection(keyName)} disabled={sectionLoading[keyName]}
                                  className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm disabled:opacity-50 flex items-center gap-2">
                                  {sectionLoading[keyName] && <Loader2 className="w-3 h-3 animate-spin" />}
                                  {sectionLoading[keyName] ? 'Regenerating...' : 'Regenerate'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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
        instructions={userInstructions} onSaveAll={(newInstr) => setUserInstructions(newInstr)} />

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
        onInsertFigure={handleInsertFigure}
        onInsertCitation={(citation) => {
          // Directly insert citation without opening modal
          if (citation.citationKey) {
            handleInsertSingleCitation(citation.citationKey);
          }
        }}
        onTextAction={handleTextAction}
        onGenerateFigure={handleGenerateFigure}
        selectedText={selectedText}
        onRefreshFigures={loadFigures}
        isVisible={true}
      />
    </div>
  );
}
