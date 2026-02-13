'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Loader2, 
  AlertCircle,
  BookOpen,
  Move,
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
import PaperMarkdownEditor, {
  type PaperMarkdownEditorRef,
  type PaperCitationDisplayMeta
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

type CitationsPanelResizeDirection = 'corner' | 'left' | 'bottom' | 'top' | 'top-left-corner';

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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
  const [showCitations, setShowCitations] = useState(false);
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
  const [citationsPanelPosition, setCitationsPanelPosition] = useState({ x: 24, y: 24 });
  const [citationsPanelSize, setCitationsPanelSize] = useState({ width: 320, height: 540 });
  const [isCitationsPanelDragging, setIsCitationsPanelDragging] = useState(false);
  const [isCitationsPanelResizing, setIsCitationsPanelResizing] = useState(false);
  const [showCitationToolsMenu, setShowCitationToolsMenu] = useState(false);
  const citationsPanelInitializedRef = useRef(false);
  const citationToolsMenuRef = useRef<HTMLDivElement | null>(null);
  const citationsPanelDragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);
  const citationsPanelResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

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

  const getViewportBounds = useCallback(() => {
    if (typeof window === 'undefined') {
      return { width: 1440, height: 900 };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }, []);

  const clampCitationsPanelSize = useCallback((size: { width: number; height: number }) => {
    const { width: viewportWidth, height: viewportHeight } = getViewportBounds();
    const minWidth = 300;
    const minHeight = 380;
    const maxWidth = Math.max(minWidth, viewportWidth - 16);
    const maxHeight = Math.max(minHeight, viewportHeight - 16);
    return {
      width: Math.max(minWidth, Math.min(maxWidth, size.width)),
      height: Math.max(minHeight, Math.min(maxHeight, size.height)),
    };
  }, [getViewportBounds]);

  const clampCitationsPanelPosition = useCallback((
    position: { x: number; y: number },
    sizeOverride?: { width: number; height: number }
  ) => {
    const { width: viewportWidth, height: viewportHeight } = getViewportBounds();
    const panelSize = sizeOverride ?? citationsPanelSize;
    const minX = 8;
    const minY = 8;
    const maxX = Math.max(minX, viewportWidth - panelSize.width - 8);
    const maxY = Math.max(minY, viewportHeight - panelSize.height - 8);
    return {
      x: Math.max(minX, Math.min(maxX, position.x)),
      y: Math.max(minY, Math.min(maxY, position.y)),
    };
  }, [citationsPanelSize, getViewportBounds]);

  const resetCitationsPanelLayout = useCallback(() => {
    const defaultSize = clampCitationsPanelSize({ width: 320, height: 540 });
    const { width: viewportWidth } = getViewportBounds();
    const defaultPosition = clampCitationsPanelPosition(
      { x: viewportWidth - defaultSize.width - 24, y: 24 },
      defaultSize
    );
    setCitationsPanelSize(defaultSize);
    setCitationsPanelPosition(defaultPosition);
  }, [clampCitationsPanelPosition, clampCitationsPanelSize, getViewportBounds]);

  const openCitationsPanel = useCallback((options?: { reset?: boolean }) => {
    const shouldReset = options?.reset === true;
    if (shouldReset) {
      resetCitationsPanelLayout();
      setShowCitations(true);
      return;
    }

    setCitationsPanelSize((prevSize) => {
      const safeSize = Number.isFinite(prevSize.width) && Number.isFinite(prevSize.height)
        ? prevSize
        : { width: 320, height: 540 };
      const nextSize = clampCitationsPanelSize(safeSize);
      setCitationsPanelPosition((prevPos) => {
        const safePos = Number.isFinite(prevPos.x) && Number.isFinite(prevPos.y)
          ? prevPos
          : { x: 24, y: 24 };
        return clampCitationsPanelPosition(safePos, nextSize);
      });
      return nextSize;
    });
    setShowCitations(true);
  }, [clampCitationsPanelPosition, clampCitationsPanelSize, resetCitationsPanelLayout]);

  const handleCitationsPanelDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    citationsPanelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startPosX: citationsPanelPosition.x,
      startPosY: citationsPanelPosition.y,
    };
    setIsCitationsPanelDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!citationsPanelDragRef.current) return;
      const deltaX = moveEvent.clientX - citationsPanelDragRef.current.startX;
      const deltaY = moveEvent.clientY - citationsPanelDragRef.current.startY;
      setCitationsPanelPosition(clampCitationsPanelPosition({
        x: citationsPanelDragRef.current.startPosX + deltaX,
        y: citationsPanelDragRef.current.startPosY + deltaY,
      }));
    };

    const handleMouseUp = () => {
      setIsCitationsPanelDragging(false);
      citationsPanelDragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [citationsPanelPosition.x, citationsPanelPosition.y, clampCitationsPanelPosition]);

  const handleCitationsPanelResizeStart = useCallback((
    event: React.MouseEvent<HTMLDivElement>,
    direction: CitationsPanelResizeDirection
  ) => {
    event.preventDefault();
    event.stopPropagation();
    citationsPanelResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: citationsPanelSize.width,
      startHeight: citationsPanelSize.height,
      startPosX: citationsPanelPosition.x,
      startPosY: citationsPanelPosition.y,
    };
    setIsCitationsPanelResizing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!citationsPanelResizeRef.current) return;
      const deltaX = moveEvent.clientX - citationsPanelResizeRef.current.startX;
      const deltaY = moveEvent.clientY - citationsPanelResizeRef.current.startY;
      let nextWidth = citationsPanelResizeRef.current.startWidth;
      let nextHeight = citationsPanelResizeRef.current.startHeight;
      let nextX = citationsPanelResizeRef.current.startPosX;
      let nextY = citationsPanelResizeRef.current.startPosY;

      if (direction === 'corner' || direction === 'left' || direction === 'top-left-corner') {
        nextWidth = citationsPanelResizeRef.current.startWidth - deltaX;
      }
      if (direction === 'corner' || direction === 'bottom') {
        nextHeight = citationsPanelResizeRef.current.startHeight + deltaY;
      }
      if (direction === 'top' || direction === 'top-left-corner') {
        nextHeight = citationsPanelResizeRef.current.startHeight - deltaY;
      }

      const constrainedSize = clampCitationsPanelSize({ width: nextWidth, height: nextHeight });

      if (direction === 'corner' || direction === 'left' || direction === 'top-left-corner') {
        nextX = citationsPanelResizeRef.current.startPosX
          + (citationsPanelResizeRef.current.startWidth - constrainedSize.width);
      }
      if (direction === 'top' || direction === 'top-left-corner') {
        nextY = citationsPanelResizeRef.current.startPosY
          + (citationsPanelResizeRef.current.startHeight - constrainedSize.height);
      }

      const constrainedPosition = clampCitationsPanelPosition({ x: nextX, y: nextY }, constrainedSize);
      setCitationsPanelSize(constrainedSize);
      setCitationsPanelPosition(constrainedPosition);
    };

    const handleMouseUp = () => {
      setIsCitationsPanelResizing(false);
      citationsPanelResizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [
    citationsPanelPosition.x,
    citationsPanelPosition.y,
    citationsPanelSize.height,
    citationsPanelSize.width,
    clampCitationsPanelPosition,
    clampCitationsPanelSize
  ]);

  useEffect(() => {
    if (!showCitations || citationsPanelInitializedRef.current) return;
    resetCitationsPanelLayout();
    citationsPanelInitializedRef.current = true;
  }, [showCitations, resetCitationsPanelLayout]);

  useEffect(() => {
    if (showCitations) return;
    setShowCitationToolsMenu(false);
  }, [showCitations]);

  useEffect(() => {
    if (!showCitationToolsMenu) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (citationToolsMenuRef.current?.contains(event.target as Node)) return;
      setShowCitationToolsMenu(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showCitationToolsMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setCitationsPanelSize((prev) => {
        const next = clampCitationsPanelSize(prev);
        setCitationsPanelPosition((prevPos) => clampCitationsPanelPosition(prevPos, next));
        if (next.width === prev.width && next.height === prev.height) return prev;
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampCitationsPanelPosition, clampCitationsPanelSize]);

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

  useEffect(() => { loadSession(); loadCitations(); loadFigures(); }, [loadSession, loadCitations, loadFigures]);

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
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'generate_section',
          sectionKey,
          instructions,
          useMappedEvidence,
          usePersonaStyle,
          personaSelection
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const disallowed = Array.isArray(data?.citationValidation?.disallowedKeys)
          ? data.citationValidation.disallowedKeys as string[]
          : [];
        const unknown = Array.isArray(data?.citationValidation?.unknownKeys)
          ? data.citationValidation.unknownKeys as string[]
          : [];
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
      if (data.content) return { success: true, content: data.content };
      return { success: false, error: 'No content returned' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [sessionId, authToken, userInstructions, usePersonaStyle, personaSelection, isMappedEvidenceEnabled]);

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
      const res = await fetch(`/api/papers/${sessionId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          action: 'generate_section',
          sectionKey,
          instructions: remarks,
          useMappedEvidence,
          usePersonaStyle,
          personaSelection
        })
      });
      const data = await res.json();
      if (res.ok && data.content) {
        setContent(prev => ({ ...prev, [sectionKey]: data.content }));
        // REMOVED: Auto-switch to preview - stay in edit mode
        setRegenOpen(prev => ({ ...prev, [sectionKey]: false }));
        setRegenRemarks(prev => ({ ...prev, [sectionKey]: '' }));
        showMsg('Section regenerated', 'success');
        await refreshSession();
      } else {
        const disallowed = Array.isArray(data?.citationValidation?.disallowedKeys)
          ? data.citationValidation.disallowedKeys as string[]
          : [];
        const unknown = Array.isArray(data?.citationValidation?.unknownKeys)
          ? data.citationValidation.unknownKeys as string[]
          : [];
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
  }, [sessionId, authToken, regenRemarks, usePersonaStyle, personaSelection, refreshSession, isMappedEvidenceEnabled]);

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

  const generateBibliography = useCallback(async () => {
    // Prefer explicit placeholders from draft content.
    const extractedCitationKeys = extractUsedCitationKeys();
    // Fallback for legacy drafts where placeholders were previously rendered as plain text spans.
    const usageFallbackKeys = citations
      .filter((citation) => {
        const usageCount = Number(citation?.usageCount || 0);
        const hasUsages = Array.isArray(citation?.usages) && citation.usages.length > 0;
        return usageCount > 0 || hasUsages;
      })
      .map((citation) => String(citation?.citationKey || '').trim())
      .filter(Boolean);
    const usedCitationKeys = extractedCitationKeys.length > 0
      ? extractedCitationKeys
      : Array.from(new Set(usageFallbackKeys));

    if (usedCitationKeys.length === 0) {
      showMsg('No citations found in the paper. Insert citations first using [CITE:key] format.', 'warning');
      return;
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
          citationKeys: usedCitationKeys,
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
        const recoveryLabel = extractedCitationKeys.length === 0 && usageFallbackKeys.length > 0
          ? ', recovered from usage metadata'
          : '';
        showMsg(
          `Bibliography generated (${bibliographyStyle}, ${usedCount} citations${sequenceLabel}${deltaLabel}${recoveryLabel})`,
          'success'
        );
        await loadCitations();
      } else {
        showMsg('Failed to generate bibliography', 'error');
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
                <button onClick={() => {
                    if (showCitations) {
                      setShowCitations(false);
                      return;
                    }
                    openCitationsPanel();
                  }}
                  className={`p-2 rounded-lg border ${showCitations ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  <BookOpen className="w-4 h-4" />
                </button>
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
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            style={{
              left: citationsPanelPosition.x,
              top: citationsPanelPosition.y,
              width: citationsPanelSize.width,
              height: citationsPanelSize.height,
            }}
            className={`fixed bg-white rounded-xl shadow-2xl border z-[120] overflow-hidden flex flex-col ${
              isCitationsPanelDragging || isCitationsPanelResizing ? 'select-none' : ''
            }`}
          >
            <div
              className={`p-3 border-b flex items-center justify-between bg-white/95 backdrop-blur-sm ${
                isCitationsPanelDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onMouseDown={handleCitationsPanelDragStart}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Move className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <BookOpen className="w-4 h-4 text-purple-500 flex-shrink-0" />
                <span className="font-semibold text-gray-900 truncate">Citations ({citations.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={resetCitationsPanelLayout}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                  title="Reset panel layout"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setShowCitations(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                  title="Close citations panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-0">
              <CitationManager
                sessionId={sessionId}
                authToken={authToken}
                citations={citations}
                onCitationsUpdated={setCitations}
                onInsertCitation={handleInsertSingleCitation}
                usageFilterAction={
                  <div
                    ref={citationToolsMenuRef}
                    className="relative"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setShowCitationToolsMenu((prev) => !prev)}
                      className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${
                        showCitationToolsMenu
                          ? 'bg-purple-50 border-purple-200 text-purple-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                      title="Citation tools"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                    </button>
                    <AnimatePresence>
                      {showCitationToolsMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -6, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.98 }}
                          transition={{ duration: 0.14 }}
                          className="absolute right-0 top-[calc(100%+8px)] z-[130] w-[290px] rounded-xl border border-gray-200 bg-white shadow-xl p-3 space-y-2"
                        >
                          <button
                            onClick={() => {
                              const activeSections = sectionConfigs || fallbackSections;
                              const targetSection = focusedSection || (activeSections.length > 0 ? activeSections[0].keys[0] : null);
                              if (targetSection) {
                                insertCitationTargetRef.current = targetSection;
                                setInsertCitationTarget(targetSection);
                              }
                              setPickerOpen(true);
                              setShowCitationToolsMenu(false);
                            }}
                            className="w-full flex items-center justify-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-700 py-2 border border-blue-200 rounded-lg hover:bg-blue-50"
                          >
                            <Plus className="w-3 h-3" /> Add Citation
                          </button>

                          <div className="space-y-1.5 pt-1">
                            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Citation Style</label>
                            <select
                              value={bibliographyStyle}
                              onChange={(e) => setBibliographyStyle(e.target.value)}
                              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:border-purple-300 focus:ring-1 focus:ring-purple-200"
                            >
                              <option value="APA7">APA 7th Edition</option>
                              <option value="IEEE">IEEE</option>
                              <option value="CHICAGO_AUTHOR_DATE">Chicago (Author-Date)</option>
                              <option value="MLA9">MLA 9th Edition</option>
                              <option value="HARVARD">Harvard</option>
                              <option value="VANCOUVER">Vancouver</option>
                            </select>
                            <div className="flex gap-1">
                              <button
                                onClick={() => setBibliographySortOrder('alphabetical')}
                                disabled={isNumericOrderBibliography}
                                className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                                  bibliographySortOrder === 'alphabetical'
                                    ? 'bg-purple-50 border-purple-200 text-purple-700 font-medium'
                                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                } ${isNumericOrderBibliography ? 'opacity-40 cursor-not-allowed hover:bg-white' : ''}`}
                              >
                                A-&gt;Z Alphabetical
                              </button>
                              <button
                                onClick={() => setBibliographySortOrder('order_of_appearance')}
                                className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                                  bibliographySortOrder === 'order_of_appearance'
                                    ? 'bg-purple-50 border-purple-200 text-purple-700 font-medium'
                                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                1-&gt;N Appearance
                              </button>
                            </div>
                            {isNumericOrderBibliography && (
                              <p className="text-[10px] text-slate-500">
                                IEEE/Vancouver uses order-of-appearance numbering by first citation in the draft.
                              </p>
                            )}
                            {isNumericOrderBibliography && sequenceInfo && (
                              <p className="text-[10px] text-slate-500">
                                Sequence {sequenceInfo.version ? `v${sequenceInfo.version}` : 'unversioned'} | snapshots {sequenceInfo.historyCount}
                                {sequenceInfo.changed
                                  ? ` | delta +${sequenceInfo.added}/-${sequenceInfo.removed}, renumbered ${sequenceInfo.renumbered}`
                                  : ' | no numbering changes'}
                              </p>
                            )}
                          </div>

                          <button
                            onClick={() => {
                              setShowCitationToolsMenu(false);
                              generateBibliography();
                            }}
                            disabled={generatingBibliography}
                            className="w-full flex items-center justify-center gap-2 text-xs font-medium text-purple-600 hover:text-purple-700 py-2 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50"
                            title="Generates bibliography only for citations used in the paper (via [CITE:key] markers)"
                          >
                            {generatingBibliography ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                            Generate Bibliography ({extractUsedCitationKeys().length} used)
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                }
              />
            </div>

            <div
              onMouseDown={(e) => handleCitationsPanelResizeStart(e, 'left')}
              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize group"
            >
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div
              onMouseDown={(e) => handleCitationsPanelResizeStart(e, 'top')}
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize group"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div
              onMouseDown={(e) => handleCitationsPanelResizeStart(e, 'bottom')}
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize group"
            >
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-8 bg-slate-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div
              onMouseDown={(e) => handleCitationsPanelResizeStart(e, 'top-left-corner')}
              className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize group z-10"
            >
              <div className="absolute top-1 left-1 w-2 h-2 border-l-2 border-t-2 border-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div
              onMouseDown={(e) => handleCitationsPanelResizeStart(e, 'corner')}
              className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize group z-10"
            >
              <div className="absolute bottom-1 left-1 w-2 h-2 border-l-2 border-b-2 border-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
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
            const primarySectionKey = section.keys[0] || '';
            const citationEligibleKeys = section.keys.filter(k => isCitationEligibleForSection(k));
            const showCitationToggle = citationEligibleKeys.length > 0;
            const mappedEvidenceEnabled = showCitationToggle
              ? citationEligibleKeys.every(k => isMappedEvidenceEnabled(k))
              : false;

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
                    {primarySectionKey && showCitationToggle && (
                      <label
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-700"
                        title="When enabled, AI uses mapped dimension evidence and citation whitelist for this section."
                      >
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={mappedEvidenceEnabled}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setMappedEvidenceBySection(prev => {
                              const next = { ...prev };
                              for (const key of citationEligibleKeys) {
                                next[normalizeSectionKey(key)] = checked;
                              }
                              return next;
                            });
                          }}
                        />
                        Auto citations
                      </label>
                    )}
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
                            {/* REMOVED: Edit/Preview Toggle - always in edit mode for stability */}
                            <button onClick={() => {
                                setFocusedSection(keyName);
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

                          {/* Selection Indicator - Simple inline badge, no layout shift */}

                          {/* Content Area - Always in edit mode for stability */}
                          <div className="relative">
                            <PaperMarkdownEditor
                              ref={(editor) => { editorRefs.current[keyName] = editor; }}
                              value={content[keyName] || ''}
                              onChange={(markdown) => handleContentChange(keyName, markdown)}
                              citationDisplayMeta={citationDisplayMeta}
                              onBlur={() => {
                                handleBlur(keyName);
                                // NOTE: Do NOT clear selectedText on blur.
                                // When the user clicks a FloatingWritingPanel button, the editor
                                // blurs first. Clearing selectedText here would disable the
                                // action buttons before the click handler fires.
                                // Selection is properly cleared by onSelectionChange when the
                                // user collapses the selection inside the editor.
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
                                // Save selection in editor ref so it persists across blur
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
        instructions={userInstructions} onSaveAll={(newInstr) => setUserInstructions(newInstr as Record<string, UserInstruction>)} />

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
          // Directly insert citation without opening modal
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
        onOpenBibliographyPanel={() => openCitationsPanel({ reset: true })}
        isVisible={true}
      />
    </div>
  );
}
