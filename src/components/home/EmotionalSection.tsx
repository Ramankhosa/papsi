'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

export default function EmotionalSection() {
  const { user } = useAuth()

  return (
    <section className="py-20 bg-gradient-to-r from-gpt-gray-50 via-white to-gpt-gray-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="mb-12">
          <p className="text-2xl md:text-3xl text-gpt-gray-800 mb-6 leading-relaxed font-light">
            You&apos;ve solved a problem no one else has.
          </p>

          <p className="text-xl md:text-2xl text-gpt-gray-700 mb-6 leading-relaxed font-light">
            But between legal paperwork, terminology, and deadlines — the spark fades.
          </p>

          <p className="text-2xl md:text-3xl font-serif font-semibold text-gpt-blue-600 mb-8">
            PatentNest brings that spark back.
          </p>

          <p className="text-lg md:text-xl text-gpt-gray-600 mb-8 leading-relaxed">
            You focus on creating; we&apos;ll help you protect what matters.
          </p>
        </div>

        <Link
          href={user ? '/patents/draft/new' : '/register'}
          className="inline-flex items-center justify-center px-10 py-4 border border-transparent text-lg font-medium rounded-full text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200 hover:shadow-xl"
        >
          Protect My Idea
        </Link>
      </div>
    </section>
  )
}

