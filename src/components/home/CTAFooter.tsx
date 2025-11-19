'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'

export default function CTAFooter() {
  const { user } = useAuth()

  return (
    <section className="py-20 bg-gradient-to-r from-gpt-gray-900 via-slate-900 to-gpt-blue-900 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="mb-10">
          <p className="text-2xl md:text-3xl mb-4 leading-relaxed font-light">
            Every idea deserves its chance to live.
          </p>

          <p className="text-xl md:text-2xl mb-6 leading-relaxed font-light text-gpt-gray-200/90">
            Don&apos;t let yours stay in your notes app.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Link
            href={user ? '/patents/draft/new' : '/register'}
            className="inline-flex items-center justify-center px-10 py-3 border border-transparent text-base md:text-lg font-medium rounded-full text-gpt-gray-900 bg-white hover:bg-gpt-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white transition-all duration-200 shadow-lg shadow-black/40"
          >
            Start for Free
          </Link>

          <button
            type="button"
            onClick={() => window.open('mailto:demo@patentnest.ai?subject=Book a Demo', '_blank')}
            className="inline-flex items-center justify-center px-10 py-3 border border-white/70 text-base md:text-lg font-medium rounded-full text-white bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white transition-all duration-200"
          >
            Book a Demo
          </button>
        </div>

        <p className="text-xs md:text-sm text-gpt-gray-300/80 max-w-md mx-auto">
          No credit card. No pressure. Just clarity.
        </p>
      </div>
    </section>
  )
}

