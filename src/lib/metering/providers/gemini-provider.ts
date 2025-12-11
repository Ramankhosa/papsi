// Google Gemini Provider Implementation
// Supports Gemini 2.5 Pro model

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  supportedModels = [
    // Gemini 2.x Series (Text)
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    // Gemini 1.5 Series
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    // Gemini 3.x Image Generation Models (for Sketch Generation)
    'gemini-3.0-nano-banana',
    'gemini-3-pro-image-preview'
  ]

  private config: ProviderConfig
  private client: any // Google Generative AI client

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    // Initialize Google Generative AI client
    if (typeof window === 'undefined') {
      // Only initialize on server side
      console.log(`Initializing Gemini provider (${name || 'gemini'}) with API key present: ${!!config.apiKey}`)
      if (config.apiKey) {
        console.log(`API key length: ${config.apiKey.length}`)
      } else {
        console.error('No API key provided for Gemini provider!')
      }

      try {
        // Dynamic import to avoid client-side issues
        const { GoogleGenerativeAI } = require('@google/generative-ai')
        this.client = new GoogleGenerativeAI(config.apiKey)
        console.log('Gemini client initialized successfully')
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

    // Note: Model validation is now handled by the model resolver
    // We allow any model code to be passed through since new models can be added via admin UI
    console.log(`[GeminiProvider] Using model: ${modelClass}`)

    // Use enforcement limits, with provider limits as fallback
    const providerLimits = this.getTokenLimits(modelClass)
    const requested = limits.maxTokensOut || providerLimits.output
    const maxTokens = Math.min(requested, providerLimits.output)
    const temperature = request.parameters?.temperature ?? 0.7 // Default temperature 0.7 if not specified
    const topP = request.parameters?.topP ?? 0.95 // Default topP 0.95

    try {
      const model = this.client.getGenerativeModel({
        model: modelClass,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: topP
        }
      })

      // Handle multimodal content (text + images)
      let contentToGenerate: any;
      if (request.content) {
        // Build multimodal content for Gemini
        const parts = []
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            parts.push({ text: part.text })
          } else if (part.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: part.image.mimeType,
                data: part.image.data
              }
            })
          }
        }
        contentToGenerate = parts
      } else {
        // Fallback to text-only prompt
        contentToGenerate = request.prompt || ''
      }

      // Add retry logic for network issues
      const maxRetries = 3
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting Gemini API call (attempt ${attempt}/${maxRetries})`)
          const result = await model.generateContent(contentToGenerate)
          const response = result.response

          // If we get here, the call was successful
          console.log(`Gemini API call successful on attempt ${attempt}`)

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
          lastError = error instanceof Error ? error : new Error(String(error))
          console.error(`Attempt ${attempt} failed:`, lastError.message)

          // If this is not the last attempt, wait before retrying
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff, max 5s
            console.log(`Waiting ${delay}ms before retry...`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }

      // All retries failed
      throw new Error(`Gemini API call failed after ${maxRetries} attempts. Last error: ${lastError?.message}`)
    } catch (error) {
      console.error('Gemini API error:', error)

      // Provide more detailed error information
      if (error instanceof Error) {
        if (error.message.includes('fetch failed')) {
          console.error('Network connectivity issue detected. Check internet connection and API endpoint availability.')
        } else if (error.message.includes('API_KEY')) {
          console.error('API key issue detected. Verify GOOGLE_AI_API_KEY is properly configured.')
        }
      }

      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    const limits: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 1048576, output: 8192 },
      'gemini-2.5-flash-lite': { input: 1048576, output: 8192 },
      // Flash models
      'gemini-2.0-flash': { input: 1048576, output: 8192 },
      // Pro models
      'gemini-2.5-pro': { input: 2097152, output: 16384 },
      'gemini-1.5-pro': { input: 2097152, output: 16384 },
      'gemini-1.5-flash': { input: 1048576, output: 8192 },
      // Image generation models
      'gemini-3.0-nano-banana': { input: 128000, output: 8192 },
      'gemini-3-pro-image-preview': { input: 128000, output: 8192 }
    }
    
    return limits[modelName] || { input: 2097152, output: 16384 }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    // Pricing per token (converted from per-million pricing)
    const costs: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 0.00000008, output: 0.0000003 },    // $0.08/$0.30 per M
      'gemini-2.5-flash-lite': { input: 0.00000035, output: 0.0000007 },    // $0.35/$0.70 per M
      // Flash models
      'gemini-2.0-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M
      // Pro models
      'gemini-2.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M
      'gemini-1.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M
      'gemini-1.5-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M
      // Image generation models
      'gemini-3.0-nano-banana': { input: 0.000001, output: 0.000004 },      // $1.00/$4.00 per M
      'gemini-3-pro-image-preview': { input: 0.000001, output: 0.000004 }   // $1.00/$4.00 per M
    }
    
    return costs[modelName] || { input: 0.00000125, output: 0.000005 }
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
