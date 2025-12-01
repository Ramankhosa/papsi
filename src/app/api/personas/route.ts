/**
 * Writing Personas API
 * 
 * Manages reusable writing style personas that can be shared within organizations.
 * 
 * Access Control:
 * - ANALYST, MANAGER, ADMIN, OWNER: Can create own personas, use any visible persona
 * - ADMIN, OWNER: Can create organization-wide personas
 * - VIEWER: No access
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canUsePersona, canCreateOwnPersona, canCreateOrgPersona, canManageOrgPersonas } from '@/lib/permissions'
import type { PersonaVisibility } from '@prisma/client'

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyJWT(token)
  if (!payload || !payload.sub) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, tenantId: true, roles: true }
  })

  return user
}

/**
 * GET /api/personas
 * List personas visible to the user (own + organization-wide)
 * 
 * Query params:
 * - includeOrg: boolean - Include organization personas (default: true)
 * - onlyOwn: boolean - Only return user's own personas
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    if (!canUsePersona(user as any)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const includeOrg = searchParams.get('includeOrg') !== 'false'
    const onlyOwn = searchParams.get('onlyOwn') === 'true'

    // Build query
    const whereConditions: any[] = [
      { createdBy: user.id, isActive: true } // Own personas
    ]

    if (includeOrg && !onlyOwn) {
      whereConditions.push({
        tenantId: user.tenantId,
        visibility: 'ORGANIZATION',
        isActive: true
      })
    }

    const personas = await prisma.writingPersona.findMany({
      where: { OR: whereConditions },
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        _count: {
          select: { samples: true }
        }
      },
      orderBy: [
        { isTemplate: 'desc' },
        { name: 'asc' }
      ]
    })

    // Group by ownership
    const myPersonas = personas.filter(p => p.createdBy === user.id)
    const orgPersonas = personas.filter(p => p.createdBy !== user.id && p.visibility === 'ORGANIZATION')

    return NextResponse.json({
      myPersonas: myPersonas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        allowCopy: p.allowCopy,
        sampleCount: p._count.samples,
        isOwn: true,
        createdAt: p.createdAt
      })),
      orgPersonas: orgPersonas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        allowCopy: p.allowCopy,
        sampleCount: p._count.samples,
        isOwn: false,
        createdBy: {
          id: p.creator.id,
          name: p.creator.name || p.creator.email
        },
        createdAt: p.createdAt
      })),
      total: personas.length
    })

  } catch (error) {
    console.error('[Personas] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/personas
 * Create a new persona
 * 
 * Body:
 * - name: string (required)
 * - description?: string
 * - visibility: 'PRIVATE' | 'ORGANIZATION' (default: PRIVATE)
 * - isTemplate?: boolean (admin only)
 * - allowCopy?: boolean
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission to create personas
    if (!canCreateOwnPersona(user as any)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, visibility = 'PRIVATE', isTemplate = false, allowCopy = true } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 })
    }

    // Check if trying to create org-wide persona
    if (visibility === 'ORGANIZATION' && !canCreateOrgPersona(user as any)) {
      return NextResponse.json(
        { error: 'Only OWNER or ADMIN can create organization-wide personas' },
        { status: 403 }
      )
    }

    // Check if name already exists for this user
    const existing = await prisma.writingPersona.findUnique({
      where: { createdBy_name: { createdBy: user.id, name: name.trim() } }
    })

    if (existing) {
      return NextResponse.json(
        { error: 'You already have a persona with this name' },
        { status: 400 }
      )
    }

    const persona = await prisma.writingPersona.create({
      data: {
        tenantId: user.tenantId,
        createdBy: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        visibility: visibility as PersonaVisibility,
        isTemplate: canCreateOrgPersona(user as any) ? isTemplate : false,
        allowCopy
      }
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId,
        action: 'PERSONA_CREATE',
        resource: `persona:${persona.id}`,
        meta: { name: persona.name, visibility: persona.visibility }
      }
    })

    return NextResponse.json({
      success: true,
      persona: {
        id: persona.id,
        name: persona.name,
        description: persona.description,
        visibility: persona.visibility,
        isTemplate: persona.isTemplate,
        allowCopy: persona.allowCopy,
        sampleCount: 0
      }
    }, { status: 201 })

  } catch (error) {
    console.error('[Personas] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create persona' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/personas
 * Update or copy a persona
 * 
 * Body for update:
 * - action: 'update'
 * - id: string
 * - name?, description?, visibility?, isTemplate?, allowCopy?, isActive?
 * 
 * Body for copy:
 * - action: 'copy'
 * - sourceId: string
 * - newName: string
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (action === 'copy') {
      // Copy an org persona to own personas
      const { sourceId, newName } = body

      if (!sourceId || !newName) {
        return NextResponse.json({ error: 'sourceId and newName required' }, { status: 400 })
      }

      // Get source persona
      const source = await prisma.writingPersona.findUnique({
        where: { id: sourceId },
        include: { samples: true }
      })

      if (!source) {
        return NextResponse.json({ error: 'Source persona not found' }, { status: 404 })
      }

      // Check visibility - can only copy org personas or own
      if (source.createdBy !== user.id && source.visibility !== 'ORGANIZATION') {
        return NextResponse.json({ error: 'Cannot copy this persona' }, { status: 403 })
      }

      if (!source.allowCopy && source.createdBy !== user.id) {
        return NextResponse.json({ error: 'This persona does not allow copying' }, { status: 403 })
      }

      // Create copy
      const copied = await prisma.writingPersona.create({
        data: {
          tenantId: user.tenantId,
          createdBy: user.id,
          name: newName.trim(),
          description: source.description ? `Copied from: ${source.name}. ${source.description}` : `Copied from: ${source.name}`,
          visibility: 'PRIVATE',
          isTemplate: false,
          allowCopy: true
        }
      })

      // Copy samples
      if (source.samples.length > 0) {
        await prisma.writingSample.createMany({
          data: source.samples.map(s => ({
            userId: user.id,
            tenantId: user.tenantId,
            personaId: copied.id,
            personaName: newName.trim(),
            jurisdiction: s.jurisdiction,
            sectionKey: s.sectionKey,
            sampleText: s.sampleText,
            notes: s.notes,
            wordCount: s.wordCount,
            isActive: true
          }))
        })
      }

      return NextResponse.json({
        success: true,
        persona: {
          id: copied.id,
          name: copied.name,
          description: copied.description,
          sampleCount: source.samples.length
        }
      })
    }

    // Update persona
    const { id, name, description, visibility, isTemplate, allowCopy, isActive } = body

    if (!id) {
      return NextResponse.json({ error: 'Persona ID required' }, { status: 400 })
    }

    const persona = await prisma.writingPersona.findUnique({
      where: { id }
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Check ownership or admin rights
    const isOwner = persona.createdBy === user.id
    const canManage = canManageOrgPersonas(user as any)

    if (!isOwner && !canManage) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Non-owners can't change visibility to ORGANIZATION
    if (!canCreateOrgPersona(user as any) && visibility === 'ORGANIZATION') {
      return NextResponse.json(
        { error: 'Only OWNER or ADMIN can make personas organization-wide' },
        { status: 403 }
      )
    }

    const updated = await prisma.writingPersona.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(visibility !== undefined && canCreateOrgPersona(user as any) && { visibility }),
        ...(isTemplate !== undefined && canManage && { isTemplate }),
        ...(allowCopy !== undefined && { allowCopy }),
        ...(isActive !== undefined && { isActive })
      }
    })

    return NextResponse.json({ success: true, persona: updated })

  } catch (error) {
    console.error('[Personas] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update persona' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/personas
 * Soft delete a persona (set isActive = false)
 * 
 * Query params:
 * - id: string
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user || !user.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Persona ID required' }, { status: 400 })
    }

    const persona = await prisma.writingPersona.findUnique({
      where: { id }
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Check ownership or admin rights
    const isOwner = persona.createdBy === user.id
    const canManage = canManageOrgPersonas(user as any)

    if (!isOwner && !canManage) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Soft delete
    await prisma.writingPersona.update({
      where: { id },
      data: { isActive: false }
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId,
        action: 'PERSONA_DELETE',
        resource: `persona:${id}`,
        meta: { name: persona.name }
      }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Personas] DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    )
  }
}

