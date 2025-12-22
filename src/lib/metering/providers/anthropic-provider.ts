/**
 * Anthropic Claude Provider Implementation
 * Supports Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
 */

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  supportedModels = [
    // Claude 3.5 models - use the stable aliases that Anthropic actually supports
    'claude-3-5-sonnet',
    'claude-3-5-haiku', 
    // Claude 3 models
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      console.log(`Initializing Anthropic provider with API key present: ${!!config.apiKey}`)
      
      if (!config.apiKey) {
        console.error('No API key provided for Anthropic provider!')
        return
      }

      try {
        const Anthropic = require('@anthropic-ai/sdk')
        this.client = new Anthropic({ apiKey: config.apiKey })
        console.log('Anthropic client initialized successfully')
      } catch (error) {
        console.warn('Anthropic SDK not available:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'claude-3-5-sonnet'
    
    // Map friendly model names to Anthropic's required exact model IDs
    // Anthropic API requires dated versions - aliases don't work
    const modelMap: Record<string, string> = {
      // Claude 3.5 Sonnet variations -> latest dated version
      'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
      'claude-sonnet-3.5': 'claude-3-5-sonnet-20241022',
      // Claude 3.5 Haiku variations
      'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
      // Claude 3 Opus variations
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-opus-latest': 'claude-3-opus-20240229',
      // Claude 3 Sonnet/Haiku
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
    }
    
    const actualModel = modelMap[modelToUse] || modelToUse
    console.log(`Anthropic: mapping model "${modelToUse}" -> "${actualModel}"`)

    try {
      // Build messages array
      const messages: any[] = []
      
      if (request.content && request.content.parts) {
        // Multimodal content
        const contentParts: any[] = []
        
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text })
          } else if (part.type === 'image') {
            // Claude expects base64 images
            contentParts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.image.mimeType || 'image/jpeg',
                data: part.image.data
              }
            })
          }
        }
        
        messages.push({ role: 'user', content: contentParts })
      } else if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      }

      // Apply token limits
      const maxTokens = Math.min(
        limits.maxTokensOut || 4096,
        8192 // Claude's max output tokens
      )

      const response = await this.client.messages.create({
        model: actualModel,
        max_tokens: maxTokens,
        messages,
        temperature: request.parameters?.temperature ?? 0.7
      })

      const outputText = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('')

      const inputTokens = response.usage?.input_tokens || 0
      const outputTokens = response.usage?.output_tokens || 0
      const latency = Date.now() - startTime

      return {
        output: outputText,
        outputTokens,
        modelClass: modelToUse,
        metadata: {
          provider: this.name,
          model: actualModel,
          inputTokens,
          latencyMs: latency,
          stopReason: response.stop_reason
        }
      }
    } catch (error: any) {
      console.error('Anthropic API error:', error)
      // IMPORTANT: Throw error instead of swallowing it, so fallback routing can work
      throw new Error(`Anthropic API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    // Claude 3.5 models have 200K context
    const limits: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet': { input: 200000, output: 8192 },
      'claude-3-5-haiku': { input: 200000, output: 8192 },
      'claude-3-opus': { input: 200000, output: 4096 },
      'claude-3-sonnet': { input: 200000, output: 4096 },
      'claude-3-haiku': { input: 200000, output: 4096 }
    }
    return limits[modelName] || { input: 200000, output: 4096 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    // Cost per token in USD (approximate as of Dec 2024)
    const costs: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-5-haiku': { input: 0.0000008, output: 0.000004 },
      'claude-3-opus': { input: 0.000015, output: 0.000075 },
      'claude-3-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-haiku': { input: 0.00000025, output: 0.00000125 }
    }
    return costs[modelName] || { input: 0.000003, output: 0.000015 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}

