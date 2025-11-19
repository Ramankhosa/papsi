'use client'

import { useEffect, useState } from 'react'

interface StepCardProps {
  step: string
  title: string
  description: string
  delay?: number
}

function StepCard({ step, title, description, delay = 0 }: StepCardProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`text-center p-8 rounded-xl bg-white shadow-sm border border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      } hover:shadow-md hover:scale-[1.02]`}
    >
      <div className="flex justify-center mb-6">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gpt-blue-600/60 bg-gpt-blue-50 text-gpt-blue-700 text-sm font-semibold">
          {step}
        </div>
      </div>
      <h3 className="text-2xl font-semibold text-gray-900 mb-3 font-serif">{title}</h3>
      <p className="text-gray-600 leading-relaxed text-sm md:text-base">{description}</p>
    </div>
  )
}

export default function HowItWorksSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-4">How it works</h2>
          <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto">
            A calm, three-step flow that keeps you in control while our AI handles the heavy lifting.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          <StepCard
            step="01"
            title="Capture your idea"
            description="Describe your invention in natural language. No templates, no formatting rules—just your thinking."
            delay={0}
          />
          <StepCard
            step="02"
            title="Validate in context"
            description="Our AI scans global patent data to surface relevant prior art and novelty signals around your idea."
            delay={200}
          />
          <StepCard
            step="03"
            title="Draft with confidence"
            description="Turn validated concepts into structured patent drafts, complete with claims and technical structure."
            delay={400}
          />
        </div>

        <div className="text-center">
          <p className="text-sm md:text-base text-gray-500 max-w-3xl mx-auto leading-relaxed">
            Behind the simple interface is a system trained on real patent practice—designed to think more like an
            attorney than a chatbot.
          </p>
        </div>
      </div>
    </section>
  )
}

