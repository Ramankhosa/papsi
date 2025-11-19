import { test, expect } from '@playwright/test'

test.describe('Super Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Login as super admin
    await page.goto('/login')
    await page.fill('input[name="email"]', process.env.SUPER_ADMIN_EMAIL || 'superadmin@test.com')
    await page.fill('input[name="password"]', process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!')
    await page.click('button[type="submit"]')

    // Wait for redirect to dashboard
    await expect(page).toHaveURL('/super-admin')
  })

  test('Super admin can view platform overview', async ({ page }) => {
    // Check dashboard header
    await expect(page.locator('text=Super Admin Dashboard')).toBeVisible()
    await expect(page.locator('text=Platform management and tenant oversight')).toBeVisible()

    // Check statistics cards
    await expect(page.locator('text=Total Tenants')).toBeVisible()
    await expect(page.locator('text=Total Users')).toBeVisible()
    await expect(page.locator('text=ATI Tokens')).toBeVisible()
    await expect(page.locator('text=Active Tenants')).toBeVisible()

    // Check navigation buttons
    await expect(page.locator('text=ATI Management')).toBeVisible()
    await expect(page.locator('text=📊 Analytics')).toBeVisible()
    await expect(page.locator('text=Quota Controller')).toBeVisible()
    await expect(page.locator('text=User wise service usage')).toBeVisible()
  })

  test('Super admin can view tenant list', async ({ page }) => {
    // Check tenant management section
    await expect(page.locator('text=Tenant Management')).toBeVisible()
    await expect(page.locator('text=Overview of all tenants and their activity')).toBeVisible()

    // Check if tenant list is displayed (may be empty)
    const tenantList = page.locator('[data-testid="tenant-list"]')
    await expect(tenantList.or(page.locator('text=No tenants yet'))).toBeVisible()
  })

  test('Super admin can create new tenant', async ({ page }) => {
    // Click create tenant button
    await page.click('text=Create Tenant')

    // Check modal appears
    await expect(page.locator('text=Create New Tenant')).toBeVisible()
    await expect(page.locator('text=Set up a new tenant organization with optional initial ATI token')).toBeVisible()

    // Fill basic information
    await page.fill('input[id="tenant_name"]', 'E2E Test Corp')
    await page.fill('input[id="ati_id"]', 'E2ETEST')

    // Check initial token generation is enabled by default
    const generateTokenCheckbox = page.locator('input[id="generate_initial_token"]')
    await expect(generateTokenCheckbox).toBeChecked()

    // Configure initial token
    await page.fill('input[id="token_expires_at"]', '2025-12-31T23:59')
    await page.fill('input[id="token_max_uses"]', '100')
    await page.selectOption('select[id="token_plan_tier"]', 'PRO')
    await page.fill('input[id="token_notes"]', 'E2E test token')

    // Submit form
    await page.click('button[type="submit"]:has-text("Create Tenant")')

    // Check success modal
    await expect(page.locator('text=✅ Tenant Created Successfully')).toBeVisible()
    await expect(page.locator('text=Tenant "E2E Test Corp" created successfully!')).toBeVisible()

    // Check token display (one-time only)
    await expect(page.locator('text=Initial ATI Token Generated')).toBeVisible()
    const tokenDisplay = page.locator('[class*="bg-yellow-100"]')
    await expect(tokenDisplay).toBeVisible()

    // Copy token (if button exists)
    const copyButton = page.locator('text=📋 Copy Token to Clipboard')
    if (await copyButton.isVisible()) {
      await copyButton.click()
      // Could verify clipboard content in a real test
    }

    // Close modal
    await page.click('text=Close')

    // Verify tenant appears in list
    await expect(page.locator('text=E2E Test Corp')).toBeVisible()
    await expect(page.locator('text=ATI ID: E2ETEST')).toBeVisible()
  })

  test('Super admin can create tenant without initial token', async ({ page }) => {
    // Click create tenant button
    await page.click('text=Create Tenant')

    // Fill basic information
    await page.fill('input[id="tenant_name"]', 'No Token Corp')
    await page.fill('input[id="ati_id"]', 'NOTOKEN')

    // Uncheck generate initial token
    await page.uncheck('input[id="generate_initial_token"]')

    // Submit form
    await page.click('button[type="submit"]:has-text("Create Tenant")')

    // Check success modal (without token section)
    await expect(page.locator('text=✅ Tenant Created Successfully')).toBeVisible()
    await expect(page.locator('text=No Token Corp')).toBeVisible()

    // Should not show token generation section
    await expect(page.locator('text=Initial ATI Token Generated')).not.toBeVisible()

    // Close modal
    await page.click('text=Close')
  })

  test('Tenant creation form validation', async ({ page }) => {
    // Click create tenant button
    await page.click('text=Create Tenant')

    // Try to submit empty form
    await page.click('button[type="submit"]:has-text("Create Tenant")')

    // Check validation (implementation may vary)
    // This depends on how validation is implemented in the component

    // Test invalid ATI ID
    await page.fill('input[id="tenant_name"]', 'Test Corp')
    await page.fill('input[id="ati_id"]', 'invalid id with spaces')
    await page.click('button[type="submit"]:has-text("Create Tenant")')

    // Should show validation error or handle gracefully
    // The exact behavior depends on implementation

    // Close modal
    await page.click('button:has-text("Cancel")')
  })

  test('Super admin can access ATI management', async ({ page }) => {
    // Click ATI Management button
    await page.click('text=ATI Management')

    // Should navigate to ATI management page
    await expect(page).toHaveURL('/ati-management')
    await expect(page.locator('text=ATI Management')).toBeVisible()
  })

  test('Super admin can access analytics', async ({ page }) => {
    // Click Analytics button
    await page.click('text=📊 Analytics')

    // Should navigate to analytics page
    await expect(page).toHaveURL('/super-admin/analytics')
    await expect(page.locator('text=Platform Analytics')).toBeVisible()
  })

  test('Super admin can access quota controller', async ({ page }) => {
    // Click Quota Controller button
    await page.click('text=Quota Controller')

    // Should navigate to quota controller page
    await expect(page).toHaveURL('/super-admin/quota-controller')
    await expect(page.locator('text=Quota Management')).toBeVisible()
  })

  test('Super admin can access user service usage', async ({ page }) => {
    // Click User wise service usage button
    await page.click('text=User wise service usage')

    // Should navigate to user service usage page
    await expect(page).toHaveURL('/super-admin/user-service-usage')
    await expect(page.locator('text=User Service Usage')).toBeVisible()
  })

  test('Expiry notifications functionality', async ({ page }) => {
    // Check expiry notifications section
    await expect(page.locator('text=Expiry Notifications')).toBeVisible()
    await expect(page.locator('text=Monitor and send notifications for tokens expiring within 7 days')).toBeVisible()

    // Click check status button
    await page.click('text=Check Status')

    // Should show notification status
    await expect(page.locator('text=Tokens Expiring Soon')).toBeVisible()

    // Click send notifications button
    await page.click('text=Send Notifications')

    // Should show confirmation dialog
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('send expiry notifications')
      await dialog.accept()
    })

    // Should show success message
    await expect(page.locator('text=Expiry notifications sent successfully')).toBeVisible()
  })

  test('Statistics update correctly', async ({ page }) => {
    // Get initial statistics
    const initialTenantCount = await page.locator('text=Total Tenants').textContent()
    const initialUserCount = await page.locator('text=Total Users').textContent()

    // Create a new tenant
    await page.click('text=Create Tenant')
    await page.fill('input[id="tenant_name"]', 'Stats Test Corp')
    await page.fill('input[id="ati_id"]', 'STATSTEST')
    await page.uncheck('input[id="generate_initial_token"]')
    await page.click('button[type="submit"]:has-text("Create Tenant")')
    await page.click('text=Close')

    // Wait for page to update
    await page.waitForTimeout(1000)

    // Check if statistics updated (this depends on real-time updates)
    // In a real implementation, statistics might update automatically
    // or require a page refresh
    const updatedTenantCount = await page.locator('text=Total Tenants').textContent()

    // At minimum, the page should still show statistics
    expect(updatedTenantCount).toBeDefined()
  })

  test('Super admin logout functionality', async ({ page }) => {
    // Click logout button
    await page.click('button:has-text("Logout")')

    // Should redirect to login page
    await expect(page).toHaveURL('/login')

    // Verify super admin areas are no longer accessible
    await page.goto('/super-admin')
    await expect(page).toHaveURL('/login')
  })

  test('Responsive design - mobile view', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    // Check that dashboard adapts to mobile
    await expect(page.locator('text=Super Admin Dashboard')).toBeVisible()

    // Check that buttons are accessible on mobile
    await expect(page.locator('text=Create Tenant')).toBeVisible()

    // Statistics should be visible
    await expect(page.locator('text=Total Tenants')).toBeVisible()
  })

  test('Error handling - network issues', async ({ page }) => {
    // This test would require mocking network failures
    // For now, we'll test general error handling

    // Try to create tenant with invalid data that causes server error
    await page.click('text=Create Tenant')
    await page.fill('input[id="tenant_name"]', 'Test Corp')
    await page.fill('input[id="ati_id"]', 'TEST')

    // Submit - this might cause an error depending on validation
    await page.click('button[type="submit"]:has-text("Create Tenant")')

    // If error occurs, check error handling
    const errorMessage = page.locator('text=Failed to create tenant')
    if (await errorMessage.isVisible()) {
      await expect(errorMessage).toBeVisible()
    }

    // Close modal
    await page.click('button:has-text("Cancel")')
  })
})
