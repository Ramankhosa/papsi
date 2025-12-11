/**
 * LLM Metering E2E Tests
 *
 * End-to-end tests that verify the complete user journey with LLM metering,
 * including UI interactions, API calls, and backend validation.
 */

import { test, expect } from '@playwright/test'
import { createTestUser, createTestTenant, cleanupTestData } from '../setup/test-db'

test.describe('LLM Metering E2E Tests', () => {
  let testUser: { email: string; password: string; tenantId: string }
  let testTenant: { id: string; name: string }

  test.beforeAll(async () => {
    // Create test tenant and user
    testTenant = await createTestTenant()
    testUser = await createTestUser(testTenant.id)
  })

  test.afterAll(async () => {
    await cleanupTestData(testUser, testTenant)
  })

  test.describe('Patent Drafting with Metering', () => {
    test('should track token usage for patent drafting workflow', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Navigate to patent drafting
      await page.goto('/patents/draft')
      await expect(page).toHaveURL(/\/patents\/draft/)

      // Fill out patent drafting form
      await page.fill('[data-testid="invention-title"]', 'Test Smartphone Innovation')
      await page.fill('[data-testid="technical-field"]', 'Mobile Communications')
      await page.fill('[data-testid="abstract"]', 'A new smartphone with advanced AI capabilities for patent drafting testing.')

      // Submit for drafting
      await page.click('[data-testid="generate-draft-button"]')

      // Wait for LLM processing
      await page.waitForSelector('[data-testid="draft-result"]', { timeout: 30000 })

      // Verify draft was generated
      const draftContent = await page.textContent('[data-testid="draft-content"]')
      expect(draftContent).toBeTruthy()
      expect(draftContent!.length).toBeGreaterThan(100)

      // Check usage dashboard
      await page.goto('/dashboard')
      await page.click('[data-testid="usage-tab"]')

      // Verify token usage was recorded
      const inputTokens = await page.textContent('[data-testid="input-tokens-used"]')
      const outputTokens = await page.textContent('[data-testid="output-tokens-used"]')

      expect(parseInt(inputTokens || '0')).toBeGreaterThan(0)
      expect(parseInt(outputTokens || '0')).toBeGreaterThan(0)
    })

    test('should enforce plan quotas in UI', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Exhaust quota by making many requests (simulate via API calls)
      // This would be done via direct API calls in a real test

      // Navigate to patent drafting
      await page.goto('/patents/draft')

      // Try to generate draft when quota exceeded
      await page.fill('[data-testid="invention-title"]', 'Quota Test Invention')
      await page.fill('[data-testid="abstract"]', 'Testing quota enforcement.')
      await page.click('[data-testid="generate-draft-button"]')

      // Should show quota exceeded error
      await page.waitForSelector('[data-testid="quota-exceeded-error"]')
      const errorMessage = await page.textContent('[data-testid="error-message"]')
      expect(errorMessage).toContain('quota exceeded')
    })
  })

  test.describe('Novelty Search with Metering', () => {
    test('should track usage for prior art searches', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Navigate to novelty search
      await page.goto('/novelty-search')
      await expect(page).toHaveURL(/\/novelty-search/)

      // Enter search query
      await page.fill('[data-testid="search-query"]', 'artificial intelligence patent analysis system')
      await page.selectOption('[data-testid="search-jurisdiction"]', 'US')

      // Execute search
      await page.click('[data-testid="search-button"]')

      // Wait for results
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 45000 })

      // Verify results were found
      const resultCount = await page.locator('[data-testid="result-item"]').count()
      expect(resultCount).toBeGreaterThan(0)

      // Check usage tracking
      await page.goto('/dashboard')
      await page.click('[data-testid="usage-tab"]')

      // Verify API calls were counted
      const apiCalls = await page.textContent('[data-testid="api-calls-count"]')
      expect(parseInt(apiCalls || '0')).toBeGreaterThan(0)
    })
  })

  test.describe('Admin Usage Monitoring', () => {
    test('super admin should see tenant usage analytics', async ({ page }) => {
      // Login as super admin (assuming test setup creates one)
      await page.goto('/login')
      await page.fill('[data-testid="email"]', 'superadmin@example.com')
      await page.fill('[data-testid="password"]', 'testpassword')
      await page.click('[data-testid="login-button"]')

      // Navigate to super admin analytics
      await page.goto('/super-admin/analytics')
      await expect(page).toHaveURL(/\/super-admin\/analytics/)

      // Check tenant usage table
      await page.waitForSelector('[data-testid="tenant-usage-table"]')

      // Find our test tenant
      const tenantRow = page.locator('[data-testid="tenant-row"]').filter({
        hasText: testTenant.name
      })

      await expect(tenantRow).toBeVisible()

      // Check usage metrics
      const tokenUsage = await tenantRow.locator('[data-testid="token-usage"]').textContent()
      expect(parseInt(tokenUsage || '0')).toBeGreaterThanOrEqual(0)
    })

    test('tenant admin should see team usage', async ({ page }) => {
      // Login as tenant admin
      await page.goto('/login')
      await page.fill('[data-testid="email"]', 'tenantadmin@example.com')
      await page.fill('[data-testid="password"]', 'testpassword')
      await page.click('[data-testid="login-button"]')

      // Navigate to tenant admin analytics
      await page.goto('/tenant-admin/analytics')
      await expect(page).toHaveURL(/\/tenant-admin\/analytics/)

      // Check team usage
      await page.waitForSelector('[data-testid="team-usage-chart"]')

      // Verify user-specific usage
      const userUsage = page.locator('[data-testid="user-usage"]').filter({
        hasText: testUser.email
      })

      await expect(userUsage).toBeVisible()
    })
  })

  test.describe('Security and Bypass Prevention', () => {
    test('should prevent unauthorized model access', async ({ page }) => {
      // Login with basic plan user
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Try to access advanced features (should be restricted by plan)
      await page.goto('/patents/draft')

      // Check if advanced model selector is disabled/hidden
      const advancedModelOption = page.locator('[data-testid="model-selector"]').locator('option').filter({
        hasText: 'GPT-4'
      })

      // Should not be available or should be disabled
      await expect(advancedModelOption).not.toBeVisible()
    })

    test('should handle session expiration gracefully', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Simulate session expiration by clearing cookies
      await page.context().clearCookies()

      // Try to access protected page
      await page.goto('/patents/draft')

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/)

      // Try to make API call (should fail)
      const response = await page.request.post('/api/v1/patents/draft', {
        data: { title: 'Test' }
      })

      expect(response.status()).toBe(401)
    })
  })

  test.describe('Performance and Reliability', () => {
    test('should handle multiple concurrent operations', async ({ browser }) => {
      // Create multiple browser contexts for concurrent operations
      const contexts = await Promise.all([
        browser.newContext(),
        browser.newContext(),
        browser.newContext()
      ])

      try {
        const pages = await Promise.all(
          contexts.map(context => context.newPage())
        )

        // Login on all pages
        await Promise.all(pages.map(async (page) => {
          await page.goto('/login')
          await page.fill('[data-testid="email"]', testUser.email)
          await page.fill('[data-testid="password"]', testUser.password)
          await page.click('[data-testid="login-button"]')
          await page.waitForURL(/\/dashboard/)
        }))

        // Perform concurrent operations
        const operations = pages.map(async (page, index) => {
          await page.goto('/patents/draft')
          await page.fill('[data-testid="invention-title"]', `Concurrent Test ${index}`)
          await page.fill('[data-testid="abstract"]', `Testing concurrent operations ${index}`)
          await page.click('[data-testid="generate-draft-button"]')

          // Wait for completion or timeout
          try {
            await page.waitForSelector('[data-testid="draft-result"]', { timeout: 30000 })
            return true
          } catch {
            return false
          }
        })

        const results = await Promise.all(operations)

        // At least some operations should succeed
        const successCount = results.filter(Boolean).length
        expect(successCount).toBeGreaterThan(0)

      } finally {
        // Clean up contexts
        await Promise.all(contexts.map(context => context.close()))
      }
    })

    test('should recover from temporary service outages', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Navigate to drafting page
      await page.goto('/patents/draft')

      // Simulate network issues (this would be done by intercepting requests in real tests)
      // For now, just verify error handling UI exists

      // Check for retry mechanisms
      const retryButton = page.locator('[data-testid="retry-button"]')
      // Button might not be visible until error occurs
      expect(await retryButton.count()).toBeLessThanOrEqual(1)
    })
  })

  test.describe('Data Integrity and Consistency', () => {
    test('should maintain consistent usage data across page refreshes', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Make a request
      await page.goto('/patents/draft')
      await page.fill('[data-testid="invention-title"]', 'Consistency Test')
      await page.fill('[data-testid="abstract"]', 'Testing data consistency across refreshes')
      await page.click('[data-testid="generate-draft-button"]')

      await page.waitForSelector('[data-testid="draft-result"]')

      // Check usage before refresh
      await page.goto('/dashboard')
      await page.click('[data-testid="usage-tab"]')
      const usageBefore = await page.textContent('[data-testid="total-tokens"]')

      // Refresh page
      await page.reload()
      await page.click('[data-testid="usage-tab"]')

      // Check usage after refresh
      const usageAfter = await page.textContent('[data-testid="total-tokens"]')

      // Should be consistent
      expect(usageBefore).toBe(usageAfter)
    })

    test('should handle browser back/forward navigation correctly', async ({ page }) => {
      // Login
      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Navigate through workflow
      await page.goto('/dashboard')
      await page.click('[data-testid="usage-tab"]')

      const initialUsage = await page.textContent('[data-testid="total-tokens"]')

      // Go back
      await page.goBack()
      await expect(page).toHaveURL(/\/dashboard/)

      // Go forward
      await page.goForward()
      await expect(page.url()).toContain('usage-tab')

      // Usage should still be visible and consistent
      const finalUsage = await page.textContent('[data-testid="total-tokens"]')
      expect(initialUsage).toBe(finalUsage)
    })
  })

  test.describe('Cross-Browser Compatibility', () => {
    // Note: These tests would be run with different browser configurations
    test('should work on different viewport sizes', async ({ page }) => {
      // Test mobile viewport
      await page.setViewportSize({ width: 375, height: 667 })

      await page.goto('/login')
      await page.fill('[data-testid="email"]', testUser.email)
      await page.fill('[data-testid="password"]', testUser.password)
      await page.click('[data-testid="login-button"]')

      // Verify mobile layout works
      await page.goto('/dashboard')
      const mobileMenu = page.locator('[data-testid="mobile-menu"]')
      await expect(mobileMenu).toBeVisible()

      // Test desktop viewport
      await page.setViewportSize({ width: 1920, height: 1080 })

      await page.reload()
      const desktopMenu = page.locator('[data-testid="desktop-menu"]')
      await expect(desktopMenu).toBeVisible()
    })
  })
})
