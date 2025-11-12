'use client'

import { useState, useEffect } from 'react'

interface KishoWidgetProps {
  onTipClick?: (tip: string) => void
}

const kishoTips = [
  "Group similar ideas before drafting — saves 20% editing time.",
  "Review patent abstracts first, claims second — efficiency hack.",
  "Save drafts frequently; your ideas are worth protecting.",
  "Novelty searches work best with specific technical details.",
  "Take breaks between drafting sessions — fresh eyes catch more.",
  "Start with the problem your invention solves, not the solution.",
  "Similar patents aren't dead ends — they're innovation opportunities.",
  "Document your 'why' for each invention — it strengthens claims."
]

export default function KishoWidget({ onTipClick }: KishoWidgetProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showSpeechBubble, setShowSpeechBubble] = useState(false)
  const [currentTip, setCurrentTip] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    // Show welcome tip on mount
    const timer = setTimeout(() => {
      showRandomTip()
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  const showRandomTip = () => {
    const randomTip = kishoTips[Math.floor(Math.random() * kishoTips.length)]
    setCurrentTip(randomTip)
    setShowSpeechBubble(true)

    // Auto-hide after 8 seconds
    setTimeout(() => {
      setShowSpeechBubble(false)
    }, 8000)
  }

  const handleClick = () => {
    setIsAnimating(true)
    showRandomTip()
    onTipClick?.(currentTip)

    // Reset animation after a short delay
    setTimeout(() => setIsAnimating(false), 500)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Speech Bubble */}
      {showSpeechBubble && (
        <div className="absolute bottom-full right-0 mb-4 max-w-xs animate-fade-in">
          <div className="bg-white/90 border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-[#4C5EFF] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                💭
              </div>
              <p className="text-sm text-[#334155] leading-relaxed" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 400 }}>
                {currentTip}
              </p>
            </div>

            {/* Speech bubble pointer */}
            <div className="absolute top-full right-8 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white/90"></div>
          </div>
        </div>
      )}

      {/* Kisho Avatar */}
      <div
        className={`
          relative group cursor-pointer transition-all duration-300
          ${isHovered ? 'scale-110' : 'scale-100'}
          ${isAnimating ? 'animate-bounce' : ''}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleClick}
      >
        {/* Drop shadow */}
        <div className={`
          absolute inset-0 rounded-full bg-black/10
          blur-sm opacity-30 -bottom-2
          ${isHovered ? 'opacity-40 scale-125' : ''}
          transition-all duration-300
        `}></div>

        {/* Avatar container */}
        <div className={`
          relative w-16 h-16 bg-white
          rounded-full flex items-center justify-center shadow-md
          border-2 border-[#E5E7EB] overflow-hidden
          ${isHovered ? 'shadow-lg' : ''}
          transition-all duration-300
        `}>
          {/* Kisho image */}
          <img
            src="/images/kisho.jpg"
            alt="Kisho - Your AI Assistant"
            className={`
              w-full h-full object-cover rounded-full transition-transform duration-300
              ${isHovered ? 'scale-110' : 'scale-100'}
            `}
          />

          {/* Silver-blue shimmer effect */}
          <div className={`
            absolute inset-2 rounded-full bg-gradient-to-r from-[#B4C6FF] to-[#A8E2D5]
            opacity-10 animate-pulse
            ${isHovered ? 'opacity-20' : ''}
          `}></div>
        </div>

        {/* Hover tooltip */}
        {isHovered && (
          <div className="absolute bottom-full right-0 mb-3 px-3 py-2 bg-white text-[#334155] text-xs rounded-lg whitespace-nowrap shadow-sm border border-[#E5E7EB]">
            Click for a tip!
            <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white"></div>
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full animate-pulse">
          <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-75"></div>
        </div>
      </div>
    </div>
  )
}
