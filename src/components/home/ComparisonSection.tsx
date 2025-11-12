'use client'

import { useEffect, useState } from 'react'

interface ComparisonFeature {
  feature: string
  patentnest: string | boolean
  traditional: string | boolean
  patentnestAdvantage: string
}

const comparisonData: ComparisonFeature[] = [
  {
    feature: "Novelty Search",
    patentnest: "AI analyzes millions of patents in minutes with contextual understanding",
    traditional: "Manual keyword searches, limited to USPTO/EPO databases, takes days/weeks",
    patentnestAdvantage: "85% faster with superior accuracy"
  },
  {
    feature: "Patent Drafting",
    patentnest: "Auto-generates complete patent documents with claims, drawings & figures",
    traditional: "Manual writing by attorneys, expensive revisions, template-based",
    patentnestAdvantage: "Complete drafts in hours, not months"
  },
  {
    feature: "Component Analysis",
    patentnest: "AI extracts & organizes invention components automatically",
    traditional: "Manual identification, prone to missing key elements",
    patentnestAdvantage: "Reduces errors by 90%"
  },
  {
    feature: "Prior Art Intelligence",
    patentnest: "Contextual reasoning across global patent databases",
    traditional: "Basic text matching, misses conceptual similarities",
    patentnestAdvantage: "Understands concepts, not just keywords"
  },
  {
    feature: "Multi-Jurisdiction Support",
    patentnest: "US, EU, Indian, and PCT formats with automated compliance",
    traditional: "Jurisdiction-specific experts needed for each format",
    patentnestAdvantage: "Single platform for global filing"
  },
  {
    feature: "Security & Confidentiality",
    patentnest: "End-to-end encryption, ideas never leave secure servers",
    traditional: "Email attachments, shared documents, data breaches",
    patentnestAdvantage: "Bank-level security"
  },
  {
    feature: "Cost Efficiency",
    patentnest: "Fraction of traditional patent attorney costs",
    traditional: "$10K-$50K per patent application",
    patentnestAdvantage: "90% cost reduction"
  },
  {
    feature: "Turnaround Time",
    patentnest: "Complete patent ready in hours/days",
    traditional: "3-6 months for draft, plus revisions",
    patentnestAdvantage: "98% faster delivery"
  }
]

function ComparisonRow({ feature, patentnest, traditional, patentnestAdvantage, delay = 0 }: ComparisonFeature & { delay?: number }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={`border-b border-gray-200 transition-all duration-700 ${
        isVisible ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-4'
      } hover:bg-blue-50/30`}
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6">
        <div className="md:col-span-1">
          <h4 className="font-semibold text-gray-900 mb-1">{feature}</h4>
          <div className="text-sm text-blue-600 font-medium">
            {patentnestAdvantage}
          </div>
        </div>

        <div className="md:col-span-1.5">
          <div className="flex items-start space-x-2">
            <div className="w-2 h-2 bg-blue-600 rounded-full mt-2 flex-shrink-0"></div>
            <div className="text-sm text-gray-700">
              <span className="font-medium text-blue-600">PatentNest:</span>{' '}
              {typeof patentnest === 'boolean' ?
                (patentnest ? '✅ Yes' : '❌ No') :
                patentnest
              }
            </div>
          </div>
        </div>

        <div className="md:col-span-1.5">
          <div className="flex items-start space-x-2">
            <div className="w-2 h-2 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
            <div className="text-sm text-gray-600">
              <span className="font-medium text-gray-500">Traditional:</span>{' '}
              {typeof traditional === 'boolean' ?
                (traditional ? '✅ Yes' : '❌ No') :
                traditional
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ComparisonSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-gray-900 mb-6">
            AI Intelligence vs Traditional Methods
          </h2>
          <p className="text-xl text-gray-600 max-w-4xl mx-auto leading-relaxed">
            See how our AI-powered platform transforms patent creation from a months-long process
            into an intelligent, automated workflow
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-white">
              <div className="font-semibold text-lg">Feature</div>
              <div className="md:col-span-1.5 flex items-center space-x-2">
                <div className="w-3 h-3 bg-white rounded-full"></div>
                <span className="font-semibold text-lg">PatentNest AI</span>
              </div>
              <div className="md:col-span-1.5 flex items-center space-x-2">
                <div className="w-3 h-3 bg-gray-300 rounded-full"></div>
                <span className="font-semibold text-lg">Traditional Services</span>
              </div>
            </div>
          </div>

          <div className="divide-y divide-gray-200">
            {comparisonData.map((item, index) => (
              <ComparisonRow
                key={item.feature}
                {...item}
                delay={index * 100}
              />
            ))}
          </div>
        </div>

        <div className="mt-12 text-center">
          <div className="inline-flex items-center space-x-4 bg-blue-50 px-6 py-4 rounded-lg">
            <div className="text-3xl">🚀</div>
            <div className="text-left">
              <div className="font-semibold text-blue-900">The Future of Patent Creation</div>
              <div className="text-blue-700">AI that thinks like an attorney, works like a team</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
