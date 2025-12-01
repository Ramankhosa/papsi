import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/writing-samples/bulk-delete
 * 
 * Delete all writing samples for a specific persona + jurisdiction combination.
 * Used when user wants to clear all samples for a jurisdiction without deleting the persona.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { personaId, jurisdiction } = body

    if (!personaId) {
      return NextResponse.json({ error: 'personaId is required' }, { status: 400 })
    }

    if (!jurisdiction) {
      return NextResponse.json({ error: 'jurisdiction is required' }, { status: 400 })
    }

    // Verify user owns or has access to this persona
    const persona = await prisma.writingPersona.findFirst({
      where: {
        id: personaId,
        OR: [
          { createdBy: authResult.user.id },
          // Allow admins to manage org personas
          {
            tenantId: authResult.user.tenantId,
            visibility: 'ORGANIZATION'
          }
        ]
      }
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found or access denied' }, { status: 404 })
    }

    // Only allow deletion if user owns the persona
    if (persona.createdBy !== authResult.user.id) {
      return NextResponse.json({ error: 'Only the persona owner can delete samples' }, { status: 403 })
    }

    // Delete all samples for this persona + jurisdiction
    const deleteResult = await prisma.writingSample.deleteMany({
      where: {
        personaId,
        jurisdiction: jurisdiction.toUpperCase()
      }
    })

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `Deleted ${deleteResult.count} samples for ${jurisdiction} jurisdiction`
    })
  } catch (error) {
    console.error('[WritingSamples:BulkDelete] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

