'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'

interface IdeaCardProps {
  idea: IdeaBankIdeaWithDetails
  onView: () => void
  onReserve: () => void
  onRelease: () => void
  onEdit: () => void
  onSendToSearch: () => void
  onSendToDrafting: () => void
}

export default function IdeaCard({
  idea,
  onView,
  onReserve,
  onRelease,
  onEdit,
  onSendToSearch,
  onSendToDrafting
}: IdeaCardProps) {
  const [isReserving, setIsReserving] = useState(false)
  const [reservationSuccess, setReservationSuccess] = useState(false)

  const isReserved = idea.status === 'RESERVED'
  const isReservedByUser = idea._isReservedByCurrentUser
  const isRedacted = isReserved && !isReservedByUser

  const handleReserve = async () => {
    setIsReserving(true)
    try {
      await onReserve()
      setReservationSuccess(true)
      // Reset success state after a delay
      setTimeout(() => setReservationSuccess(false), 3000)
    } catch (error) {
      console.error('Reservation failed:', error)
    } finally {
      setIsReserving(false)
    }
  }

  const getStatusColor = () => {
    switch (idea.status) {
      case 'PUBLIC': return 'bg-green-100 text-green-800'
      case 'RESERVED': return 'bg-orange-100 text-orange-800'
      case 'LICENSED': return 'bg-blue-100 text-blue-800'
      case 'ARCHIVED': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getNoveltyColor = (score?: number | null) => {
    if (!score) return 'bg-gray-100 text-gray-600'
    if (score >= 0.8) return 'bg-green-100 text-green-800'
    if (score >= 0.6) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  return (
    <Card className={`transition-all duration-200 hover:shadow-lg ${
      isReserved ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
    } ${isReservedByUser ? 'ring-2 ring-orange-300' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start mb-2">
          <Badge className={getStatusColor()}>
            {idea.status.toLowerCase()}
          </Badge>
          {idea.noveltyScore && (
            <Badge className={getNoveltyColor(idea.noveltyScore)}>
              Novelty: {(idea.noveltyScore * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
        <h3 className="font-semibold text-lg text-gray-900 line-clamp-2">
          {isRedacted ? `${idea.title.split(' ').slice(0, 3).join(' ')}...` : idea.title}
        </h3>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Description */}
        <div>
          <p className="text-sm text-gray-600 line-clamp-3">
            {idea._redactedDescription || idea.description}
          </p>
          {isRedacted && (
            <p className="text-xs text-orange-600 mt-1">
              Content reserved • {idea.reservedCount} reservations
            </p>
          )}
        </div>

        {/* Domain Tags */}
        {idea.domainTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {idea.domainTags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {idea.domainTags.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{idea.domainTags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Technical Field */}
        {idea.technicalField && (
          <div className="text-xs text-gray-500">
            Field: {idea.technicalField}
          </div>
        )}

        {/* Creator Info */}
        <div className="text-xs text-gray-500">
          By {idea.creator.name || idea.creator.email} • {new Date(idea.createdAt).toLocaleDateString()}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onView}
            className="flex-1"
          >
            View Details
          </Button>

          {isReservedByUser ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onRelease}
                className="text-orange-600 border-orange-300 hover:bg-orange-50"
              >
                Release
              </Button>
              <Button
                size="sm"
                onClick={onSendToSearch}
                className="bg-blue-600 hover:bg-blue-700"
              >
                🔍 Search
              </Button>
              <Button
                size="sm"
                onClick={onSendToDrafting}
                className="bg-green-600 hover:bg-green-700"
              >
                ✍️ Draft
              </Button>
            </>
          ) : !isReserved ? (
            <Button
              size="sm"
              onClick={handleReserve}
              disabled={isReserving}
              className={`bg-orange-600 hover:bg-orange-700 ${
                reservationSuccess ? 'bg-green-600 hover:bg-green-700' : ''
              }`}
            >
              {isReserving ? (
                <div className="flex items-center gap-1">
                  <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                  <span>Reserving...</span>
                </div>
              ) : reservationSuccess ? (
                <div className="flex items-center gap-1">
                  <span>✓ Reserved</span>
                </div>
              ) : (
                'Reserve'
              )}
            </Button>
          ) : isReservedByUser ? (
            <Button
              size="sm"
              onClick={onReserve}
              disabled
              className="bg-green-600 hover:bg-green-700 cursor-not-allowed flex items-center gap-1"
            >
              <span>✓ Reserved</span>
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            className="text-gray-600"
          >
            ✏️ Edit
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
