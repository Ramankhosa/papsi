import React, { ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth, useRoleAccess } from '@/lib/auth-context'

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock fetch
global.fetch = jest.fn()

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  )

  describe('Initial State', () => {
    test('should initialize with null user', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper })

      expect(result.current.user).toBeNull()
      // Initial loading state depends on whether there's a token to validate
      // Since we mocked localStorage to return null, it should complete quickly
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(result.current.isLoading).toBe(false)
    })

    test('should check for existing auth token on mount', () => {
      localStorageMock.getItem.mockReturnValue('mock-token')

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          user: { id: 1, email: 'test@example.com', roles: ['USER'] }
        })
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      expect(localStorageMock.getItem).toHaveBeenCalledWith('auth_token')
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/whoami', {
        headers: { 'Authorization': 'Bearer mock-token' }
      })
    })
  })

  describe('Authentication Methods', () => {
    test('should handle successful login', async () => {
      const mockUser = { user_id: '1', email: 'test@example.com', roles: ['USER'], tenant_id: null, ati_id: null }
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'new-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockUser)
        })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      let loginResult: Awaited<ReturnType<typeof result.current.login>> | undefined
      await act(async () => {
        loginResult = await result.current.login('test@example.com', 'password')
      })

      expect(loginResult).toBeDefined()
      expect(loginResult!.success).toBe(true)
      expect(result.current.user).toEqual(mockUser)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_token', 'new-token')
    })

    test('should handle login failure', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid credentials' })
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      let loginResult: Awaited<ReturnType<typeof result.current.login>> | undefined
      await act(async () => {
        loginResult = await result.current.login('test@example.com', 'wrong-password')
      })

      expect(loginResult).toBeDefined()
      expect(loginResult!.success).toBe(false)
      expect(loginResult!.error).toBe('Invalid credentials')
      expect(result.current.user).toBeNull()
      expect(localStorageMock.setItem).not.toHaveBeenCalled()
    })

    test('should handle logout', async () => {
      // Set up logged in state
      localStorageMock.getItem.mockReturnValue('mock-token')
      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        result.current.logout()
      })

      expect(result.current.user).toBeNull()
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token')
    })

    test('should handle registration', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      let signupResult: Awaited<ReturnType<typeof result.current.signup>> | undefined
      await act(async () => {
        signupResult = await result.current.signup('new@example.com', 'password123', 'ati-token', 'John', 'Doe')
      })

      expect(signupResult).toBeDefined()
      expect(signupResult!.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/signup', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'password123',
          atiToken: 'ati-token',
          firstName: 'John',
          lastName: 'Doe'
        })
      }))
    })
  })

  describe('Role-based Access', () => {
    test('should identify super admin role', () => {
      const mockUser = { user_id: '1', email: 'admin@test.com', roles: ['SUPER_ADMIN'], tenant_id: null, ati_id: null }

      // Test the useRoleAccess hook with a mock user
      let roleAccessResult: ReturnType<typeof useRoleAccess> | undefined
      const TestComponent = () => {
        roleAccessResult = useRoleAccess()
        return null
      }

      // Mock useAuth to return our test user
      const originalUseAuth = require('@/lib/auth-context').useAuth
      require('@/lib/auth-context').useAuth = () => ({
        user: mockUser,
        token: 'mock-token',
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
        isLoading: false,
        refreshUser: jest.fn()
      })

      renderHook(() => <TestComponent />, { wrapper })

      expect(roleAccessResult).toBeDefined()
      expect(roleAccessResult!.isSuperAdmin).toBe(true)
      expect(roleAccessResult!.canManageTenants).toBe(true)

      // Restore original function
      require('@/lib/auth-context').useAuth = originalUseAuth
    })

    test('should identify tenant admin role', () => {
      const mockUser = { user_id: '2', email: 'tenant@test.com', roles: ['OWNER'], tenant_id: 'tenant-1', ati_id: 'TEST' }

      // Test the useRoleAccess hook with a mock user
      let roleAccessResult: ReturnType<typeof useRoleAccess> | undefined
      const TestComponent = () => {
        roleAccessResult = useRoleAccess()
        return null
      }

      // Mock useAuth to return our test user
      const originalUseAuth = require('@/lib/auth-context').useAuth
      require('@/lib/auth-context').useAuth = () => ({
        user: mockUser,
        token: 'mock-token',
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
        isLoading: false,
        refreshUser: jest.fn()
      })

      renderHook(() => <TestComponent />, { wrapper })

      expect(roleAccessResult).toBeDefined()
      expect(roleAccessResult!.isSuperAdmin).toBe(false)
      expect(roleAccessResult!.isTenantAdmin).toBe(true)

      // Restore original function
      require('@/lib/auth-context').useAuth = originalUseAuth
    })

    test('should identify regular user role', () => {
      const mockUser = { user_id: '3', email: 'user@test.com', roles: ['VIEWER'], tenant_id: 'tenant-1', ati_id: 'TEST' }

      // Test the useRoleAccess hook with a mock user
      let roleAccessResult: ReturnType<typeof useRoleAccess> | undefined
      const TestComponent = () => {
        roleAccessResult = useRoleAccess()
        return null
      }

      // Mock useAuth to return our test user
      const originalUseAuth = require('@/lib/auth-context').useAuth
      require('@/lib/auth-context').useAuth = () => ({
        user: mockUser,
        token: 'mock-token',
        login: jest.fn(),
        logout: jest.fn(),
        signup: jest.fn(),
        isLoading: false,
        refreshUser: jest.fn()
      })

      renderHook(() => <TestComponent />, { wrapper })

      expect(roleAccessResult).toBeDefined()
      expect(roleAccessResult!.isSuperAdmin).toBe(false)
      expect(roleAccessResult!.isTenantAdmin).toBe(false)
      expect(roleAccessResult!.canViewReports).toBe(true)

      // Restore original function
      require('@/lib/auth-context').useAuth = originalUseAuth
    })
  })

  describe('Error Handling', () => {
    test('should handle network errors during login', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'))
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      let loginResult: Awaited<ReturnType<typeof result.current.login>> | undefined
      await act(async () => {
        loginResult = await result.current.login('test@example.com', 'password')
      })

      expect(loginResult).toBeDefined()
      expect(loginResult!.success).toBe(false)
      expect(loginResult!.error).toBe('Network error')
    })

    test('should handle invalid JSON responses', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.reject(new Error('Invalid JSON'))
        })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      let loginResult: Awaited<ReturnType<typeof result.current.login>> | undefined
      await act(async () => {
        loginResult = await result.current.login('test@example.com', 'password')
      })

      expect(loginResult).toBeDefined()
      expect(loginResult!.success).toBe(false)
      expect(loginResult!.error).toBe('Network error')
    })
  })

  describe('Session Management', () => {
    test('should refresh user data', async () => {
      const mockUser = { user_id: '1', email: 'test@example.com', roles: ['USER'], tenant_id: null, ati_id: null }
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockUser)
      })
      global.fetch = mockFetch

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        await result.current.refreshUser('mock-token')
      })

      expect(result.current.user).toEqual(mockUser)
    })

    test('should handle session expiry', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Token expired' })
      })
      global.fetch = mockFetch

      localStorageMock.getItem.mockReturnValue('expired-token')

      const { result } = renderHook(() => useAuth(), { wrapper })

      // Wait for useEffect to complete
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(result.current.user).toBeNull()
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token')
    })
  })
})
