export function isNumberedHeading(label: string): boolean {
  // Matches: "1. Title", "01. Title", "1) Title"
  return /^\s*\d+\s*[\.\)]\s+/.test(label || '')
}

export function ensureDisplayOrder(value: unknown, context: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid displayOrder (${String(value)}) for ${context}. Configure it in /super-admin/jurisdiction-config.`)
  }
  return n
}

export function formatNumberedHeading(displayOrder: number, heading: string, padTo = 2): string {
  const raw = String(heading || '').trim()
  if (!raw) return raw
  if (isNumberedHeading(raw)) return raw
  const prefix = String(displayOrder).padStart(padTo, '0')
  return `${prefix}. ${raw}`
}


