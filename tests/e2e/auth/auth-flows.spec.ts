import { test, expect } from '@playwright/test'

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session
    await page.context().clearCookies()
    await page.goto('/')
  })

  test('Complete user registration flow', async ({ page }) => {
    // Navigate to registration page
    await page.goto('/register')

    // Fill registration form
    await page.fill('input[name="email"]', 'e2e-test@example.com')
    await page.fill('input[name="password"]', 'SecurePass123!')
    await page.fill('input[name="confirmPassword"]', 'SecurePass123!')
    await page.fill('input[name="firstName"]', 'E2E')
    await page.fill('input[name="lastName"]', 'TestUser')
    await page.fill('input[name="atiToken"]', process.env.TEST_ATI_TOKEN || 'test-token')

    // Submit form
    await page.click('button[type="submit"]')

    // Should redirect to dashboard or email verification page
    await expect(page).toHaveURL(/\/(dashboard|verify-email)/)

    // Check for success message
    await expect(page.locator('text=account created successfully')).toBeVisible()
  })

  test('User login and logout flow', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login')

    // Fill login form
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com')
    await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || 'TestPass123!')

    // Submit form
    await page.click('button[type="submit"]')

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard')

    // Check that user is logged in
    await expect(page.locator('text=Welcome back')).toBeVisible()

    // Test logout
    await page.click('button:has-text("Logout")')

    // Should redirect to login page
    await expect(page).toHaveURL('/login')

    // Verify user is logged out
    await expect(page.locator('text=Welcome back')).not.toBeVisible()
  })

  test('Password reset flow', async ({ page }) => {
    // Navigate to forgot password page
    await page.goto('/forgot-password')

    // Fill email
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com')

    // Submit form
    await page.click('button[type="submit"]')

    // Check for success message
    await expect(page.locator('text=password reset email sent')).toBeVisible()

    // Note: Actual password reset would require email interaction
    // This test verifies the UI flow up to email sending
  })

  test('Email verification flow', async ({ page }) => {
    // This test assumes we have a way to get a verification token
    // In a real scenario, this would come from email
    const verificationToken = process.env.TEST_VERIFICATION_TOKEN || 'test-verification-token'

    // Navigate to verification page with token
    await page.goto(`/verify-email?token=${verificationToken}`)

    // Check for verification success message
    await expect(page.locator('text=email verified successfully')).toBeVisible()

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard')
  })

  test('Session persistence across page reloads', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com')
    await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || 'TestPass123!')
    await page.click('button[type="submit"]')

    // Wait for dashboard to load
    await expect(page).toHaveURL('/dashboard')

    // Reload the page
    await page.reload()

    // Should still be logged in
    await expect(page).toHaveURL('/dashboard')
    await expect(page.locator('text=Welcome back')).toBeVisible()
  })

  test('Role-based route protection - Super Admin', async ({ page }) => {
    // Login as super admin
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.SUPER_ADMIN_EMAIL || 'superadmin@test.com')
    await page.fill('input[name="password"]', process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!')
    await page.click('button[type="submit"]')

    // Should access super admin dashboard
    await page.goto('/super-admin')
    await expect(page).toHaveURL('/super-admin')

    // Should see super admin specific content
    await expect(page.locator('text=Super Admin Dashboard')).toBeVisible()
    await expect(page.locator('text=Create Tenant')).toBeVisible()
  })

  test('Role-based route protection - Tenant Admin', async ({ page }) => {
    // Login as tenant admin
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.TENANT_ADMIN_EMAIL || 'tenantadmin@test.com')
    await page.fill('input[name="password"]', process.env.TENANT_ADMIN_PASSWORD || 'TenantAdmin123!')
    await page.click('button[type="submit"]')

    // Should access tenant admin dashboard
    await page.goto('/tenant-admin')
    await expect(page).toHaveURL('/tenant-admin')

    // Should see tenant admin specific content
    await expect(page.locator('text=Tenant Admin Dashboard')).toBeVisible()
    await expect(page.locator('text=ATI Token Management')).toBeVisible()

    // Should not access super admin routes
    await page.goto('/super-admin')
    await expect(page).toHaveURL('/unauthorized') // or redirect to appropriate page
  })

  test('Role-based route protection - Regular User', async ({ page }) => {
    // Login as regular user
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.REGULAR_USER_EMAIL || 'user@test.com')
    await page.fill('input[name="password"]', process.env.REGULAR_USER_PASSWORD || 'UserPass123!')
    await page.click('button[type="submit"]')

    // Should access user dashboard
    await page.goto('/dashboard')
    await expect(page).toHaveURL('/dashboard')

    // Should see user specific content
    await expect(page.locator('text=My Projects')).toBeVisible()
    await expect(page.locator('text=Draft Patent')).toBeVisible()

    // Should not access admin routes
    await page.goto('/super-admin')
    await expect(page).toHaveURL('/unauthorized')

    await page.goto('/tenant-admin')
    await expect(page).toHaveURL('/unauthorized')
  })

  test('Unauthorized access redirects', async ({ page }) => {
    // Try to access protected route without authentication
    await page.goto('/dashboard')
    await expect(page).toHaveURL('/login')

    await page.goto('/super-admin')
    await expect(page).toHaveURL('/login')

    await page.goto('/tenant-admin')
    await expect(page).toHaveURL('/login')
  })

  test('Invalid login attempts', async ({ page }) => {
    await page.goto('/login')

    // Test invalid email
    await page.fill('input[name="email"]', 'invalid@example.com')
    await page.fill('input[name="password"]', 'password')
    await page.click('button[type="submit"]')

    await expect(page.locator('text=Invalid credentials')).toBeVisible()

    // Test invalid password
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com')
    await page.fill('input[name="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    await expect(page.locator('text=Invalid credentials')).toBeVisible()

    // Should still be on login page
    await expect(page).toHaveURL('/login')
  })

  test('Form validation on registration', async ({ page }) => {
    await page.goto('/register')

    // Try to submit empty form
    await page.click('button[type="submit"]')

    // Check for validation errors
    await expect(page.locator('text=Email is required')).toBeVisible()
    await expect(page.locator('text=Password is required')).toBeVisible()
    await expect(page.locator('text=First name is required')).toBeVisible()
    await expect(page.locator('text=Last name is required')).toBeVisible()

    // Test invalid email format
    await page.fill('input[name="email"]', 'invalid-email')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Invalid email format')).toBeVisible()

    // Test weak password
    await page.fill('input[name="password"]', '123')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Password too weak')).toBeVisible()

    // Test password mismatch
    await page.fill('input[name="password"]', 'SecurePass123!')
    await page.fill('input[name="confirmPassword"]', 'DifferentPass123!')
    await page.click('button[type="submit"]')
    await expect(page.locator('text=Passwords do not match')).toBeVisible()
  })

  test('Account lockout after multiple failed attempts', async ({ page }) => {
    await page.goto('/login')

    const email = process.env.TEST_USER_EMAIL || 'test@example.com'
    const wrongPassword = 'wrongpassword'

    // Multiple failed login attempts
    for (let i = 0; i < 5; i++) {
      await page.fill('input[name="email"]', email)
      await page.fill('input[name="password"]', wrongPassword)
      await page.click('button[type="submit"]')

      // Wait for error message
      await expect(page.locator('text=Invalid credentials')).toBeVisible()
    }

    // Next attempt should show account locked message
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', wrongPassword)
    await page.click('button[type="submit"]')

    await expect(page.locator('text=Account temporarily locked')).toBeVisible()
  })

  test('Session timeout handling', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.TEST_USER_EMAIL || 'test@example.com')
    await page.fill('input[name="password"]', process.env.TEST_USER_PASSWORD || 'TestPass123!')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL('/dashboard')

    // Simulate session timeout by clearing localStorage
    await page.evaluate(() => {
      localStorage.removeItem('auth_token')
    })

    // Try to access a protected resource
    await page.goto('/projects')

    // Should redirect to login
    await expect(page).toHaveURL('/login')
  })
})
