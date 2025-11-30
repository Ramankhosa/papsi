import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

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

    // Create a map of sectionKey -> mapping for quick lookup
    const mappingByKey = new Map(sectionMappings.map(m => [m.sectionKey, m]))

    // Return only the data needed for drafting UI (structure/prompts/rules/meta)
    const profileData = profile.profileData as any
    
    // Process structure to apply country-specific ordering from mappings
    let structure = profileData?.structure || null
    if (structure?.variants) {
      structure = {
        ...structure,
        variants: structure.variants.map((variant: any) => {
          if (!variant.sections) return variant
          
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
            
            return {
              ...sec,
              // Use mapping's displayOrder if available, otherwise keep original order
              order: mapping?.displayOrder ?? sec.order,
              // Include mapping metadata
              _mapping: mapping ? {
                heading: mapping.heading,
                isRequired: mapping.isRequired,
                isEnabled: mapping.isEnabled,
                displayOrder: mapping.displayOrder
              } : null
            }
          })
          
          // Sort sections by the resolved order
          sectionsWithOrder.sort((a: any, b: any) => (a.order || 999) - (b.order || 999))
          
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
      sectionMappings: sectionMappings.map(m => ({
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
