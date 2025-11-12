'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

export default function CTAFooter() {
  const { user } = useAuth()

  return (
    <section className="py-20 bg-gradient-to-r from-gray-900 to-blue-900 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="mb-12">
          <p className="text-2xl md:text-3xl mb-6 leading-relaxed font-light">
            Every idea deserves its chance to live.
          </p>

          <p className="text-xl md:text-2xl mb-8 leading-relaxed font-light">
            Don't let yours stay in your notes app.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center mb-8">
          <Link
            href={user ? "/patents/draft/new" : "/register"}
            className="inline-flex items-center px-10 py-4 border border-transparent text-lg font-medium rounded-lg text-blue-900 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white transition-all duration-200 transform hover:scale-105 shadow-xl"
          >
            ⚡ Start for Free
          </Link>

          <button
            onClick={() => {
              // This would typically open a demo booking modal or redirect to a booking page
              window.open('mailto:demo@patentnest.ai?subject=Book a Demo', '_blank')
            }}
            className="inline-flex items-center px-10 py-4 border-2 border-white text-lg font-medium rounded-lg text-white bg-transparent hover:bg-white hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white transition-all duration-200 transform hover:scale-105"
          >
            💬 Book a Demo
          </button>
        </div>

        <p className="text-sm text-gray-300 max-w-md mx-auto">
          No credit card. No pressure. Just clarity.
        </p>
      </div>
    </section>
  )
}
