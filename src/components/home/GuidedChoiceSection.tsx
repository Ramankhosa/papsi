'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useEffect, useState } from 'react'

interface ChoiceCardProps {
  label: string
  title: string
  description: string
  href: string
  hint: string
  delay?: number
}

function ChoiceCard({ label, title, description, href, hint, delay = 0 }: ChoiceCardProps) {
  const { user } = useAuth()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  const finalHref = user ? href : '/register'

  return (
    <Link
      href={finalHref}
      className={`block p-8 bg-white rounded-xl shadow-sm border border-gray-100 transition-all duration-700 hover:shadow-md hover:scale-[1.02] hover:border-gpt-blue-200 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      <div className="flex flex-col items-center text-center space-y-3">
        <span className="inline-flex items-center rounded-full border border-gpt-blue-600/40 bg-gpt-blue-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-gpt-blue-700">
          {label}
        </span>
        <h3 className="text-xl font-semibold text-gray-900 font-serif">{title}</h3>
        <p className="text-gray-600 leading-relaxed text-sm md:text-base">{description}</p>
        <div className="text-xs md:text-sm text-gpt-blue-600 font-medium">{hint}</div>
      </div>
    </Link>
  )
}

export default function GuidedChoiceSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-4">
            What would you like to do today?
          </h2>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto">
            Choose the path that matches where you are in your patent journey.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <ChoiceCard
            label="Start here"
            title="Validate my idea"
            description="Check if your invention appears novel across global patent data."
            href="/novelty-search"
            hint="Ideal for first-time inventors"
            delay={0}
          />
          <ChoiceCard
            label="Move faster"
            title="Draft my patent"
            description="Transform a validated idea into a structured patent draft with AI."
            href="/patents/draft/new"
            hint="Perfect for teams and professionals"
            delay={200}
          />
          <ChoiceCard
            label="See the landscape"
            title="Analyze competitors"
            description="Understand existing patents in your space and identify whitespace."
            href="/patents"
            hint="Great for strategy and R&D"
            delay={400}
          />
        </div>
      </div>
    </section>
  )
}

