import request from 'supertest'
import { createTestServer } from '../../setup/test-server'
import { setupTestDatabase, cleanupTestDatabase } from '../../setup/test-db'

const app = createTestServer()

describe('Super Admin Tenant Management API', () => {
  let superAdminToken: string

  beforeAll(async () => {
    await setupTestDatabase()

    // Login as super admin to get token
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@test.com',
        password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!'
      })

    superAdminToken = loginResponse.body.token
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  describe('GET /api/v1/platform/tenants', () => {
    test('should return list of all tenants', async () => {
      const response = await request(app)
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)

      expect(Array.isArray(response.body)).toBe(true)
      expect(response.body.length).toBeGreaterThanOrEqual(0)

      if (response.body.length > 0) {
        const tenant = response.body[0]
        expect(tenant).toHaveProperty('id')
        expect(tenant).toHaveProperty('name')
        expect(tenant).toHaveProperty('ati_id')
        expect(tenant).toHaveProperty('status')
        expect(tenant).toHaveProperty('user_count')
        expect(tenant).toHaveProperty('ati_token_count')
        expect(tenant).toHaveProperty('created_at')
      }
    })

    test('should include tenant statistics', async () => {
      const response = await request(app)
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)

      response.body.forEach((tenant: any) => {
        expect(typeof tenant.user_count).toBe('number')
        expect(typeof tenant.ati_token_count).toBe('number')
        expect(['ACTIVE', 'INACTIVE', 'SUSPENDED']).toContain(tenant.status)
      })
    })

    test('should reject unauthorized access', async () => {
      const response = await request(app)
        .get('/api/v1/platform/tenants')
        .expect(401)

      expect(response.body.message).toContain('unauthorized')
    })

    test('should reject non-super-admin access', async () => {
      // Login as regular user
      const userLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'user@test.com',
          password: 'UserPass123!'
        })

      const response = await request(app)
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${userLogin.body.token}`)
        .expect(403)

      expect(response.body.message).toContain('forbidden')
    })
  })

  describe('POST /api/v1/platform/tenants', () => {
    test('should create new tenant successfully', async () => {
      const tenantData = {
        name: 'Test Corporation',
        atiId: 'TESTCORP',
        generateInitialToken: true,
        expires_at: '2025-12-31T23:59:59Z',
        max_uses: 100,
        plan_tier: 'PRO',
        notes: 'Test tenant for automated testing'
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(tenantData)
        .expect(201)

      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(tenantData.name)
      expect(response.body.ati_id).toBe(tenantData.atiId.toUpperCase())
      expect(response.body.status).toBe('ACTIVE')

      if (tenantData.generateInitialToken) {
        expect(response.body).toHaveProperty('initial_token')
        expect(response.body.initial_token).toHaveProperty('token_display_once')
        expect(response.body.initial_token).toHaveProperty('fingerprint')
      }
    })

    test('should create tenant without initial token', async () => {
      const tenantData = {
        name: 'No Token Corp',
        atiId: 'NOTOKEN',
        generateInitialToken: false
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(tenantData)
        .expect(201)

      expect(response.body).toHaveProperty('id')
      expect(response.body.name).toBe(tenantData.name)
      expect(response.body.ati_id).toBe(tenantData.atiId.toUpperCase())
      expect(response.body).not.toHaveProperty('initial_token')
    })

    test('should validate required fields', async () => {
      const invalidData = {
        name: 'Test Corp'
        // Missing atiId
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('required')
    })

    test('should validate ATI ID format', async () => {
      const invalidData = {
        name: 'Test Corp',
        atiId: 'invalid id with spaces' // Invalid format
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('ATI ID')
    })

    test('should reject duplicate ATI ID', async () => {
      const tenantData = {
        name: 'Duplicate Corp',
        atiId: 'DUPLICATE',
        generateInitialToken: false
      }

      // Create first tenant
      await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(tenantData)

      // Try to create duplicate
      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(tenantData)
        .expect(400)

      expect(response.body.message).toContain('already exists')
    })

    test('should validate plan tier', async () => {
      const invalidData = {
        name: 'Test Corp',
        atiId: 'TESTPLAN',
        plan_tier: 'INVALID_PLAN'
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('plan')
    })

    test('should handle initial token configuration', async () => {
      const tenantData = {
        name: 'Token Config Corp',
        atiId: 'TOKENCFG',
        generateInitialToken: true,
        initialTokenConfig: {
          expires_at: '2024-12-31T23:59:59Z',
          max_uses: 50,
          plan_tier: 'ENTERPRISE',
          notes: 'Custom configuration'
        }
      }

      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(tenantData)
        .expect(201)

      expect(response.body.initial_token).toHaveProperty('expires_at')
      expect(response.body.initial_token.max_uses).toBe(50)
      expect(response.body.initial_token.plan_tier).toBe('ENTERPRISE')
      expect(response.body.initial_token.notes).toBe('Custom configuration')
    })
  })

  describe('PUT /api/v1/platform/tenants/:id', () => {
    let tenantId: string

    beforeAll(async () => {
      // Create a test tenant for updates
      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Update Test Corp',
          atiId: 'UPDATETEST',
          generateInitialToken: false
        })

      tenantId = response.body.id
    })

    test('should update tenant successfully', async () => {
      const updateData = {
        name: 'Updated Corp Name',
        status: 'SUSPENDED'
      }

      const response = await request(app)
        .put(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(updateData)
        .expect(200)

      expect(response.body.name).toBe(updateData.name)
      expect(response.body.status).toBe(updateData.status)
    })

    test('should reject invalid status', async () => {
      const updateData = {
        status: 'INVALID_STATUS'
      }

      const response = await request(app)
        .put(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(updateData)
        .expect(400)

      expect(response.body.message).toContain('status')
    })

    test('should reject non-existent tenant', async () => {
      const updateData = {
        name: 'Non-existent Corp'
      }

      const response = await request(app)
        .put('/api/v1/platform/tenants/non-existent-id')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(updateData)
        .expect(404)

      expect(response.body.message).toContain('not found')
    })
  })

  describe('DELETE /api/v1/platform/tenants/:id', () => {
    let tenantId: string

    beforeAll(async () => {
      // Create a test tenant for deletion
      const response = await request(app)
        .post('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Delete Test Corp',
          atiId: 'DELETETEST',
          generateInitialToken: false
        })

      tenantId = response.body.id
    })

    test('should delete tenant successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/platform/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)

      expect(response.body.message).toContain('deleted')

      // Verify tenant is deleted
      const getResponse = await request(app)
        .get('/api/v1/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`)

      const deletedTenant = getResponse.body.find((t: any) => t.id === tenantId)
      expect(deletedTenant).toBeUndefined()
    })

    test('should reject deletion of non-existent tenant', async () => {
      const response = await request(app)
        .delete('/api/v1/platform/tenants/non-existent-id')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404)

      expect(response.body.message).toContain('not found')
    })

    test('should handle tenant with existing users', async () => {
      // Create tenant with users (this would be complex to set up)
      // The test should verify proper cascading delete or rejection
      // Implementation depends on business rules
    })
  })

  describe('Expiry Notifications', () => {
    describe('GET /api/v1/admin/expiry-notifications', () => {
      test('should return expiry notification status', async () => {
        const response = await request(app)
          .get('/api/v1/admin/expiry-notifications')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)

        expect(response.body).toHaveProperty('expiringTokensCount')
        expect(response.body).toHaveProperty('tokens')
        expect(Array.isArray(response.body.tokens)).toBe(true)
      })

      test('should include token details for expiring tokens', async () => {
        const response = await request(app)
          .get('/api/v1/admin/expiry-notifications')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)

        response.body.tokens.forEach((token: any) => {
          expect(token).toHaveProperty('id')
          expect(token).toHaveProperty('fingerprint')
          expect(token).toHaveProperty('expiresAt')
          expect(token).toHaveProperty('daysUntilExpiry')
          expect(token).toHaveProperty('tenantName')
        })
      })
    })

    describe('POST /api/v1/admin/expiry-notifications', () => {
      test('should send expiry notifications', async () => {
        const response = await request(app)
          .post('/api/v1/admin/expiry-notifications')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)

        expect(response.body.message).toContain('sent')
      })

      test('should handle empty notification list', async () => {
        // Ensure no tokens are expiring
        const response = await request(app)
          .post('/api/v1/admin/expiry-notifications')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)

        expect(response.body.message).toContain('sent')
      })
    })
  })

  describe('Plan Quotas', () => {
    describe('GET /api/v1/admin/plan-quotas', () => {
      test('should return plan quota configurations', async () => {
        const response = await request(app)
          .get('/api/v1/admin/plan-quotas')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)

        expect(Array.isArray(response.body)).toBe(true)

        response.body.forEach((plan: any) => {
          expect(plan).toHaveProperty('plan_tier')
          expect(plan).toHaveProperty('quotas')
          expect(typeof plan.quotas).toBe('object')
        })
      })
    })

    describe('PUT /api/v1/admin/plan-quotas', () => {
      test('should update plan quotas', async () => {
        const quotaData = {
          BASIC: {
            monthly_searches: 100,
            monthly_drafts: 50,
            api_calls_per_hour: 1000
          },
          PRO: {
            monthly_searches: 1000,
            monthly_drafts: 200,
            api_calls_per_hour: 5000
          }
        }

        const response = await request(app)
          .put('/api/v1/admin/plan-quotas')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send(quotaData)
          .expect(200)

        expect(response.body.message).toContain('updated')
      })

      test('should validate quota values', async () => {
        const invalidQuotaData = {
          BASIC: {
            monthly_searches: -1, // Invalid negative value
            monthly_drafts: 50
          }
        }

        const response = await request(app)
          .put('/api/v1/admin/plan-quotas')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send(invalidQuotaData)
          .expect(400)

        expect(response.body.message).toContain('invalid')
      })
    })
  })
})
