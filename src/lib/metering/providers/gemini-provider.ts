// Google Gemini Provider Implementation
// Supports Gemini 2.5 Pro model

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  supportedModels = ['gemini-2.5-pro', 'gemini-2.0-flash-lite']

  private config: ProviderConfig
  private client: any // Google Generative AI client

  constructor(config: ProviderConfig) {
    this.config = config

    // Initialize Google Generative AI client
    if (typeof window === 'undefined') {
      // Only initialize on server side
      try {
        // Dynamic import to avoid client-side issues
        const { GoogleGenerativeAI } = require('@google/generative-ai')
        this.client = new GoogleGenerativeAI(config.apiKey)
      } catch (error) {
        console.warn('Google Generative AI not available:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Gemini client not initialized')
    }

    // Use modelClass from request, or fallback to configured model, or first supported model
    const modelClass = request.modelClass || this.config.model || this.supportedModels[0]

    // Validate model access
    if (!this.supportedModels.includes(modelClass)) {
      throw new Error(`Model ${modelClass} not supported by Gemini provider`)
    }

    // Use enforcement limits, with provider limits as fallback
    const providerLimits = this.getTokenLimits(modelClass)
    const requested = limits.maxTokensOut || providerLimits.output
    const maxTokens = Math.min(requested, providerLimits.output)
    const temperature = 0.7 // Default temperature

    try {
      const model = this.client.getGenerativeModel({
        model: modelClass,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
        }
      })

      const result = await model.generateContent(request.prompt || '')
      const response = result.response

      const output = response.text()
      const usage = response.usageMetadata

      // Log response details for debugging
      console.log('🔍 Gemini API response details:', {
        hasCandidates: !!response.candidates,
        candidatesCount: response.candidates?.length || 0,
        finishReason: response.candidates?.[0]?.finishReason,
        outputLength: output?.length || 0,
        usage: usage
      });

      // Check if response is empty
      if (!output || output.trim().length === 0) {
        const finishReason = response.candidates?.[0]?.finishReason;
        console.error(`❌ Gemini API returned empty response - finishReason: ${finishReason}`);
        if (finishReason === 'MAX_TOKENS') {
          console.warn('💡 MAX_TOKENS reached - consider increasing token limit or reducing prompt size');
        }
        throw new Error(`Gemini API returned empty response (finishReason: ${finishReason})`);
      }

      return {
        output,
        outputTokens: usage?.candidatesTokenCount || 0,
        modelClass: modelClass,
        metadata: {
          provider: 'gemini',
          inputTokens: usage?.promptTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0,
          finishReason: response.candidates?.[0]?.finishReason
        }
      }
    } catch (error) {
      console.error('Gemini API error:', error)
      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    switch (modelName) {
      case 'gemini-2.0-flash-lite':
      case 'gemini-2.5-flash-lite':
        return {
          input: 1048576, // 1M tokens
          output: 8192
        }
      case 'gemini-2.5-pro':
      default:
        return {
          input: 2097152, // 2M tokens
          output: 16384   // Increased ceiling for longer reports
        }
    }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    // Pricing per million tokens
    switch (modelName) {
      case 'gemini-2.0-flash-lite':
      case 'gemini-2.5-flash-lite':
        return {
          input: 0.00000035,  // $0.35 per million input tokens
          output: 0.00000070   // $0.70 per million output tokens
        }
      case 'gemini-2.5-pro':
      default:
        return {
          input: 0.00000125,  // $1.25 per million input tokens
          output: 0.000005    // $5.00 per million output tokens
        }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client) return false

      // Simple health check - try to list models
      const model = this.client.getGenerativeModel({ model: this.config.model })
      // If we can create a model instance, consider it healthy
      return true
    } catch (error) {
      console.error('Gemini health check failed:', error)
      return false
    }
  }
}
