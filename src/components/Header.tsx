'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import AnimatedLogo from '@/components/ui/animated-logo'

export default function Header() {
  const { user, logout, isLoading } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  const handleSignOut = () => {
    logout()
  }
  const handlePasswordReset = async () => {
    if (!user?.email || isSendingReset) return
    try {
      setIsSendingReset(true)
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      })
      if (!res.ok) throw new Error('Failed to request reset')
      setShowUserMenu(false)
      alert('Password reset link sent to ' + user.email)
    } catch (e) {
      console.error('Reset request failed', e)
      alert('Could not send reset email. Please try again.')
    } finally {
      setIsSendingReset(false)
    }
  }

  if (isLoading) {
    return (
      <header className="bg-white shadow-sm border-b border-gpt-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <AnimatedLogo size="sm" className="flex-shrink-0" useKishoFallback={true} />
              <Link href="/" className="text-xl font-bold text-gpt-gray-900">
                PatentNest
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gpt-blue-600"></div>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white shadow-sm border-b border-gpt-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <AnimatedLogo size="sm" autoPlayDuration={2000} className="flex-shrink-0" useKishoFallback={true} />
            <Link href="/" className="text-xl font-bold text-gpt-gray-900">
              PatentNest
            </Link>
          </div>

          {user ? (
            <div className="relative inline-block" ref={userMenuRef}>
              {/* Quick Navigation Links */}
              <div className="flex items-center space-x-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                >
                  ðŸ  Dashboard
                </Link>

                <Link
                  href="/novelty-search"
                  className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
                >
                  ðŸ” Search
                </Link>

                {/* Compact User Dropdown */}
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gpt-gray-50 transition-all duration-200 border border-gpt-gray-200"
                >
                  <div className="w-6 h-6 bg-gpt-blue-600 rounded-full flex items-center justify-center text-white text-xs font-medium">
                    {user.email?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <svg
                    className={`w-3 h-3 text-gpt-gray-500 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Compact User Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gpt-gray-200 rounded-lg shadow-lg z-50">
                  {/* User Info */}
                  <div className="px-3 py-2 border-b border-gpt-gray-200 bg-gpt-gray-50">
                    <div className="text-sm text-gpt-gray-900 font-medium truncate">{user.email}</div>
                    <div className="text-xs text-gpt-gray-600">Role: {user.roles?.join(', ') || 'None'}</div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-1">
                    <Link
                      href="/dashboard"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <span>ðŸ </span>
                      <span>Dashboard</span>
                    </Link>

                    <Link
                      href="/novelty-search"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <span>ðŸ”</span>
                      <span>Novelty Search</span>
                    </Link>

                    <Link
                      href="/projects"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <span>ðŸ“</span>
                      <span>Projects</span>
                    </Link>

                    {/* Super Admin Links */}
                    {user.roles?.includes('SUPER_ADMIN') && (
                      <Link
                        href="/super-admin/countries"
                        className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <span>🌍</span>
                        <span>Country Profiles</span>
                      </Link>
                    )}

                    {/* Separator */}
                    <div className="border-t border-gpt-gray-200 my-1"></div>

                    <Link
                      href="/persona-sync"
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <span>ðŸŽ¨</span>
                      <span>PersonaSync Training</span>
                    </Link>
                    <button
                      onClick={handlePasswordReset}
                      disabled={isSendingReset}
                      className="w-full px-3 py-2 text-left text-sm text-gpt-gray-700 hover:bg-gpt-gray-50 flex items-center space-x-2 disabled:opacity-50"
                    >
                      <span>🔒</span>
                      <span>{isSendingReset ? 'Sending reset link…' : 'Reset Password'}</span>
                    </button>

                    <button
                      onClick={handleSignOut}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center space-x-2"
                    >
                      <span>ðŸšª</span>
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-gpt-gray-700 bg-white hover:bg-gpt-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Sign In
              </Link>

              <Link
                href="/register"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gpt-blue-600 hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 transition-all duration-200"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}


