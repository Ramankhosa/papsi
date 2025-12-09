'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import BackendActivityPanel from './BackendActivityPanel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import plantumlEncoder from 'plantuml-encoder'
import SectionInstructionPopover from './SectionInstructionPopover'
import AllInstructionsModal from './AllInstructionsModal'
import WritingSamplesModal from './WritingSamplesModal'
import PersonaManager, { type PersonaSelection } from './PersonaManager'
import InlineSectionValidator from './InlineSectionValidator'
import type { ValidationIssue as UnifiedValidationIssue } from '@/types/validation'

// ============================================================================
// AI Review Issue Type
// ============================================================================

interface AIReviewIssue {
  id: string
  sectionKey: string
  sectionLabel: string
  type: 'error' | 'warning' | 'suggestion'
  category: 'consistency' | 'diagram' | 'completeness' | 'legal' | 'clarity' | 'translation'
  title: string
  description: string
  suggestion: string
  fixPrompt: string
  relatedSections?: string[]
  severity: number
}

interface ValidationIssue {
  sectionKey: string
  type: 'error' | 'warning' | 'info'
  rule: string
  message: string
  actual?: number
  limit?: number
}

// ============================================================================
// Inline Diff View Component - Shows changes between original and revised text
// ============================================================================

function InlineDiffView({ original, revised }: { original: string; revised: string }) {
  // Simple word-level diff for highlighting changes
  const computeDiff = useMemo(() => {
    try {
      if (!original && !revised) return []
      if (!original) return [{ type: 'add' as const, text: revised }]
      if (!revised) return [{ type: 'remove' as const, text: original }]
      
      // Performance safeguard: for very long content, skip detailed diff
      const MAX_CHARS_FOR_DIFF = 30000
      if (original.length > MAX_CHARS_FOR_DIFF || revised.length > MAX_CHARS_FOR_DIFF) {
        return [{ 
          type: 'same' as const, 
          text: '⚠️ Content too long for detailed diff view. Please compare the Original and Revised panels above.' 
        }]
      }
      
      // If content is identical, show message
      if (original === revised) {
        return [{ type: 'same' as const, text: '(No changes - content is identical)' }]
      }
      
      // Split into words while preserving whitespace
      const originalWords = original.split(/(\s+)/)
      const revisedWords = revised.split(/(\s+)/)
      
      // Additional safeguard: limit word count for diff algorithm
      const MAX_WORDS = 2000
      if (originalWords.length > MAX_WORDS || revisedWords.length > MAX_WORDS) {
        return [{ 
          type: 'same' as const, 
          text: '⚠️ Content has too many words for detailed diff. Please compare the Original and Revised panels above.' 
        }]
      }
      
      const result: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
      
      // Simple LCS-based diff algorithm
      const lcs = (a: string[], b: string[]): number[][] => {
        const m = a.length, n = b.length
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
        
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
              dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
              dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
            }
          }
        }
        return dp
      }
      
      // Iterative backtrack to avoid stack overflow on large inputs
      const backtrackIterative = (dp: number[][], a: string[], b: string[]): void => {
        let i = a.length
        let j = b.length
        const stack: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = []
        
        while (i > 0 || j > 0) {
          if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            stack.push({ type: 'same', text: a[i - 1] })
            i--
            j--
          } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'add', text: b[j - 1] })
            j--
          } else if (i > 0) {
            stack.push({ type: 'remove', text: a[i - 1] })
            i--
          }
        }
        
        // Reverse to get correct order
        while (stack.length > 0) {
          result.push(stack.pop()!)
        }
      }
      
      const dp = lcs(originalWords, revisedWords)
      backtrackIterative(dp, originalWords, revisedWords)
      
      // Merge consecutive same-type segments
      const merged: typeof result = []
      for (const segment of result) {
        if (merged.length > 0 && merged[merged.length - 1].type === segment.type) {
          merged[merged.length - 1].text += segment.text
        } else {
          merged.push({ ...segment })
        }
      }
      
      return merged
    } catch (error) {
      console.error('Diff computation failed:', error)
      // Fallback: show revised content without diff highlighting
      return [{ type: 'same' as const, text: '⚠️ Could not compute diff. Showing revised content in the panel above.' }]
    }
  }, [original, revised])
  
  if (computeDiff.length === 0) {
    return <span className="text-gray-400 italic">No changes detected</span>
  }
  
  return (
    <div className="text-sm leading-relaxed">
      {computeDiff.map((segment, idx) => {
        if (segment.type === 'same') {
          return <span key={idx} className="text-gray-700">{segment.text}</span>
        } else if (segment.type === 'add') {
          return (
            <span 
              key={idx} 
              className="bg-emerald-200 text-emerald-900 px-0.5 rounded"
              title="Added"
            >
              {segment.text}
            </span>
          )
        } else {
          return (
            <span 
              key={idx} 
              className="bg-red-200 text-red-900 line-through px-0.5 rounded"
              title="Removed"
            >
              {segment.text}
            </span>
          )
        }
      })}
    </div>
  )
}

// ============================================================================
// Comprehensive Validation Panel Component
// ============================================================================

interface ValidationPanelProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
  onFix: (sectionKey: string, fixedContent: string) => void
  onProceedToExport: () => void
  /** Callback to sync AI issues to inline section validators */
  onAIIssuesChange?: (issues: AIReviewIssue[]) => void
}

function ValidationPanel({ 
  sessionId, 
  jurisdiction, 
  patentId, 
  draft, 
  onFix,
  onProceedToExport,
  onAIIssuesChange 
}: ValidationPanelProps) {
  // Numerical validation state
  const [numericIssues, setNumericIssues] = useState<ValidationIssue[]>([])
  const [numericLoading, setNumericLoading] = useState(false)
  
  // AI Review state
  const [aiIssues, setAiIssues] = useState<AIReviewIssue[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSummary, setAiSummary] = useState<{
    totalIssues: number
    errors: number
    warnings: number
    suggestions: number
    overallScore: number
    recommendation: string
  } | null>(null)
  const [currentReviewId, setCurrentReviewId] = useState<string | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  
  // Fix state
  const [fixingIssue, setFixingIssue] = useState<string | null>(null)
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set())
  
  // Fix preview state - shows diff before applying
  const [pendingFix, setPendingFix] = useState<{
    issue: AIReviewIssue
    sectionKey: string
    originalContent: string
    fixedContent: string
  } | null>(null)
  
  // Last review timestamps
  const [lastNumericCheck, setLastNumericCheck] = useState<string | null>(null)
  const [lastAICheck, setLastAICheck] = useState<string | null>(null)

  // Load existing reviews on mount/jurisdiction change
  useEffect(() => {
    const loadExistingReviews = async () => {
      if (!sessionId || !jurisdiction || !patentId) return
      setLoadingExisting(true)
      try {
        const res = await fetch(`/api/patents/${patentId}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'get_ai_reviews',
            sessionId,
            jurisdiction
          })
        })
        const data = await res.json()
        if (data.success && data.latest?.[jurisdiction.toUpperCase()]) {
          const latestReview = data.latest[jurisdiction.toUpperCase()]
          const issues = latestReview.issues || []
          // Restore review state
          setAiIssues(issues)
          setAiSummary(latestReview.summary || null)
          setCurrentReviewId(latestReview.id)
          setLastAICheck(new Date(latestReview.reviewedAt).toLocaleTimeString())
          // Restore ignored and applied fixes
          const ignored = new Set<string>(
            Array.isArray(latestReview.ignoredIssues) ? latestReview.ignoredIssues : []
          )
          setIgnoredIssues(ignored)
          const applied = new Set<string>(
            Array.isArray(latestReview.appliedFixes) 
              ? latestReview.appliedFixes.map((f: any) => f.issueId)
              : []
          )
          setAppliedFixes(applied)
          // Sync AI issues to inline section validators
          onAIIssuesChange?.(issues)
        }
      } catch (err) {
        console.error('Failed to load existing reviews:', err)
      } finally {
        setLoadingExisting(false)
      }
    }

    loadExistingReviews()
  }, [sessionId, jurisdiction, patentId, onAIIssuesChange])

  // Run numerical validation
  const runNumericValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setNumericLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setNumericIssues(data.issues)
        setLastNumericCheck(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Numeric validation error:', err)
    } finally {
      setNumericLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Track if AI review is a Pro feature (for UI display)
  const [aiReviewUpgradeRequired, setAiReviewUpgradeRequired] = useState(false)

  // Run AI review
  const runAIReview = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setAiLoading(true)
    setAiReviewUpgradeRequired(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'run_ai_review',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.success) {
        const issues = data.issues || []
        setAiIssues(issues)
        setAiSummary(data.summary || null)
        setCurrentReviewId(data.reviewId || null)
        setLastAICheck(new Date().toLocaleTimeString())
        // Reset ignored/applied for new review
        setIgnoredIssues(new Set())
        setAppliedFixes(new Set())
        // Sync AI issues to inline section validators
        onAIIssuesChange?.(issues)
      } else if (data.upgradeRequired) {
        // Pro feature - show upgrade message
        setAiReviewUpgradeRequired(true)
        setAiSummary({
          overallScore: 0,
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          recommendation: 'AI Review is a Pro feature. Upgrade your plan to access AI-powered patent review with comprehensive analysis of claims consistency, diagram alignment, and legal compliance.'
        })
      } else {
        alert(`AI Review failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('AI review error:', err)
      alert('Failed to run AI review. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft, onAIIssuesChange])

  // Generate fix preview for an AI issue (shows diff before applying)
  const generateFixPreview = useCallback(async (issue: AIReviewIssue) => {
    if (!sessionId || !jurisdiction || !patentId) return
    setFixingIssue(issue.id)
    try {
      // Get related content if needed
      const relatedContent: Record<string, string> = {}
      if (issue.relatedSections) {
        for (const key of issue.relatedSections) {
          if (draft[key]) relatedContent[key] = draft[key]
        }
      }

      const originalContent = draft[issue.sectionKey] || ''

      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'apply_ai_fix',
          sessionId,
          jurisdiction,
          sectionKey: issue.sectionKey,
          issue,
          currentContent: originalContent,
          relatedContent,
          previewOnly: true // Signal that we want preview, not direct apply
        })
      })
      const data = await res.json()
      if (data.success && data.fixedContent) {
        // Show the diff preview instead of applying immediately
        setPendingFix({
          issue,
          sectionKey: issue.sectionKey,
          originalContent,
          fixedContent: data.fixedContent
        })
      } else if (data.upgradeRequired) {
        alert('AI Fix is a Pro feature. Please upgrade your plan to apply AI-suggested fixes automatically.')
      } else {
        alert(`Failed to generate fix: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Generate fix preview error:', err)
      alert('Failed to generate fix preview. Please try again.')
    } finally {
      setFixingIssue(null)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  // Approve and apply the pending fix
  const approveFix = useCallback(() => {
    if (!pendingFix) return
    
    const { issue, sectionKey, fixedContent } = pendingFix
    
    // Apply the fix
    onFix(sectionKey, fixedContent)
    
    // Track the applied fix locally
    setAppliedFixes(prev => new Set([...Array.from(prev), issue.id]))
    
    // Remove the fixed issue from the list and sync to inline validators
    // Using functional update to ensure we have the latest state
    setAiIssues(prev => {
      const updatedIssues = prev.filter(i => i.id !== issue.id)
      // Sync to inline validators with the updated list (not stale state)
      onAIIssuesChange?.(updatedIssues)
      return updatedIssues
    })
    
    // Clear the pending fix
    setPendingFix(null)
  }, [pendingFix, onFix, onAIIssuesChange])

  // Reject the pending fix
  const rejectFix = useCallback(() => {
    setPendingFix(null)
  }, [])

  // Ignore an issue (persists to backend)
  const ignoreIssue = useCallback(async (issueId: string) => {
    // Update local state immediately
    setIgnoredIssues(prev => new Set(Array.from(prev).concat(issueId)))
    
    // Persist to backend
    try {
      await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'ignore_ai_issue',
          sessionId,
          jurisdiction,
          issueId,
          reviewId: currentReviewId
        })
      })
    } catch (err) {
      console.error('Failed to persist ignored issue:', err)
      // Local state already updated, so user experience is smooth
    }
  }, [sessionId, jurisdiction, patentId, currentReviewId])

  // Auto-run numeric validation when draft changes
  useEffect(() => {
    if (Object.keys(draft).length > 0) {
      runNumericValidation()
    }
  }, [jurisdiction])

  // Calculate counts
  const numericErrorCount = numericIssues.filter(i => i.type === 'error').length
  const numericWarningCount = numericIssues.filter(i => i.type === 'warning').length
  const activeAiIssues = aiIssues.filter(i => !ignoredIssues.has(i.id) && !appliedFixes.has(i.id))
  const aiErrorCount = activeAiIssues.filter(i => i.type === 'error').length
  const aiWarningCount = activeAiIssues.filter(i => i.type === 'warning').length
  const fixedCount = appliedFixes.size
  const totalErrors = numericErrorCount + aiErrorCount
  const totalWarnings = numericWarningCount + aiWarningCount

  // Category icons and colors
  const getCategoryStyle = (category: string) => {
    switch (category) {
      case 'consistency': return { icon: '🔗', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' }
      case 'diagram': return { icon: '📊', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' }
      case 'completeness': return { icon: '📋', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' }
      case 'legal': return { icon: '⚖️', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }
      case 'clarity': return { icon: '💡', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' }
      case 'translation': return { icon: '🌐', bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' }
      default: return { icon: '📝', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' }
    }
  }

  return (
    <div className="space-y-8">
      {/* Header with Overall Status */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 shadow-xl border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🔬</span>
              Draft Review & Validation
            </h3>
            <p className="text-slate-400 text-sm mt-1">
              Comprehensive analysis for {jurisdiction} jurisdiction
            </p>
          </div>
          
          {/* Overall Score */}
          {aiSummary && (
            <div className="text-center">
              <div className={`text-4xl font-bold ${
                aiSummary.overallScore >= 80 ? 'text-emerald-400' :
                aiSummary.overallScore >= 60 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {aiSummary.overallScore}
              </div>
              <div className="text-xs text-slate-400">Quality Score</div>
            </div>
          )}
        </div>

        {/* Status Summary */}
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-slate-700">
            <div className="text-2xl font-bold text-red-400">{totalErrors}</div>
            <div className="text-xs text-slate-400">Errors</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-slate-700">
            <div className="text-2xl font-bold text-amber-400">{totalWarnings}</div>
            <div className="text-xs text-slate-400">Warnings</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-slate-700">
            <div className="text-2xl font-bold text-blue-400">{aiSummary?.suggestions || 0}</div>
            <div className="text-xs text-slate-400">Suggestions</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-slate-700">
            <div className="text-2xl font-bold text-emerald-400">{fixedCount}</div>
            <div className="text-xs text-slate-400">Fixed</div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 text-center border border-slate-700">
            <div className="text-2xl font-bold text-slate-400">{ignoredIssues.size}</div>
            <div className="text-xs text-slate-400">Ignored</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mt-6">
          <button
            onClick={runNumericValidation}
            disabled={numericLoading}
            className="px-4 py-2.5 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2 text-sm border border-slate-600"
          >
            {numericLoading ? (
              <><span className="animate-spin">⏳</span> Checking...</>
            ) : (
              <><span>📏</span> Run Numeric Checks</>
            )}
          </button>
          
          <button
            onClick={runAIReview}
            disabled={aiLoading}
            className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg font-medium hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 flex items-center gap-2 text-sm shadow-lg"
          >
            {aiLoading ? (
              <><span className="animate-spin">⏳</span> AI Analyzing...</>
            ) : (
              <><span>🤖</span> Run AI Review (Gemini)</>
            )}
          </button>

          <div className="flex-1" />

          <button
            onClick={onProceedToExport}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg font-medium hover:from-emerald-500 hover:to-teal-500 flex items-center gap-2 text-sm shadow-lg"
          >
            <span>📄</span>
            {totalErrors > 0 ? 'Export Anyway' : 'Proceed to Export'}
            <span>→</span>
          </button>
        </div>

        {/* Last Check Times */}
        <div className="flex gap-4 mt-4 text-xs text-slate-500">
          {loadingExisting && <span className="text-cyan-400">⏳ Loading previous review...</span>}
          {lastNumericCheck && <span>📏 Numeric: {lastNumericCheck}</span>}
          {lastAICheck && <span>🤖 AI Review: {lastAICheck}</span>}
          {currentReviewId && <span className="text-slate-600">ID: {currentReviewId.slice(0, 8)}...</span>}
        </div>
      </div>

      {/* Numeric Validation Results */}
      {numericIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <span>📏</span> Numeric Validation
              <span className="text-xs font-normal text-gray-500 ml-2">
                Word limits, character counts, claim numbers
              </span>
            </h4>
          </div>
          <div className="divide-y divide-gray-100">
            {numericIssues.map((issue, idx) => (
              <div 
                key={idx} 
                className={`px-6 py-4 flex items-start gap-4 ${
                  issue.type === 'error' ? 'bg-red-50/50' : 
                  issue.type === 'warning' ? 'bg-amber-50/50' : 'bg-blue-50/50'
                }`}
              >
                <div className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 capitalize">{issue.sectionKey}</div>
                  <div className="text-sm text-gray-600">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-gray-500 mt-1">
                      Current: <strong>{issue.actual}</strong> | Limit: <strong>{issue.limit}</strong>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Preview Modal - Shows diff before applying */}
      {pendingFix && (
        <div 
          className="bg-white rounded-xl border-2 border-emerald-300 shadow-lg overflow-hidden animate-in slide-in-from-top-2 duration-300"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fix-preview-title"
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') rejectFix() }}
        >
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200">
            <div className="flex items-center justify-between">
              <div>
                <h4 id="fix-preview-title" className="font-semibold text-gray-900 flex items-center gap-2">
                  <span>🔍</span> Review Proposed Changes
                </h4>
                <p className="text-sm text-gray-600 mt-1">
                  Section: <strong>{pendingFix.issue.sectionLabel}</strong> • Issue: {pendingFix.issue.title}
                </p>
              </div>
              <button
                onClick={rejectFix}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                title="Close preview (Esc)"
                aria-label="Close preview"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Issue being fixed */}
            <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
              <div className="text-xs font-medium text-amber-700 mb-1">💡 Issue Being Fixed</div>
              <p className="text-sm text-amber-800">{pendingFix.issue.description}</p>
            </div>
            
            {/* Side-by-side diff view */}
            <div className="grid grid-cols-2 gap-4">
              {/* Original Content */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-red-600 px-2 py-0.5 bg-red-100 rounded">ORIGINAL</span>
                  <span className="text-xs text-gray-500">Before fix</span>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-[300px] overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                    {pendingFix.originalContent || <span className="text-gray-400 italic">No content</span>}
                  </pre>
                </div>
              </div>
              
              {/* Fixed Content */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-emerald-600 px-2 py-0.5 bg-emerald-100 rounded">REVISED</span>
                  <span className="text-xs text-gray-500">After fix</span>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 max-h-[300px] overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                    {pendingFix.fixedContent || <span className="text-gray-400 italic">No content</span>}
                  </pre>
                </div>
              </div>
            </div>
            
            {/* Inline diff - highlight changes */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-violet-600 px-2 py-0.5 bg-violet-100 rounded">CHANGES HIGHLIGHTED</span>
                <span className="text-xs text-gray-500">Added text in green, removed in red</span>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[200px] overflow-y-auto">
                <InlineDiffView original={pendingFix.originalContent} revised={pendingFix.fixedContent} />
              </div>
            </div>
          </div>
          
          {/* Action buttons */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Review the changes carefully before applying. This will update the draft section.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={rejectFix}
                className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-2"
              >
                <span>✕</span> Reject
              </button>
              <button
                onClick={approveFix}
                className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 flex items-center gap-2 shadow-sm"
              >
                <span>✓</span> Apply Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Review Results */}
      {activeAiIssues.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-violet-50 to-purple-50 border-b border-violet-200">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <span>🤖</span> AI Review Results
              <span className="text-xs font-normal text-gray-500 ml-2">
                Powered by Gemini • Cross-section analysis
              </span>
            </h4>
            {aiSummary && (
              <p className="text-sm text-gray-600 mt-1">{aiSummary.recommendation}</p>
            )}
          </div>
          <div className="divide-y divide-gray-100">
            {activeAiIssues.map((issue) => {
              const style = getCategoryStyle(issue.category)
              const isFixing = fixingIssue === issue.id
              
              return (
                <div key={issue.id} className={`px-6 py-5 ${style.bg}`}>
                  <div className="flex items-start gap-4">
                    {/* Severity indicator */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-2xl">{style.icon}</span>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <div 
                            key={n}
                            className={`w-1.5 h-1.5 rounded-full ${
                              n <= issue.severity 
                                ? issue.type === 'error' ? 'bg-red-500' 
                                  : issue.type === 'warning' ? 'bg-amber-500' 
                                  : 'bg-blue-500'
                                : 'bg-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Issue content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                          {issue.category}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          issue.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' :
                          issue.type === 'warning' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                          'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {issue.type}
                        </span>
                        <span className="text-xs text-gray-500">
                          Section: <strong>{issue.sectionLabel}</strong>
                        </span>
                      </div>
                      
                      <h5 className="font-semibold text-gray-900 mb-1">{issue.title}</h5>
                      <p className="text-sm text-gray-700 mb-2">{issue.description}</p>
                      
                      <div className="bg-white/80 rounded-lg p-3 border border-gray-200">
                        <div className="text-xs font-medium text-gray-500 mb-1">💡 Suggestion</div>
                        <p className="text-sm text-gray-700">{issue.suggestion}</p>
                      </div>

                      {issue.relatedSections && issue.relatedSections.length > 0 && (
                        <div className="text-xs text-gray-500 mt-2">
                          Related sections: {issue.relatedSections.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => generateFixPreview(issue)}
                        disabled={isFixing || pendingFix !== null}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                      >
                        {isFixing ? (
                          <><span className="animate-spin">⏳</span> Generating...</>
                        ) : (
                          <><span>🔧</span> Preview Fix</>
                        )}
                      </button>
                      <button
                        onClick={() => ignoreIssue(issue.id)}
                        className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-2 whitespace-nowrap"
                      >
                        <span>🚫</span> Ignore
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* All Clear State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && (lastNumericCheck || lastAICheck) && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-8 text-center">
          <div className="text-5xl mb-4">✨</div>
          <h4 className="text-xl font-semibold text-emerald-800 mb-2">All Clear!</h4>
          <p className="text-emerald-700">
            No issues found. Your draft is ready for export.
          </p>
          <button
            onClick={onProceedToExport}
            className="mt-6 px-8 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 shadow-lg inline-flex items-center gap-2"
          >
            <span>📄</span> Export Draft <span>→</span>
          </button>
        </div>
      )}

      {/* Initial State */}
      {numericIssues.length === 0 && activeAiIssues.length === 0 && !lastNumericCheck && !lastAICheck && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h4 className="text-lg font-semibold text-gray-700 mb-2">Ready to Review</h4>
          <p className="text-gray-600 text-sm mb-4">
            Run validation checks to ensure your draft meets all requirements.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={runNumericValidation}
              disabled={numericLoading}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
            >
              📏 Numeric Checks
            </button>
            <button
              onClick={runAIReview}
              disabled={aiLoading}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 flex items-center gap-2 text-sm"
            >
              🤖 AI Review
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Simple Validation Report (Legacy - kept for backwards compatibility)
// ============================================================================

interface ValidationReportProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  draft: Record<string, string>
}

function ValidationReport({ sessionId, jurisdiction, patentId, draft }: ValidationReportProps) {
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const runValidation = useCallback(async () => {
    if (!sessionId || !jurisdiction || !patentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_draft',
          sessionId,
          jurisdiction,
          draft
        })
      })
      const data = await res.json()
      if (data.issues) {
        setIssues(data.issues)
        setLastChecked(new Date().toLocaleTimeString())
      }
    } catch (err) {
      console.error('Validation error:', err)
    } finally {
      setLoading(false)
    }
  }, [sessionId, jurisdiction, patentId, draft])

  useEffect(() => {
    if (Object.keys(draft).length > 0) {
      runValidation()
    }
  }, [jurisdiction])

  const errorCount = issues.filter(i => i.type === 'error').length
  const warningCount = issues.filter(i => i.type === 'warning').length

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900">Validation Report</h4>
        <button
          onClick={runValidation}
          disabled={loading}
          className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
        >
          {loading ? (
            <>
              <span className="animate-spin">⏳</span> Checking...
            </>
          ) : (
            <>
              🔍 Run Validation
            </>
          )}
        </button>
      </div>

      {lastChecked && (
        <div className="text-xs text-gray-500 mb-4">Last checked: {lastChecked}</div>
      )}

      {/* Summary */}
      <div className="flex gap-4 mb-4">
        <div className={`px-3 py-2 rounded-lg text-sm ${errorCount > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
          {errorCount} Error{errorCount !== 1 ? 's' : ''}
        </div>
        <div className={`px-3 py-2 rounded-lg text-sm ${warningCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}`}>
          {warningCount} Warning{warningCount !== 1 ? 's' : ''}
        </div>
        {errorCount === 0 && warningCount === 0 && issues.length === 0 && (
          <div className="px-3 py-2 rounded-lg text-sm bg-emerald-50 text-emerald-700">
            ✅ No issues found
          </div>
        )}
      </div>

      {/* Issues List */}
      {issues.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {issues.map((issue, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg text-sm ${
                issue.type === 'error'
                  ? 'bg-red-50 border border-red-100'
                  : issue.type === 'warning'
                    ? 'bg-amber-50 border border-amber-100'
                    : 'bg-blue-50 border border-blue-100'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5">
                  {issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <div>
                  <div className="font-medium capitalize">{issue.sectionKey}</div>
                  <div className="text-gray-700">{issue.message}</div>
                  {issue.actual !== undefined && issue.limit !== undefined && (
                    <div className="text-xs text-gray-500 mt-1">
                      Current: {issue.actual} | Limit: {issue.limit}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Export Button Component
// ============================================================================

interface ExportButtonProps {
  sessionId: string
  jurisdiction: string
  patentId: string
  disabled?: boolean
}

function ExportButton({ sessionId, jurisdiction, patentId, disabled }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'docx' | 'pdf'>('docx')
  const [showSuccess, setShowSuccess] = useState(false)

  const handleExport = async () => {
    if (!sessionId || !jurisdiction || !patentId) {
      alert('Missing required information for export. Please ensure you have a valid session and jurisdiction.')
      return
    }
    
    // Check for unsupported format
    if (exportFormat === 'pdf') {
      alert('📋 PDF export is coming soon!\n\nPlease use MS Word (.docx) format for now.')
      return
    }
    
    setExporting(true)
    setShowSuccess(false)
    try {
      const res = await fetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'export_docx',
          sessionId,
          jurisdiction,
          format: exportFormat
        })
      })

      if (!res.ok) {
        let errorMsg = 'Unknown error'
        try {
          const error = await res.json()
          errorMsg = error.error || error.message || errorMsg
        } catch {
          errorMsg = `Server error (${res.status})`
        }
        alert(`❌ Export failed: ${errorMsg}`)
        return
      }

      // Check content type to ensure we got a file
      const contentType = res.headers.get('content-type')
      if (!contentType?.includes('application/vnd.openxmlformats')) {
        // Might be an error response
        const errorText = await res.text()
        alert(`❌ Export failed: Invalid response format. ${errorText.substring(0, 100)}`)
        return
      }

      // Download the file
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `patent_draft_${jurisdiction}_${new Date().toISOString().split('T')[0]}.docx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      // Show success feedback
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch (err) {
      console.error('Export error:', err)
      alert(`❌ Export failed: ${err instanceof Error ? err.message : 'Network error'}. Please check your connection and try again.`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <select
        value={exportFormat}
        onChange={(e) => setExportFormat(e.target.value as 'docx' | 'pdf')}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      >
        <option value="docx">MS Word (.docx)</option>
        <option value="pdf">PDF (coming soon)</option>
      </select>
      
      <button
        onClick={handleExport}
        disabled={disabled || exporting}
        className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 shadow-lg transition-all ${
          showSuccess 
            ? 'bg-emerald-500 text-white' 
            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60'
        }`}
      >
        {exporting ? (
          <>
            <span className="animate-spin">⏳</span>
            Exporting...
          </>
        ) : showSuccess ? (
          <>
            <span>✅</span>
            Downloaded!
          </>
        ) : (
          <>
            <span>📄</span>
            Export {jurisdiction} Draft
          </>
        )}
      </button>
    </div>
  )
}

type SectionConfig = {
  keys: string[]
  label: string
  description?: string
  constraints?: string[]
  required?: boolean
}

interface AnnexureDraftStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface CountryOption {
  code: string
  label: string
  description: string
  languages: string[]
}

const displayName: Record<string, string> = {
  title: 'Title',
  abstract: 'Abstract',
  fieldOfInvention: 'Field of Invention',
  crossReference: 'Cross-Reference to Related Applications',
  background: 'Background',
  objectsOfInvention: 'Objects of the Invention',
  summary: 'Summary',
  briefDescriptionOfDrawings: 'Brief Description of Drawings',
  detailedDescription: 'Detailed Description',
  bestMethod: 'Best Method',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  listOfNumerals: 'List of Reference Numerals',
  // PCT/JP specific
  technicalProblem: 'Technical Problem',
  technicalSolution: 'Technical Solution',
  advantageousEffects: 'Advantageous Effects'
}

const fallbackSections: SectionConfig[] = [
  { keys: ['title', 'abstract'], label: 'Title + Abstract' },
  { keys: ['fieldOfInvention'], label: 'Technical Field' },
  { keys: ['background'], label: 'Background' },
  { keys: ['summary', 'briefDescriptionOfDrawings'], label: 'Summary + Brief Description' },
  { keys: ['detailedDescription', 'bestMethod'], label: 'Detailed Description + Best Mode' },
  { keys: ['industrialApplicability'], label: 'Industrial Applicability' },
  { keys: ['claims', 'listOfNumerals'], label: 'Claims + List of Reference Numerals' }
]

export default function AnnexureDraftStage({ session, patent, onComplete, onRefresh }: AnnexureDraftStageProps) {
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [debugSteps, setDebugSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [usePersonaStyle, setUsePersonaStyle] = useState<boolean>(false) // OFF by default
  const [styleAvailable, setStyleAvailable] = useState<boolean | null>(null)
  const [showWritingSamplesModal, setShowWritingSamplesModal] = useState(false)
  const [showPersonaManager, setShowPersonaManager] = useState(false)
  const [personaSelection, setPersonaSelection] = useState<PersonaSelection | undefined>(undefined)
  const [currentKeys, setCurrentKeys] = useState<string[] | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({})
  const [regenRemarks, setRegenRemarks] = useState<Record<string, string>>({})
  const [regenOpen, setRegenOpen] = useState<Record<string, boolean>>({})
  const [sectionLoading, setSectionLoading] = useState<Record<string, boolean>>({})
  const [autoMode, setAutoMode] = useState<boolean>(false)
  const [autoModeRunning, setAutoModeRunning] = useState<boolean>(false)
  const [autoModeProgress, setAutoModeProgress] = useState<{ current: number; total: number; currentSection: string } | null>(null)
  // Ref for immediate cancellation check (state updates are async, refs are sync)
  const autoModeCancelledRef = useRef<boolean>(false)
  const [activeJurisdiction, setActiveJurisdiction] = useState<string>(() => (session?.activeJurisdiction || session?.draftingJurisdictions?.[0] || 'IN'))
  const [sourceOfTruth, setSourceOfTruth] = useState<string>(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())
      : ['IN']
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    if (preferred && list.includes(preferred)) return preferred
    const active = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    if (active && list.includes(active)) return active
    return list[0] || 'IN'
  })
  const [languageByCode, setLanguageByCode] = useState<Record<string, string>>({})
  const [availableCountries, setAvailableCountries] = useState<CountryOption[]>([])
  const [availableCountriesError, setAvailableCountriesError] = useState<string | null>(null)
  const [selectedAddCode, setSelectedAddCode] = useState<string>('')
  const [addingJurisdiction, setAddingJurisdiction] = useState<boolean>(false)
  const [deletingJurisdiction, setDeletingJurisdiction] = useState<string | null>(null)
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[] | null>(null)
  const [profileLoading, setProfileLoading] = useState<boolean>(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState<boolean>(false)
  
  // Activity Panel Visibility
  const [showActivity, setShowActivity] = useState(true)
  
  // Debug Panel for B+T+U (Base + TopUp + User prompts)
  const [showDebugPanel, setShowDebugPanel] = useState(true)
  const [promptInjectionInfo, setPromptInjectionInfo] = useState<Record<string, { B: boolean; T: boolean; U: boolean; source: string | null; key: string; strategy: string }>>({})

  // Text Formatting
  const [showFormatting, setShowFormatting] = useState(false)
  const [fontFamily, setFontFamily] = useState('serif')
  const [fontSize, setFontSize] = useState('15px')
  
  // User Instructions
  const [userInstructions, setUserInstructions] = useState<Record<string, Record<string, any>>>({}) // { jurisdiction: { sectionKey: instruction } }
  const [instructionPopoverKey, setInstructionPopoverKey] = useState<string | null>(null)
  const [showAllInstructionsModal, setShowAllInstructionsModal] = useState(false)
  const [lineHeight, setLineHeight] = useState('1.7')

  // Inline Section Validation (Post-generation feedback)
  const [inlineValidationIssues, setInlineValidationIssues] = useState<Record<string, UnifiedValidationIssue[]>>({})
  const [validationLoading, setValidationLoading] = useState<Record<string, boolean>>({})

  // Handle AI Review issues sync to inline validators
  const handleAIIssuesChange = useCallback((aiIssues: AIReviewIssue[]) => {
    // Convert AI Review issues to ValidationIssue format and group by section
    const issuesBySection: Record<string, UnifiedValidationIssue[]> = {}
    
    for (const issue of aiIssues) {
      const sectionKey = issue.sectionKey
      if (!issuesBySection[sectionKey]) {
        issuesBySection[sectionKey] = []
      }
      
      // Map AI issue type to validation severity
      const severityMap: Record<string, 'error' | 'warning' | 'notice'> = {
        'error': 'error',
        'warning': 'warning',
        'suggestion': 'notice'
      }
      
      // Convert to ValidationIssue format
      // Store original fixPrompt in metadata for API compatibility
      const validationIssue: UnifiedValidationIssue = {
        id: issue.id,
        sectionId: issue.sectionKey,
        severity: severityMap[issue.type] || 'notice',
        code: `ai_${issue.category}_${issue.id.substring(0, 8)}`,
        message: `${issue.title}${issue.description ? ': ' + issue.description : ''}`,
        suggestedFix: issue.suggestion || issue.fixPrompt || '',
        category: issue.category as UnifiedValidationIssue['category'],
        relatedSections: issue.relatedSections,
        isFixed: false,
        isIgnored: false,
        // Store original AI issue properties needed for API fix
        metadata: {
          fixPrompt: issue.fixPrompt,
          sectionKey: issue.sectionKey,
          sectionLabel: issue.sectionLabel,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
          originalType: issue.type,
          originalSeverity: issue.severity
        }
      }
      
      issuesBySection[sectionKey].push(validationIssue)
    }
    
    // Update inline validation issues (merge with existing, replacing AI issues)
    setInlineValidationIssues(prev => {
      const updated: Record<string, UnifiedValidationIssue[]> = {}
      
      // Collect all unique section keys
      const prevKeys = Object.keys(prev)
      const newKeys = Object.keys(issuesBySection)
      const allSectionKeys: string[] = []
      const seenKeys: Record<string, boolean> = {}
      
      for (const key of prevKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      for (const key of newKeys) {
        if (!seenKeys[key]) {
          seenKeys[key] = true
          allSectionKeys.push(key)
        }
      }
      
      // For each section, keep non-AI issues and add new AI issues
      for (const sectionKey of allSectionKeys) {
        const existingIssues = prev[sectionKey] || []
        const newAIIssues = issuesBySection[sectionKey] || []
        
        // Filter out old AI issues (they start with 'ai-' or have code starting with 'ai_')
        const nonAIIssues = existingIssues.filter(issue => 
          !issue.id.startsWith('ai-') && !issue.code.startsWith('ai_')
        )
        
        // Combine non-AI issues with new AI issues
        updated[sectionKey] = [...nonAIIssues, ...newAIIssues]
      }
      
      return updated
    })
  }, [])

  // Fetch validation for a section (debounced/on-demand)
  const validateSection = useCallback(async (sectionKey: string, content: string) => {
    if (!content || content.trim().length === 0 || !session?.id || !patent?.id) return
    
    setValidationLoading(prev => ({ ...prev, [sectionKey]: true }))
    try {
      const res = await fetch(`/api/patents/${patent.id}/validation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'validate_section',
          sessionId: session.id,
          jurisdiction: activeJurisdiction,
          sectionKey,
          content
        })
      })
      const data = await res.json()
      if (data.success && data.issues) {
        setInlineValidationIssues(prev => ({
          ...prev,
          [sectionKey]: data.issues
        }))
      }
    } catch (err) {
      console.error('Section validation error:', err)
    } finally {
      setValidationLoading(prev => ({ ...prev, [sectionKey]: false }))
    }
  }, [session?.id, patent?.id, activeJurisdiction])

  // Validate section on content change (debounced)
  useEffect(() => {
    const debouncedValidate = setTimeout(() => {
      Object.entries(generated).forEach(([key, content]) => {
        if (content && content.trim().length > 0) {
          validateSection(key, content)
        }
      })
    }, 1500) // 1.5s debounce

    return () => clearTimeout(debouncedValidate)
  }, [generated, activeJurisdiction])

  // Data for figures - use frozen sequence if available (includes both diagrams and sketches)
  const figurePlans = useMemo(() => Array.isArray(session?.figurePlans) ? session.figurePlans : [], [session?.figurePlans])
  const diagramSources = useMemo(() => Array.isArray(session?.diagramSources) ? session.diagramSources : [], [session?.diagramSources])
  const sketchRecords = useMemo(() => Array.isArray(session?.sketchRecords) ? session.sketchRecords.filter((s: any) => s.status === 'SUCCESS') : [], [session?.sketchRecords])
  const figureSequence = useMemo(() => Array.isArray((session as any)?.figureSequence) ? (session as any).figureSequence : [], [session])
  const figureSequenceFinalized = (session as any)?.figureSequenceFinalized || false

  // Build unified figures list using frozen sequence (matches export logic)
  // Returns { figures, hasAppended, missingCount } for warning computation
  const figuresData = useMemo(() => {
    const figures: Array<{
      figureNo: number
      title: string
      type: 'diagram' | 'sketch'
      imageUrl: string | null
      sourceId: string
      isNew?: boolean
    }> = []
    let hasAppended = false
    let missingCount = 0

    if (figureSequenceFinalized && figureSequence.length > 0) {
      // Use the finalized figure sequence (includes both diagrams and sketches in user-defined order)
      const sequencedSourceIds = new Set(figureSequence.map((s: any) => s.sourceId))
      
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = figurePlans.find((f: any) => f.id === seqItem.sourceId)
          const source = diagramSources.find((d: any) => d.figureNo === plan?.figureNo)
          if (plan) {
            let imgUrl: string | null = null
            if (source?.imageFilename) {
              imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
            } else if (source?.plantuml) {
              try {
                const encoded = plantumlEncoder.encode(source.plantuml)
                imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
              } catch (e) {
                console.error('Failed to encode plantuml', e)
              }
            }
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: plan.title || `Figure ${seqItem.finalFigNo}`,
              type: 'diagram',
              imageUrl: imgUrl,
              sourceId: seqItem.sourceId
            })
          } else {
            // Diagram was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Diagram (Source ID: ${seqItem.sourceId})`,
              type: 'diagram',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = sketchRecords.find((s: any) => s.id === seqItem.sourceId)
          if (sketch) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: sketch.title || `Figure ${seqItem.finalFigNo}`,
              type: 'sketch',
              imageUrl: sketch.imagePath || null,
              sourceId: seqItem.sourceId
            })
          } else {
            // Sketch was deleted after freezing
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: `Missing Sketch (Source ID: ${seqItem.sourceId})`,
              type: 'sketch',
              imageUrl: null,
              sourceId: seqItem.sourceId
            })
            missingCount++
          }
        }
      }

      // Auto-append new diagrams added after sequence was finalized
      figurePlans.forEach((plan: any) => {
        if (!sequencedSourceIds.has(plan.id)) {
          const source = diagramSources.find((d: any) => d.figureNo === plan.figureNo)
          let imgUrl: string | null = null
          if (source?.imageFilename) {
            imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
          } else if (source?.plantuml) {
            try {
              const encoded = plantumlEncoder.encode(source.plantuml)
              imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
            } catch (e) {
              console.error('Failed to encode plantuml', e)
            }
          }
          figures.push({
            figureNo: figures.length + 1,
            title: plan.title || `Figure ${figures.length + 1}`,
            type: 'diagram',
            imageUrl: imgUrl,
            sourceId: plan.id,
            isNew: true
          })
          hasAppended = true
        }
      })

      // Auto-append new sketches added after sequence was finalized
      sketchRecords.forEach((sketch: any) => {
        if (!sequencedSourceIds.has(sketch.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: sketch.title || `Figure ${figures.length + 1}`,
            type: 'sketch',
            imageUrl: sketch.imagePath || null,
            sourceId: sketch.id,
            isNew: true
          })
          hasAppended = true
        }
      })
    } else {
      // Fallback: use figurePlans sorted by figureNo, then append sketches
      const sortedPlans = [...figurePlans].sort((a: any, b: any) => a.figureNo - b.figureNo)
      for (const plan of sortedPlans) {
        const source = diagramSources.find((d: any) => d.figureNo === plan.figureNo)
        let imgUrl: string | null = null
        if (source?.imageFilename) {
          imgUrl = `/api/projects/${patent?.project?.id ?? ''}/patents/${patent?.id ?? ''}/upload?filename=${encodeURIComponent(source.imageFilename)}`
        } else if (source?.plantuml) {
          try {
            const encoded = plantumlEncoder.encode(source.plantuml)
            imgUrl = `https://www.plantuml.com/plantuml/img/${encoded}`
          } catch (e) {
            console.error('Failed to encode plantuml', e)
          }
        }
        figures.push({
          figureNo: plan.figureNo,
          title: plan.title || `Figure ${plan.figureNo}`,
          type: 'diagram',
          imageUrl: imgUrl,
          sourceId: plan.id
        })
      }
      // Append sketches after diagrams
      const maxFigNo = figures.length > 0 ? Math.max(...figures.map(f => f.figureNo)) : 0
      sketchRecords.forEach((sketch: any, index: number) => {
        figures.push({
          figureNo: maxFigNo + index + 1,
          title: sketch.title || `Figure ${maxFigNo + index + 1}`,
          type: 'sketch',
          imageUrl: sketch.imagePath || null,
          sourceId: sketch.id
        })
      })
    }

    return { figures, hasAppended, missingCount }
  }, [figurePlans, diagramSources, sketchRecords, figureSequence, figureSequenceFinalized, patent])

  // Extract figures and warning state from memoized data
  const unifiedFigures = figuresData.figures
  const sequenceOutdated = figuresData.hasAppended || figuresData.missingCount > 0
  const sequenceWarningMessage = figuresData.hasAppended 
    ? `${figuresData.figures.filter(f => f.isNew).length} new figure(s) added after freezing - appended at end. Consider reordering in Planner stage.`
    : figuresData.missingCount > 0
      ? `${figuresData.missingCount} figure(s) deleted after freezing. Consider reordering in Planner stage.`
      : ''

  const copySection = async (key: string) => {
    try {
      const text = generated?.[key] || ''
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1200)
    } catch {}
  }

  const availableJurisdictions: string[] = useMemo(() => {
    const list = Array.isArray(session?.draftingJurisdictions) && session.draftingJurisdictions.length > 0
      ? session.draftingJurisdictions
      : []
    return list.map((c: string) => (c || '').toUpperCase())
  }, [session?.draftingJurisdictions])

  const latestDrafts = useMemo(() => {
    const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
    const map: Record<string, any> = {}
    drafts.forEach((d: any) => {
      const code = (d?.jurisdiction || 'IN').toUpperCase()
      if (!map[code] || (d.version || 0) > (map[code].version || 0)) {
        map[code] = d
      }
    })
    return map
  }, [session?.annexureDrafts])
  const isMultiJurisdiction = availableJurisdictions.length > 1

  const addableCountries = useMemo(
    () => availableCountries.filter(c => !availableJurisdictions.includes(c.code)),
    [availableCountries, availableJurisdictions]
  )

  const persistStageState = async (opts: {
    jurisdictions?: string[]
    active?: string
    source?: string
    languageMap?: Record<string, string>
  }) => {
    if (!session?.id) return
    const nextJurisdictions = opts.jurisdictions || availableJurisdictions
    const payload: any = {
      action: 'set_stage',
      sessionId: session.id,
      stage: session?.status || 'ANNEXURE_DRAFT',
      draftingJurisdictions: nextJurisdictions,
      activeJurisdiction: opts.active || activeJurisdiction,
      languageByJurisdiction: opts.languageMap || languageByCode,
      sourceOfTruth: opts.source || sourceOfTruth
    }
    await onComplete(payload)
    await onRefresh()
  }

  const handleSourceChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setSourceOfTruth(normalized)
    const reordered = [normalized, ...availableJurisdictions.filter(c => c !== normalized)]
    await persistStageState({ source: normalized, jurisdictions: reordered })
  }

  const handleLanguageChange = async (code: string, lang: string) => {
    const normalized = (code || '').toUpperCase()
    setLanguageByCode(prev => ({ ...prev, [normalized]: lang }))
    await persistStageState({ languageMap: { ...languageByCode, [normalized]: lang } })
  }

  const handleAddJurisdiction = async () => {
    if (!selectedAddCode || !session?.id) return
    if (availableJurisdictions.includes(selectedAddCode)) return
    try {
      setAddingJurisdiction(true)
      const country = availableCountries.find(c => c.code === selectedAddCode)
      const preferredLang = languageByCode[selectedAddCode] || country?.languages?.[0]
      const nextLanguageMap = preferredLang ? { ...languageByCode, [selectedAddCode]: preferredLang } : { ...languageByCode }
      setLanguageByCode(nextLanguageMap)
      const nextList = [...availableJurisdictions, selectedAddCode]
      await persistStageState({
        jurisdictions: nextList,
        active: selectedAddCode,
        source: sourceOfTruth || nextList[0],
        languageMap: nextLanguageMap
      })
      setActiveJurisdiction(selectedAddCode)
    } finally {
      setAddingJurisdiction(false)
    }
  }

  const handleDeleteDraft = async (code: string, removeFromList: boolean = false) => {
    if (!session?.id) return
    const normalized = (code || '').toUpperCase()
    try {
      setDeletingJurisdiction(normalized)
      await onComplete({
        action: 'delete_annexure_draft',
        sessionId: session.id,
        jurisdiction: normalized,
        removeFromList
      })
      // Optimistically update local active/source to reflect removal/clear
      const remaining = removeFromList
        ? availableJurisdictions.filter(c => c !== normalized)
        : availableJurisdictions
      if (removeFromList && remaining.length > 0) {
        const next = remaining[0]
        setActiveJurisdiction(next)
        setSourceOfTruth(prev => (remaining.includes(prev) ? prev : next))
      }
      // Clear the generated state for the deleted jurisdiction to prevent stale data
      if (activeJurisdiction === normalized) {
        setGenerated({})
      }
      await onRefresh()
    } finally {
      setDeletingJurisdiction(null)
    }
  }

  // Initialize from latest saved draft for the active jurisdiction
  useEffect(() => {
    const code = (activeJurisdiction || '').toUpperCase()
    const latest = latestDrafts[code]

    if (latest) {
      // Get extraSections from dedicated column OR legacy validationReport location
      const extraSections = (latest as any).extraSections || (latest.validationReport as any)?.extraSections || {}
      
      // For REFERENCE drafts, section content is stored in _rawDraft
      const rawDraft = extraSections._rawDraft || {}
      const isReference = code === 'REFERENCE'
      
      const initial: Record<string, string> = {
        // Legacy columns (dedicated DB fields)
        // For REFERENCE: prefer rawDraft content, fallback to DB columns
        title: isReference ? (rawDraft.title || latest.title || '') : (latest.title || ''),
        fieldOfInvention: isReference ? (rawDraft.fieldOfInvention || latest.fieldOfInvention || '') : (latest.fieldOfInvention || ''),
        background: isReference ? (rawDraft.background || latest.background || '') : (latest.background || ''),
        summary: isReference ? (rawDraft.summary || latest.summary || '') : (latest.summary || ''),
        briefDescriptionOfDrawings: isReference ? (rawDraft.briefDescriptionOfDrawings || latest.briefDescriptionOfDrawings || '') : (latest.briefDescriptionOfDrawings || ''),
        detailedDescription: isReference ? (rawDraft.detailedDescription || latest.detailedDescription || '') : (latest.detailedDescription || ''),
        bestMethod: isReference ? (rawDraft.bestMode || rawDraft.bestMethod || latest.bestMethod || '') : (latest.bestMethod || ''),
        industrialApplicability: isReference ? (rawDraft.industrialApplicability || latest.industrialApplicability || '') : (latest.industrialApplicability || ''),
        claims: isReference ? (rawDraft.claims || latest.claims || '') : (latest.claims || ''),
        abstract: isReference ? (rawDraft.abstract || latest.abstract || '') : (latest.abstract || ''),
        listOfNumerals: isReference ? (rawDraft.listOfNumerals || latest.listOfNumerals || '') : (latest.listOfNumerals || ''),
        // Extra sections (JSON column for scalable storage)
        // For REFERENCE: prefer rawDraft, then extraSections
        crossReference: isReference ? (rawDraft.crossReference || extraSections.crossReference || '') : (extraSections.crossReference || ''),
        preamble: isReference ? (rawDraft.preamble || extraSections.preamble || '') : (extraSections.preamble || ''),
        objectsOfInvention: isReference ? (rawDraft.objectsOfInvention || extraSections.objectsOfInvention || '') : (extraSections.objectsOfInvention || ''),
        technicalProblem: isReference ? (rawDraft.technicalProblem || extraSections.technicalProblem || '') : (extraSections.technicalProblem || ''),
        technicalSolution: isReference ? (rawDraft.technicalSolution || extraSections.technicalSolution || '') : (extraSections.technicalSolution || ''),
        advantageousEffects: isReference ? (rawDraft.advantageousEffects || extraSections.advantageousEffects || '') : (extraSections.advantageousEffects || ''),
        modeOfCarryingOut: isReference ? (rawDraft.modeOfCarryingOut || extraSections.modeOfCarryingOut || '') : (extraSections.modeOfCarryingOut || '')
      }
      setGenerated(initial)
    } else {
      setGenerated({})
    }
  }, [latestDrafts, activeJurisdiction])

  // Sync active jurisdiction when session updates
  useEffect(() => {
    const nextJurisdiction = session?.activeJurisdiction || session?.draftingJurisdictions?.[0]
    if (nextJurisdiction && nextJurisdiction !== activeJurisdiction) {
      setActiveJurisdiction(nextJurisdiction)
    }
  }, [session?.activeJurisdiction, session?.draftingJurisdictions])

  // Keep source-of-truth in sync
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const preferred = status?.__sourceOfTruth ? String(status.__sourceOfTruth).toUpperCase() : ''
    const fallbackActive = session?.activeJurisdiction ? String(session.activeJurisdiction).toUpperCase() : ''
    const resolved = preferred && availableJurisdictions.includes(preferred)
      ? preferred
      : (fallbackActive && availableJurisdictions.includes(fallbackActive)
        ? fallbackActive
        : (availableJurisdictions[0] || sourceOfTruth))
    setSourceOfTruth(resolved || 'IN')
  }, [session?.jurisdictionDraftStatus, session?.activeJurisdiction, availableJurisdictions, sourceOfTruth])

  // Load available country profiles
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        setAvailableCountriesError(null)
        const res = await fetch('/api/country-profiles', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profiles (${res.status})`)
        const data = await res.json()
        const countries: CountryOption[] = Array.isArray(data?.countries) ? data.countries.map((meta: any) => ({
          code: (meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${(meta.code || '').toUpperCase()})`,
          description: `${meta.office || 'Patent Office'} format. Languages: ${(meta.languages || []).join(', ') || 'N/A'}. Applications: ${(meta.applicationTypes || []).join(', ') || 'N/A'}.`,
          languages: meta.languages || []
        })) : []
        countries.sort((a, b) => a.label.localeCompare(b.label))
        setAvailableCountries(countries)
      } catch (err) {
        console.error('Failed to load country profiles (Annexure stage)', err)
        setAvailableCountriesError('Failed to load jurisdiction catalog. You can still draft with existing selections.')
      }
    }
    fetchCountries()
  }, [])

  // Maintain language preferences
  useEffect(() => {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    setLanguageByCode(prev => {
      const next: Record<string, string> = {}
      availableJurisdictions.forEach(code => {
        const saved = status?.[code]?.language
        const country = availableCountries.find(c => c.code === code)
        const defaultLang = country?.languages?.[0] || ''
        next[code] = saved || prev[code] || defaultLang
      })
      return next
    })
  }, [session?.jurisdictionDraftStatus, availableCountries, availableJurisdictions])

  // Load user instructions for the session
  useEffect(() => {
    const loadUserInstructions = async () => {
      if (!session?.id || !patent?.id) return
      try {
        const res = await fetch(`/api/patents/${patent.id}/drafting/user-instructions?sessionId=${session.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
        })
        if (res.ok) {
          const data = await res.json()
          setUserInstructions(data.grouped || {})
        }
      } catch (err) {
        console.error('Failed to load user instructions:', err)
      }
    }
    loadUserInstructions()
  }, [session?.id, patent?.id])

  // Keep add-jurisdiction dropdown updated
  useEffect(() => {
    const addable = availableCountries.filter(c => !availableJurisdictions.includes(c.code))
    if (!selectedAddCode || !addable.find(c => c.code === selectedAddCode)) {
      setSelectedAddCode(addable[0]?.code || '')
    }
  }, [availableCountries, availableJurisdictions, selectedAddCode])

  useEffect(() => {
    if (!selectedAddCode) return
    const country = availableCountries.find(c => c.code === selectedAddCode)
    if (!country) return
    setLanguageByCode(prev => {
      if (prev[selectedAddCode]) return prev
      const lang = country.languages?.[0]
      if (!lang) return prev
      return { ...prev, [selectedAddCode]: lang }
    })
  }, [selectedAddCode, availableCountries])

  // Load country profile to drive section layout
  // For REFERENCE pseudo-country, pass the selected jurisdictions to get dynamic optimized sections
  useEffect(() => {
    const loadProfile = async () => {
      if (!activeJurisdiction) return
      setProfileLoading(true)
      setProfileError(null)
      try {
        // Build URL with jurisdictions param for REFERENCE profile optimization
        let url = `/api/country-profiles/${activeJurisdiction}`
        
        // For REFERENCE profile, append selected jurisdictions to optimize the section list
        if (activeJurisdiction.toUpperCase() === 'REFERENCE') {
          const jurisdictions = (session?.draftingJurisdictions || [])
            .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')
          if (jurisdictions.length > 0) {
            url += `?jurisdictions=${jurisdictions.join(',')}`
          }
        }
        
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          }
        })
        if (!res.ok) throw new Error(`Failed to load country profile (${res.status})`)
        const data = await res.json()
        const profile = data?.profile
        const variant = profile?.structure?.variants?.find((v: any) => v.id === profile?.structure?.defaultVariant) || profile?.structure?.variants?.[0]
        const sections: SectionConfig[] = []
        const canonicalMap: Record<string, string> = {
          title: 'title',
          technical_field: 'fieldOfInvention',
          field_of_invention: 'fieldOfInvention',
          fieldofinvention: 'fieldOfInvention',
          field: 'fieldOfInvention',
          cross_reference: 'crossReference',
          crossreference: 'crossReference',
          background: 'background',
          background_art: 'background',
          objects: 'objectsOfInvention',
          objects_of_invention: 'objectsOfInvention',
          objectsofinvention: 'objectsOfInvention',
          // Direct camelCase mappings for canonical keys returned from API
          objectsOfInvention: 'objectsOfInvention',
          fieldOfInvention: 'fieldOfInvention',
          crossReference: 'crossReference',
          briefDescriptionOfDrawings: 'briefDescriptionOfDrawings',
          detailedDescription: 'detailedDescription',
          bestMethod: 'bestMethod',
          industrialApplicability: 'industrialApplicability',
          listOfNumerals: 'listOfNumerals',
          technicalProblem: 'technicalProblem',
          technicalSolution: 'technicalSolution',
          advantageousEffects: 'advantageousEffects',
          summary_of_invention: 'summary',
          summary: 'summary',
          brief_drawings: 'briefDescriptionOfDrawings',
          brief_description_of_drawings: 'briefDescriptionOfDrawings',
          briefdescriptionofdrawings: 'briefDescriptionOfDrawings',
          description: 'detailedDescription',
          detailed_description: 'detailedDescription',
          detaileddescription: 'detailedDescription',
          best_mode: 'bestMethod',
          best_method: 'bestMethod',
          bestmethod: 'bestMethod',
          industrial_applicability: 'industrialApplicability',
          industrialapplicability: 'industrialApplicability',
          utility: 'industrialApplicability',
          claims: 'claims',
          abstract: 'abstract',
          reference_numerals: 'listOfNumerals',
          reference_signs: 'listOfNumerals',
          list_of_numerals: 'listOfNumerals',
          listofnumerals: 'listOfNumerals',
          // PCT/JP specific
          technical_problem: 'technicalProblem',
          technicalproblem: 'technicalProblem',
          technical_solution: 'technicalSolution',
          technicalsolution: 'technicalSolution',
          advantageous_effects: 'advantageousEffects',
          advantageouseffects: 'advantageousEffects'
        }
        const promptSections = profile?.prompts?.sections || {}
        
        // ============================================================================
        // SECTIONS NOW COME EXCLUSIVELY FROM CountrySectionMapping TABLE
        // This is the single source of truth for which sections appear per jurisdiction
        // Configured via: /super-admin/jurisdiction-config
        // ============================================================================
        
        if (Array.isArray(profile?.sectionMappings) && profile.sectionMappings.length > 0) {
          // Build sections ONLY from CountrySectionMapping table entries
          // Filter out N/A, Implicit, and disabled sections
          const applicableMappings = profile.sectionMappings.filter((mapping: any) => 
            mapping.sectionKey && 
            mapping.heading && 
            mapping.heading !== '(N/A)' && 
            mapping.heading !== '(Implicit)' &&
            mapping.heading !== '(Recommended/NA)' &&
            mapping.heading !== '(Include in Detailed Desc)' &&
            mapping.isEnabled !== false
          )
          
          // Sort by displayOrder
          applicableMappings.sort((a: any, b: any) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999))
          
          for (const mapping of applicableMappings) {
            const sectionKey = mapping.sectionKey
            
            // Resolve to canonical internal key using the mapping
            const canonicalKey = canonicalMap[sectionKey] || canonicalMap[sectionKey.toLowerCase()] || sectionKey
            
            // Skip sections that don't resolve to a known canonical key (prevents prompt loading errors)
            if (!canonicalKey) {
              console.warn(`[AnnexureDraftStage] Skipping unmapped section: ${sectionKey}`)
              continue
            }
            
            sections.push({
              keys: [canonicalKey],
              label: mapping.heading, // Use exact heading from CountrySectionMapping table
              description: promptSections?.[canonicalKey]?.description || promptSections?.[sectionKey]?.description || '',
              constraints: promptSections?.[canonicalKey]?.constraints || promptSections?.[sectionKey]?.constraints || [],
              required: mapping.isRequired ?? true
            })
          }
          
          console.log(`[AnnexureDraftStage] Loaded ${sections.length} sections from CountrySectionMapping for ${activeJurisdiction}`)
        } else {
          // No CountrySectionMapping found - this jurisdiction is not configured
          console.error(`[AnnexureDraftStage] No CountrySectionMapping found for ${activeJurisdiction}. Configure via /super-admin/jurisdiction-config`)
        }
        
        if (sections.length > 0) {
          setSectionConfigs(sections)
          setUsingFallback(false)
          setProfileError(null)
        } else {
          // CRITICAL: Do not use fallback - CountrySectionMapping is the single source of truth
          // Show error so admin knows to configure the jurisdiction
          setSectionConfigs([])
          setUsingFallback(true)
          setProfileError(`No sections configured for ${activeJurisdiction}. Please configure via /super-admin/jurisdiction-config`)
        }
      } catch (err) {
        console.error('Failed to load jurisdiction profile', err)
        setProfileError('Failed to load country-specific sections; using default layout.')
        setSectionConfigs(fallbackSections)
        setUsingFallback(true)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [activeJurisdiction, session?.draftingJurisdictions])

  const handleJurisdictionChange = async (code: string) => {
    const normalized = (code || '').toUpperCase()
    setActiveJurisdiction(normalized)
    if (!session?.id) return
    try {
      await persistStageState({ active: normalized })
    } catch (err) {
      console.error('Failed to persist jurisdiction change', err)
    }
  }

  // Multi-jurisdiction: Generate Reference Draft (superset sections)
  const [generatingReference, setGeneratingReference] = useState(false)
  const [translating, setTranslating] = useState<string | null>(null)

  const handleGenerateReferenceDraft = async (forceRegenerate = false) => {
    if (!session?.id || generatingReference) return
    
    // Check if regenerating existing reference draft
    if (session?.referenceDraftComplete && !forceRegenerate) {
      const confirmed = confirm(
        '⚠️ Regenerating Reference Draft\n\n' +
        'This will replace your existing reference draft. ' +
        'Existing translations for other jurisdictions will become outdated and may need to be regenerated.\n\n' +
        'Do you want to continue?'
      )
      if (!confirmed) return
    }
    
    setGeneratingReference(true)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'generate_reference_draft',
          sessionId: session.id
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Reference draft generation failed:', data.error)
        alert(`❌ Failed to generate reference draft: ${data.error || 'Unknown error'}`)
        return
      }
      // Refresh to get updated session with reference draft
      await onRefresh()
      if (data.draft) {
        setGenerated(data.draft)
        alert('✅ Reference draft generated successfully!\n\nYou can now translate to other jurisdictions.')
      }
    } catch (err) {
      console.error('Reference draft generation error:', err)
      alert(`❌ Failed to generate reference draft: ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setGeneratingReference(false)
    }
  }

  // Multi-jurisdiction: Translate Reference Draft to a jurisdiction
  const handleTranslateToJurisdiction = async (targetJurisdiction: string) => {
    if (!session?.id || translating) return
    const code = targetJurisdiction.toUpperCase()
    
    // Validate jurisdiction exists in available list
    if (!availableJurisdictions.includes(code) && code !== 'REFERENCE') {
      alert(`Invalid jurisdiction: ${code}. Please select a valid jurisdiction.`)
      return
    }
    
    setTranslating(code)
    setShowActivity(true)
    try {
      const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'translate_to_jurisdiction',
          sessionId: session.id,
          targetJurisdiction: code
        })
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Translation failed:', data.error)
        alert(`❌ Translation failed for ${code}: ${data.error || 'Unknown error'}`)
        return
      }
      
      // Check for high fallback rate warning
      if (data.warning) {
        console.warn('[Translation] Warning:', data.warning)
      }
      
      // Refresh to get updated session with translated draft
      await onRefresh()
      
      // Build comprehensive success message
      let message = `✅ Translation to ${code} complete!`
      
      // Add fallback warning if applicable
      if (data.warning) {
        message += `\n\n⚠️ ${data.warning}`
      }
      
      // Add validation issues if any
      if (data.validation?.issues?.length > 0) {
        const errorCount = data.validation.issues.filter((i: any) => i.type === 'error').length
        const warnCount = data.validation.issues.filter((i: any) => i.type === 'warning').length
        if (errorCount > 0 || warnCount > 0) {
          message += `\n\n📋 Validation Report:\n• ${errorCount} error(s)\n• ${warnCount} warning(s)\n\nPlease review the Validation section.`
        }
      }
      
      alert(message)
      
      // Switch to translated jurisdiction
      if (data.draft) {
        setGenerated(data.draft)
        setActiveJurisdiction(code)
      }
    } catch (err) {
      console.error('Translation error:', err)
      alert(`❌ Translation failed: ${err instanceof Error ? err.message : 'Network error'}. Please try again.`)
    } finally {
      setTranslating(null)
    }
  }

  const handleGenerate = async (keys: string[], skipRefresh = false) => {
    if (loading) return
    setLoading(true)
    setShowActivity(true)
    setCurrentKeys(keys)
    try {
      const sections = keys.filter(Boolean)
      if (sections.length === 0) {
        throw new Error('No valid sections to generate')
      }
      
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      // For REFERENCE jurisdiction, use generate_reference_section for proper persistence
      // Handle both single and multi-key by looping
      if (isReference) {
        const generatedContent: Record<string, string> = {}
        const debugStepsCollected: any[] = []
        
        for (const sectionKey of sections) {
          const result = await generateSingleSection(sectionKey, true)
          
          if (result.success && result.content) {
            generatedContent[sectionKey] = result.content
            debugStepsCollected.push({ step: `generate_${sectionKey}`, status: 'done' })
          } else {
            // If generation fails, throw error with context
            throw new Error(`Failed to generate ${displayName[sectionKey] || sectionKey}: ${result.error || 'Unknown error'}`)
          }
        }
        
        // Update state with all generated content
        setGenerated(prev => ({ ...prev, ...generatedContent }))
        setDebugSteps(debugStepsCollected)
        
        // Refresh to get updated session with persisted draft
        if (!skipRefresh) {
          await onRefresh()
        }
      } else {
        // Standard generation for non-REFERENCE jurisdictions
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections,
          usePersonaStyle,
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const filtered: Record<string, string> = {}
        Object.entries(incoming).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim()) filtered[k] = v.trim()
        })
        setGenerated(prev => ({ ...prev, ...filtered }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // Refresh to persist changes
        if (!skipRefresh) {
          await onRefresh()
        }
      }
    } catch (error) {
      console.error('Generation failed:', error)
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setLoading(false)
      // Optionally hide activity after a delay
      // setTimeout(() => setShowActivity(false), 5000)
    }
  }
  
  // Helper function to generate a single section (used by auto-mode)
  const generateSingleSection = async (sectionKey: string, isReference: boolean): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      if (isReference) {
        // Use REFERENCE-specific API
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey
          })
        })
        const data = await res.json()
        if (!res.ok) {
          return { success: false, error: data.error || 'Failed to generate section' }
        }
        if (data.success && data.content) {
          return { success: true, content: data.content }
        }
        return { success: false, error: 'No content returned' }
      } else {
        // Standard generation
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [sectionKey],
          usePersonaStyle,
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const value = typeof incoming?.[sectionKey] === 'string' ? incoming[sectionKey].trim() : ''
        if (value) {
          return { success: true, content: value }
        }
        return { success: false, error: 'No content returned' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  
  // Auto-mode: Generate all sections sequentially without user interaction
  const handleAutoGenerateAll = async () => {
    if (autoModeRunning || loading) return
    
    // Get all section keys that don't have content yet
    const pendingSections = sectionConfigs
      .map(s => s.keys[0])
      .filter(key => key && !generated?.[key]?.trim())
    
    if (pendingSections.length === 0) {
      alert('All sections already have content. Use the regenerate option to update individual sections.')
      return
    }
    
    const confirmed = confirm(
      `🚀 Auto-Generate Mode\n\n` +
      `This will automatically generate ${pendingSections.length} section(s) one by one.\n\n` +
      `Sections to generate:\n${pendingSections.map(k => `• ${displayName[k] || k}`).join('\n')}\n\n` +
      `You can cancel at any time by clicking the Stop button.\n\n` +
      `Do you want to continue?`
    )
    
    if (!confirmed) return
    
    // Reset cancellation flag
    autoModeCancelledRef.current = false
    setAutoModeRunning(true)
    setShowActivity(true)
    
    const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
    let successCount = 0
    let failedSection: string | null = null
    let failedError: string | null = null
    
    try {
      for (let i = 0; i < pendingSections.length; i++) {
        // Check if auto-mode was cancelled (using ref for immediate check)
        if (autoModeCancelledRef.current) {
          console.log('[AutoMode] Cancelled by user')
          break
        }
        
        const sectionKey = pendingSections[i]
        const sectionLabel = displayName[sectionKey] || sectionKey
        
        setAutoModeProgress({
          current: i + 1,
          total: pendingSections.length,
          currentSection: sectionLabel
        })
        
        setCurrentKeys([sectionKey])
        setSectionLoading(prev => ({ ...prev, [sectionKey]: true }))
        
        // First attempt
        let result = await generateSingleSection(sectionKey, isReference)
        
        // If failed, retry once
        if (!result.success) {
          console.log(`[AutoMode] First attempt failed for ${sectionKey}, retrying...`)
          setDebugSteps([{ step: `retry_${sectionKey}`, status: 'running' }])
          
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Check cancellation before retry
          if (autoModeCancelledRef.current) {
            setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
            break
          }
          
          result = await generateSingleSection(sectionKey, isReference)
        }
        
        setSectionLoading(prev => ({ ...prev, [sectionKey]: false }))
        
        if (result.success && result.content) {
          setGenerated(prev => ({ ...prev, [sectionKey]: result.content! }))
          setDebugSteps([{ step: `generate_${sectionKey}`, status: 'done' }])
          successCount++
        } else {
          // Failed after retry - stop auto-mode and notify user
          console.error(`[AutoMode] Failed to generate ${sectionKey} after retry:`, result.error)
          setDebugSteps([{ step: `generate_${sectionKey}`, status: 'fail', meta: { error: result.error } }])
          failedSection = sectionLabel
          failedError = result.error || 'Unknown error'
          break // Stop the loop
        }
        
        // Small delay between sections to avoid overwhelming the API
        if (i < pendingSections.length - 1 && !autoModeCancelledRef.current) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
      
      // Final refresh to ensure all content is persisted
      await onRefresh()
      
      // Show appropriate message based on outcome
      if (autoModeCancelledRef.current) {
        alert(`⏹ Auto-generation stopped.\n\n${successCount} of ${pendingSections.length} section(s) were generated and saved.`)
      } else if (failedSection) {
        alert(
          `❌ Auto-generation stopped due to error.\n\n` +
          `Failed section: ${failedSection}\n` +
          `Error: ${failedError}\n\n` +
          `${successCount} of ${pendingSections.length} section(s) were generated and saved.\n\n` +
          `You can try generating the remaining sections manually or restart auto-mode.`
        )
      } else {
        // Success - show different message based on jurisdiction
        if (isReference) {
          alert(
            `✅ Reference Draft Complete!\n\n` +
            `${successCount} section(s) have been generated and saved.\n\n` +
            `🔓 Other jurisdictions (${availableJurisdictions.join(', ')}) are now unlocked for translation.`
          )
        } else {
          alert(`✅ Auto-generation complete!\n\n${successCount} section(s) have been generated and saved.`)
        }
      }
    } catch (error) {
      console.error('[AutoMode] Unexpected error:', error)
      alert(`Auto-generation failed unexpectedly: ${error instanceof Error ? error.message : 'Unknown error'}\n\n${successCount} section(s) were generated before the error.`)
    } finally {
      setAutoModeRunning(false)
      setAutoModeProgress(null)
      setCurrentKeys(null)
      // Reset cancellation flag
      autoModeCancelledRef.current = false
    }
  }
  
  // Stop auto-mode immediately
  const handleStopAutoMode = () => {
    autoModeCancelledRef.current = true // Immediate flag for sync check
    setAutoMode(false)
  }

  const handleApproveSave = async (keys: string[]) => {
    const patch: Record<string, string> = {}
    for (const k of keys) if (generated?.[k]) patch[k] = generated[k]
    if (Object.keys(patch).length === 0) return
    await onComplete({ action: 'save_sections', sessionId: session?.id, patch })
    await onRefresh()
  }

  const handleAutosaveSection = async (key: string) => {
    const value = (editDrafts?.[key] ?? generated?.[key] ?? '').trim()
    if (!value) return
    setGenerated(prev => ({ ...prev, [key]: value }))
    await onComplete({ action: 'autosave_sections', sessionId: session?.id, patch: { [key]: value } })
    setEditingKey(null)
  }

  const handleRegenerateSection = async (key: string) => {
    if (sectionLoading[key]) return
    setSectionLoading(prev => ({ ...prev, [key]: true }))
    setShowActivity(true)
    try {
      const isReference = activeJurisdiction.toUpperCase() === 'REFERENCE'
      
      if (isReference) {
        // Use REFERENCE-specific API for proper persistence
        const res = await fetch(`/api/patents/${patent?.id}/drafting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`
          },
          body: JSON.stringify({
            action: 'generate_reference_section',
            sessionId: session?.id,
            sectionKey: key
          })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to regenerate section')
        }
        if (data.success && data.content) {
          setGenerated(prev => ({ ...prev, [key]: data.content }))
        }
        setDebugSteps([{ step: `regenerate_${key}`, status: 'done' }])
        // Refresh to persist changes
        await onRefresh()
      } else {
        // Standard regeneration for non-REFERENCE jurisdictions
        const instructions: Record<string, string> = {}
        if (regenRemarks[key]) instructions[key] = regenRemarks[key]
        const res = await onComplete({
          action: 'generate_sections',
          sessionId: session?.id,
          sections: [key],
          instructions,
          usePersonaStyle,
          jurisdiction: activeJurisdiction
        })
        const incoming = res?.generated || {}
        const value = typeof incoming?.[key] === 'string' ? incoming[key].trim() : ''
        if (value) setGenerated(prev => ({ ...prev, [key]: value }))
        setDebugSteps(res?.debugSteps || [])
        
        // Extract B+T+U prompt injection info from debug steps
        const steps = res?.debugSteps || []
        const injectionInfo: Record<string, any> = {}
        steps.forEach((step: any) => {
          if (step.step?.startsWith('build_prompt_') && step.meta?.promptInjection) {
            const sectionKey = step.step.replace('build_prompt_', '')
            injectionInfo[sectionKey] = step.meta.promptInjection
          }
        })
        if (Object.keys(injectionInfo).length > 0) {
          setPromptInjectionInfo(prev => ({ ...prev, ...injectionInfo }))
        }
        
        // Refresh to persist changes
        await onRefresh()
      }
      
      setRegenOpen(prev => ({ ...prev, [key]: false }))
      setRegenRemarks(prev => ({ ...prev, [key]: '' }))
    } catch (error) {
      console.error('Regeneration failed:', error)
      alert(`Regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again or contact support if the issue persists.`)
      setDebugSteps([{ step: 'error', status: 'fail', meta: { error: error instanceof Error ? error.message : String(error) } }])
    } finally {
      setSectionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // If no jurisdictions are available, show a message instead of defaulting to IN
  if (availableJurisdictions.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-gray-500 mb-4">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Jurisdictions Available</h3>
        <p className="text-gray-500 mb-4">All patent jurisdictions have been removed from this drafting session.</p>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div className="pb-24 pt-8 bg-[#F5F6F7] min-h-screen">
      {/* Top Controls Bar */}
      <div className="max-w-[850px] mx-auto mb-6 px-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Annexure Draft</h2>
          <p className="text-sm text-gray-500">Review and edit your patent application.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
           {/* AI Persona Toggle with Writing Samples */}
           <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm border transition-colors ${
             usePersonaStyle 
               ? 'bg-emerald-50 border-emerald-300' 
               : 'bg-red-50 border-red-200'
           }`}>
            <button
              onClick={() => setUsePersonaStyle(!usePersonaStyle)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                usePersonaStyle ? 'bg-emerald-500' : 'bg-red-400'
              }`}
              title={usePersonaStyle ? 'Style mimicry is ON' : 'Style mimicry is OFF'}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                usePersonaStyle ? 'left-5' : 'left-0.5'
              }`} />
            </button>
            <span className={`text-xs font-medium ${usePersonaStyle ? 'text-emerald-700' : 'text-red-600'}`}>
              {usePersonaStyle ? '✓ Style ON' : '○ Style OFF'}
            </span>
            {/* Selected Persona Display */}
            {personaSelection?.primaryPersonaName && (
              <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-100 rounded">
                {personaSelection.primaryPersonaName}
                {personaSelection.secondaryPersonaNames?.length ? ` +${personaSelection.secondaryPersonaNames.length}` : ''}
              </span>
            )}
            <button
              onClick={() => setShowPersonaManager(true)}
              className="px-2 py-0.5 text-xs rounded bg-blue-50 border border-blue-300 text-blue-600 hover:bg-blue-100"
              title="Select writing persona (CSE, Bio, etc.)"
            >
              👤 Persona
            </button>
            <button
              onClick={() => setShowWritingSamplesModal(true)}
              className="px-2 py-0.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="Manage writing samples"
            >
              ✍️ Samples
            </button>
          </div>

          {/* Auto-Mode Controls */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm border transition-colors ${
            autoModeRunning
              ? 'bg-amber-50 border-amber-300'
              : autoMode 
                ? 'bg-emerald-50 border-emerald-300' 
                : 'bg-gray-50 border-gray-200'
          }`}>
            <button
              onClick={() => setAutoMode(!autoMode)}
              disabled={autoModeRunning}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                autoMode ? 'bg-emerald-500' : 'bg-gray-300'
              } ${autoModeRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={autoMode ? 'Auto-mode is ON' : 'Auto-mode is OFF'}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                autoMode ? 'left-5' : 'left-0.5'
              }`} />
            </button>
            <span className={`text-xs font-medium ${autoMode ? 'text-emerald-700' : 'text-gray-500'}`}>
              {autoModeRunning ? '⏳ Generating...' : autoMode ? '🚀 Auto ON' : '○ Auto OFF'}
            </span>
            {autoMode && !autoModeRunning && (
              <button
                onClick={handleAutoGenerateAll}
                disabled={loading}
                className="px-3 py-1 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 font-medium transition-colors disabled:opacity-50"
              >
                Generate All
              </button>
            )}
            {autoModeRunning && (
              <button
                onClick={handleStopAutoMode}
                className="px-3 py-1 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium transition-colors"
              >
                ⏹ Stop
              </button>
            )}
          </div>
          
          {/* Auto-Mode Progress Indicator */}
          {autoModeProgress && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-medium text-blue-700">
                  {autoModeProgress.current}/{autoModeProgress.total}
                </span>
              </div>
              <span className="text-xs text-blue-600 max-w-[150px] truncate">
                {autoModeProgress.currentSection}
              </span>
            </div>
          )}

          {/* Clear/Delete controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleDeleteDraft(activeJurisdiction, false)}
              disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              title="Clear the generated draft for the active jurisdiction but keep it selected."
            >
              {deletingJurisdiction === activeJurisdiction ? 'Clearing…' : `Clear draft (${activeJurisdiction})`}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteDraft(activeJurisdiction, true)}
              disabled={loading || deletingJurisdiction === activeJurisdiction || autoModeRunning}
              className="inline-flex items-center rounded-md border border-red-500 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
              title="Delete the draft and remove this jurisdiction from the drafting list."
            >
              {deletingJurisdiction === activeJurisdiction ? 'Deleting…' : `Delete & remove (${activeJurisdiction})`}
            </button>
          </div>

          {/* Custom Instructions Button */}
          <button
            onClick={() => setShowAllInstructionsModal(true)}
            className={`p-2 rounded-full shadow-sm border transition-colors relative ${
              Object.keys(userInstructions).length > 0
                ? 'bg-violet-50 border-violet-200 text-violet-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            title="Custom Instructions"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            {Object.keys(userInstructions).length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-violet-500 rounded-full text-[8px] text-white flex items-center justify-center">
                {Object.values(userInstructions).reduce((sum, j) => sum + Object.keys(j).length, 0)}
              </span>
            )}
          </button>

          {/* Formatting Button */}
          <div className="relative">
            <button
              onClick={() => setShowFormatting(!showFormatting)}
              className={`p-2 rounded-full shadow-sm border transition-colors ${
                showFormatting
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              title="Text Formatting"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>

            {/* Formatting Panel */}
            {showFormatting && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Font Family</label>
                    <select
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="serif">Serif (Times New Roman)</option>
                      <option value="sans-serif">Sans Serif (Arial)</option>
                      <option value="monospace">Monospace (Courier)</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="system-ui, sans-serif">System UI</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Font Size</label>
                    <select
                      value={fontSize}
                      onChange={(e) => setFontSize(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="12px">Small (12px)</option>
                      <option value="14px">Medium (14px)</option>
                      <option value="15px">Default (15px)</option>
                      <option value="16px">Large (16px)</option>
                      <option value="18px">Extra Large (18px)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Line Spacing</label>
                    <select
                      value={lineHeight}
                      onChange={(e) => setLineHeight(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="1.3">Compact (1.3)</option>
                      <option value="1.5">Normal (1.5)</option>
                      <option value="1.7">Relaxed (1.7)</option>
                      <option value="1.9">Spacious (1.9)</option>
                      <option value="2.1">Very Spacious (2.1)</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-2 border-t border-gray-100">
                    <button
                      onClick={() => setShowFormatting(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMultiJurisdiction && (
        <div className="max-w-[850px] mx-auto mb-8 px-8">
          <div className="border border-gray-200 rounded-lg bg-white shadow-sm p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Multi-Jurisdiction Filing
              {!session?.referenceDraftComplete && (
                <span className="ml-2 text-amber-600 font-normal normal-case">
                  ⚠️ Generate Reference Draft first
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Reference Draft Tab - Always first in multi-jurisdiction mode */}
              <button
                onClick={() => handleJurisdictionChange('REFERENCE')}
                className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                  activeJurisdiction === 'REFERENCE'
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                📝 Reference Draft
                {session?.referenceDraftComplete && (
                  <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">✓</span>
                )}
              </button>
              
              {/* Country jurisdiction tabs */}
              {availableJurisdictions.map((code) => {
                const isLocked = !session?.referenceDraftComplete
                const hasTranslation = latestDrafts[code]?.version > 0
                
                return (
                <button
                  key={code}
                    onClick={() => !isLocked && handleJurisdictionChange(code)}
                    disabled={isLocked}
                  className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                      isLocked
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                        : code === activeJurisdiction
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                    title={isLocked ? 'Complete Reference Draft first' : `Draft for ${code}`}
                  >
                    {isLocked && '🔒 '}{code}
                    {hasTranslation && !isLocked && (
                      <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1 rounded">v{latestDrafts[code]?.version}</span>
                    )}
                </button>
                )
              })}
            </div>
            
            {/* Translation hint */}
            {session?.referenceDraftComplete && activeJurisdiction !== 'REFERENCE' && (
              <div className="mt-3 text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded p-2">
                💡 <strong>Translation Mode:</strong> Content will be translated from Reference Draft with temp=0 for consistency.
              </div>
            )}
            
            {/* Action buttons for multi-jurisdiction - same UI pattern as other jurisdictions */}
            <div className="mt-4 flex flex-wrap gap-2">
              {activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete && (
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-center gap-2">
                    ✅ Reference Draft Complete
                  </span>
                </div>
              )}
              
              {activeJurisdiction !== 'REFERENCE' && session?.referenceDraftComplete && (
                <button
                  onClick={() => handleTranslateToJurisdiction(activeJurisdiction)}
                  disabled={!!translating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating === activeJurisdiction ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating to {activeJurisdiction}...
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      Translate to {activeJurisdiction}
                    </>
                  )}
                </button>
              )}
              
              {/* Translate All button */}
              {activeJurisdiction === 'REFERENCE' && session?.referenceDraftComplete && availableJurisdictions.length > 0 && (
                <button
                  onClick={async () => {
                    for (const code of availableJurisdictions) {
                      if (!latestDrafts[code]?.version) {
                        await handleTranslateToJurisdiction(code)
                      }
                    }
                  }}
                  disabled={!!translating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {translating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Translating {translating}...
                    </>
                  ) : (
                    <>
                      <span>🌐</span>
                      Translate All ({availableJurisdictions.filter(c => !latestDrafts[c]?.version).length} remaining)
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* B+T+U Debug Panel - Testing Only */}
      {showDebugPanel && (
        <div className="max-w-[850px] mx-auto mb-4 px-8">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">DEBUG</span>
                <h3 className="text-sm font-semibold text-white">Prompt Injection Status (B+T+U)</h3>
              </div>
              <button
                onClick={() => setShowDebugPanel(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Hide ✕
              </button>
            </div>
            
            {/* Legend */}
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">B</span>
                <span className="text-slate-300">Base (Superset)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-amber-500 text-white font-bold flex items-center justify-center text-[10px]">T</span>
                <span className="text-slate-300">TopUp (Country)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-6 h-6 rounded bg-emerald-500 text-white font-bold flex items-center justify-center text-[10px]">U</span>
                <span className="text-slate-300">User Instructions</span>
              </div>
              <div className="flex items-center gap-1.5 ml-4">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400"></span>
                <span className="text-slate-400 text-[10px]">DB</span>
                <span className="inline-block w-2 h-2 rounded-full bg-violet-400 ml-2"></span>
                <span className="text-slate-400 text-[10px]">JSON</span>
              </div>
            </div>
            
            {/* Section Status Grid */}
            <div className="flex flex-wrap gap-2">
              {Object.keys(promptInjectionInfo).length === 0 ? (
                <div className="text-slate-500 text-xs italic">Generate sections to see prompt injection status...</div>
              ) : (
                Object.entries(promptInjectionInfo).map(([key, info]) => (
                  <div key={key} className="bg-slate-700/50 rounded px-2 py-1.5 flex items-center gap-1.5" title={`Key: ${info.key}, Strategy: ${info.strategy}`}>
                    <span className="text-slate-300 text-[10px] font-mono mr-1">{key.substring(0, 12)}{key.length > 12 ? '…' : ''}</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.B ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-400'}`}>B</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.T ? 'bg-amber-500 text-white' : 'bg-slate-600 text-slate-400'}`}>T</span>
                    <span className={`inline-block w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${info.U ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-slate-400'}`}>U</span>
                    {info.T && info.source && (
                      <span className={`inline-block w-2 h-2 rounded-full ${info.source === 'db' ? 'bg-cyan-400' : 'bg-violet-400'}`} title={`Source: ${info.source}`}></span>
                    )}
                  </div>
                ))
              )}
            </div>
            
            {/* Active Profile Info */}
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="flex items-center gap-4 text-xs">
                <div className="text-slate-400">
                  <span className="text-slate-500">Active:</span>{' '}
                  <span className="text-emerald-400 font-semibold">{activeJurisdiction}</span>
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-500">Sections:</span>{' '}
                  <span className="text-white">{sectionConfigs?.length || 0}</span>
                  {usingFallback && <span className="text-amber-400 ml-1">(fallback)</span>}
                </div>
                <div className="text-slate-400">
                  <span className="text-slate-500">Prompts Tracked:</span>{' '}
                  <span className="text-white">{Object.keys(promptInjectionInfo).length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Toggle Debug Panel (if hidden) */}
      {!showDebugPanel && (
        <div className="max-w-[850px] mx-auto mb-2 px-8">
          <button
            onClick={() => setShowDebugPanel(true)}
            className="text-xs text-slate-400 hover:text-slate-600 font-mono"
          >
            [Show B+T+U Debug Panel]
          </button>
        </div>
      )}

      {/* The "Paper" Document */}
      <div className="max-w-[850px] mx-auto bg-white shadow-[0_4px_24px_rgba(0,0,0,0.06)] min-h-[1100px] px-[60px] py-[60px] relative border border-gray-100">

        {profileLoading && (
          <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500">
               <span className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full"></span>
               Loading template...
            </div>
          </div>
        )}

        <div className="space-y-10">
            {(sectionConfigs || fallbackSections).map((section, idx) => {
              const isGeneratingThis = loading && currentKeys?.join('|') === section.keys.join('|')
              const isRegeneratingThis = section.keys.some(k => sectionLoading[k])
              const isWorking = isGeneratingThis || isRegeneratingThis
              const hasContent = section.keys.some(k => generated?.[k])

              return (
              <div key={section.keys.join('|') || idx} className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg">
                {/* Hover Actions (Floating) */}
                <div className={`absolute -right-4 top-0 transform translate-x-full opacity-0 group-hover:opacity-100 transition-opacity pl-2 ${isWorking ? 'opacity-100' : ''}`}>
                   <div className="flex flex-col gap-1 bg-white border border-gray-200 shadow-sm rounded-md p-1">
                      {!hasContent ? (
                         <button
                           disabled={loading}
                           onClick={() => handleGenerate(section.keys)}
                           className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-md"
                           title="Generate"
                         >
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleApproveSave(section.keys)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-md"
                            title="Save"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" /></svg>
                          </button>
                          <button
                             onClick={() => {
                               const key = section.keys[0] // Default to first key for simple edit trigger
                               setEditingKey(editingKey === key ? null : key)
                               setEditDrafts(prev => ({ ...prev, [key]: generated?.[key] || '' }))
                             }}
                             className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
                             title="Edit"
                          >
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </>
                      )}
                   </div>
                </div>

                {/* Section Header */}
                <div className="flex items-baseline justify-between mb-4">
                  <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    {section.label || section.keys.map(k => displayName[k] || k).join(' / ')}
                  </h3>
                    {/* Per-section instruction controls */}
                    {(() => {
                      const key = section.keys[0]
                      const jurisdictionInstr = userInstructions[activeJurisdiction]?.[key]
                      const globalInstr = userInstructions['*']?.[key]
                      const hasInstruction = jurisdictionInstr || globalInstr
                      const activeInstr = jurisdictionInstr || globalInstr
                      const isActive = activeInstr?.isActive !== false
                      
                      return (
                        <div className="relative flex items-center gap-1">
                          {hasInstruction && (
                            <span
                              className={`text-[10px] px-2 py-1 rounded-full ${
                                isActive
                                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-100 text-amber-700 border border-amber-200'
                              }`}
                              title={isActive ? 'Instruction is active' : 'Instruction is saved but inactive'}
                            >
                              {isActive ? 'INSTR ON' : 'INSTR OFF'}
                            </span>
                          )}
                          {/* Quick toggle button - only show if instruction exists */}
                          {hasInstruction && (
                            <button
                              onClick={async () => {
                                const instr = jurisdictionInstr || globalInstr
                                if (!instr) return
                                const newStatus = !isActive
                                try {
                                  await fetch(`/api/patents/${patent?.id}/drafting/user-instructions`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
                                    },
                                    body: JSON.stringify({
                                      sessionId: session?.id,
                                      sectionKey: key,
                                      jurisdiction: instr.jurisdiction || (jurisdictionInstr ? activeJurisdiction : '*'),
                                      instruction: instr.instruction,
                                      emphasis: instr.emphasis,
                                      avoid: instr.avoid,
                                      style: instr.style,
                                      wordCount: instr.wordCount,
                                      isActive: newStatus
                                    })
                                  })
                                  // Update local state
                                  const jur = jurisdictionInstr ? activeJurisdiction : '*'
                                  setUserInstructions(prev => ({
                                    ...prev,
                                    [jur]: {
                                      ...(prev[jur] || {}),
                                      [key]: { ...instr, isActive: newStatus }
                                    }
                                  }))
                                } catch (err) {
                                  console.error('Failed to toggle instruction:', err)
                                }
                              }}
                              className={`p-1 rounded transition-colors ${
                                isActive 
                                  ? 'text-emerald-600 hover:bg-emerald-50' 
                                  : 'text-gray-400 hover:bg-gray-100'
                              }`}
                              title={isActive ? 'Click to disable instruction' : 'Click to enable instruction'}
                            >
                              {isActive ? (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor">
                                  <circle cx="10" cy="10" r="7" strokeWidth="1.5" />
                                </svg>
                              )}
                            </button>
                          )}
                          
                          {/* Edit/Add instruction button */}
                          <button
                            onClick={() => setInstructionPopoverKey(instructionPopoverKey === key ? null : key)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              hasInstruction
                                ? isActive
                                  ? 'text-violet-600 bg-violet-50 hover:bg-violet-100'
                                  : 'text-gray-400 bg-gray-100 hover:bg-gray-200 line-through'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                            title={
                              hasInstruction 
                                ? isActive 
                                  ? `Custom instruction for ${jurisdictionInstr ? activeJurisdiction : 'all jurisdictions'} (active)`
                                  : `Custom instruction (disabled)`
                                : 'Add custom instruction'
                            }
                          >
                            <svg className="w-4 h-4" fill={hasInstruction ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                          </button>
                          
                          {/* Instruction Popover */}
                          {instructionPopoverKey === key && (
                            <SectionInstructionPopover
                              sectionKey={key}
                              sectionLabel={section.label || displayName[key] || key}
                              sessionId={session?.id || ''}
                              patentId={patent?.id || ''}
                              activeJurisdiction={activeJurisdiction}
                              existingInstruction={jurisdictionInstr || null}
                              globalInstruction={globalInstr || null}
                              onSave={(instr) => {
                                const jur = instr.jurisdiction || '*'
                                setUserInstructions(prev => ({
                                  ...prev,
                                  [jur]: {
                                    ...(prev[jur] || {}),
                                    [key]: instr.instruction ? instr : undefined
                                  }
                                }))
                              }}
                              onClose={() => setInstructionPopoverKey(null)}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  {/* Activity Panel Injection */}
                  {isWorking && showActivity && (
                      <div className="ml-4 transform scale-90 origin-right">
                        <BackendActivityPanel
                          isVisible={true}
                          onClose={() => setShowActivity(false)}
                          steps={(Array.isArray(debugSteps) ? debugSteps : []).map((s: any) => ({
                            id: String(s.step || ''),
                            state: s.status === 'fail' ? 'error' : (s.status || 'running')
                          }))}
                        />
                      </div>
                  )}
                </div>

                {/* Content Area */}
                <div className="text-gray-800 text-justify">
                  {!hasContent && !isWorking ? (
                    <div 
                      onClick={() => handleGenerate(section.keys)}
                      className="border-2 border-dashed border-gray-100 rounded-lg p-8 text-center hover:border-indigo-100 hover:bg-indigo-50/30 transition-all cursor-pointer group/empty"
                    >
                       <div className="text-gray-400 group-hover/empty:text-indigo-400 font-medium mb-1">Section not generated</div>
                       <div className="text-xs text-gray-300 group-hover/empty:text-indigo-300">Click to draft with AI</div>
                    </div>
                  ) : (
                    <div>
                      {section.keys.map(keyName => (
                        <div key={keyName} className="mb-6 last:mb-0">
                          {section.keys.length > 1 && (
                             <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 mt-4">{displayName[keyName] || keyName}</h4>
                          )}
                          
                          {/* Toolbar for each section text */}
                          {generated?.[keyName] && (
                             <div className="flex items-center justify-end gap-1 mb-2">
                               <button
                                 onClick={() => copySection(keyName)}
                                 className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                                 title={copiedKey === keyName ? "Copied" : "Copy to clipboard"}
                               >
                                  {copiedKey === keyName ? <svg className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>}
                               </button>
                               <button
                                 onClick={() => !sectionLoading[keyName] && setRegenOpen(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                 className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                 title="Regenerate"
                                 disabled={sectionLoading[keyName]}
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                               </button>
                               <button
                                 onClick={() => { setEditingKey(editingKey === keyName ? null : keyName); setEditDrafts(prev => ({ ...prev, [keyName]: generated?.[keyName] || '' })) }}
                                 className={`p-1.5 rounded transition-colors ${editingKey === keyName ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                                 title="Edit"
                               >
                                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                               </button>
                             </div>
                          )}
                          
                          {editingKey === keyName ? (
                            <div className="relative">
                              <textarea
                                className="w-full border-0 bg-gray-50 p-4 rounded-md text-gray-800 focus:ring-1 focus:ring-indigo-200 resize-none text-justify"
                                style={{
                                  fontFamily,
                                  fontSize,
                                  lineHeight
                                }}
                                value={editDrafts[keyName] ?? generated[keyName] ?? ''}
                                onChange={(e) => setEditDrafts(prev => ({ ...prev, [keyName]: e.target.value }))}
                                rows={Math.max(6, (generated[keyName] || '').split('\n').length)}
                                autoFocus
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={() => setEditingKey(null)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1">Cancel</button>
                                <button onClick={() => handleAutosaveSection(keyName)} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded shadow-sm hover:bg-indigo-700">Save</button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <div className="whitespace-pre-wrap text-justify"
                                   style={{
                                     fontFamily,
                                     fontSize,
                                     lineHeight
                                   }}>
                                {generated[keyName] || (isWorking ? <span className="text-gray-300 animate-pulse">Drafting content...</span> : '')}
                              </div>

                              {/* Inline Regeneration Dialog */}
                              {regenOpen[keyName] && (
                                <div className="mt-4 p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1 bg-indigo-100 rounded-md">
                                       <svg className="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    </div>
                                    <label className="block text-xs font-semibold text-indigo-900">Refinement Instructions</label>
                                  </div>
                                  <textarea
                                    className="w-full border-indigo-200 rounded-md p-3 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                                    value={regenRemarks[keyName] || ''}
                                    onChange={(e) => setRegenRemarks(prev => ({ ...prev, [keyName]: e.target.value }))}
                                    placeholder="Tell the AI what to improve (e.g. 'Make it more concise', 'Expand on the benefits', 'Fix the claim dependencies')..."
                                    rows={3}
                                    autoFocus
                                  />
                                  <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => setRegenOpen(prev => ({ ...prev, [keyName]: false }))} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-white rounded transition-colors border border-transparent hover:border-gray-200">Cancel</button>
                                    <button 
                                      onClick={() => handleRegenerateSection(keyName)} 
                                      disabled={sectionLoading[keyName]}
                                      className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm disabled:opacity-50 flex items-center gap-2"
                                    >
                                      {sectionLoading[keyName] && <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span>}
                                      {sectionLoading[keyName] ? 'Refining...' : 'Regenerate Section'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Inline Section Validation */}
                              {generated[keyName] && (
                                <InlineSectionValidator
                                  sectionKey={keyName}
                                  content={generated[keyName] || ''}
                                  jurisdiction={activeJurisdiction}
                                  patentId={patent?.id || ''}
                                  sessionId={session?.id || ''}
                                  issues={inlineValidationIssues[keyName] || []}
                                  onFix={(fixedContent) => {
                                    setGenerated(prev => ({ ...prev, [keyName]: fixedContent }))
                                    setEditDrafts(prev => ({ ...prev, [keyName]: fixedContent }))
                                  }}
                                  onIssuesChange={(issues) => {
                                    setInlineValidationIssues(prev => ({
                                      ...prev,
                                      [keyName]: issues
                                    }))
                                  }}
                                  isLoading={validationLoading[keyName]}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )})}

            {/* Drawings Section */}
            <div className="group relative hover:bg-gray-50/30 transition-colors -mx-4 px-4 py-2 rounded-lg mt-16 break-before-page">
               <div className="flex items-baseline justify-between mb-8">
                  <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">
                    Drawings
                  </h3>
               </div>
               
               {/* Warning when figures have been added/deleted after freezing the sequence */}
               {sequenceOutdated && figureSequenceFinalized && (
                 <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                   <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>
                   <div>
                     <p className="text-sm text-amber-800 font-medium">Figure sequence may be outdated</p>
                     <p className="text-xs text-amber-700 mt-0.5">{sequenceWarningMessage}</p>
                   </div>
                 </div>
               )}

               <div className="space-y-16">
                 {unifiedFigures.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-lg">
                      <div className="text-gray-400 font-medium mb-1">No figures defined</div>
                      <div className="text-xs text-gray-300">Define figures in the Planner stage to see them here.</div>
                    </div>
                 ) : (
                   unifiedFigures.map((figure) => (
                     <div key={`${figure.type}-${figure.sourceId}`} className="flex flex-col items-center break-inside-avoid">
                       <div className="w-full max-w-3xl bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center bg-gray-50/50 p-4">
                          {figure.imageUrl ? (
                            <img 
                              src={figure.imageUrl} 
                              alt={`Figure ${figure.figureNo}`}
                              className="max-w-full max-h-[600px] object-contain mix-blend-multiply"
                              loading="lazy"
                              onError={(e) => {
                                // Hide broken image and show placeholder instead
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const placeholder = target.nextElementSibling as HTMLElement
                                if (placeholder) placeholder.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          <div 
                            className="text-center p-8 text-gray-400 flex-col items-center"
                            style={{ display: figure.imageUrl ? 'none' : 'flex' }}
                          >
                            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span className="text-sm font-medium">Figure {figure.figureNo}</span>
                            <span className="text-xs opacity-75 mt-1">
                              {figure.title.startsWith('Missing') ? figure.title : (figure.type === 'sketch' ? 'Sketch pending' : 'Draft pending')}
                            </span>
                          </div>
                       </div>
                       <div className="mt-4 text-center max-w-xl">
                         <div className="font-bold text-gray-900 uppercase tracking-widest text-sm flex items-center justify-center gap-2">
                           FIG. {figure.figureNo}
                           {figure.type === 'sketch' && (
                             <span className="text-xs font-normal text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Sketch</span>
                           )}
                           {figure.isNew && <span className="text-xs font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">New</span>}
                         </div>
                         {figure.title && <div className="text-sm text-gray-600 mt-1">{figure.title}</div>}
                       </div>
                     </div>
                   ))
                 )}
               </div>
            </div>
           
            {/* Validation & Export Section (Multi-jurisdiction) */}
            {isMultiJurisdiction && activeJurisdiction !== 'REFERENCE' && latestDrafts[activeJurisdiction]?.version > 0 && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    // Apply the fix to the generated content
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    // Mark as needing save
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    // Scroll to export section or show export modal
                    const exportSection = document.getElementById('export-section')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section" className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
            
            {/* Validation & Export Section (Single jurisdiction) */}
            {!isMultiJurisdiction && Object.keys(generated).length > 0 && (
              <div className="mt-16 border-t pt-8">
                <ValidationPanel
                  sessionId={session?.id || ''}
                  jurisdiction={activeJurisdiction}
                  patentId={patent?.id || ''}
                  draft={generated}
                  onFix={(sectionKey, fixedContent) => {
                    setGenerated(prev => ({ ...prev, [sectionKey]: fixedContent }))
                    setEditDrafts(prev => ({ ...prev, [sectionKey]: fixedContent }))
                  }}
                  onProceedToExport={() => {
                    const exportSection = document.getElementById('export-section-single')
                    if (exportSection) {
                      exportSection.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  onAIIssuesChange={handleAIIssuesChange}
                />
                
                {/* Export Section */}
                <div id="export-section-single" className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Export Options</h4>
                  <ExportButton
                    sessionId={session?.id || ''}
                    jurisdiction={activeJurisdiction}
                    patentId={patent?.id || ''}
                    disabled={false}
                  />
                </div>
              </div>
            )}
        </div>
    </div>

      {/* All Instructions Modal */}
      {showAllInstructionsModal && (
        <AllInstructionsModal
          sessionId={session?.id || ''}
          patentId={patent?.id || ''}
          activeJurisdiction={activeJurisdiction}
          availableJurisdictions={availableJurisdictions}
          sectionLabels={displayName}
          onClose={() => setShowAllInstructionsModal(false)}
          onUpdate={() => {
            // Refresh instructions
            fetch(`/api/patents/${patent?.id}/drafting/user-instructions?sessionId=${session?.id}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` }
            })
              .then(res => res.json())
              .then(data => setUserInstructions(data.grouped || {}))
              .catch(console.error)
          }}
        />
      )}

      {/* Persona Manager Modal */}
      {showPersonaManager && (
        <PersonaManager
          isOpen={showPersonaManager}
          onClose={() => setShowPersonaManager(false)}
          showSelector={true}
          currentSelection={personaSelection}
          onSelectPersona={(selection) => {
            setPersonaSelection(selection)
            if (selection.primaryPersonaId) {
              setUsePersonaStyle(true) // Auto-enable style when persona selected
            }
          }}
        />
      )}

      {/* Writing Samples Modal */}
      {showWritingSamplesModal && (
        <WritingSamplesModal
          onClose={() => setShowWritingSamplesModal(false)}
          onUpdate={() => {
            // Could refresh any UI state related to samples
          }}
        />
      )}

    </div>
  )
}
