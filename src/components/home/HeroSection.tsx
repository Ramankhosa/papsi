'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import AnimatedLogo from '@/components/ui/animated-logo'

export default function HeroSection() {
  const { user } = useAuth()

  return (
    <section className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center overflow-hidden bg-gradient-to-br from-gpt-gray-900 via-slate-950 to-black text-white">
      <style jsx>{`
        .hero-orb {
          position: absolute;
          border-radius: 9999px;
          filter: blur(45px);
          opacity: 0.7;
          mix-blend-mode: screen;
          pointer-events: none;
        }
        .hero-orb--one {
          width: 380px;
          height: 380px;
          background: radial-gradient(circle at 30% 30%, #3b82f6, transparent 60%);
          top: -120px;
          right: -60px;
          animation: floatSlow 20s ease-in-out infinite;
        }
        .hero-orb--two {
          width: 320px;
          height: 320px;
          background: radial-gradient(circle at 20% 80%, #10b981, transparent 60%);
          bottom: -120px;
          left: -40px;
          animation: floatSlow 24s ease-in-out infinite;
        }
        .hero-grid {
          position: absolute;
          inset: 0;
          opacity: 0.18;
          background-image: radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.5) 1px, transparent 0);
          background-size: 40px 40px;
          mask-image: radial-gradient(circle at center, black, transparent);
          pointer-events: none;
        }
        @keyframes floatSlow {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(10px, -18px, 0);
          }
        }
      `}</style>

      <div className="hero-grid" />
      <div className="hero-orb hero-orb--one" />
      <div className="hero-orb hero-orb--two" />

      <div className="relative z-10 w-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
          <div className="mb-10 animate-fade-in">
            <div className="inline-flex items-center px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-[11px] uppercase tracking-[0.16em] text-gpt-gray-100/80">
              <span className="mr-2 inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AI-native patent studio for serious inventors
            </div>
          </div>

          <div className="flex flex-col items-center gap-6 mb-10">
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute -inset-4 rounded-full bg-white/10 blur-2xl opacity-40" />
                <div className="relative">
                  <AnimatedLogo size="lg" autoPlayDuration={3000} />
                </div>
              </div>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-serif font-bold tracking-tight text-white animate-slide-up">
              PatentNest.ai
            </h1>

            <div className="max-w-3xl mx-auto space-y-4 animate-fade-in">
              <p className="text-xl md:text-2xl font-serif text-gpt-gray-100/90 italic">
                “Where ideas hatch into patents.”
              </p>
              <p className="text-base md:text-lg text-gpt-gray-200/90">
                Your imagination deserves legal wings. Draft, validate, and protect inventions — effortlessly,
                intelligently, and globally.
              </p>
            </div>
          </div>

          <div className="mb-10 flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-in">
            <Link
              href={user ? '/novelty-search' : '/login'}
              className="inline-flex items-center justify-center rounded-full px-8 py-3 text-sm md:text-base font-medium text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 focus:ring-offset-gpt-gray-900 shadow-lg shadow-gpt-blue-500/30 transition-all duration-200"
            >
              Start Novelty Search
            </Link>

            <Link
              href={user ? '/patents/draft/new' : '/login'}
              className="inline-flex items-center justify-center rounded-full px-8 py-3 text-sm md:text-base font-medium text-gpt-gray-100 border border-gpt-gray-500/60 bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 focus:ring-offset-gpt-gray-900 transition-all duration-200"
            >
              Start Patent Drafting
            </Link>
          </div>

          <p className="text-xs md:text-sm text-gpt-gray-300/80 max-w-md mx-auto">
            No forms. No legal jargon. Just your idea, and an AI that understands patents.
          </p>
        </div>
      </div>
    </section>
  )
}

