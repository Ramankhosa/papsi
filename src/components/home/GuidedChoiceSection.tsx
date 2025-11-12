'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useEffect, useState } from 'react'

interface ChoiceCardProps {
  icon: string
  title: string
  description: string
  href: string
  hint: string
  delay?: number
}

function ChoiceCard({ icon, title, description, href, hint, delay = 0 }: ChoiceCardProps) {
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
      className={`block p-8 bg-white rounded-xl shadow-sm border border-gray-100 transition-all duration-700 hover:shadow-lg hover:scale-105 hover:border-blue-200 ${
        isVisible ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'
      }`}
    >
      <div className="text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2 font-serif">
          {title}
        </h3>
        <p className="text-gray-600 mb-4 leading-relaxed">
          {description}
        </p>
        <div className="text-sm text-blue-600 font-medium">
          {hint}
        </div>
      </div>
    </Link>
  )
}

export default function GuidedChoiceSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-6">
            What would you like to do today?
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <ChoiceCard
            icon="🧠"
            title="Validate My Idea"
            description="Check if your invention is novel and patentable"
            href="/novelty-search"
            hint="Ideal for inventors"
            delay={0}
          />
          <ChoiceCard
            icon="✍️"
            title="Draft My Patent"
            description="Generate a complete patent application with AI"
            href="/patents/draft/new"
            hint="Perfect for professionals"
            delay={200}
          />
          <ChoiceCard
            icon="🔍"
            title="Analyze Competitor"
            description="Study existing patents in your field"
            href="/patents"
            hint="Great for strategists"
            delay={400}
          />
        </div>
      </div>
    </section>
  )
}
