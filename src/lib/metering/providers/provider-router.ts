// LLM Provider Router
// Routes requests to appropriate providers with failover and metering integration

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import { MeteringError } from '../index'
import type { LLMProvider } from './llm-provider'
import { createLLMProvider, type ProviderConfig } from './llm-provider'

export interface ProviderPriority {
  provider: string
  priority: number // Lower number = higher priority
  fallback: boolean // Whether to use as fallback
}

export interface RoutingDecision {
  provider: LLMProvider
  reason: string
  costEstimate?: number
}

export class LLMProviderRouter {
  private providers = new Map<string, LLMProvider>()
  private providerConfigs: Record<string, ProviderConfig> = {}

  constructor() {
    this.initializeProviders()
  }

  private initializeProviders() {
    // Initialize providers from environment variables
    console.log('Initializing LLM providers...')
    console.log('GOOGLE_AI_API_KEY present:', !!process.env.GOOGLE_AI_API_KEY)
    console.log('OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY)

    const configs = {
      gemini: {
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: 'gemini-2.5-pro', // Gemini 2.5 Pro (multimodal capabilities, 2M context)
        baseURL: 'https://generativelanguage.googleapis.com/v1beta'
      },
      'gemini-flash-lite': {
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: 'gemini-2.5-flash-lite', // Gemini 2.5 Flash-Lite (faster, cost-effective)
        baseURL: 'https://generativelanguage.googleapis.com/v1beta'
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o', // GPT-4o (multimodal capabilities)
        baseURL: 'https://api.openai.com/v1'
      }
      // Grok removed due to invalid API key
    }

    // Only initialize providers that have API keys
    Object.entries(configs).forEach(([type, config]) => {
      if (config.apiKey) {
        try {
          const provider = createLLMProvider(type as any, config as ProviderConfig)
          this.providers.set(type, provider)
          this.providerConfigs[type] = config as ProviderConfig
          console.log(`Initialized ${type} provider`)
        } catch (error) {
          console.warn(`Failed to initialize ${type} provider:`, error)
        }
      } else {
        console.warn(`No API key found for ${type} provider`)
      }
    })
  }

  async routeAndExecute(
    request: LLMRequest,
    limits: EnforcementDecision,
    priorities?: ProviderPriority[]
  ): Promise<LLMResponse> {
    const routingDecision = await this.selectProvider(request, limits, priorities)

    if (!routingDecision) {
      throw new Error('No suitable provider found for the request')
    }

    const { provider, reason } = routingDecision

    console.log(`Routing to ${provider.name}: ${reason}`)

    // Execute with the selected provider
    try {
      const response = await provider.execute(request, limits)

      // Add provider metadata to response
      return {
        ...response,
        metadata: {
          ...response.metadata,
          routingReason: reason,
          selectedProvider: provider.name
        }
      }
    } catch (error) {
      console.error(`Provider ${provider.name} failed:`, error)

      // Try fallback if enabled
      const fallbackResponse = await this.tryFallback(request, limits, provider.name)
      if (fallbackResponse) {
        return fallbackResponse
      }

      throw error
    }
  }

  private async selectProvider(
    request: LLMRequest,
    limits: EnforcementDecision,
    priorities?: ProviderPriority[]
  ): Promise<RoutingDecision | null> {
    const availableProviders = Array.from(this.providers.values())
      .filter(provider => this.isProviderHealthy(provider))

    if (availableProviders.length === 0) {
      throw new Error('No healthy providers available')
    }

    // Special handling for multimodal requests (text + images)
    const isMultimodal = request.content && request.content.parts.some(part => part.type === 'image')

    // Special handling for relevance analysis (PRIOR_ART_SEARCH) - use Flash-Lite
    const isRelevanceAnalysis = request.taskCode === 'LLM5_NOVELTY_ASSESS' && !isMultimodal

    let activePriorities: ProviderPriority[]

    if (isMultimodal) {
      // For multimodal: Gemini 2.5 Pro primary, GPT-4o fallback
      activePriorities = [
        { provider: 'gemini', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true }
      ]
    } else if (isRelevanceAnalysis) {
      // For relevance analysis: Gemini 2.5 Flash-Lite primary, GPT-4o fallback
      activePriorities = [
        { provider: 'gemini-flash-lite', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true }
      ]
    } else {
      // Default priority order: Gemini primary, OpenAI fallback
      activePriorities = priorities || [
        { provider: 'gemini', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true }
      ]
    }

    // Sort providers by priority
    const sortedProviders = availableProviders
      .map(provider => ({
        provider,
        priority: activePriorities.find(p => p.provider === provider.name)?.priority || 999
      }))
      .sort((a, b) => a.priority - b.priority)

    // Return the highest priority provider
    const selected = sortedProviders[0]
    if (!selected) return null

    return {
      provider: selected.provider,
      reason: `Selected by priority (${selected.priority})`,
      costEstimate: this.estimateCost(selected.provider, request, limits)
    }
  }

  private async tryFallback(
    request: LLMRequest,
    limits: EnforcementDecision,
    failedProvider: string
  ): Promise<LLMResponse | null> {
    const fallbackProviders = Array.from(this.providers.values())
      .filter(provider => provider.name !== failedProvider && this.isProviderHealthy(provider))

    for (const provider of fallbackProviders) {
      try {
        console.log(`Trying fallback provider: ${provider.name}`)
        const response = await provider.execute(request, limits)

        return {
          ...response,
          metadata: {
            ...response.metadata,
            wasFallback: true,
            originalProvider: failedProvider,
            fallbackProvider: provider.name
          }
        }
      } catch (error) {
        console.error(`Fallback provider ${provider.name} also failed:`, error)
        continue
      }
    }

    return null
  }

  private isProviderHealthy(provider: LLMProvider): boolean {
    // For now, assume providers are healthy if they exist
    // In production, implement actual health checks
    return true
  }

  private estimateCost(
    provider: LLMProvider,
    request: LLMRequest,
    limits: EnforcementDecision
  ): number {
    const costs = provider.getCostPerToken(provider.supportedModels[0])
    const estimatedInputTokens = (request.inputTokens || 100)
    const estimatedOutputTokens = (limits.maxTokensOut || 1000)

    return (estimatedInputTokens * costs.input) + (estimatedOutputTokens * costs.output)
  }

  // Public methods for monitoring and management
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  getProviderHealth(): Record<string, boolean> {
    const health: Record<string, boolean> = {}
    this.providers.forEach((provider, name) => {
      health[name] = this.isProviderHealthy(provider)
    })
    return health
  }

  async refreshProviders(): Promise<void> {
    // Reinitialize providers (useful for key rotation)
    this.providers.clear()
    this.initializeProviders()
  }
}

// Singleton instance
export const llmProviderRouter = new LLMProviderRouter()
