/**
 * Zhipu Provider Implementation
 * Supports GLM-5 and GLM-4.5V via OpenAI-compatible API
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class ZhipuProvider implements LLMProvider {
  name = 'zhipu'
  supportedModels = ['glm-5', 'glm-4.5v']

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      if (!config.apiKey) {
        console.error('No API key provided for Zhipu provider!')
        return
      }

      try {
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://open.bigmodel.cn/api/paas/v4'
        })
      } catch (error) {
        console.warn('Zhipu client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Zhipu client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'glm-5'
    const modelMap: Record<string, string> = {
      'glm-5': 'glm-5',
      'glm-4.5v': 'glm-4.5v',
      'glm-4-5v': 'glm-4.5v'
    }
    const actualModel = modelMap[modelToUse] || modelToUse

    try {
      const messages: any[] = []

      if (request.content?.parts?.length) {
        const hasMultimodalBinary = request.content.parts.some(
          p => p.type === 'image' || p.type === 'file'
        )

        if (hasMultimodalBinary && actualModel === 'glm-4.5v') {
          const multimodalParts: any[] = []
          for (const part of request.content.parts) {
            if (part.type === 'text') {
              multimodalParts.push({ type: 'text', text: part.text })
            } else if (part.type === 'image') {
              multimodalParts.push({
                type: 'image_url',
                image_url: {
                  url: `data:${part.image.mimeType || 'image/jpeg'};base64,${part.image.data}`
                }
              })
            } else if (part.type === 'file') {
              const fileUrl = String(part.file?.url || '').trim()
              if (!fileUrl) {
                throw new Error('Zhipu file input requires file.url (publicly reachable HTTP/HTTPS URL)')
              }
              multimodalParts.push({
                type: 'file_url',
                file_url: {
                  url: fileUrl
                }
              })
            }
          }
          messages.push({ role: 'user', content: multimodalParts })
        } else {
          const textParts = request.content.parts
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('\n')
          if (textParts) {
            messages.push({ role: 'user', content: textParts })
          }
        }
      } else if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      }

      if (messages.length === 0) {
        throw new Error('No valid content provided for Zhipu request')
      }

      const modelLimits = this.getTokenLimits(actualModel)
      const maxTokens = limits.maxTokensOut || modelLimits.output

      const response = await this.client.chat.completions.create({
        model: actualModel,
        messages,
        max_tokens: maxTokens,
        temperature: request.parameters?.temperature ?? 0.7
      })

      const outputText = response.choices?.[0]?.message?.content || ''
      const inputTokens = response.usage?.prompt_tokens || 0
      const outputTokens = response.usage?.completion_tokens || 0
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
          finishReason: response.choices?.[0]?.finish_reason
        }
      }
    } catch (error: any) {
      console.error('Zhipu API error:', error)
      throw new Error(`Zhipu API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'glm-5': { input: 200000, output: 65536 },
      'glm-4.5v': { input: 128000, output: 16384 }
    }
    return limits[modelName] || { input: 128000, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const costs: Record<string, { input: number; output: number }> = {
      // USD per token (from per-1M pricing)
      'glm-5': { input: 0.000001, output: 0.0000032 },
      'glm-4.5v': { input: 0.0000006, output: 0.0000018 }
    }
    return costs[modelName] || { input: 0.000001, output: 0.0000032 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}
