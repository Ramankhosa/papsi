'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

export default function EmotionalSection() {
  const { user } = useAuth()

  return (
    <section className="py-20 bg-gradient-to-r from-blue-50 to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="mb-12">
          <p className="text-2xl md:text-3xl text-gray-800 mb-6 leading-relaxed font-light">
            You've solved a problem no one else has.
          </p>

          <p className="text-xl md:text-2xl text-gray-700 mb-6 leading-relaxed font-light">
            But between legal paperwork, terminology, and deadlines — the spark fades.
          </p>

          <p className="text-2xl md:text-3xl font-serif font-semibold text-blue-600 mb-8">
            PatentNest brings that spark back.
          </p>

          <p className="text-lg md:text-xl text-gray-600 mb-8 leading-relaxed">
            You focus on creating; we'll handle the protection.
          </p>
        </div>

        <Link
          href={user ? "/patents/draft/new" : "/register"}
          className="inline-flex items-center px-10 py-5 border border-transparent text-xl font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:scale-105 shadow-xl hover:shadow-2xl"
        >
          🚀 Protect My Idea
        </Link>
      </div>
    </section>
  )
}
