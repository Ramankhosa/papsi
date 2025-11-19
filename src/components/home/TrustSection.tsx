'use client'

import { useEffect, useState } from 'react'

interface StatCardProps {
  number: string
  label: string
  delay?: number
}

function StatCard({ number, label, delay = 0 }: StatCardProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`text-center p-8 rounded-xl bg-white/90 shadow-sm border border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      } hover:shadow-md hover:scale-[1.02]`}
    >
      <div className="text-4xl md:text-5xl font-bold text-gpt-blue-600 mb-2 font-serif">{number}</div>
      <div className="text-gray-600 font-medium">{label}</div>
    </div>
  )
}

export default function TrustSection() {
  return (
    <section className="py-20 bg-gpt-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <StatCard number="6,000+" label="ideas analyzed for novelty" delay={0} />
          <StatCard number="85%" label="faster draft turnaround" delay={200} />
          <StatCard number="Global" label="formats for USPTO, EPO, and Indian filings" delay={400} />
        </div>

        <div className="text-center">
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            From your concept to a ready-to-file draft — all under one intelligent roof.
          </p>
        </div>
      </div>
    </section>
  )
}

