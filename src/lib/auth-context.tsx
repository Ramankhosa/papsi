'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { hasPermission } from '@/lib/permissions'

export interface User {
  user_id: string
  email: string
  tenant_id: string | null
  roles: ('SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER')[]
  ati_id: string | null
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  signup: (email: string, password: string, atiToken: string) => Promise<{ success: boolean; error?: string }>
  isLoading: boolean
  refreshUser: (authToken?: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load token and user from localStorage on mount
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('auth_token')
      if (storedToken) {
        setToken(storedToken)
        // Validate token and get user info
        await refreshUser(storedToken)
      } else {
        setIsLoading(false)
      }
    }

    initializeAuth()
  }, [])

  const refreshUser = async (authToken?: string) => {
    const tokenToUse = authToken || token
    if (!tokenToUse) return

    try {
      const response = await fetch('/api/v1/auth/whoami', {
        headers: {
          'Authorization': `Bearer ${tokenToUse}`
        }
      })

      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
      } else {
        // Token invalid, clear it
        logout()
      }
    } catch (error) {
      console.error('Failed to refresh user:', error)
      logout()
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (response.ok) {
        const { token: newToken } = data
        setToken(newToken)
        localStorage.setItem('auth_token', newToken)

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

  const signup = async (email: string, password: string, atiToken: string) => {
    try {
      const response = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, atiToken })
      })

      const data = await response.json()

      if (response.ok) {
        // After signup, user can login
        return { success: true }
      } else {
        return { success: false, error: data.message || 'Signup failed' }
      }
    } catch (error) {
      return { success: false, error: 'Network error' }
    }
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('auth_token')
  }

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      signup,
      isLoading,
      refreshUser
    }}>
      {children}
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
    isSuperAdmin: hasAnyRole(user, ['SUPER_ADMIN']),
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
