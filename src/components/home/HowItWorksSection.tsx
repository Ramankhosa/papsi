'use client'

import { useEffect, useState } from 'react'

interface StepCardProps {
  icon: string
  title: string
  description: string
  delay?: number
}

function StepCard({ icon, title, description, delay = 0 }: StepCardProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`text-center p-8 rounded-xl bg-white shadow-sm border border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'
      } hover:shadow-lg hover:scale-105`}
    >
      <div className="text-6xl mb-6">{icon}</div>
      <h3 className="text-2xl font-semibold text-gray-900 mb-4 font-serif">
        {title}
      </h3>
      <p className="text-gray-600 leading-relaxed">
        {description}
      </p>
    </div>
  )
}

export default function HowItWorksSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-6">
            How It Works
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <StepCard
            icon="💭"
            title="Think."
            description="Type your idea in simple language. No templates needed."
            delay={0}
          />
          <StepCard
            icon="🔍"
            title="Validate."
            description="Our AI compares your idea with millions of patents worldwide."
            delay={200}
          />
          <StepCard
            icon="📄"
            title="Draft."
            description="Instantly generate a complete patent document with diagrams and claims."
            delay={400}
          />
        </div>

        <div className="text-center">
          <p className="text-lg text-gray-500 max-w-4xl mx-auto leading-relaxed">
            Behind the simplicity lies a trained system powered by advanced legal AI and real patent data — designed to think like an attorney, not a chatbot.
          </p>
        </div>
      </div>
    </section>
  )
}
