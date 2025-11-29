/**
 * Unified Jurisdiction Configuration API
 * 
 * Provides comprehensive management for:
 * - Superset sections (foundation)
 * - Country configurations
 * - Section mappings
 * - Top-up prompts
 * 
 * Includes safety validations to prevent data integrity issues.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ============================================================================
// Auth Helper
// ============================================================================

async function verifySuperAdmin(request: NextRequest): Promise<{ userId: string; email: string } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true, email: true, roles: true }
  })

  if (!user?.roles?.includes('SUPER_ADMIN')) return null
  return { userId: user.id, email: user.email }
}

// ============================================================================
// GET - Fetch complete configuration data
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'full'

    // Fetch all superset sections
    const supersetSections = await prisma.supersetSection.findMany({
      orderBy: { displayOrder: 'asc' }
    })

    // Get mappings separately (relation removed to allow flexible seeding)
    const allMappingsForSections = await prisma.countrySectionMapping.findMany({
      select: {
        id: true,
        countryCode: true,
        sectionKey: true,
        heading: true,
        isRequired: true,
        isEnabled: true,
        displayOrder: true
      }
    })

    // Group mappings by section key
    const mappingsBySectionKey: Record<string, typeof allMappingsForSections> = {}
    for (const mapping of allMappingsForSections) {
      if (!mappingsBySectionKey[mapping.sectionKey]) {
        mappingsBySectionKey[mapping.sectionKey] = []
      }
      mappingsBySectionKey[mapping.sectionKey].push(mapping)
    }

    // Attach mappings to sections
    const supersetSectionsWithMappings = supersetSections.map(s => ({
      ...s,
      mappings: mappingsBySectionKey[s.sectionKey] || []
    }))

    // Fetch all countries (from profiles)
    const countryProfiles = await prisma.countryProfile.findMany({
      where: { status: 'ACTIVE' },
      select: {
        countryCode: true,
        name: true,
        version: true,
        profileData: true
      },
      orderBy: { name: 'asc' }
    })

    // Fetch country names for display
    const countryNames = await prisma.countryName.findMany()
    const countryNameMap: Record<string, string> = {}
    for (const cn of countryNames) {
      countryNameMap[cn.code] = cn.name
    }

    // Fetch all section mappings
    const allMappings = await prisma.countrySectionMapping.findMany({
      orderBy: [{ countryCode: 'asc' }, { displayOrder: 'asc' }]
    })

    // Fetch all section prompts
    const allPrompts = await prisma.countrySectionPrompt.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,  // Include ID for editing
        countryCode: true,
        sectionKey: true,
        instruction: true,
        constraints: true,
        additions: true,
        version: true,
        createdAt: true,
        updatedAt: true
      }
    })

    // Build country configurations
    const countries: Record<string, {
      code: string
      name: string
      version: number
      mappings: typeof allMappings
      prompts: typeof allPrompts
      enabledSections: string[]
      requiredSections: string[]
    }> = {}

    for (const profile of countryProfiles) {
      const code = profile.countryCode
      const mappings = allMappings.filter(m => m.countryCode === code)
      const prompts = allPrompts.filter(p => p.countryCode === code)

      countries[code] = {
        code,
        name: countryNameMap[code] || profile.name || code,
        version: profile.version,
        mappings,
        prompts,
        enabledSections: mappings.filter(m => m.isEnabled).map(m => m.sectionKey),
        requiredSections: mappings.filter(m => m.isRequired).map(m => m.sectionKey)
      }
    }

    // Build matrix data for UI
    const matrix: Array<{
      sectionKey: string
      label: string
      displayOrder: number
      description: string | null
      isActive: boolean
      baseInstruction: string
      baseConstraints: any[]
      countries: Record<string, {
        mapped: boolean
        enabled: boolean
        required: boolean
        heading: string | null
        hasPrompt: boolean
        promptVersion: number | null
      }>
    }> = []

    for (const section of supersetSectionsWithMappings) {
      const countryData: Record<string, any> = {}
      
      for (const code of Object.keys(countries)) {
        const mapping = section.mappings.find((m: any) => m.countryCode === code)
        const prompt = allPrompts.find(p => p.countryCode === code && p.sectionKey === section.sectionKey)

        countryData[code] = {
          mapped: !!mapping,
          enabled: mapping?.isEnabled ?? false,
          required: mapping?.isRequired ?? section.isRequired,
          heading: mapping?.heading || null,
          hasPrompt: !!prompt,
          promptVersion: prompt?.version || null
        }
      }

      matrix.push({
        sectionKey: section.sectionKey,
        label: section.label,
        displayOrder: section.displayOrder,
        description: section.description,
        isActive: section.isActive,
        baseInstruction: section.instruction,
        baseConstraints: section.constraints as any[],
        countries: countryData
      })
    }

    // Stats
    const stats = {
      totalSupersetSections: supersetSectionsWithMappings.length,
      activeSupersetSections: supersetSectionsWithMappings.filter(s => s.isActive).length,
      totalCountries: Object.keys(countries).length,
      totalMappings: allMappings.length,
      totalPrompts: allPrompts.length,
      unmappedCombinations: supersetSectionsWithMappings.length * Object.keys(countries).length - allMappings.length
    }

    return NextResponse.json({
      supersetSections: supersetSectionsWithMappings.map(s => ({
        id: s.id,
        sectionKey: s.sectionKey,
        displayOrder: s.displayOrder,
        label: s.label,
        description: s.description,
        instruction: s.instruction,
        constraints: s.constraints,
        isRequired: s.isRequired,
        isActive: s.isActive,
        mappingCount: s.mappings.length
      })),
      countries,
      matrix,
      stats
    })
  } catch (error) {
    console.error('[JurisdictionConfig] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch configuration' }, { status: 500 })
  }
}

// ============================================================================
// POST - Create new items
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, ...data } = body

    switch (action) {
      // Create new superset section
      case 'createSupersetSection': {
        const { sectionKey, label, displayOrder, description, instruction, constraints, isRequired } = data

        if (!sectionKey || !label || displayOrder === undefined || !instruction) {
          return NextResponse.json(
            { error: 'sectionKey, label, displayOrder, and instruction are required' },
            { status: 400 }
          )
        }

        // Check if key already exists
        const existing = await prisma.supersetSection.findUnique({
          where: { sectionKey }
        })
        if (existing) {
          return NextResponse.json(
            { error: `Superset section '${sectionKey}' already exists` },
            { status: 409 }
          )
        }

        const section = await prisma.supersetSection.create({
          data: {
            sectionKey,
            label,
            displayOrder,
            description: description || null,
            instruction,
            constraints: constraints || [],
            isRequired: isRequired ?? true,
            isActive: true,
            createdBy: admin.email
          }
        })

        return NextResponse.json({ success: true, section }, { status: 201 })
      }

      // Create new country
      case 'createCountry': {
        const { countryCode, name, continent } = data

        if (!countryCode || !name) {
          return NextResponse.json(
            { error: 'countryCode and name are required' },
            { status: 400 }
          )
        }

        const code = countryCode.toUpperCase()

        // Check if already exists
        const existingProfile = await prisma.countryProfile.findUnique({
          where: { countryCode: code }
        })
        if (existingProfile) {
          return NextResponse.json(
            { error: `Country '${code}' already exists` },
            { status: 409 }
          )
        }

        // Create country profile with minimal data
        const profile = await prisma.countryProfile.create({
          data: {
            countryCode: code,
            name,
            profileData: {
              meta: {
                code,
                name,
                continent: continent || 'Unknown',
                version: 1
              },
              structure: { variants: [] },
              prompts: { sections: {} }
            },
            version: 1,
            status: 'ACTIVE',
            createdBy: admin.userId
          }
        })

        // Create or update country name
        await prisma.countryName.upsert({
          where: { code },
          create: { code, name, continent: continent || 'Unknown' },
          update: { name, continent: continent || 'Unknown' }
        })

        return NextResponse.json({ success: true, profile }, { status: 201 })
      }

      // Create section mapping for a country
      case 'createMapping': {
        const { countryCode, sectionKey, heading, isRequired, isEnabled, displayOrder } = data

        if (!countryCode || !sectionKey) {
          return NextResponse.json(
            { error: 'countryCode and sectionKey are required' },
            { status: 400 }
          )
        }

        const code = countryCode.toUpperCase()

        // Verify superset section exists
        const supersetSection = await prisma.supersetSection.findUnique({
          where: { sectionKey }
        })
        if (!supersetSection) {
          return NextResponse.json(
            { error: `Superset section '${sectionKey}' not found` },
            { status: 404 }
          )
        }

        // Check if mapping already exists
        const existing = await prisma.countrySectionMapping.findUnique({
          where: { countryCode_sectionKey: { countryCode: code, sectionKey } }
        })
        if (existing) {
          return NextResponse.json(
            { error: `Mapping already exists for ${code}/${sectionKey}` },
            { status: 409 }
          )
        }

        // Create mapping
        const mapping = await prisma.countrySectionMapping.create({
          data: {
            countryCode: code,
            supersetCode: `${String(supersetSection.displayOrder).padStart(2, '0')}. ${supersetSection.label}`,
            sectionKey,
            heading: heading || supersetSection.label,
            isRequired: isRequired ?? supersetSection.isRequired,
            isEnabled: isEnabled ?? true,
            displayOrder: displayOrder ?? supersetSection.displayOrder
          }
        })

        return NextResponse.json({ success: true, mapping }, { status: 201 })
      }

      // Bulk create mappings for a country (map all superset sections)
      case 'bulkCreateMappings': {
        const { countryCode, mappings: mappingOverrides } = data

        if (!countryCode) {
          return NextResponse.json({ error: 'countryCode is required' }, { status: 400 })
        }

        const code = countryCode.toUpperCase()

        // Get all active superset sections
        const supersetSections = await prisma.supersetSection.findMany({
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' }
        })

        // Get existing mappings
        const existingMappings = await prisma.countrySectionMapping.findMany({
          where: { countryCode: code }
        })
        const existingKeys = new Set(existingMappings.map(m => m.sectionKey))

        const created: any[] = []
        const skipped: string[] = []

        for (const section of supersetSections) {
          if (existingKeys.has(section.sectionKey)) {
            skipped.push(section.sectionKey)
            continue
          }

          const override = mappingOverrides?.[section.sectionKey] || {}

          const mapping = await prisma.countrySectionMapping.create({
            data: {
              countryCode: code,
              supersetCode: `${String(section.displayOrder).padStart(2, '0')}. ${section.label}`,
              sectionKey: section.sectionKey,
              heading: override.heading || section.label,
              isRequired: override.isRequired ?? section.isRequired,
              isEnabled: override.isEnabled ?? true,
              displayOrder: override.displayOrder ?? section.displayOrder
            }
          })

          created.push(mapping)
        }

        return NextResponse.json({
          success: true,
          created: created.length,
          skipped: skipped.length,
          skippedKeys: skipped
        }, { status: 201 })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[JurisdictionConfig] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create' },
      { status: 500 }
    )
  }
}

// ============================================================================
// PUT - Update existing items
// ============================================================================

export async function PUT(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, ...data } = body

    switch (action) {
      // Update superset section
      case 'updateSupersetSection': {
        const { id, sectionKey, label, displayOrder, description, instruction, constraints, isRequired, isActive } = data

        if (!id && !sectionKey) {
          return NextResponse.json({ error: 'id or sectionKey required' }, { status: 400 })
        }

        const section = await prisma.supersetSection.update({
          where: id ? { id } : { sectionKey },
          data: {
            ...(label !== undefined && { label }),
            ...(displayOrder !== undefined && { displayOrder }),
            ...(description !== undefined && { description }),
            ...(instruction !== undefined && { instruction }),
            ...(constraints !== undefined && { constraints }),
            ...(isRequired !== undefined && { isRequired }),
            ...(isActive !== undefined && { isActive }),
            updatedBy: admin.email
          }
        })

        return NextResponse.json({ success: true, section })
      }

      // Update section mapping
      case 'updateMapping': {
        const { countryCode, sectionKey, heading, isRequired, isEnabled, displayOrder } = data

        if (!countryCode || !sectionKey) {
          return NextResponse.json({ error: 'countryCode and sectionKey required' }, { status: 400 })
        }

        const mapping = await prisma.countrySectionMapping.update({
          where: {
            countryCode_sectionKey: {
              countryCode: countryCode.toUpperCase(),
              sectionKey
            }
          },
          data: {
            ...(heading !== undefined && { heading }),
            ...(isRequired !== undefined && { isRequired }),
            ...(isEnabled !== undefined && { isEnabled }),
            ...(displayOrder !== undefined && { displayOrder })
          }
        })

        return NextResponse.json({ success: true, mapping })
      }

      // Bulk update mappings for a country
      case 'bulkUpdateMappings': {
        const { countryCode, updates } = data

        if (!countryCode || !updates) {
          return NextResponse.json({ error: 'countryCode and updates required' }, { status: 400 })
        }

        const code = countryCode.toUpperCase()
        const results: any[] = []

        for (const [sectionKey, update] of Object.entries(updates as Record<string, any>)) {
          try {
            const mapping = await prisma.countrySectionMapping.update({
              where: { countryCode_sectionKey: { countryCode: code, sectionKey } },
              data: {
                ...(update.heading !== undefined && { heading: update.heading }),
                ...(update.isRequired !== undefined && { isRequired: update.isRequired }),
                ...(update.isEnabled !== undefined && { isEnabled: update.isEnabled }),
                ...(update.displayOrder !== undefined && { displayOrder: update.displayOrder })
              }
            })
            results.push({ sectionKey, success: true, mapping })
          } catch (e) {
            results.push({ sectionKey, success: false, error: (e as Error).message })
          }
        }

        return NextResponse.json({ success: true, results })
      }

      // Reorder superset sections
      case 'reorderSupersetSections': {
        const { order } = data // Array of { sectionKey, displayOrder }

        if (!order || !Array.isArray(order)) {
          return NextResponse.json({ error: 'order array required' }, { status: 400 })
        }

        for (const item of order) {
          await prisma.supersetSection.update({
            where: { sectionKey: item.sectionKey },
            data: { displayOrder: item.displayOrder, updatedBy: admin.email }
          })
        }

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[JurisdictionConfig] PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update' },
      { status: 500 }
    )
  }
}

// ============================================================================
// DELETE - Remove items with safety checks
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const admin = await verifySuperAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    switch (action) {
      // Delete superset section (with safety check)
      case 'deleteSupersetSection': {
        const sectionKey = searchParams.get('sectionKey')
        if (!sectionKey) {
          return NextResponse.json({ error: 'sectionKey required' }, { status: 400 })
        }

        // Check for existing mappings
        const mappings = await prisma.countrySectionMapping.count({
          where: { sectionKey }
        })

        if (mappings > 0) {
          return NextResponse.json({
            error: `Cannot delete superset section '${sectionKey}': ${mappings} country mapping(s) exist. Remove mappings first.`,
            mappingCount: mappings,
            suggestion: 'Use isActive=false to disable instead, or remove all mappings first'
          }, { status: 409 })
        }

        // Check for existing prompts
        const prompts = await prisma.countrySectionPrompt.count({
          where: { sectionKey }
        })

        if (prompts > 0) {
          return NextResponse.json({
            error: `Cannot delete superset section '${sectionKey}': ${prompts} country prompt(s) exist. Archive prompts first.`,
            promptCount: prompts
          }, { status: 409 })
        }

        // Safe to delete
        await prisma.supersetSection.delete({
          where: { sectionKey }
        })

        return NextResponse.json({ success: true, deleted: sectionKey })
      }

      // Delete mapping
      case 'deleteMapping': {
        const countryCode = searchParams.get('countryCode')
        const sectionKey = searchParams.get('sectionKey')

        if (!countryCode || !sectionKey) {
          return NextResponse.json({ error: 'countryCode and sectionKey required' }, { status: 400 })
        }

        // Check for associated prompt
        const prompt = await prisma.countrySectionPrompt.findFirst({
          where: {
            countryCode: countryCode.toUpperCase(),
            sectionKey,
            status: 'ACTIVE'
          }
        })

        if (prompt) {
          return NextResponse.json({
            error: `Cannot delete mapping: Active prompt exists for ${countryCode}/${sectionKey}. Archive the prompt first.`,
            promptId: prompt.id
          }, { status: 409 })
        }

        await prisma.countrySectionMapping.delete({
          where: {
            countryCode_sectionKey: {
              countryCode: countryCode.toUpperCase(),
              sectionKey
            }
          }
        })

        return NextResponse.json({ success: true })
      }

      // Delete all mappings for a country
      case 'deleteCountryMappings': {
        const countryCode = searchParams.get('countryCode')
        if (!countryCode) {
          return NextResponse.json({ error: 'countryCode required' }, { status: 400 })
        }

        const code = countryCode.toUpperCase()

        // Check for active prompts
        const activePrompts = await prisma.countrySectionPrompt.count({
          where: { countryCode: code, status: 'ACTIVE' }
        })

        if (activePrompts > 0) {
          return NextResponse.json({
            error: `Cannot delete all mappings: ${activePrompts} active prompt(s) exist. Archive prompts first.`,
            promptCount: activePrompts
          }, { status: 409 })
        }

        const result = await prisma.countrySectionMapping.deleteMany({
          where: { countryCode: code }
        })

        return NextResponse.json({ success: true, deleted: result.count })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error('[JurisdictionConfig] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete' },
      { status: 500 }
    )
  }
}

