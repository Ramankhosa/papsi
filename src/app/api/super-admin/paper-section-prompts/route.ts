import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/super-admin/paper-section-prompts
 * Returns paper type section prompts organized by paper type
 * 
 * Similar to the patent section-prompts endpoint but for papers
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all active paper types
    const paperTypes = await prisma.paperTypeDefinition.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    })

    // Get all superset sections (base prompts)
    const supersetSections = await prisma.paperSupersetSection.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' }
    })

    // Get all paper type prompts
    const typePrompts = await prisma.paperTypeSectionPrompt.findMany({
      where: { status: 'ACTIVE' },
      include: {
        supersetSection: {
          select: {
            label: true,
            description: true
          }
        }
      }
    })

    // Organize prompts by paper type
    const promptsByPaperType: Record<string, any[]> = {}
    const paperTypeNames: Record<string, string> = {}

    for (const pt of paperTypes) {
      paperTypeNames[pt.code] = pt.name
      
      // For each section, get either the override or the base prompt
      const sectionsForType = supersetSections.map(ss => {
        const override = typePrompts.find(
          tp => tp.paperTypeCode === pt.code && tp.sectionKey === ss.sectionKey
        )

        return {
          sectionKey: ss.sectionKey,
          label: ss.label,
          description: ss.description,
          displayOrder: ss.displayOrder,
          isRequired: ss.isRequired,
          // Instruction: use override if exists, otherwise base
          instruction: override?.instruction || ss.instruction,
          instructionPreview: (override?.instruction || ss.instruction).substring(0, 200) + '...',
          constraints: override?.constraints || ss.constraints,
          // Metadata
          hasOverride: !!override,
          overrideId: override?.id,
          version: override?.version || 1,
          // Context flags from base
          requiresBlueprint: ss.requiresBlueprint,
          requiresPreviousSections: ss.requiresPreviousSections,
          requiresCitations: ss.requiresCitations
        }
      })

      promptsByPaperType[pt.code] = sectionsForType
    }

    return NextResponse.json({
      supersetSections: supersetSections.map(s => ({
        sectionKey: s.sectionKey,
        label: s.label,
        description: s.description,
        displayOrder: s.displayOrder,
        isRequired: s.isRequired,
        instruction: s.instruction,
        instructionPreview: s.instruction.substring(0, 200) + '...',
        constraints: s.constraints,
        requiresBlueprint: s.requiresBlueprint,
        requiresPreviousSections: s.requiresPreviousSections,
        requiresCitations: s.requiresCitations
      })),
      paperTypes: paperTypes.map(pt => ({
        code: pt.code,
        name: pt.name
      })),
      paperTypeNames,
      promptsByPaperType
    })
  } catch (error) {
    console.error('Failed to fetch paper section prompts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/super-admin/paper-section-prompts
 * Create or update paper type section prompts
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, paperTypeCode, sectionKey, instruction, constraints, changeReason } = body

    if (!paperTypeCode || !sectionKey) {
      return NextResponse.json({ error: 'Missing paperTypeCode or sectionKey' }, { status: 400 })
    }

    // Verify paper type exists
    const paperType = await prisma.paperTypeDefinition.findUnique({
      where: { code: paperTypeCode }
    })
    if (!paperType) {
      return NextResponse.json({ error: 'Paper type not found' }, { status: 404 })
    }

    // Verify section exists
    const supersetSection = await prisma.paperSupersetSection.findUnique({
      where: { sectionKey }
    })
    if (!supersetSection) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    // Validate instruction is not empty when provided
    if (instruction !== undefined && typeof instruction === 'string' && instruction.trim().length < 10) {
      return NextResponse.json({ 
        error: 'Instruction must be at least 10 characters' 
      }, { status: 400 })
    }

    switch (action) {
      case 'create_override':
      case 'update': {
        // Check if override already exists (include ARCHIVED to handle restore scenario)
        const existing = await prisma.paperTypeSectionPrompt.findFirst({
          where: {
            paperTypeCode,
            sectionKey,
            status: { in: ['ACTIVE', 'DRAFT'] }
          }
        })

        if (existing) {
          // Update existing override using transaction
          const newVersion = existing.version + 1

          const updated = await prisma.$transaction(async (tx) => {
            // Create history record first
            await tx.paperTypeSectionPromptHistory.create({
              data: {
                promptId: existing.id,
                paperTypeCode,
                sectionKey,
                instruction: existing.instruction,
                constraints: existing.constraints as any,
                additions: existing.additions as any,
                version: existing.version,
                changeType: 'UPDATE',
                changeReason: changeReason || 'Admin update',
                changedBy: authResult.user.id
              }
            })

            // Update the prompt
            return tx.paperTypeSectionPrompt.update({
              where: { id: existing.id },
              data: {
                instruction: instruction ?? existing.instruction,
                constraints: constraints ?? existing.constraints,
                version: newVersion,
                updatedBy: authResult.user.id
              }
            })
          })

          return NextResponse.json({
            success: true,
            message: `Updated override for ${paperTypeCode}/${sectionKey}`,
            prompt: updated
          })
        } else {
          // Check if there's an archived version we should update instead
          const archived = await prisma.paperTypeSectionPrompt.findFirst({
            where: { paperTypeCode, sectionKey, status: 'ARCHIVED' }
          })

          if (archived) {
            // Reactivate and update the archived version
            const updated = await prisma.$transaction(async (tx) => {
              await tx.paperTypeSectionPromptHistory.create({
                data: {
                  promptId: archived.id,
                  paperTypeCode,
                  sectionKey,
                  instruction: instruction || supersetSection.instruction,
                  constraints: (constraints || {}) as any,
                  version: archived.version + 1,
                  changeType: 'RESTORE',
                  changeReason: changeReason || 'Recreated override',
                  changedBy: authResult.user.id
                }
              })

              return tx.paperTypeSectionPrompt.update({
                where: { id: archived.id },
                data: {
                  instruction: instruction || supersetSection.instruction,
                  constraints: constraints || {},
                  status: 'ACTIVE',
                  version: archived.version + 1,
                  updatedBy: authResult.user.id
                }
              })
            })

            return NextResponse.json({
              success: true,
              message: `Recreated override for ${paperTypeCode}/${sectionKey}`,
              prompt: updated
            })
          }

          // Create new override using transaction
          const newPrompt = await prisma.$transaction(async (tx) => {
            const created = await tx.paperTypeSectionPrompt.create({
              data: {
                paperTypeCode,
                sectionKey,
                instruction: instruction || supersetSection.instruction,
                constraints: constraints || {},
                status: 'ACTIVE',
                createdBy: authResult.user.id
              }
            })

            // Create history record
            await tx.paperTypeSectionPromptHistory.create({
              data: {
                promptId: created.id,
                paperTypeCode,
                sectionKey,
                instruction: created.instruction,
                constraints: created.constraints as any,
                version: 1,
                changeType: 'CREATE',
                changeReason: changeReason || 'Initial creation',
                changedBy: authResult.user.id
              }
            })

            return created
          })

          return NextResponse.json({
            success: true,
            message: `Created override for ${paperTypeCode}/${sectionKey}`,
            prompt: newPrompt
          })
        }
      }

      case 'delete_override': {
        const existing = await prisma.paperTypeSectionPrompt.findFirst({
          where: {
            paperTypeCode,
            sectionKey,
            status: 'ACTIVE'
          }
        })

        if (!existing) {
          return NextResponse.json({ 
            error: 'No active override exists for this combination' 
          }, { status: 404 })
        }

        // Use transaction for atomic operation
        await prisma.$transaction(async (tx) => {
          // Create history record
          await tx.paperTypeSectionPromptHistory.create({
            data: {
              promptId: existing.id,
              paperTypeCode,
              sectionKey,
              instruction: existing.instruction,
              constraints: existing.constraints as any,
              additions: existing.additions as any,
              version: existing.version,
              changeType: 'ARCHIVE',
              changeReason: changeReason || 'Removed override - using base prompt',
              changedBy: authResult.user.id
            }
          })

          // Archive the override
          await tx.paperTypeSectionPrompt.update({
            where: { id: existing.id },
            data: {
              status: 'ARCHIVED',
              updatedBy: authResult.user.id
            }
          })
        })

        return NextResponse.json({
          success: true,
          message: `Removed override for ${paperTypeCode}/${sectionKey} - now using base prompt`
        })
      }

      case 'restore_override': {
        // First check if there's already an active override
        const activeExists = await prisma.paperTypeSectionPrompt.findFirst({
          where: {
            paperTypeCode,
            sectionKey,
            status: 'ACTIVE'
          }
        })

        if (activeExists) {
          return NextResponse.json({ 
            error: 'An active override already exists. Delete it first before restoring an archived version.' 
          }, { status: 400 })
        }

        const archived = await prisma.paperTypeSectionPrompt.findFirst({
          where: {
            paperTypeCode,
            sectionKey,
            status: 'ARCHIVED'
          },
          orderBy: { updatedAt: 'desc' }
        })

        if (!archived) {
          return NextResponse.json({ 
            error: 'No archived override found' 
          }, { status: 404 })
        }

        // Use transaction for atomic operation
        await prisma.$transaction(async (tx) => {
          await tx.paperTypeSectionPrompt.update({
            where: { id: archived.id },
            data: {
              status: 'ACTIVE',
              version: archived.version + 1,
              updatedBy: authResult.user.id
            }
          })

          await tx.paperTypeSectionPromptHistory.create({
            data: {
              promptId: archived.id,
              paperTypeCode,
              sectionKey,
              instruction: archived.instruction,
              constraints: archived.constraints as any,
              version: archived.version + 1,
              changeType: 'RESTORE',
              changeReason: changeReason || 'Restored override',
              changedBy: authResult.user.id
            }
          })
        })

        return NextResponse.json({
          success: true,
          message: `Restored override for ${paperTypeCode}/${sectionKey}`
        })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Failed to update paper section prompt:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/super-admin/paper-section-prompts?paperTypeCode=X&sectionKey=Y
 * Returns prompt history for a specific paper type / section combination
 * 
 * Note: Using PUT because GET is already used for listing all prompts.
 * A proper solution would be a separate /history route.
 */
export async function PUT(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user || !authResult.user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const paperTypeCode = searchParams.get('paperTypeCode')
    const sectionKey = searchParams.get('sectionKey')

    if (!paperTypeCode || !sectionKey) {
      return NextResponse.json({ error: 'Missing paperTypeCode or sectionKey parameters' }, { status: 400 })
    }

    // Validate that the combination exists
    const supersetSection = await prisma.paperSupersetSection.findUnique({
      where: { sectionKey }
    })
    if (!supersetSection) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const history = await prisma.paperTypeSectionPromptHistory.findMany({
      where: { paperTypeCode, sectionKey },
      orderBy: { changedAt: 'desc' },
      take: 50 // Increased limit for better history visibility
    })

    return NextResponse.json({ 
      history,
      sectionLabel: supersetSection.label,
      paperTypeCode,
      sectionKey
    })
  } catch (error) {
    console.error('Failed to fetch prompt history:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

