'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import SessionExpiredModal from '@/components/auth/SessionExpiredModal'

export interface User {
  user_id: string
  email: string
  tenant_id: string | null
  roles: ('SUPER_ADMIN' | 'SUPER_ADMIN_VIEWER' | 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER')[]
  ati_id: string | null
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: (logoutAll?: boolean) => Promise<void>
  signup: (email: string, password: string, atiToken: string, firstName: string, lastName: string, isTrialInvite?: boolean) => Promise<{ success: boolean; error?: string }>
  isLoading: boolean
  refreshUser: (authToken?: string) => Promise<void>
  // Authenticated fetch that automatically handles token refresh
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  // Session expiration state
  isSessionExpired: boolean
  // Method to manually trigger activity (refreshes token if needed)
  registerActivity: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Token refresh state (shared across all requests)
let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSessionExpired, setIsSessionExpired] = useState(false)
  const tokenExpiryRef = useRef<number | null>(null)
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null)
  const activityTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const initializationRef = useRef<boolean>(false) // Prevent re-initialization
  
  // Activity timeout - refresh token if user has been active in the last 5 minutes
  const ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

  // Parse JWT to get expiry time
  const getTokenExpiry = useCallback((jwt: string): number | null => {
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]))
      return payload.exp * 1000 // Convert to milliseconds
    } catch {
      return null
    }
  }, [])
  // Schedule proactive token refresh (before expiry)
  const scheduleTokenRefresh = useCallback((currentToken: string, refreshFn: () => Promise<string | null>) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    const expiry = getTokenExpiry(currentToken)
    if (!expiry) return

    // Refresh 2 minutes before expiry (or half the remaining time if less than 4 minutes)
    const now = Date.now()
    const timeUntilExpiry = expiry - now
    const refreshIn = Math.max(timeUntilExpiry - 2 * 60 * 1000, timeUntilExpiry / 2, 30000) // At least 30 seconds

    if (timeUntilExpiry > 0) {
      refreshTimerRef.current = setTimeout(async () => {
        console.log('Proactively refreshing token before expiry')
        await refreshFn()
      }, refreshIn)
    }
  }, [getTokenExpiry])

  // Perform logout (clear state and optionally call server)
  const performLogout = useCallback(async (callServer: boolean = true, logoutAll: boolean = false, showExpiredModal: boolean = false) => {
    // Clear refresh timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }
    
    // Clear activity timer
    if (activityTimerRef.current) {
      clearTimeout(activityTimerRef.current)
    }

    // Call server logout to invalidate refresh token
    if (callServer) {
      try {
        await fetch(`/api/v1/auth/logout${logoutAll ? '?all=true' : ''}`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
      } catch (error) {
        console.error('Logout API error:', error)
      }
    }

    // Clear local state
    setUser(null)
    setToken(null)
    tokenExpiryRef.current = null
    localStorage.removeItem('auth_token')
    
    // Show session expired modal if needed (e.g., token refresh failed)
    if (showExpiredModal) {
      setIsSessionExpired(true)
    }
  }, [token])

  // Refresh access token using refresh token cookie
  const refreshAccessToken = useCallback(async (showModalOnFailure: boolean = true): Promise<string | null> => {
    // If already refreshing, wait for that to complete
    if (isRefreshing && refreshPromise) {
      return refreshPromise
    }

    isRefreshing = true
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include' // Include cookies
        })

        if (response.ok) {
          const data = await response.json()
          const newToken = data.token
          setToken(newToken)
          localStorage.setItem('auth_token', newToken)
          tokenExpiryRef.current = getTokenExpiry(newToken)
          scheduleTokenRefresh(newToken, () => refreshAccessToken(true))
          // Reset session expired state on successful refresh
          setIsSessionExpired(false)
          return newToken
        } else {
          // Refresh failed - session expired
          console.log('Token refresh failed - session expired')
          // Only show modal if user was previously logged in and flag is true
          const wasLoggedIn = !!localStorage.getItem('auth_token')
          await performLogout(false, false, showModalOnFailure && wasLoggedIn)
          return null
        }
      } catch (error) {
        console.error('Token refresh error:', error)
        const wasLoggedIn = !!localStorage.getItem('auth_token')
        await performLogout(false, false, showModalOnFailure && wasLoggedIn)
        return null
      } finally {
        isRefreshing = false
        refreshPromise = null
      }
    })()

    return refreshPromise
  }, [getTokenExpiry, performLogout, scheduleTokenRefresh])

  // Authenticated fetch with automatic token refresh
  const authFetch = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    // Register activity on each API call
    lastActivityRef.current = Date.now()
    
    let currentToken = token

    // Check if token is expired or about to expire (within 30 seconds)
    const expiry = tokenExpiryRef.current
    if (expiry && Date.now() > expiry - 30000) {
      // Token expired or about to expire - refresh first
      currentToken = await refreshAccessToken(true)
      if (!currentToken) {
        // Refresh failed - return 401 response (modal already shown)
        return new Response(JSON.stringify({ code: 'SESSION_EXPIRED', message: 'Session expired. Please log in again.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    // Make the request with current token
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
      }
    })

    // If 401, try to refresh and retry once
    if (response.status === 401 && currentToken) {
      const newToken = await refreshAccessToken(true)
      if (newToken) {
        // Retry with new token
        return fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${newToken}`
          }
        })
      }
      // If refresh failed, modal is already shown
    }

    return response
  }, [token, refreshAccessToken])
  
  // Register user activity - call this on user interactions to prevent session timeout
  const registerActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    
    // If token is about to expire and user is active, proactively refresh
    const expiry = tokenExpiryRef.current
    if (expiry && token) {
      const timeUntilExpiry = expiry - Date.now()
      // If less than 3 minutes until expiry and user is active, refresh now
      if (timeUntilExpiry > 0 && timeUntilExpiry < 3 * 60 * 1000) {
        console.log('User active, proactively refreshing token')
        refreshAccessToken(false) // Don't show modal for proactive refresh
      }
    }
  }, [token, refreshAccessToken])

  const refreshUser = useCallback(async (authToken?: string) => {
    const tokenToUse = authToken || token
    if (!tokenToUse) {
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/v1/auth/whoami', {
        headers: {
          'Authorization': `Bearer ${tokenToUse}`
        },
        credentials: 'include'
      })

      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
      } else if (response.status === 401) {
        // Token invalid - try refresh
        const newToken = await refreshAccessToken()
        if (newToken) {
          // Retry with new token
          const retryResponse = await fetch('/api/v1/auth/whoami', {
            headers: {
              'Authorization': `Bearer ${newToken}`
            },
            credentials: 'include'
          })
          if (retryResponse.ok) {
            const userData = await retryResponse.json()
            setUser(userData)
          } else {
            await performLogout(false)
          }
        }
      } else {
        await performLogout(false)
      }
    } catch (error) {
      console.error('Failed to refresh user:', error)
      await performLogout(false)
    } finally {
      setIsLoading(false)
    }
  }, [token, refreshAccessToken, performLogout])

  // Load token and user from localStorage on mount (runs only once)
  useEffect(() => {
    // Prevent re-initialization on dependency changes
    if (initializationRef.current) {
      return
    }
    initializationRef.current = true

    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('auth_token')
      if (storedToken) {
        const expiry = getTokenExpiry(storedToken)
        
        // Check if token is expired
        if (expiry && Date.now() > expiry) {
          // Token expired - try to refresh (don't show modal on initial load)
          const newToken = await refreshAccessToken(false)
          if (newToken) {
            await refreshUser(newToken)
          } else {
            setIsLoading(false)
          }
        } else {
          // Token still valid
          setToken(storedToken)
          tokenExpiryRef.current = expiry
          scheduleTokenRefresh(storedToken, () => refreshAccessToken(true))
          await refreshUser(storedToken)
        }
      } else {
        // No token - try to refresh (might have valid refresh token cookie, don't show modal)
        const newToken = await refreshAccessToken(false)
        if (newToken) {
          await refreshUser(newToken)
        } else {
          setIsLoading(false)
        }
      }
    }

    initializeAuth()

    // Cleanup timer on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
    // Note: Dependencies listed for completeness, but initializationRef prevents re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Include cookies for refresh token
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (response.ok) {
        const { token: newToken } = data
        setToken(newToken)
        localStorage.setItem('auth_token', newToken)
        tokenExpiryRef.current = getTokenExpiry(newToken)
        scheduleTokenRefresh(newToken, () => refreshAccessToken(true))
        // Reset session expired state on successful login
        setIsSessionExpired(false)

        // Get user info
        await refreshUser(newToken)
        return { success: true }
      } else {
        return { success: false, error: data.message || 'Login failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  const signup = async (
    email: string, 
    password: string, 
    atiToken: string, 
    firstName: string, 
    lastName: string,
    isTrialInvite?: boolean
  ) => {
    try {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, atiToken, firstName, lastName, isTrialInvite })
      })

      const data = await response.json()

      if (response.ok) {
        return { success: true, isTrial: data.is_trial }
      } else {
        return { success: false, error: data.message || 'Signup failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  const logout = async (logoutAll: boolean = false) => {
    await performLogout(true, logoutAll, false) // Don't show expired modal on manual logout
  }
  
  // Handle re-login from session expired modal
  const handleRelogin = useCallback(() => {
    setIsSessionExpired(false)
    router.push('/login')
  }, [router])
  
  // Close session expired modal (user dismissed it)
  const handleDismissSessionExpired = useCallback(() => {
    setIsSessionExpired(false)
  }, [])
  
  // Set up activity listener for mouse/keyboard events
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now()
    }
    
    // Listen for user activity
    window.addEventListener('mousemove', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity, { passive: true })
    window.addEventListener('click', handleActivity, { passive: true })
    window.addEventListener('scroll', handleActivity, { passive: true })
    window.addEventListener('touchstart', handleActivity, { passive: true })
    
    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('click', handleActivity)
      window.removeEventListener('scroll', handleActivity)
      window.removeEventListener('touchstart', handleActivity)
    }
  }, [])
  
  // Check activity and refresh token if user is active
  useEffect(() => {
    if (!token) return
    
    const checkActivityAndRefresh = () => {
      const now = Date.now()
      const timeSinceActivity = now - lastActivityRef.current
      const expiry = tokenExpiryRef.current
      
      // If user has been active in the last 5 minutes and token expires soon, refresh
      if (expiry && timeSinceActivity < ACTIVITY_THRESHOLD_MS) {
        const timeUntilExpiry = expiry - now
        // Refresh if less than 2 minutes until expiry
        if (timeUntilExpiry > 0 && timeUntilExpiry < 2 * 60 * 1000) {
          console.log('Activity detected, refreshing token before expiry')
          refreshAccessToken(false)
        }
      }
    }
    
    // Check every minute
    activityTimerRef.current = setInterval(checkActivityAndRefresh, 60 * 1000)
    
    return () => {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current)
      }
    }
  }, [token, refreshAccessToken])

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      signup,
      isLoading,
      refreshUser,
      authFetch,
      isSessionExpired,
      registerActivity
    }}>
      {children}
      
      {/* Session Expired Modal */}
      <SessionExpiredModal
        isOpen={isSessionExpired}
        onClose={handleDismissSessionExpired}
        onRelogin={handleRelogin}
      />
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper function to check if user has any of the specified roles
function hasAnyRole(user: any, roles: string[]): boolean {
  if (!user?.roles) return false;
  return roles.some(role => user.roles.includes(role));
}

// Helper function to check if user has all of the specified roles
function hasAllRoles(user: any, roles: string[]): boolean {
  if (!user?.roles) return false;
  return roles.every(role => user.roles.includes(role));
}

// Role-based access helpers
export function useRoleAccess() {
  const { user } = useAuth()

  // Determine tenant type based on user's tenant context
  // For security, default to ENTERPRISE (strict permissions)
  let tenantType: 'INDIVIDUAL' | 'ENTERPRISE' = 'ENTERPRISE'

  // Simple heuristic: if this is a platform admin context or enterprise tenant, use ENTERPRISE
  // Individual tenants would be explicitly marked as such in the future
  if (user?.ati_id === 'PLATFORM') {
    tenantType = 'ENTERPRISE'
  } else if (user?.tenant_id) {
    // For now, assume all named tenants are ENTERPRISE
    // This can be enhanced to fetch actual tenant type from API
    tenantType = 'ENTERPRISE'
  }

  return {
    // Treat SUPER_ADMIN_VIEWER as a super admin for navigation/visibility,
    // but permissions are enforced separately in the API layer.
    isSuperAdmin: hasAnyRole(user, ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER']),
    isSuperAdminViewer: hasAnyRole(user, ['SUPER_ADMIN_VIEWER']),
    isTenantOwner: hasAnyRole(user, ['OWNER']),
    isTenantAdmin: hasAnyRole(user, ['OWNER', 'ADMIN']),
    isManager: hasAnyRole(user, ['MANAGER']),
    isAnalyst: hasAnyRole(user, ['ANALYST']),
    isViewer: hasAnyRole(user, ['VIEWER']),

    // Context-aware permissions (consider tenant type)
    canManageUsers: hasPermission(user, 'manage_users', tenantType),
    canManageTokens: hasPermission(user, 'manage_ati_tokens', tenantType),
    canManageTenants: hasPermission(user, 'manage_tenants', tenantType),
    canViewReports: hasPermission(user, 'view_reports', tenantType),
    canViewAnalytics: hasPermission(user, 'view_analytics', tenantType),
    canCreateProjects: hasPermission(user, 'create_projects', tenantType),
    canUseProduct: hasPermission(user, 'access_novelty_search', tenantType),

    // Additional helpers for multiple role checks
    hasRoles: (roles: string[]) => hasAnyRole(user, roles),
    hasAllRoles: (roles: string[]) => hasAllRoles(user, roles),
    userRoles: user?.roles || []
  }
}
