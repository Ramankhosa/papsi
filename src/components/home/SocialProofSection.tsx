'use client'

import { useEffect, useState } from 'react'

interface ReviewCardProps {
  quote: string
  delay?: number
}

function ReviewCard({ quote, delay = 0 }: ReviewCardProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`bg-white p-6 rounded-lg shadow-sm border border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'
      } hover:shadow-md`}
    >
      <p className="text-gray-700 italic leading-relaxed">
        "{quote}"
      </p>
    </div>
  )
}

export default function SocialProofSection() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Trusted by innovators from academia, startups, and IP professionals worldwide.
          </p>

          {/* Trust Indicators - Logos in grayscale/outline style */}
          <div className="flex justify-center items-center space-x-8 mb-12 opacity-60">
            <div className="text-gray-400 text-lg font-semibold">IITs</div>
            <div className="w-px h-8 bg-gray-300"></div>
            <div className="text-gray-400 text-lg font-semibold">DST</div>
            <div className="w-px h-8 bg-gray-300"></div>
            <div className="text-gray-400 text-lg font-semibold">Start-Up India</div>
          </div>
        </div>

        {/* Micro-Reviews */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ReviewCard
            quote="Feels like working with a 24/7 patent attorney."
            delay={0}
          />
          <ReviewCard
            quote="I explained my idea in one paragraph — got a draft in minutes."
            delay={200}
          />
          <ReviewCard
            quote="The AI actually understands patent law, not just keywords."
            delay={400}
          />
        </div>
      </div>
    </section>
  )
}
