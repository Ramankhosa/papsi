// OpenAI Provider Implementation
// Supports GPT-3.5, GPT-4, GPT-5, and o1 series models with multimodal capabilities
// Note: GPT-5 and o1 models use max_completion_tokens instead of max_tokens

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
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5-nano',
    // GPT-5 Thinking Variants (alias to base model + reasoning controls)
    'gpt-5.1-thinking',
    'gpt-5.2-thinking',
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

  private normalizeModelCode(modelCode: string): {
    apiModel: string
    isThinkingVariant: boolean
  } {
    if (!modelCode) return { apiModel: modelCode, isThinkingVariant: false }

    // "thinking" is represented as a model-code variant in our system
    // and translated into OpenAI request fields (reasoning.effort).
    if (modelCode.endsWith('-thinking')) {
      return { apiModel: modelCode.replace(/-thinking$/, ''), isThinkingVariant: true }
    }

    return { apiModel: modelCode, isThinkingVariant: false }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    // Use the model specified in the request (from model resolver) or fall back to config default
    const requestedModel = request.modelClass || this.config.model
    const { apiModel: modelToUse, isThinkingVariant } = this.normalizeModelCode(requestedModel)
    
    // Check if this model requires max_completion_tokens instead of max_tokens
    // OpenAI's newer models (o1, o1-mini, o1-preview, gpt-5, gpt-5.1, etc.) use max_completion_tokens
    const isO1Model = modelToUse.startsWith('o1')
    const isGPT5Model = modelToUse.startsWith('gpt-5')
    const usesMaxCompletionTokens = isO1Model || isGPT5Model
    const supportsTemperatureTuning = !(isO1Model || isGPT5Model)
    
    // Apply enforcement limits - some models use max_completion_tokens instead of max_tokens
    const maxTokens = limits.maxTokensOut || 4096
    console.log(`[OpenAIProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, using=${maxTokens}`)

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

      // Reasoning / "thinking" controls:
      // - Thinking variants (e.g., gpt-5.2-thinking) default to higher reasoning effort.
      // - Non-thinking variants (gpt-5, gpt-5.1, gpt-5.2) default to 'low' for faster responses.
      // - Request can override via request.parameters.reasoning_effort (string) or request.parameters.reasoning?.effort.
      // IMPORTANT: This gateway calls OpenAI via /v1/chat/completions and that endpoint rejects an object parameter
      // named "reasoning" (400: Unknown parameter: 'reasoning'). Use reasoning_effort instead.
      // Note: We only apply this to GPT-5 family in this gateway to avoid surprising behavior on other models.
      if (isGPT5Model) {
        const configuredReasoning = request.parameters?.reasoning
        const configuredReasoningEffort = request.parameters?.reasoning_effort

        // Default effort: 'high' for thinking variants, 'low' for regular GPT-5 models (faster responses)
        // Set to 'medium' or 'high' explicitly if you need more thorough reasoning
        const defaultEffort = isThinkingVariant ? 'high' : 'low'
        const effort = configuredReasoning?.effort ?? configuredReasoningEffort ?? defaultEffort

        // Always set reasoning_effort for GPT-5 models to control response time
        requestBody.reasoning_effort = effort
        console.log(`[OpenAIProvider] Using reasoning_effort=${effort} for ${modelToUse}`)
      }
      
      if (usesMaxCompletionTokens) {
        // o1 models and GPT-5 models expect max_completion_tokens (NOT max_tokens)
        // See: https://help.openai.com/en/articles/5072518
        requestBody.max_completion_tokens = maxTokens
        
        // o1 models don't support temperature parameter
        // GPT-5 models expect default temperature (omit to avoid API error)
        if (supportsTemperatureTuning) {
          requestBody.temperature = request.parameters?.temperature ?? 0.7
        }
        console.log(`[OpenAIProvider] Using max_completion_tokens for ${modelToUse} (${maxTokens} tokens)`)
      } else {
        // Legacy chat models (GPT-3.5/4 families) use max_tokens
        requestBody.max_tokens = maxTokens
        if (supportsTemperatureTuning) {
          requestBody.temperature = request.parameters?.temperature ?? 0.7
        }
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
        modelClass: requestedModel, // Preserve the configured model code (may be a thinking alias)
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
    const normalized = this.normalizeModelCode(modelName).apiModel
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
      'gpt-5.2': { input: 256000, output: 32768 },
      'gpt-5-mini': { input: 128000, output: 16384 },
      'gpt-5-nano': { input: 64000, output: 8192 },
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 16384, output: 4096 },
      // o1 Reasoning Models
      'o1': { input: 200000, output: 100000 },
      'o1-mini': { input: 128000, output: 65536 },
      'o1-preview': { input: 128000, output: 32768 }
    }
    
    return limits[normalized] || { input: 128000, output: 16384 }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    const normalized = this.normalizeModelCode(modelName).apiModel
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
      'gpt-5.2': { input: 0.000012, output: 0.000036 },           // $12/$36 per M (placeholder - update if pricing differs)
      'gpt-5-mini': { input: 0.000003, output: 0.000012 },        // $3/$12 per M
      'gpt-5-nano': { input: 0.0000005, output: 0.000002 },       // $0.50/$2.00 per M
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },   // $0.50/$1.50 per M
      // o1 Reasoning Models
      'o1': { input: 0.000015, output: 0.00006 },                 // $15/$60 per M
      'o1-mini': { input: 0.000003, output: 0.000012 },           // $3/$12 per M
      'o1-preview': { input: 0.000015, output: 0.00006 }          // $15/$60 per M
    }
    
    return costs[normalized] || { input: 0.000005, output: 0.000015 }
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
