import { prisma } from '@/lib/prisma'
import { StyleProfile } from '@/types/persona-sync'

export type SectionInstructions = Record<string, string>

function truncateList(list: string[] | undefined, n: number): string[] {
  if (!Array.isArray(list)) return []
  return list.filter(Boolean).slice(0, n)
}

function asPercent(n?: number): string | null {
  if (typeof n !== 'number' || Number.isNaN(n)) return null
  return `${Math.round(n * 100)}%`
}

export function buildStyleInstructions(profile: StyleProfile): SectionInstructions {
  const instr: SectionInstructions = {}

  // Build a compact general header
  const g = profile.global || ({} as any)
  const genParts: string[] = []
  if (g.tone) genParts.push(`tone=${g.tone}`)
  if (g.verbosity) genParts.push(`verbosity=${g.verbosity}`)
  if (g.sentence_length_stats?.mean) genParts.push(`avg_sentence_length≈${Math.round(g.sentence_length_stats.mean)}`)
  if (typeof g.passive_ratio === 'number') {
    const pr = asPercent(g.passive_ratio)
    if (pr) genParts.push(`passive≈${pr}`)
  }
  if (Array.isArray(g.preferred_connectors) && g.preferred_connectors.length > 0) {
    genParts.push(`connectors={${truncateList(g.preferred_connectors, 6).join(', ')}}`)
  }
  if (g.formatting_habits) {
    const f: string[] = []
    if (g.formatting_habits.numbered_lists) f.push('numbered-lists')
    if (g.formatting_habits.bullet_points) f.push('bullets')
    if (f.length) genParts.push(`formatting=${f.join('+')}`)
  }
  const general = genParts.join('; ')

  // Helper to compose per-section with general
  const withGeneral = (specific: string) => (general ? `${general}; ${specific}` : specific)

  // Map sections
  const sec = profile.sections || ({} as any)

  // ABSTRACT → abstract
  if (sec.ABSTRACT) {
    const s = sec.ABSTRACT
    const cap = s.micro_rules?.word_cap
    const avoidCit = s.micro_rules?.avoid_citations === true
    const parts: string[] = []
    if (cap) parts.push(`word_cap=${cap}`)
    if (avoidCit) parts.push('avoid_citations=true')
    const phr = truncateList(s.micro_rules?.style_rules, 6)
    if (phr.length) parts.push(`style_rules={${phr.join(', ')}}`)
    instr.abstract = withGeneral(parts.join('; '))
  }

  // BACKGROUND → background
  if (sec.BACKGROUND) {
    const s = sec.BACKGROUND
    const outline = truncateList(s.micro_rules?.structure_outline, 8)
    const parts: string[] = []
    if (outline.length) parts.push(`structure=${outline.join(' → ')}`)
    instr.background = withGeneral(parts.join('; '))
  }

  // SUMMARY → summary
  if (sec.SUMMARY) {
    const s = sec.SUMMARY
    const outline = truncateList(s.micro_rules?.structure_outline, 8)
    const parts: string[] = []
    if (outline.length) parts.push(`structure=${outline.join(' → ')}`)
    instr.summary = withGeneral(parts.join('; '))
  }

  // BRIEF_DESCRIPTION → briefDescriptionOfDrawings (do not change numbering policy)
  if (sec.BRIEF_DESCRIPTION) {
    const s = sec.BRIEF_DESCRIPTION
    const tpl = s.micro_rules?.figure_caption_template
    const parts: string[] = []
    if (tpl) parts.push(`figure_caption_template="${String(tpl)}"`)
    instr.briefDescriptionOfDrawings = withGeneral(parts.join('; '))
  }

  // DETAILED_DESCRIPTION → detailedDescription (no figure numbering overrides)
  if (sec.DETAILED_DESCRIPTION) {
    const s = sec.DETAILED_DESCRIPTION
    const markers = truncateList(s.micro_rules?.embodiment_markers, 6)
    const parts: string[] = []
    if (markers.length) parts.push(`embodiment_markers={${markers.join(', ')}}`)
    instr.detailedDescription = withGeneral(parts.join('; '))
  }

  // CLAIMS → claims (informative hints only)
  if (sec.CLAIMS) {
    const s = sec.CLAIMS
    const parts: string[] = []
    const lex = truncateList(s.micro_rules?.lexical_rules, 8)
    if (lex.length) parts.push(`lexical_rules={${lex.join(', ')}}`)
    if (s.micro_rules?.opening) parts.push(`opening_style="${String(s.micro_rules.opening)}"`)
    if (s.micro_rules?.numbering_pattern?.dependencies_style) {
      parts.push(`dependencies=${String(s.micro_rules.numbering_pattern.dependencies_style)}`)
    }
    instr.claims = withGeneral(parts.join('; '))
  }

  // Fallbacks for sections not present in style: apply only general
  const keysNeedingGeneral = [
    'title',
    'fieldOfInvention',
    'bestMethod',
    'industrialApplicability',
    'listOfNumerals'
  ]
  for (const k of keysNeedingGeneral) {
    if (!instr[k]) instr[k] = general
  }

  return instr
}

// Gated builder: only returns instructions if tenant plan allows PERSONA_SYNC and a LEARNED profile exists
export async function getGatedStyleInstructions(
  tenantId: string,
  userId: string
): Promise<SectionInstructions | null> {
  // Check tenant's current active plan
  const tenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE'
    },
    include: {
      plan: true
    },
    orderBy: {
      effectiveFrom: 'desc'
    }
  })

  if (!tenantPlan?.plan) return null

  const planHasFeature = await prisma.planFeature.findFirst({
    where: {
      planId: tenantPlan.plan.id,
      feature: { code: 'PERSONA_SYNC' }
    }
  })
  if (!planHasFeature) return null

  // Get latest LEARNED profile
  const profile = await prisma.styleProfile.findFirst({
    where: { tenantId, userId, status: 'LEARNED' },
    orderBy: { version: 'desc' }
  })
  if (!profile) return null

  const json = profile.json as unknown as StyleProfile
  try {
    const built = buildStyleInstructions(json)
    if (process.env.PERSONA_SYNC_DEBUG === '1') {
      console.log('[StyleInstructionBuilder] built', Object.keys(built))
    }
    return built
  } catch (e) {
    if (process.env.PERSONA_SYNC_DEBUG === '1') {
      console.warn('[StyleInstructionBuilder] build failed', e)
    }
    return null
  }
}

