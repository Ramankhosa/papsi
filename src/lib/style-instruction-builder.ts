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

  // --- 1. Build Global Natural Language Instructions ---
  const g = profile.global || ({} as any)
  const rules: string[] = []

  // Tone & Hedging
  if (g.tone) rules.push(`Adopt a ${g.tone} tone.`)
  if (g.hedging_level === 'high') {
    rules.push(`Use cautious language frequently (e.g., "may", "can", "optionally"). Avoid absolute terms like "must" or "always".`)
  } else if (g.hedging_level === 'low') {
    rules.push(`Use direct and definitive language (e.g., "is configured to", "comprises"). Minimize usage of "may" or "might".`)
  }

  // Sentence Structure
  if (g.sentence_length_stats?.mean) {
    const len = Math.round(g.sentence_length_stats.mean)
    if (len > 35) rules.push(`Write in long, complex sentences (avg ${len} words).`)
    else if (len < 15) rules.push(`Write in short, concise sentences (avg ${len} words).`)
  }

  // Connectors
  if (Array.isArray(g.preferred_connectors) && g.preferred_connectors.length > 0) {
    const top = truncateList(g.preferred_connectors, 5).join('", "')
    rules.push(`Frequently use transition words such as "${top}".`)
  }

  // Formatting
  if (g.formatting_habits?.bullet_points) rules.push('Use bullet points for lists where appropriate.')
  if (g.formatting_habits?.numbered_lists) rules.push('Use numbered lists for sequential steps.')

  const generalInstructions = rules.join(' ')

  // --- 2. Helper to append section-specifics ---
  const compose = (specificRules: string[], examples?: string[]) => {
    let out = generalInstructions
    if (specificRules.length) out += '\n' + specificRules.join(' ')
    if (examples && examples.length) {
      out += `\n\nFEW-SHOT EXAMPLES (Mimic this style):\n${examples.map(e => `"${e}"`).join('\n\n')}`
    }
    return out
  }

  // --- 3. Map Sections ---
  const sec = profile.sections || ({} as any)

  // ABSTRACT
  if (sec.ABSTRACT) {
    const s = sec.ABSTRACT
    const r: string[] = []
    if (s.micro_rules?.word_cap) r.push(`Limit length to approx ${s.micro_rules.word_cap} words.`)
    if (s.micro_rules?.avoid_citations) r.push('Do not cite references.')
    instr.abstract = compose(r, s.micro_rules?.few_shot_examples)
  }

  // BACKGROUND
  if (sec.BACKGROUND) {
    const s = sec.BACKGROUND
    const r: string[] = []
    if (s.micro_rules?.prior_art_tone === 'critical') r.push('Critique prior art limitations aggressively ("suffer from", "drawbacks").')
    else if (s.micro_rules?.prior_art_tone === 'neutral') r.push('Describe prior art neutrally ("Conventionally...", "Existing systems include...").')
    
    if (s.micro_rules?.structure_outline) {
       r.push(`Follow this structure: ${truncateList(s.micro_rules.structure_outline, 5).join(' -> ')}.`)
    }
    instr.background = compose(r, s.micro_rules?.few_shot_examples)
  }

  // SUMMARY
  if (sec.SUMMARY) {
    const s = sec.SUMMARY
    instr.summary = compose([], s.micro_rules?.few_shot_examples)
  }

  // DETAILED DESCRIPTION
  if (sec.DETAILED_DESCRIPTION) {
    const s = sec.DETAILED_DESCRIPTION
    const r: string[] = []
    
    // Boilerplate Location
    if (s.micro_rules?.boilerplate_location === 'detailed_desc_start') {
      r.push('Place general disclaimers/boilerplate at the START of this section.')
    } else if (s.micro_rules?.boilerplate_location === 'detailed_desc_end') {
      r.push('Place general disclaimers/boilerplate at the END of this section.')
    }

    // Cross-linking
    if (s.micro_rules?.cross_linking_density === 'high') {
      r.push('Densely cross-link descriptions to figures (e.g., "As shown in FIG. 1...").')
    }
    
    instr.detailedDescription = compose(r, s.micro_rules?.few_shot_examples)
  }

  // CLAIMS
  if (sec.CLAIMS) {
    const s = sec.CLAIMS
    const r: string[] = []
    const mr = s.micro_rules || {}

    // Ordering
    if (mr.claim_ordering && mr.claim_ordering.length) {
      r.push(`Order independent claim families as: ${mr.claim_ordering.join(' -> ')}.`)
    }
    
    // Preamble
    if (mr.preamble_type) {
      r.push(`Use preamble style: "${mr.preamble_type.replace('_', ' ')}".`)
    }

    // Numerals
    if (mr.use_numerals === true) r.push('Include reference numerals in parentheses in the claims.')
    else if (mr.use_numerals === false) r.push('Do NOT use reference numerals in claims.')

    instr.claims = compose(r, mr.few_shot_examples)
  }
  
  // BRIEF DESCRIPTION
  if (sec.BRIEF_DESCRIPTION) {
     instr.briefDescriptionOfDrawings = compose([], sec.BRIEF_DESCRIPTION.micro_rules?.few_shot_examples)
  }

  // Fallbacks
  const keysNeedingGeneral = ['title', 'fieldOfInvention', 'bestMethod', 'industrialApplicability', 'listOfNumerals']
  for (const k of keysNeedingGeneral) {
    if (!instr[k]) instr[k] = generalInstructions
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

