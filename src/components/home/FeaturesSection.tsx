'use client'

import { useEffect, useState } from 'react'

interface FeatureRowProps {
  feature: string
  description: string
  delay?: number
}

function FeatureRow({ feature, description, delay = 0 }: FeatureRowProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <tr
      className={`border-b border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } hover:bg-gray-50`}
    >
      <td className="py-5 px-6">
        <div className="flex items-center">
          <span className="mr-3 flex h-2 w-2 rounded-full bg-gpt-blue-600" />
          <span className="font-semibold text-gray-900 text-sm md:text-base">{feature}</span>
        </div>
      </td>
      <td className="py-5 px-6 text-gray-600 leading-relaxed text-sm md:text-base">{description}</td>
    </tr>
  )
}

export default function FeaturesSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-4">Quietly powerful features</h2>
          <p className="text-base md:text-lg text-gray-600 max-w-2xl mx-auto">
            A focused set of tools that stay out of your way while you think through the invention.
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl shadow-sm overflow-hidden border border-gray-100">
          <table className="w-full">
            <tbody>
              <FeatureRow
                feature="Smart novelty search"
                description="Understands concepts instead of raw keywords, so you see the prior art that actually matters."
                delay={0}
              />
              <FeatureRow
                feature="AI-assisted drafting"
                description="Generate structured patent drafts with sections, figures, and claims you can refine."
                delay={120}
              />
              <FeatureRow
                feature="Prior art intelligence"
                description="Layer insights on top of search results to see where your idea is strongest."
                delay={200}
              />
              <FeatureRow
                feature="Modular workflow"
                description="Start from an idea, a disclosure, or an existing draft—then move seamlessly between stages."
                delay={280}
              />
              <FeatureRow
                feature="Multi-jurisdiction support"
                description="Prepare for US, EU, Indian, and PCT formats from a single, unified workspace."
                delay={360}
              />
              <FeatureRow
                feature="Security by design"
                description="Your ideas are processed on secure infrastructure with encryption and controlled access."
                delay={440}
              />
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

