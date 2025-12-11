// OpenAI Provider Implementation
// Supports GPT-4o model with multimodal capabilities

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  supportedModels = [
    // GPT-4 Series
    'gpt-4o', 
    'gpt-4o-mini', 
    'gpt-4-turbo', 
    'gpt-4',
    // GPT-5 Series
    'gpt-5',
    'gpt-5.1',
    'gpt-5-mini',
    'gpt-5-nano',
    // GPT-3.5 Series
    'gpt-3.5-turbo',
    // o1 Reasoning Models
    'o1',
    'o1-mini',
    'o1-preview'
  ]

  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    // Use the model specified in the request (from model resolver) or fall back to config default
    const modelToUse = request.modelClass || this.config.model
    
    // Check if this is an o1 reasoning model (requires different parameters)
    const isO1Model = modelToUse.startsWith('o1')
    
    // Apply enforcement limits - o1 models use max_completion_tokens instead of max_tokens
    const maxTokens = limits.maxTokensOut || 4096

    try {
      // Build message content for OpenAI
      let messageContent: any;

      if (request.content) {
        // Build multimodal content for GPT-4o
        messageContent = []
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            messageContent.push({ type: 'text', text: part.text })
          } else if (part.type === 'image') {
            messageContent.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.image.mimeType};base64,${part.image.data}`,
                detail: 'high' // Use high detail for better analysis
              }
            })
          }
        }
      } else {
        // Fallback to text-only
        messageContent = request.prompt || ''
      }

      // Build request body with model-specific parameters
      const requestBody: any = {
        model: modelToUse,
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ]
      }
      
      // o1 models use different parameters:
      // - max_completion_tokens instead of max_tokens
      // - Do NOT support temperature parameter
      if (isO1Model) {
        requestBody.max_completion_tokens = maxTokens
        // Note: o1 models do not accept temperature - omit it entirely
        console.log(`[OpenAIProvider] Using o1-specific params for ${modelToUse} (max_completion_tokens: ${maxTokens})`)
      } else {
        requestBody.max_tokens = maxTokens
        requestBody.temperature = request.parameters?.temperature ?? 0.7
      }
      
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${response.status} ${error}`)
      }

      const data = await response.json()

      const choice = data.choices[0]
      const usage = data.usage

      return {
        output: choice.message.content,
        outputTokens: usage?.completion_tokens || 0,
        modelClass: modelToUse, // Use the actual model that was called
        metadata: {
          provider: 'openai',
          inputTokens: usage?.prompt_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
          finishReason: choice.finish_reason,
          modelUsed: modelToUse
        }
      }
    } catch (error) {
      console.error('OpenAI API error:', error)
      throw new Error(`OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    // Token limits per model family
    const limits: Record<string, { input: number, output: number }> = {
      // GPT-4 Series
      'gpt-4o': { input: 128000, output: 16384 },
      'gpt-4o-mini': { input: 128000, output: 16384 },
      'gpt-4-turbo': { input: 128000, output: 4096 },
      'gpt-4': { input: 8192, output: 4096 },
      // GPT-5 Series (estimated based on typical patterns)
      'gpt-5': { input: 256000, output: 32768 },
      'gpt-5.1': { input: 256000, output: 32768 },
      'gpt-5-mini': { input: 128000, output: 16384 },
      'gpt-5-nano': { input: 64000, output: 8192 },
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 16384, output: 4096 },
      // o1 Reasoning Models
      'o1': { input: 200000, output: 100000 },
      'o1-mini': { input: 128000, output: 65536 },
      'o1-preview': { input: 128000, output: 32768 }
    }
    
    return limits[modelName] || { input: 128000, output: 16384 }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    // Pricing per token (converted from per-million pricing)
    const costs: Record<string, { input: number, output: number }> = {
      // GPT-4 Series
      'gpt-4o': { input: 0.0000025, output: 0.000010 },           // $2.50/$10.00 per M
      'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },    // $0.15/$0.60 per M
      'gpt-4-turbo': { input: 0.00001, output: 0.00003 },         // $10/$30 per M
      'gpt-4': { input: 0.00003, output: 0.00006 },               // $30/$60 per M
      // GPT-5 Series (estimated pricing)
      'gpt-5': { input: 0.00001, output: 0.00003 },               // $10/$30 per M
      'gpt-5.1': { input: 0.000012, output: 0.000036 },           // $12/$36 per M
      'gpt-5-mini': { input: 0.000003, output: 0.000012 },        // $3/$12 per M
      'gpt-5-nano': { input: 0.0000005, output: 0.000002 },       // $0.50/$2.00 per M
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },   // $0.50/$1.50 per M
      // o1 Reasoning Models
      'o1': { input: 0.000015, output: 0.00006 },                 // $15/$60 per M
      'o1-mini': { input: 0.000003, output: 0.000012 },           // $3/$12 per M
      'o1-preview': { input: 0.000015, output: 0.00006 }          // $15/$60 per M
    }
    
    return costs[modelName] || { input: 0.000005, output: 0.000015 }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      })
      return response.ok
    } catch (error) {
      console.error('OpenAI health check failed:', error)
      return false
    }
  }
}
