import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function setupTestDatabase() {
  // Clean up existing test data
  await cleanupTestDatabase()

  // Create test tenants
  const tenant1 = await prisma.tenant.create({
    data: {
      name: 'Test Tenant 1',
      atiId: 'TEST1',
      status: 'ACTIVE',
    }
  })

  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Test Tenant 2',
      atiId: 'TEST2',
      status: 'ACTIVE',
    }
  })

  // Create test users
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@test.com',
      passwordHash: '$2b$10$hashedpassword', // Use proper hashing in real implementation
      firstName: 'Super',
      lastName: 'Admin',
      roles: ['SUPER_ADMIN'],
      emailVerified: true,
      tenantId: tenant1.id
    }
  })

  const tenantAdmin = await prisma.user.create({
    data: {
      email: 'tenantadmin@test.com',
      passwordHash: '$2b$10$hashedpassword',
      firstName: 'Tenant',
      lastName: 'Admin',
      roles: ['ADMIN'],
      emailVerified: true,
      tenantId: tenant1.id
    }
  })

  const regularUser = await prisma.user.create({
    data: {
      email: 'user@test.com',
      passwordHash: '$2b$10$hashedpassword',
      firstName: 'Regular',
      lastName: 'User',
      roles: ['ANALYST'],
      emailVerified: true,
      tenantId: tenant1.id
    }
  })

  // Create test ATI tokens
  await prisma.aTIToken.create({
    data: {
      tokenHash: 'dummy-hash-1',
      fingerprint: 'test-fingerprint-1',
      status: 'ACTIVE',
      tenantId: tenant1.id,
      expiresAt: new Date('2025-12-31'),
      maxUses: 100,
      planTier: 'PRO',
      notes: 'Test token'
    }
  })

  await prisma.aTIToken.create({
    data: {
      tokenHash: 'dummy-hash-2',
      fingerprint: 'test-fingerprint-2',
      status: 'EXPIRED',
      tenantId: tenant1.id,
      expiresAt: new Date('2023-01-01'),
      maxUses: 50,
      planTier: 'BASIC'
    }
  })

  // Create test projects and patents
  const project = await prisma.project.create({
    data: {
      name: 'Test Project',
      userId: regularUser.id
    }
  })

  await prisma.patent.create({
    data: {
      title: 'Test Patent Application',
      projectId: project.id,
      createdBy: regularUser.id
    }
  })

  // Set up test plan quotas - commented out as PlanQuota model doesn't exist in current schema
  // await prisma.planQuota.createMany({
  //   data: [
  //     {
  //       planTier: 'BASIC',
  //       monthlySearches: 100,
  //       monthlyDrafts: 50,
  //       apiCallsPerHour: 1000
  //     },
  //     {
  //       planTier: 'PRO',
  //       monthlySearches: 1000,
  //       monthlyDrafts: 200,
  //       apiCallsPerHour: 5000
  //     },
  //     {
  //       planTier: 'ENTERPRISE',
  //       monthlySearches: 10000,
  //       monthlyDrafts: 1000,
  //       apiCallsPerHour: 50000
  //     }
  //   ]
  // })

  return {
    tenants: [tenant1, tenant2],
    users: { superAdmin, tenantAdmin, regularUser },
    project
  }
}

export async function cleanupTestDatabase() {
  // Clean up in reverse order of dependencies
  await prisma.usageLog.deleteMany()
  await prisma.aTIToken.deleteMany()
  await prisma.patent.deleteMany()
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()
  // await prisma.planQuota.deleteMany() // Commented out as PlanQuota model doesn't exist
  await prisma.tenant.deleteMany()
}
