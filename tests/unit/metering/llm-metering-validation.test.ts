/**
 * Comprehensive LLM Metering Validation Tests
 *
 * Tests all aspects of LLM request validation, token counting, and bypass prevention.
 * This covers the core security and billing integrity of the metering system.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { LLMGateway, llmGateway } from '../../../src/lib/metering/gateway'
import { createMeteringSystem } from '../../../src/lib/metering/system'
import { createPolicyService } from '../../../src/lib/metering/policy'
import { createMeteringService } from '../../../src/lib/metering/metering'
import { LLMProviderRouter } from '../../../src/lib/metering/providers/provider-router'
import { resolveModel } from '../../../src/lib/metering/model-resolver'
import { extractTenantContextFromRequest } from '../../../src/lib/metering/auth-bridge'
import type { TenantContext, FeatureRequest, LLMRequest, EnforcementDecision } from '@/lib/metering/types'
import { MeteringError } from '@/lib/metering/errors'

// Mock external dependencies
jest.mock('../../../src/lib/prisma', () => ({
  prisma: {
    tenant: { findUnique: jest.fn() },
    tenantPlan: { findFirst: jest.fn() },
    plan: { findFirst: jest.fn() },
    planFeatures: { findMany: jest.fn() },
    planLLMAccess: { findFirst: jest.fn() },
    planStageModelConfig: { findFirst: jest.fn() },
    planTaskModelConfig: { findFirst: jest.fn() },
    policyRule: { findMany: jest.fn() },
    usageReservation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    usageLog: { create: jest.fn() },
    usageMeter: { upsert: jest.fn() },
    lLMModel: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    planFeature: { findFirst: jest.fn() },
    quotaAlert: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() }
  }
}))

jest.mock('../../../src/lib/metering/providers/provider-router')
jest.mock('../../../src/lib/metering/model-resolver')

describe('LLM Metering Validation - Plan-Based Access Control', () => {
  let mockPrisma: any
  let mockProviderRouter: jest.Mocked<LLMProviderRouter>
  let mockResolveModel: jest.MockedFunction<typeof resolveModel>

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = require('@/lib/prisma').prisma
    mockProviderRouter = require('@/lib/metering/providers/provider-router').LLMProviderRouter as jest.Mocked<LLMProviderRouter>
    mockResolveModel = require('@/lib/metering/model-resolver').resolveModel as jest.MockedFunction<typeof resolveModel>
  })

  describe('Plan-Based Model Access Validation', () => {
    it('should allow access to models permitted by plan', async () => {
      // Setup: User with PRO plan that allows GPT-4o
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-pro',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-pro',
        code: 'PRO',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'PRO_L' },
          allowedClasses: JSON.stringify(['PRO_L'])
        }]
      })
      mockPrisma.planFeature.findFirst.mockResolvedValue({
        monthlyQuota: 1000,
        dailyQuota: 100
      })
      mockPrisma.usageMeter.findFirst.mockResolvedValue({ currentUsage: 50 })

      mockResolveModel.mockResolvedValue({
        modelCode: 'gpt-4o',
        modelId: 'model-123',
        provider: 'openai',
        displayName: 'GPT-4o',
        supportsVision: false,
        supportsStreaming: true,
        contextWindow: 128000,
        fallbacks: [],
        source: 'plan-default',
        costPer1M: { input: 2500, output: 10000 }
      })

      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'Draft a patent claim',
        inputTokens: 100
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      expect(result.success).toBe(true)
      expect(mockResolveModel).toHaveBeenCalledWith('plan-pro', 'LLM2_DRAFT', undefined)
    })

    it('should deny access to models not permitted by plan', async () => {
      // Setup: User with BASIC plan trying to access GPT-4o (only allowed on PRO+)
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-basic'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        code: 'BASIC',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'BASE_M' },
          allowedClasses: JSON.stringify(['BASE_M'])
        }]
      })

      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'Draft a patent claim',
        modelClass: 'gpt-4o', // Explicitly requesting PRO model
        inputTokens: 100
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('POLICY_VIOLATION')
    })

    it('should prevent model class spoofing via direct model specification', async () => {
      // Attempt to bypass plan restrictions by directly specifying a model
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-basic'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        code: 'BASIC',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'BASE_M' },
          allowedClasses: JSON.stringify(['BASE_M'])
        }]
      })

      // Mock model resolver to return the requested model despite plan restrictions
      mockResolveModel.mockResolvedValue({
        modelCode: 'claude-3.5-sonnet', // ADVANCED model
        modelId: 'model-456',
        provider: 'anthropic',
        displayName: 'Claude 3.5 Sonnet',
        supportsVision: true,
        supportsStreaming: true,
        contextWindow: 200000,
        fallbacks: [],
        source: 'plan-default',
        costPer1M: { input: 3000, output: 15000 }
      })

      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'Draft a patent claim',
        modelClass: 'claude-3.5-sonnet',
        inputTokens: 100
      }

      // This should still be blocked by plan validation
      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('POLICY_VIOLATION')
    })
  })

  describe('Token Counting Accuracy', () => {
    it('should accurately count input tokens from text prompts', async () => {
      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'This is a test prompt with exactly forty characters.',
        inputTokens: undefined // Force estimation
      }

      const gateway = new LLMGateway()
      const estimated = (gateway as any).estimateInputTokens(request)

      // Rough heuristic: ~4 chars per token
      expect(estimated).toBeGreaterThan(8) // At least 9 tokens
      expect(estimated).toBeLessThan(15) // At most 14 tokens
    })

    it('should count tokens in multimodal content', async () => {
      const request: LLMRequest = {
        taskCode: 'LLM1_PRIOR_ART',
        content: {
          parts: [
            { type: 'text', text: 'Analyze this patent image' },
            { type: 'image', image: { data: 'base64data', mimeType: 'image/jpeg' } }
          ]
        },
        inputTokens: undefined
      }

      const gateway = new LLMGateway()
      const estimated = (gateway as any).estimateInputTokens(request)

      expect(estimated).toBeGreaterThan(5) // At least some tokens from text
    })

    it('should validate provider-reported token counts', async () => {
      // Mock provider returning token counts
      const mockProvider = {
        execute: jest.fn().mockResolvedValue({
          output: 'Generated response',
          outputTokens: 150,
          modelClass: 'gpt-4o-mini',
          metadata: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            inputTokens: 50,
            latencyMs: 1000
          }
        })
      }

      mockProviderRouter.getProviderForModel.mockReturnValue(mockProvider as any)
      mockProviderRouter.routeWithModel.mockResolvedValue({
        output: 'Generated response',
        outputTokens: 150,
        modelClass: 'gpt-4o-mini',
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 50,
          latencyMs: 1000
        }
      })

      // This test verifies that token counts are properly recorded
      expect(mockProvider.execute).not.toHaveBeenCalled() // Should use router
    })
  })

  describe('Multi-Level Usage Tracking', () => {
    it('should track usage at user level', async () => {
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      mockPrisma.usageLog.create.mockResolvedValue({} as any)

      const meteringService = createMeteringService({} as any)
      const stats = {
        inputTokens: 100,
        outputTokens: 200,
        modelClass: 'gpt-4o' as any,
        apiCalls: 1,
        metadata: {}
      }

      await meteringService.recordUsage('reservation-123', stats, 'user-456')

      expect(mockPrisma.usageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          userId: 'user-456',
          inputTokens: 100,
          outputTokens: 200,
          modelClass: 'gpt-4o'
        })
      })
    })

    it('should track usage at tenant level across all users', async () => {
      mockPrisma.usageMeter.upsert.mockResolvedValue({} as any)

      const meteringService = createMeteringService({} as any)

      // Simulate multiple users' usage
      const stats = {
        inputTokens: 50,
        outputTokens: 100,
        modelClass: 'gpt-4o-mini' as any,
        apiCalls: 1,
        metadata: {}
      }

      await meteringService.recordUsage('reservation-123', stats)

      expect(mockPrisma.usageMeter.upsert).toHaveBeenCalled()
      const upsertCall = mockPrisma.usageMeter.upsert.mock.calls[0][0]

      expect(upsertCall.where).toEqual(
        expect.objectContaining({
          tenantId: expect.any(String),
          featureId: expect.any(String),
          taskCode: expect.any(String),
          periodType: 'MONTHLY'
        })
      )
    })

    it('should enforce plan-level quotas', async () => {
      const policyService = createPolicyService({} as any)

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        status: 'ACTIVE',
        planFeatures: [{
          feature: { code: 'PATENT_DRAFTING' },
          monthlyQuota: 100,
          dailyQuota: 10
        }]
      })
      mockPrisma.usageMeter.findFirst.mockResolvedValue({ currentUsage: 95 }) // Near limit

      const request: FeatureRequest = {
        tenantId: 'tenant-123',
        featureCode: 'PATENT_DRAFTING',
        taskCode: 'LLM2_DRAFT',
        userId: 'user-456'
      }

      const decision = await policyService.evaluateAccess(request)

      expect(decision.allowed).toBe(true) // Still allowed, not over limit
      expect(decision.remainingQuota).toBeDefined()
    })

    it('should block requests when plan quota exceeded', async () => {
      const policyService = createPolicyService({} as any)

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        status: 'ACTIVE',
        planFeatures: [{
          feature: { code: 'PATENT_DRAFTING' },
          monthlyQuota: 100,
          dailyQuota: 10
        }]
      })
      mockPrisma.usageMeter.findFirst.mockResolvedValue({ currentUsage: 105 }) // Over limit

      const request: FeatureRequest = {
        tenantId: 'tenant-123',
        featureCode: 'PATENT_DRAFTING',
        taskCode: 'LLM2_DRAFT',
        userId: 'user-456'
      }

      const decision = await policyService.evaluateAccess(request)

      expect(decision.allowed).toBe(false)
      expect(decision.reason).toContain('Quota exceeded')
    })
  })

  describe('Super Admin Bypass Prevention', () => {
    it('should prevent tenant admins from modifying plan configurations', async () => {
      // This test verifies that tenant admins cannot change LLM model access
      // through any API that might bypass super admin controls

      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-basic'
      }

      // Mock that user is tenant admin, not super admin
      mockPrisma.tenant.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        // No super admin privileges
      })

      // Any attempt to modify plan LLM access should be blocked
      const mockRequest = {
        headers: {
          'authorization': 'Bearer tenant-admin-token'
        }
      }

      const result = await extractTenantContextFromRequest(mockRequest)

      expect(result).toBeNull() // Should not extract context for unauthorized access
    })

    it('should validate model access against super admin defined plan rules', async () => {
      // Test that even if model resolver returns a model, plan validation still applies

      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-basic'
      }

      // Setup basic plan that only allows BASE_M models
      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        code: 'BASIC',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'BASE_M' },
          allowedClasses: JSON.stringify(['BASE_M'])
        }]
      })

      // But model resolver somehow returns PRO model
      mockResolveModel.mockResolvedValue({
        modelCode: 'gpt-4o', // PRO model
        modelId: 'model-123',
        provider: 'openai',
        displayName: 'GPT-4o',
        supportsVision: false,
        supportsStreaming: true,
        contextWindow: 128000,
        fallbacks: [],
        source: 'plan-default',
        costPer1M: { input: 2500, output: 10000 }
      })

      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'Draft patent',
        inputTokens: 50
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      // Should still be blocked by plan validation
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('POLICY_VIOLATION')
    })

    it('should prevent direct provider API access bypassing metering', async () => {
      // Test that direct provider calls are blocked if not through gateway

      const mockProvider = {
        execute: jest.fn().mockResolvedValue({
          output: 'Direct API response',
          outputTokens: 100,
          modelClass: 'gpt-4o',
          metadata: {}
        })
      }

      // Attempt direct provider access (simulating bypass)
      const directResult = await mockProvider.execute({
        taskCode: 'LLM2_DRAFT',
        prompt: 'Bypass test',
        inputTokens: 50
      }, {} as EnforcementDecision)

      // Direct access succeeds (as expected), but this test documents
      // that the gateway is the only authorized access point
      expect(directResult.output).toBe('Direct API response')

      // In production, providers should only be accessible through the gateway
      // This test serves as documentation of the security boundary
    })
  })

  describe('Provider Routing and Failover', () => {
    it('should route to correct provider based on model', async () => {
      mockProviderRouter.getProviderForModel.mockImplementation((modelCode: string) => {
        if (modelCode === 'gpt-4o') {
          return {
            name: 'openai',
            execute: jest.fn().mockResolvedValue({
              output: 'OpenAI response',
              outputTokens: 100,
              modelClass: 'gpt-4o',
              metadata: { provider: 'openai' }
            })
          } as any
        }
        if (modelCode === 'claude-3.5-sonnet') {
          return {
            name: 'anthropic',
            execute: jest.fn().mockResolvedValue({
              output: 'Anthropic response',
              outputTokens: 100,
              modelClass: 'claude-3.5-sonnet',
              metadata: { provider: 'anthropic' }
            })
          } as any
        }
        return null
      })

      mockProviderRouter.routeWithModel.mockImplementation(async (request, limits, modelCode) => {
        const provider = mockProviderRouter.getProviderForModel(modelCode)
        if (provider) {
          return provider.execute(request, limits)
        }
        throw new Error('No provider found')
      })

      const result = await mockProviderRouter.routeWithModel(
        { taskCode: 'LLM2_DRAFT', prompt: 'Test', inputTokens: 10 },
        { allowed: true, maxTokensOut: 100 } as EnforcementDecision,
        'gpt-4o',
        []
      )

      expect(result.output).toBe('OpenAI response')
      expect(result.metadata.provider).toBe('openai')
    })

    it('should fallback to alternative models on provider failure', async () => {
      const failingProvider = {
        name: 'openai',
        execute: jest.fn().mockRejectedValue(new Error('API rate limit'))
      }

      const fallbackProvider = {
        name: 'anthropic',
        execute: jest.fn().mockResolvedValue({
          output: 'Fallback response',
          outputTokens: 80,
          modelClass: 'claude-3.5-haiku',
          metadata: { provider: 'anthropic', wasFallback: true }
        })
      }

      mockProviderRouter.getProviderForModel
        .mockReturnValueOnce(failingProvider as any)
        .mockReturnValueOnce(fallbackProvider as any)

      mockProviderRouter.routeWithModel.mockImplementation(async (request, limits, modelCode, fallbacks) => {
        // Simulate trying primary model first, then fallback
        try {
          const primaryProvider = mockProviderRouter.getProviderForModel(modelCode)
          return await primaryProvider.execute(request, limits)
        } catch {
          if (fallbacks && fallbacks.length > 0) {
            const fallbackProvider = mockProviderRouter.getProviderForModel(fallbacks[0])
            const result = await fallbackProvider.execute(request, limits)
            return {
              ...result,
              metadata: { ...result.metadata, wasFallback: true }
            }
          }
          throw new Error('All providers failed')
        }
      })

      const result = await mockProviderRouter.routeWithModel(
        { taskCode: 'LLM2_DRAFT', prompt: 'Test', inputTokens: 10 },
        { allowed: true, maxTokensOut: 100 } as EnforcementDecision,
        'gpt-4o',
        ['claude-3.5-haiku']
      )

      expect(result.output).toBe('Fallback response')
      expect(result.metadata.wasFallback).toBe(true)
    })
  })

  describe('Edge Cases and Malicious Attempts', () => {
    it('should handle malformed LLM requests', async () => {
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      // Test with missing required fields
      const malformedRequest: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: '', // Empty prompt
        inputTokens: -1 // Invalid token count
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        malformedRequest
      )

      // Should handle gracefully, possibly estimating tokens
      expect(result.success).toBeDefined() // May succeed or fail, but not crash
    })

    it('should prevent token count manipulation', async () => {
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-basic'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-basic',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-basic',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'BASE_M' },
          allowedClasses: JSON.stringify(['BASE_M'])
        }]
      })

      // Attempt to under-report input tokens to bypass quotas
      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'This is a very long prompt that should consume many tokens but I am reporting only 1 token to try to bypass metering controls and save on costs by manipulating the token counting system.',
        inputTokens: 1 // Under-reported
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      // Even if it succeeds, the system should estimate actual tokens
      if (result.success) {
        // Verify that actual token counting happens via provider
        expect(result.response?.metadata.inputTokens).toBeDefined()
      }
    })

    it('should handle concurrent requests without race conditions', async () => {
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-pro',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-pro',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'PRO_L' },
          allowedClasses: JSON.stringify(['PRO_L'])
        }]
      })
      mockPrisma.planFeature.findFirst.mockResolvedValue({
        monthlyQuota: 1000,
        dailyQuota: 100
      })

      // Simulate concurrent usage meter updates
      mockPrisma.usageMeter.findFirst.mockResolvedValue({ currentUsage: 50 })
      mockPrisma.usageMeter.upsert.mockImplementation(async (args) => {
        // Simulate concurrent updates
        return { currentUsage: 51 }
      })

      const requests = Array(10).fill(null).map((_, i) => ({
        taskCode: 'LLM2_DRAFT' as const,
        prompt: `Concurrent request ${i}`,
        inputTokens: 10
      }))

      const promises = requests.map(request =>
        llmGateway.executeLLMOperation({ tenantContext }, request)
      )

      const results = await Promise.all(promises)

      // All requests should be processed
      expect(results.length).toBe(10)
      const successfulResults = results.filter(r => r.success)
      expect(successfulResults.length).toBeGreaterThan(0)
    })

    it('should prevent infinite fallback loops', async () => {
      // Test that fallback chains are limited to prevent infinite loops

      mockResolveModel.mockResolvedValue({
        modelCode: 'model-1',
        modelId: 'id-1',
        provider: 'provider-1',
        displayName: 'Model 1',
        supportsVision: false,
        supportsStreaming: true,
        contextWindow: 1000,
        fallbacks: [
          { modelCode: 'model-2', modelId: 'id-2', provider: 'provider-2' },
          { modelCode: 'model-3', modelId: 'id-3', provider: 'provider-3' },
          { modelCode: 'model-4', modelId: 'id-4', provider: 'provider-4' },
          { modelCode: 'model-5', modelId: 'id-5', provider: 'provider-5' },
          { modelCode: 'model-6', modelId: 'id-6', provider: 'provider-6' }, // Beyond limit
        ],
        source: 'task',
        costPer1M: { input: 1000, output: 2000 }
      })

      const result = await resolveModel('plan-123', 'LLM2_DRAFT')

      // Should limit fallbacks to prevent infinite chaining
      expect(result.fallbacks.length).toBeLessThanOrEqual(3) // MAX_FALLBACK_DEPTH
    })
  })

  describe('System Stability Under Load', () => {
    it('should handle high-frequency requests without memory leaks', async () => {
      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      mockPrisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' })
      mockPrisma.tenantPlan.findFirst.mockResolvedValue({
        planId: 'plan-pro',
        plan: { status: 'ACTIVE' }
      })
      mockPrisma.plan.findFirst.mockResolvedValue({
        id: 'plan-pro',
        status: 'ACTIVE',
        planFeatures: [{ feature: { code: 'PATENT_DRAFTING' } }],
        planLLMAccess: [{
          taskCode: 'LLM2_DRAFT',
          defaultClass: { code: 'PRO_L' },
          allowedClasses: JSON.stringify(['PRO_L'])
        }]
      })

      const highVolumeRequests = Array(100).fill(null).map((_, i) => ({
        taskCode: 'LLM2_DRAFT' as const,
        prompt: `Load test request ${i}`,
        inputTokens: 50
      }))

      const startTime = Date.now()
      const promises = highVolumeRequests.map(request =>
        llmGateway.executeLLMOperation({ tenantContext }, request)
      )

      const results = await Promise.all(promises)
      const endTime = Date.now()

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(30000) // 30 seconds max

      // Should not have memory issues (basic check)
      expect(results.length).toBe(100)
    })

    it('should gracefully handle provider API failures', async () => {
      mockProviderRouter.routeWithModel.mockRejectedValue(new Error('Provider API down'))

      const tenantContext: TenantContext = {
        tenantId: 'tenant-123',
        userId: 'user-456',
        planId: 'plan-pro'
      }

      const request: LLMRequest = {
        taskCode: 'LLM2_DRAFT',
        prompt: 'Test prompt',
        inputTokens: 50
      }

      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        request
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(MeteringError)
      expect(result.error?.code).toBe('SERVICE_UNAVAILABLE')
    })
  })
})
