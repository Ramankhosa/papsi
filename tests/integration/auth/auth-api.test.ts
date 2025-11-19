import request from 'supertest'
import { createTestServer } from '../setup/test-server'
import { setupTestDatabase, cleanupTestDatabase } from '../setup/test-db'

const app = createTestServer()

describe('Authentication API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase()
  })

  describe('POST /api/v1/auth/signup', () => {
    test('should create new user account', async () => {
      const userData = {
        email: 'newuser@test.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        ati_token: 'valid-ati-token' // Assuming test token exists
      }

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)
        .expect(201)

      expect(response.body).toHaveProperty('user')
      expect(response.body).toHaveProperty('token')
      expect(response.body.user.email).toBe(userData.email)
      expect(response.body.user.firstName).toBe(userData.firstName)
      expect(response.body.user.lastName).toBe(userData.lastName)
      expect(response.body.user.roles).toContain('USER')
    })

    test('should reject duplicate email', async () => {
      const userData = {
        email: 'existing@test.com',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Smith',
        ati_token: 'valid-ati-token'
      }

      // Create user first
      await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)

      // Try to create again
      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)
        .expect(400)

      expect(response.body.message).toContain('already exists')
    })

    test('should validate required fields', async () => {
      const invalidData = {
        email: 'test@test.com'
        // Missing password, firstName, lastName
      }

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('required')
    })

    test('should validate email format', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        ati_token: 'valid-ati-token'
      }

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('email')
    })

    test('should validate password strength', async () => {
      const invalidData = {
        email: 'test@test.com',
        password: '123', // Too weak
        firstName: 'John',
        lastName: 'Doe',
        ati_token: 'valid-ati-token'
      }

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(invalidData)
        .expect(400)

      expect(response.body.message).toContain('password')
    })

    test('should reject invalid ATI token', async () => {
      const userData = {
        email: 'test@test.com',
        password: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        ati_token: 'invalid-token'
      }

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)
        .expect(400)

      expect(response.body.message).toContain('token')
    })
  })

  describe('POST /api/v1/auth/login', () => {
    beforeAll(async () => {
      // Create test user for login tests
      await request(app)
        .post('/api/v1/auth/signup')
        .send({
          email: 'login@test.com',
          password: 'SecurePass123!',
          firstName: 'Login',
          lastName: 'User',
          ati_token: 'valid-ati-token'
        })
    })

    test('should authenticate valid credentials', async () => {
      const credentials = {
        email: 'login@test.com',
        password: 'SecurePass123!'
      }

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(200)

      expect(response.body).toHaveProperty('user')
      expect(response.body).toHaveProperty('token')
      expect(response.body.user.email).toBe(credentials.email)
    })

    test('should reject invalid email', async () => {
      const credentials = {
        email: 'nonexistent@test.com',
        password: 'SecurePass123!'
      }

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(401)

      expect(response.body.message).toContain('credentials')
    })

    test('should reject invalid password', async () => {
      const credentials = {
        email: 'login@test.com',
        password: 'WrongPassword123!'
      }

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(401)

      expect(response.body.message).toContain('credentials')
    })

    test('should handle account lockout after failed attempts', async () => {
      const credentials = {
        email: 'login@test.com',
        password: 'WrongPassword123!'
      }

      // Multiple failed attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send(credentials)
          .expect(401)
      }

      // Should be locked out
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(429)

      expect(response.body.message).toContain('locked')
    })
  })

  describe('GET /api/v1/auth/whoami', () => {
    let authToken: string

    beforeAll(async () => {
      // Get auth token for authenticated requests
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@test.com',
          password: 'SecurePass123!'
        })

      authToken = response.body.token
    })

    test('should return user data for authenticated request', async () => {
      const response = await request(app)
        .get('/api/v1/auth/whoami')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toHaveProperty('user')
      expect(response.body.user.email).toBe('login@test.com')
      expect(response.body.user).toHaveProperty('roles')
    })

    test('should reject unauthenticated request', async () => {
      const response = await request(app)
        .get('/api/v1/auth/whoami')
        .expect(401)

      expect(response.body.message).toContain('unauthorized')
    })

    test('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/whoami')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401)

      expect(response.body.message).toContain('invalid')
    })

    test('should reject expired token', async () => {
      // This would require mocking time or using an expired token
      // Implementation depends on JWT expiry logic
      const response = await request(app)
        .get('/api/v1/auth/whoami')
        .set('Authorization', 'Bearer expired-token')
        .expect(401)

      expect(response.body.message).toContain('expired')
    })
  })

  describe('POST /api/v1/auth/forgot-password', () => {
    test('should send reset email for valid user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'login@test.com' })
        .expect(200)

      expect(response.body.message).toContain('sent')
    })

    test('should not reveal if email exists', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(200)

      // Should return same message to prevent email enumeration
      expect(response.body.message).toContain('sent')
    })

    test('should validate email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'invalid-email' })
        .expect(400)

      expect(response.body.message).toContain('email')
    })
  })

  describe('POST /api/v1/auth/reset-password', () => {
    let resetToken: string

    beforeAll(async () => {
      // Generate reset token (this would normally be done via forgot-password)
      // For testing, we'll assume we have access to generate one
      resetToken = 'valid-reset-token'
    })

    test('should reset password with valid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          password: 'NewSecurePass123!'
        })
        .expect(200)

      expect(response.body.message).toContain('reset')
    })

    test('should reject invalid reset token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: 'invalid-token',
          password: 'NewSecurePass123!'
        })
        .expect(400)

      expect(response.body.message).toContain('invalid')
    })

    test('should validate password strength', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          password: '123' // Too weak
        })
        .expect(400)

      expect(response.body.message).toContain('password')
    })

    test('should prevent token reuse', async () => {
      // First use the token
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          password: 'NewSecurePass123!'
        })

      // Try to use it again
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          password: 'AnotherPass123!'
        })
        .expect(400)

      expect(response.body.message).toContain('used')
    })
  })

  describe('POST /api/v1/auth/verify-email', () => {
    let verificationToken: string

    beforeAll(async () => {
      // Generate verification token (normally sent via email)
      verificationToken = 'valid-verification-token'
    })

    test('should verify email with valid token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: verificationToken })
        .expect(200)

      expect(response.body.message).toContain('verified')
    })

    test('should reject invalid verification token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'invalid-token' })
        .expect(400)

      expect(response.body.message).toContain('invalid')
    })

    test('should prevent token reuse', async () => {
      // First use the token
      await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: verificationToken })

      // Try to use it again
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: verificationToken })
        .expect(400)

      expect(response.body.message).toContain('used')
    })
  })
})
