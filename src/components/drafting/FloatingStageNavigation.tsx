'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface FloatingStageNavigationProps {
  onNavigatePrev: () => void
  onNavigateNext: () => void
  canGoPrev: boolean
  canGoNext: boolean
}

export default function FloatingStageNavigation({
  onNavigatePrev,
  onNavigateNext,
  canGoPrev,
  canGoNext
}: FloatingStageNavigationProps) {
  return (
    <>
      {/* Left Arrow - Previous Stage */}
      <button
        onClick={onNavigatePrev}
        disabled={!canGoPrev}
        className={`
          fixed left-4 top-1/2 transform -translate-y-1/2 z-40
          p-3 rounded-full
          bg-white/80 backdrop-blur-sm border border-gray-200/60
          shadow-lg hover:shadow-xl
          transition-all duration-300 ease-out
          ${canGoPrev
            ? 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 cursor-pointer opacity-60 hover:opacity-100'
            : 'text-gray-300 cursor-not-allowed opacity-30'
          }
          group
        `}
        title="Previous Stage"
      >
        <ChevronLeft
          className={`
            w-6 h-6 transition-all duration-300
            ${canGoPrev ? 'group-hover:scale-110' : ''}
          `}
          strokeWidth={2.5}
        />
      </button>

      {/* Right Arrow - Next Stage */}
      <button
        onClick={onNavigateNext}
        disabled={!canGoNext}
        className={`
          fixed right-4 top-1/2 transform -translate-y-1/2 z-40
          p-3 rounded-full
          bg-white/80 backdrop-blur-sm border border-gray-200/60
          shadow-lg hover:shadow-xl
          transition-all duration-300 ease-out
          ${canGoNext
            ? 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 cursor-pointer opacity-60 hover:opacity-100'
            : 'text-gray-300 cursor-not-allowed opacity-30'
          }
          group
        `}
        title="Next Stage"
      >
        <ChevronRight
          className={`
            w-6 h-6 transition-all duration-300
            ${canGoNext ? 'group-hover:scale-110' : ''}
          `}
          strokeWidth={2.5}
        />
      </button>
    </>
  )
}

