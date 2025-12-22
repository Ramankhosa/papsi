'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Lightbulb,
  Search,
  Download,
  Star,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface IdeaFrame {
  id: string
  title: string
  problem: string
  principle: string
  technicalEffect?: string
  status: string
  noveltyScore?: number
  userRating?: number
  data?: any
}

interface IdeaFramePanelProps {
  ideas: IdeaFrame[]
  onSelectIdea: (idea: IdeaFrame) => void
  onCheckNovelty: (ideaId: string) => void
  onExport: (ideaIds: string[]) => void
  onClose: () => void
}

export default function IdeaFramePanel({
  ideas,
  onSelectIdea,
  onCheckNovelty,
  onExport,
  onClose,
}: IdeaFramePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set())
  const [checkingNovelty, setCheckingNovelty] = useState<string | null>(null)

  const handleNoveltyCheck = async (ideaId: string) => {
    setCheckingNovelty(ideaId)
    await onCheckNovelty(ideaId)
    setCheckingNovelty(null)
  }

  const toggleExportSelection = (ideaId: string) => {
    setSelectedForExport(prev => {
      const next = new Set(prev)
      if (next.has(ideaId)) {
        next.delete(ideaId)
      } else {
        next.add(ideaId)
      }
      return next
    })
  }

  const handleExport = () => {
    if (selectedForExport.size > 0) {
      onExport(Array.from(selectedForExport))
    }
  }

  const getNoveltyColor = (score?: number) => {
    if (score === undefined) return 'bg-slate-100 text-slate-600'
    if (score >= 70) return 'bg-green-100 text-green-700'
    if (score >= 40) return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SHORTLISTED':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />
      case 'REJECTED':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'EXPORTED':
        return <ExternalLink className="w-4 h-4 text-blue-500" />
      default:
        return <Lightbulb className="w-4 h-4 text-purple-500" />
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-violet-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-purple-500" />
            Generated Ideas ({ideas.length})
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-200 rounded-md transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Review, rate, and export your generated invention ideas
        </p>
      </div>

      {/* Ideas List */}
      <div className="flex-1 overflow-auto">
        {ideas.map((idea, index) => (
          <motion.div
            key={idea.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="border-b border-slate-100"
          >
            {/* Idea Header */}
            <div
              className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                selectedForExport.has(idea.id) ? 'bg-violet-50' : ''
              }`}
              onClick={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
            >
              <div className="flex items-start gap-3">
                {/* Selection Checkbox */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExportSelection(idea.id)
                  }}
                  className={`
                    flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5
                    transition-colors
                    ${selectedForExport.has(idea.id)
                      ? 'bg-violet-500 border-violet-500'
                      : 'border-slate-300 hover:border-violet-400'
                    }
                  `}
                >
                  {selectedForExport.has(idea.id) && (
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusIcon(idea.status)}
                    <h4 className="font-medium text-slate-900 text-sm line-clamp-1">
                      {idea.title}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {idea.principle}
                  </p>

                  {/* Tags & Scores */}
                  <div className="flex items-center gap-2 mt-2">
                    {idea.noveltyScore !== undefined && (
                      <Badge className={getNoveltyColor(idea.noveltyScore)}>
                        {idea.noveltyScore}% novel
                      </Badge>
                    )}
                    {idea.userRating && (
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star
                            key={star}
                            className={`w-3 h-3 ${
                              star <= idea.userRating!
                                ? 'text-yellow-400 fill-yellow-400'
                                : 'text-slate-200'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expand Icon */}
                <div className="flex-shrink-0">
                  {expandedId === idea.id ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>
            </div>

            {/* Expanded Details */}
            <AnimatePresence>
              {expandedId === idea.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3">
                    {/* Problem */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Problem
                      </label>
                      <p className="text-sm text-slate-700 mt-1">
                        {idea.problem}
                      </p>
                    </div>

                    {/* Technical Effect */}
                    {idea.technicalEffect && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Technical Effect
                        </label>
                        <p className="text-sm text-slate-700 mt-1">
                          {idea.technicalEffect}
                        </p>
                      </div>
                    )}

                    {/* Additional Data */}
                    {idea.data && (
                      <>
                        {/* Components */}
                        {idea.data.components?.length > 0 && (
                          <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              Components
                            </label>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {idea.data.components.map((comp: string, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {comp}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Variants */}
                        {idea.data.variants?.length > 0 && (
                          <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              Variants ({idea.data.variants.length})
                            </label>
                            <div className="mt-1 space-y-1">
                              {idea.data.variants.slice(0, 3).map((v: any, i: number) => (
                                <div key={i} className="text-xs text-slate-600 pl-2 border-l-2 border-violet-200">
                                  <span className="font-medium">{v.title}:</span> {v.description}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Claim Hooks */}
                        {idea.data.claimHooks?.length > 0 && (
                          <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              Claim Hooks
                            </label>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {idea.data.claimHooks.slice(0, 5).map((hook: string, i: number) => (
                                <Badge key={i} className="bg-purple-100 text-purple-700 text-[10px]">
                                  {hook}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleNoveltyCheck(idea.id)
                        }}
                        disabled={checkingNovelty === idea.id}
                        className="text-xs"
                      >
                        {checkingNovelty === idea.id ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Checking...
                          </>
                        ) : (
                          <>
                            <Search className="w-3 h-3 mr-1" />
                            Check Novelty
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectIdea(idea)
                        }}
                        className="text-xs"
                      >
                        <ArrowRight className="w-3 h-3 mr-1" />
                        Full Details
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>

      {/* Export Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500">
            {selectedForExport.size} selected for export
          </span>
          {selectedForExport.size > 0 && (
            <button
              onClick={() => setSelectedForExport(new Set())}
              className="text-xs text-violet-600 hover:text-violet-800"
            >
              Clear selection
            </button>
          )}
        </div>
        <Button
          onClick={handleExport}
          disabled={selectedForExport.size === 0}
          className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-lg"
        >
          <Download className="w-4 h-4 mr-2" />
          Export to Idea Bank ({selectedForExport.size})
        </Button>
      </div>
    </div>
  )
}

