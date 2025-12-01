import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/sections/by-jurisdiction?jurisdiction=IN
 * 
 * Returns sections available for a specific jurisdiction based on CountrySectionMapping.
 * 
 * For specific jurisdictions:
 * - Returns mapped sections where heading is NOT "NA" or "N/A"
 * - Sections with NA/N/A heading are not applicable for that country
 * 
 * For universal (*):
 * - Returns superset sections that are mapped to at least one country
 * - Includes info about which countries use each section
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const jurisdiction = url.searchParams.get('jurisdiction')?.toUpperCase() || '*'

    // For universal jurisdiction, return superset sections that have at least one valid country mapping
    if (jurisdiction === '*') {
      // Get all country section mappings (excluding NA/N/A headings)
      const allMappings = await prisma.countrySectionMapping.findMany({
        where: {
          isEnabled: true,
          NOT: {
            heading: { in: ['NA', 'N/A', 'na', 'n/a'] }
          }
        },
        select: {
          sectionKey: true,
          countryCode: true
        }
      })

      // Group by sectionKey to find which sections are used by at least one country
      const sectionCountries: Record<string, string[]> = {}
      for (const mapping of allMappings) {
        if (!sectionCountries[mapping.sectionKey]) {
          sectionCountries[mapping.sectionKey] = []
        }
        if (!sectionCountries[mapping.sectionKey].includes(mapping.countryCode)) {
          sectionCountries[mapping.sectionKey].push(mapping.countryCode)
        }
      }

      // Get superset sections that have at least one country mapping
      const supersetSections = await prisma.supersetSection.findMany({
        where: { 
          isActive: true,
          sectionKey: { in: Object.keys(sectionCountries) }
        },
        orderBy: { displayOrder: 'asc' },
        select: {
          sectionKey: true,
          label: true,
          displayOrder: true
        }
      })

      return NextResponse.json({
        jurisdiction: '*',
        note: 'Universal persona samples apply to all countries that use this section',
        sections: supersetSections.map(s => ({
          key: s.sectionKey,
          label: s.label,
          displayOrder: s.displayOrder,
          usedBy: sectionCountries[s.sectionKey] || []
        }))
      })
    }

    // For specific jurisdiction, get mapped sections (excluding NA/N/A)
    const mappings = await prisma.countrySectionMapping.findMany({
      where: {
        countryCode: jurisdiction,
        isEnabled: true,
        NOT: {
          heading: { in: ['NA', 'N/A', 'na', 'n/a'] }
        }
      },
      orderBy: { displayOrder: 'asc' },
      select: {
        sectionKey: true,
        heading: true,
        displayOrder: true,
        isRequired: true
      }
    })

    // If no mappings found, fall back to superset sections
    if (mappings.length === 0) {
      // Check if the country exists in mappings at all
      const anyMapping = await prisma.countrySectionMapping.findFirst({
        where: { countryCode: jurisdiction }
      })

      if (!anyMapping) {
        // Country not configured - return superset sections with a warning
        const supersetSections = await prisma.supersetSection.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          select: {
            sectionKey: true,
            label: true,
            displayOrder: true
          }
        })

        return NextResponse.json({
          jurisdiction,
          fallback: true,
          note: 'This jurisdiction is not configured. Showing all superset sections.',
          sections: supersetSections.map(s => ({
            key: s.sectionKey,
            label: s.label,
            displayOrder: s.displayOrder
          }))
        })
      }

      // Country exists but all sections are NA - return empty
      return NextResponse.json({
        jurisdiction,
        note: 'No applicable sections for this jurisdiction',
        sections: []
      })
    }

    return NextResponse.json({
      jurisdiction,
      sections: mappings.map(m => ({
        key: m.sectionKey,
        label: m.heading,
        displayOrder: m.displayOrder,
        isRequired: m.isRequired
      }))
    })
  } catch (error) {
    console.error('[Sections:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
