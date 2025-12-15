import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { computeDynamicSuperset, isNonApplicableHeading } from '@/lib/multi-jurisdiction-service'
import { ensureDisplayOrder } from '@/lib/section-display-order'

// ============================================================================
// REFERENCE Pseudo-Country Profile
// This is a synthetic "country" that represents the superset of all sections
// Used in multi-jurisdiction filing as the source draft before translation
// 
// DYNAMIC MODE: When ?jurisdictions=IN,US,PCT is provided, returns only
// the sections required by those jurisdictions (optimized)
// ============================================================================

// Full superset - used as fallback when no jurisdictions specified
const FULL_SUPERSET_SECTIONS = [
  { id: 'title', label: 'Title of the Invention', order: 1, required: true },
  { id: 'preamble', label: 'Preamble', order: 2, required: false },
  { id: 'crossReference', label: 'Cross-Reference to Related Applications', order: 3, required: false },
  { id: 'fieldOfInvention', label: 'Field of the Invention', order: 4, required: true },
  { id: 'background', label: 'Background of the Invention', order: 5, required: true },
  { id: 'objectsOfInvention', label: 'Objects of the Invention', order: 6, required: false },
  { id: 'summary', label: 'Summary of the Invention', order: 7, required: true },
  { id: 'technicalProblem', label: 'Technical Problem', order: 8, required: false },
  { id: 'technicalSolution', label: 'Technical Solution', order: 9, required: false },
  { id: 'advantageousEffects', label: 'Advantageous Effects', order: 10, required: false },
  { id: 'briefDescriptionOfDrawings', label: 'Brief Description of the Drawings', order: 11, required: true },
  { id: 'detailedDescription', label: 'Detailed Description of the Invention', order: 12, required: true },
  { id: 'bestMode', label: 'Best Mode', order: 13, required: false },
  { id: 'industrialApplicability', label: 'Industrial Applicability', order: 14, required: false },
  { id: 'claims', label: 'Claims', order: 15, required: true },
  { id: 'abstract', label: 'Abstract', order: 16, required: true }
]

// Section ID to label map for dynamic sections
const SECTION_LABELS: Record<string, string> = {
  title: 'Title of the Invention',
  preamble: 'Preamble',
  crossReference: 'Cross-Reference to Related Applications',
  fieldOfInvention: 'Field of the Invention',
  background: 'Background of the Invention',
  objectsOfInvention: 'Objects of the Invention',
  summary: 'Summary of the Invention',
  technicalProblem: 'Technical Problem',
  technicalSolution: 'Technical Solution',
  advantageousEffects: 'Advantageous Effects',
  briefDescriptionOfDrawings: 'Brief Description of the Drawings',
  detailedDescription: 'Detailed Description of the Invention',
  bestMode: 'Best Mode',
  industrialApplicability: 'Industrial Applicability',
  claims: 'Claims',
  abstract: 'Abstract',
  listOfNumerals: 'List of Reference Numerals'
}

// Build profile from section list
function buildReferenceProfile(
  sections: Array<{ id: string; label: string; order: number; required: boolean; requiredBy?: string[] }>,
  isOptimized: boolean,
  jurisdictions?: string[]
) {
  const description = isOptimized && jurisdictions
    ? `Dynamic reference draft containing ${sections.length} sections required by: ${jurisdictions.join(', ')}`
    : 'Universal reference draft containing all superset sections. Used as the source for translating to country-specific drafts.'

  return {
    code: 'REFERENCE',
    name: 'Reference Draft (Multi-Jurisdiction)',
    meta: {
      languages: ['English'],
      description,
      isReferenceDraft: true,
      isOptimized,
      targetJurisdictions: jurisdictions || [],
      sectionCount: sections.length
    },
    structure: {
      defaultVariant: 'reference',
      variants: [{
        id: 'reference',
        name: 'Reference Draft',
        sections: sections.map(s => ({
          id: s.id,
          label: s.label,
          order: s.order,
          required: s.required,
          canonicalKeys: [s.id],
          requiredBy: s.requiredBy || []
        }))
      }]
    },
    prompts: {
      sections: sections.reduce((acc, s) => {
        acc[s.id] = {
          required: s.required,
          label: s.label,
          description: s.requiredBy?.length
            ? `Required by: ${s.requiredBy.join(', ')}`
            : `Reference draft section: ${s.label}`
        }
        return acc
      }, {} as Record<string, any>)
    },
    rules: {
      claims: { maxIndependent: 20, maxTotal: 50 },
      drawings: { colorAllowed: true, paperSize: 'A4' }
    },
    export: {
      format: 'docx',
      templateId: 'reference'
    },
    sectionMappings: sections.map(s => ({
      sectionKey: s.id,
      heading: s.label.toUpperCase(),
      displayOrder: s.order,
      isRequired: s.required,
      isEnabled: true,
      requiredBy: s.requiredBy || []
    }))
  }
}

// Get static full profile (no optimization)
function getFullReferenceProfile() {
  const sections = FULL_SUPERSET_SECTIONS.map(s => ({
    ...s,
    requiredBy: ['ALL'] as string[]
  }))
  return buildReferenceProfile(sections, false)
}

// Get dynamic optimized profile based on jurisdictions
async function getDynamicReferenceProfile(jurisdictions: string[]) {
  try {
    const result = await computeDynamicSuperset(jurisdictions)
    
    // Build sections from dynamic computation
    const sections = result.sections.map((sectionKey, index) => {
      const details = result.sectionDetails[sectionKey]
      return {
        id: sectionKey,
        label: details?.label || SECTION_LABELS[sectionKey] || sectionKey,
        order: index + 1,
        required: true, // If it's in the dynamic superset, it's required by at least one jurisdiction
        requiredBy: details?.requiredBy || []
      }
    })
    
    console.log(`[CountryProfile:REFERENCE] Dynamic profile: ${sections.length} sections for ${jurisdictions.join(', ')}`)
    
    return buildReferenceProfile(sections, true, jurisdictions)
  } catch (error) {
    console.error('[CountryProfile:REFERENCE] Failed to compute dynamic superset, falling back to full:', error)
    return getFullReferenceProfile()
  }
}

export async function GET(request: NextRequest, { params }: { params: { countryCode: string } }) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message || 'Unauthorized' },
        { status: authResult.error?.status || 401 }
      )
    }

    const code = (params.countryCode || '').toUpperCase()
    if (!code) {
      return NextResponse.json({ error: 'countryCode required' }, { status: 400 })
    }

    // Handle REFERENCE pseudo-country specially
    // This is used in multi-jurisdiction filing for the reference draft
    // 
    // DYNAMIC MODE: Pass ?jurisdictions=IN,US,PCT to get optimized section list
    // containing only sections required by those specific jurisdictions
    if (code === 'REFERENCE') {
      // Check for jurisdictions query parameter for dynamic optimization
      const { searchParams } = new URL(request.url)
      const jurisdictionsParam = searchParams.get('jurisdictions')
      
      if (jurisdictionsParam) {
        // Parse comma-separated jurisdictions (e.g., "IN,US,PCT")
        const jurisdictions = jurisdictionsParam
          .split(',')
          .map(j => j.trim().toUpperCase())
          .filter(j => j && j !== 'REFERENCE') // Exclude REFERENCE itself
        
        if (jurisdictions.length > 0) {
          console.log(`[CountryProfile:REFERENCE] Dynamic mode with ${jurisdictions.length} jurisdictions: ${jurisdictions.join(', ')}`)
          const dynamicProfile = await getDynamicReferenceProfile(jurisdictions)
          return NextResponse.json({ profile: dynamicProfile })
        }
      }
      
      // Fallback: Return full superset when no jurisdictions specified
      console.log('[CountryProfile:REFERENCE] Returning full superset (no jurisdictions specified)')
      return NextResponse.json({ profile: getFullReferenceProfile() })
    }

    // Fetch profile and section mappings in parallel
    const [profile, sectionMappings] = await Promise.all([
      prisma.countryProfile.findFirst({
      where: { countryCode: code, status: 'ACTIVE' as any }
      }),
      prisma.countrySectionMapping.findMany({
        where: { countryCode: code, isEnabled: true },
        orderBy: { displayOrder: 'asc' }
    })
    ])

    if (!profile) {
      return NextResponse.json({ error: 'Country profile not found' }, { status: 404 })
    }

    // Normalize mappings: drop non-applicable headings
    const resolvedMappings = sectionMappings.filter(m => !isNonApplicableHeading(m.heading))
    if (resolvedMappings.length === 0) {
      return NextResponse.json({ error: `No section mappings configured for ${code}. Please configure via /super-admin/jurisdiction-config.` }, { status: 400 })
    }
    
    // Validate displayOrder - DB is the only source of truth for ordering
    try {
      for (const m of resolvedMappings) {
        ensureDisplayOrder(m.displayOrder, `${code}:${String(m.sectionKey)}`)
      }
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Invalid displayOrder in jurisdiction config' }, { status: 400 })
    }

    // Create a map of sectionKey -> mapping for quick lookup
    const mappingByKey = new Map(resolvedMappings.map(m => [m.sectionKey, m]))

    // Return only the data needed for drafting UI (structure/prompts/rules/meta)
    const profileData = profile.profileData as any
    
    // Process structure to apply country-specific ordering from mappings
    // AND add sections from CountrySectionMapping that are missing from the profile structure
    let structure = profileData?.structure || null
    if (structure?.variants) {
      structure = {
        ...structure,
        variants: structure.variants.map((variant: any) => {
          if (!variant.sections) return variant
          
          // Track which sectionKeys are already in the profile
          const existingSectionKeys = new Set<string>()
          
          // Map sections with their country-specific displayOrder
          const sectionsWithOrder = variant.sections.map((sec: any) => {
            // Try to find mapping by section ID or canonical keys
            let mapping = mappingByKey.get(sec.id)
            if (!mapping && sec.canonicalKeys) {
              for (const key of sec.canonicalKeys) {
                mapping = mappingByKey.get(key)
                if (mapping) break
              }
            }
            
            // DB mapping is authoritative: if no mapping exists, this section should not appear
            if (!mapping) {
              return null
            }
            
            // Track this section's key
            existingSectionKeys.add(sec.id)
            if (sec.canonicalKeys) {
              sec.canonicalKeys.forEach((k: string) => existingSectionKeys.add(k))
            }
            if (mapping?.sectionKey) {
              existingSectionKeys.add(mapping.sectionKey)
            }
            
            return {
              ...sec,
              // Use mapping's displayOrder ONLY (database is source of truth)
              order: ensureDisplayOrder(mapping.displayOrder, `${code}:${String(mapping.sectionKey)}`),
              // Use mapping heading for display (jurisdiction-config)
              label: mapping.heading,
              // Include mapping metadata
              _mapping: mapping ? {
                heading: mapping.heading,
                isRequired: mapping.isRequired,
                isEnabled: mapping.isEnabled,
                displayOrder: mapping.displayOrder
              } : null
            }
          })
          .filter(Boolean)
          
          // Add sections from CountrySectionMapping that are missing from the profile
          // but are applicable (heading is not N/A)
          for (const mapping of resolvedMappings) {
            // Skip if this section is already in the profile
            if (existingSectionKeys.has(mapping.sectionKey)) continue
            
            // Skip disabled sections
            if (!mapping.isEnabled) continue
            
            // Add the section from the mapping
            sectionsWithOrder.push({
              id: mapping.sectionKey,
              label: mapping.heading,
              order: ensureDisplayOrder(mapping.displayOrder, `${code}:${String(mapping.sectionKey)}`),
              required: mapping.isRequired,
              canonicalKeys: [mapping.sectionKey],
              _mapping: {
                heading: mapping.heading,
                isRequired: mapping.isRequired,
                isEnabled: mapping.isEnabled,
                displayOrder: mapping.displayOrder
              },
              _fromMapping: true // Flag to indicate this was added from CountrySectionMapping
            })
          }
          
          // Sort sections by the resolved order
          sectionsWithOrder.sort((a: any, b: any) => a.order - b.order)
          
          return {
            ...variant,
            sections: sectionsWithOrder
          }
        })
      }
    }
    
    const payload = {
      code: profile.countryCode,
      name: profile.name,
      meta: profileData?.meta || {},
      structure,
      prompts: profileData?.prompts || null,
      rules: profileData?.rules || null,
      export: profileData?.export || null,
      // Include mappings for reference
      sectionMappings: resolvedMappings.map(m => ({
        sectionKey: m.sectionKey,
        heading: m.heading,
        displayOrder: m.displayOrder,
        isRequired: m.isRequired,
        isEnabled: m.isEnabled
      }))
    }

    return NextResponse.json({ profile: payload })
  } catch (error) {
    console.error('[CountryProfile:getByCode] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
