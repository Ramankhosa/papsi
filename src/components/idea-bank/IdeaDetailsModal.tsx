'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'
import { Lightbulb, TrendingUp, Zap, Target, Layers, BarChart3, Users, Calendar, Bot, Sparkles } from 'lucide-react'

interface IdeaDetailsModalProps {
  idea: IdeaBankIdeaWithDetails
  open: boolean
  onClose: () => void
  onReserve: () => void
  onRelease: () => void
  onEdit: () => void
  onSendToSearch: () => void
  onSendToDrafting: () => void
}

export default function IdeaDetailsModal({
  idea,
  open,
  onClose,
  onReserve,
  onRelease,
  onEdit,
  onSendToSearch,
  onSendToDrafting
}: IdeaDetailsModalProps) {
  const isReserved = idea.status === 'RESERVED'
  const isReservedByUser = idea._isReservedByCurrentUser
  const canSeeFullContent = !isReserved || isReservedByUser

  const getStatusColor = () => {
    switch (idea.status) {
      case 'PUBLIC': return 'bg-green-100 text-green-800 border-green-200'
      case 'RESERVED': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'LICENSED': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'ARCHIVED': return 'bg-gray-100 text-gray-800 border-gray-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getDomainTagColor = () => {
    return 'bg-blue-100 text-blue-800 border-blue-200'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-white border border-gray-200 shadow-lg">
        <DialogHeader className="pb-4 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-gray-600" />
                <span className="text-sm text-gray-600">AI Generated Idea</span>
              </div>
              <DialogTitle className="text-xl font-semibold text-gray-900">
                {idea.title}
              </DialogTitle>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                {idea.noveltyScore && (
                  <span>Novelty: {(idea.noveltyScore * 100).toFixed(1)}%</span>
                )}
                <span>Reservations: {idea.reservedCount}</span>
              </div>
            </div>
            <Badge className={`${getStatusColor()} font-medium`}>
              {idea.status.toLowerCase()}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-5">
          {/* Core Principle */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Core Principle</h3>
            <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">
              {canSeeFullContent ? idea.description : idea._redactedDescription}
            </div>
            {isReserved && !isReservedByUser && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-yellow-800 text-sm">
                  This content is reserved. Only the first few words are visible.
                  Reserve this idea to see the full description and take further actions.
                </p>
              </div>
            )}
          </div>

          {/* Expected Advantage */}
          {idea.abstract && canSeeFullContent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Expected Advantage</h3>
              <div className="text-gray-700 italic whitespace-pre-wrap leading-relaxed">
                {idea.abstract}
              </div>
            </div>
          )}

          {/* Non-obvious Extension */}
          {idea.keyFeatures.length > 0 && canSeeFullContent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Non-obvious Extension</h3>
              <div className="space-y-2">
                {idea.keyFeatures.map((feature, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">
                      {index + 1}
                    </span>
                    <div className="text-gray-700 leading-relaxed">{feature}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Domain Tags and Technical Field */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {idea.domainTags.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Domain Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {idea.domainTags.map(tag => (
                    <Badge key={tag} className={`${getDomainTagColor()} font-medium`}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {idea.technicalField && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">Technical Field</h3>
                <p className="text-gray-700">{idea.technicalField}</p>
              </div>
            )}
          </div>

          {/* Potential Applications */}
          {idea.potentialApplications.length > 0 && canSeeFullContent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Potential Applications</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {idea.potentialApplications.map((app, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-gray-100 text-gray-700 rounded-full flex items-center justify-center text-sm font-medium mt-0.5">
                      {index + 1}
                    </span>
                    <div className="text-gray-700 leading-relaxed">{app}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prior Art Analysis */}
          {idea.priorArtSummary && canSeeFullContent && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Prior Art Analysis</h3>
              <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-4 rounded border text-sm leading-relaxed">
                {idea.priorArtSummary}
              </div>
            </div>
          )}

          {/* Derivation Information */}
          {(idea.derivedFrom || idea.derivedIdeas.length > 0) && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Idea Genealogy</h3>
              <div className="space-y-3">
                {idea.derivedFrom && (
                  <div className="p-3 bg-gray-50 rounded border">
                    <div className="text-sm text-gray-600 mb-1">Derived From</div>
                    <div className="font-medium text-gray-900">"{idea.derivedFrom.title}"</div>
                  </div>
                )}
                {idea.derivedIdeas.length > 0 && (
                  <div className="p-3 bg-gray-50 rounded border">
                    <div className="text-sm text-gray-600 mb-2">Derived Ideas ({idea.derivedIdeas.length})</div>
                    <div className="space-y-1">
                      {idea.derivedIdeas.map(derived => (
                        <div key={derived.id} className="text-sm text-gray-700">
                          • {derived.title}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="border-t border-gray-200 pt-5">
          <div className="flex flex-wrap gap-3 justify-between items-center">
            <div className="flex flex-wrap gap-3">
              {isReservedByUser ? (
                <>
                  <Button
                    onClick={onRelease}
                    variant="outline"
                    className="border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                  >
                    Release Reservation
                  </Button>
                  <Button onClick={onSendToSearch} className="bg-blue-600 hover:bg-blue-700">
                    Send to Novelty Search
                  </Button>
                  <Button onClick={onSendToDrafting} className="bg-green-600 hover:bg-green-700">
                    Send to Patent Drafting
                  </Button>
                </>
              ) : !isReserved ? (
                <Button onClick={onReserve} className="bg-yellow-600 hover:bg-yellow-700">
                  Reserve Idea
                </Button>
              ) : (
                <div className="text-yellow-700 text-sm font-medium">
                  This idea is currently reserved by another user
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button onClick={onEdit} variant="outline">
                Clone & Edit
              </Button>
              <Button onClick={onClose} variant="ghost">
                Close
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
