'use client'

import { useEffect, useState } from 'react'

interface FeatureRowProps {
  icon: string
  feature: string
  description: string
  delay?: number
}

function FeatureRow({ icon, feature, description, delay = 0 }: FeatureRowProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <tr
      className={`border-b border-gray-100 transition-all duration-700 ${
        isVisible ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-4'
      } hover:bg-gray-50`}
    >
      <td className="py-6 px-6">
        <div className="flex items-center">
          <span className="text-2xl mr-4">{icon}</span>
          <span className="font-semibold text-gray-900">{feature}</span>
        </div>
      </td>
      <td className="py-6 px-6 text-gray-600 leading-relaxed">
        {description}
      </td>
    </tr>
  )
}

export default function FeaturesSection() {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 mb-6">
            Subtle AI Intelligence
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Advanced capabilities that work behind the scenes to make patent creation effortless
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <tbody>
              <FeatureRow
                icon="🧭"
                feature="Smart Novelty Search"
                description="Understands concept, not just keywords."
                delay={0}
              />
              <FeatureRow
                icon="📄"
                feature="Auto Drafting"
                description="Generates ready-to-file patent drafts with figures and claims."
                delay={100}
              />
              <FeatureRow
                icon="🔍"
                feature="Prior Art Intelligence"
                description="Analyzes global patent databases with contextual reasoning."
                delay={200}
              />
              <FeatureRow
                icon="🧩"
                feature="Modular Workflow"
                description="Start from idea, continue to draft, or upload your own."
                delay={300}
              />
              <FeatureRow
                icon="🌐"
                feature="Multi-Jurisdiction Support"
                description="Supports US, EU, Indian, and PCT formats."
                delay={400}
              />
              <FeatureRow
                icon="🔐"
                feature="Confidential & Encrypted"
                description="Your ideas never leave our secure server."
                delay={500}
              />
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
