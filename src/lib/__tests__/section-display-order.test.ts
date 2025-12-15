import { describe, expect, test } from 'vitest'
import { ensureDisplayOrder, formatNumberedHeading, isNumberedHeading } from '@/lib/section-display-order'

describe('section-display-order', () => {
  test('isNumberedHeading detects existing numeric prefixes', () => {
    expect(isNumberedHeading('01. FIELD OF THE INVENTION')).toBe(true)
    expect(isNumberedHeading('1) Background')).toBe(true)
    expect(isNumberedHeading('  12.  Summary')).toBe(true)
    expect(isNumberedHeading('FIELD OF THE INVENTION')).toBe(false)
  })

  test('ensureDisplayOrder validates positive finite numbers', () => {
    expect(ensureDisplayOrder(1, 'X')).toBe(1)
    expect(ensureDisplayOrder('2', 'X')).toBe(2)
    expect(() => ensureDisplayOrder(undefined, 'X')).toThrow(/Invalid displayOrder/i)
    expect(() => ensureDisplayOrder(null, 'X')).toThrow(/Invalid displayOrder/i)
    expect(() => ensureDisplayOrder(0, 'X')).toThrow(/Invalid displayOrder/i)
    expect(() => ensureDisplayOrder(-1, 'X')).toThrow(/Invalid displayOrder/i)
    expect(() => ensureDisplayOrder('abc', 'X')).toThrow(/Invalid displayOrder/i)
  })

  test('formatNumberedHeading prefixes using displayOrder and does not double-prefix', () => {
    expect(formatNumberedHeading(3, 'Background of the Invention')).toBe('03. Background of the Invention')
    expect(formatNumberedHeading(12, 'Detailed Description')).toBe('12. Detailed Description')
    expect(formatNumberedHeading(7, '07. Summary')).toBe('07. Summary')
  })
})


