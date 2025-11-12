'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import AnimatedLogo from '@/components/ui/animated-logo'

export default function HeroSection() {
  const { user } = useAuth()

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-gray-50 to-gray-100 overflow-hidden">
      {/* Subtle AI Network Animation Background */}
      <div className="absolute inset-0 opacity-5">
        <svg
          className="w-full h-full"
          viewBox="0 0 1000 1000"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="network" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
              <circle cx="25" cy="25" r="1" fill="#3b82f6" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite" />
              </circle>
              <line x1="25" y1="25" x2="50" y2="25" stroke="#3b82f6" strokeWidth="0.5" opacity="0.2" />
              <line x1="25" y1="25" x2="25" y2="50" stroke="#3b82f6" strokeWidth="0.5" opacity="0.2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#network)" />
        </svg>
      </div>

      {/* Pulsating Dots */}
      <div className="absolute top-20 left-20 w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
      <div className="absolute top-40 right-32 w-1 h-1 bg-blue-300 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
      <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '2s' }}></div>
      <div className="absolute bottom-20 right-20 w-1 h-1 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="flex justify-center mb-8">
          <AnimatedLogo size="lg" autoPlayDuration={3000} />
        </div>

        <h1 className="text-6xl md:text-8xl font-serif font-bold text-gray-900 mb-6 tracking-tight">
          PatentNest.ai
        </h1>

        <div className="max-w-4xl mx-auto mb-8">
          <h2 className="text-2xl md:text-4xl font-serif font-medium text-gray-700 mb-4 italic">
            "Where Ideas Hatch Into Patents"
          </h2>

          <p className="text-xl md:text-2xl text-gray-600 mb-6 font-light">
            Your imagination deserves legal wings.
          </p>

          <p className="text-lg md:text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
            Draft, validate, and protect inventions — effortlessly, intelligently, and globally.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Link
            href={user ? "/novelty-search" : "/login"}
            className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
          >
            🧠 Start Novelty Search
          </Link>

          <Link
            href={user ? "/patents/draft/new" : "/login"}
            className="inline-flex items-center px-8 py-4 border-2 border-blue-600 text-lg font-medium rounded-lg text-blue-600 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
          >
            ✍️ Start Patent Drafting
          </Link>
        </div>

        <p className="text-sm text-gray-400 max-w-md mx-auto">
          No forms. No legal jargon. Just your idea and AI precision.
        </p>
      </div>
    </section>
  )
}
