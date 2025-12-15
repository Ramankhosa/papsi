import { describe, expect, it } from 'vitest'
import { OpenAIProvider } from '../openai-provider'
import { GeminiProvider } from '../gemini-provider'

describe('Provider model aliasing', () => {
  it('OpenAIProvider normalizes *-thinking to base model', () => {
    const p = new OpenAIProvider({ apiKey: 'x', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.2-thinking' })
    // Accessing private via bracket is not allowed; validate via token/cost tables normalization behavior instead.
    expect(p.getTokenLimits('gpt-5.2-thinking')).toEqual(p.getTokenLimits('gpt-5.2'))
    expect(p.getCostPerToken('gpt-5.2-thinking')).toEqual(p.getCostPerToken('gpt-5.2'))
  })

  it('GeminiProvider maps gemini-3-pro-preview-thinking to gemini-3-pro-preview for limits/costs', () => {
    // We don’t execute network calls here; only verify mapping in helper methods.
    const p = new GeminiProvider({ apiKey: 'x', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3-pro-preview-thinking' })
    expect(p.getTokenLimits('gemini-3-pro-preview-thinking')).toEqual(p.getTokenLimits('gemini-3-pro-preview'))
    expect(p.getCostPerToken('gemini-3-pro-preview-thinking')).toEqual(p.getCostPerToken('gemini-3-pro-preview'))
  })
})


