import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Validation constants
const MIN_WORDS = 10
const MAX_WORDS = 200
const MAX_CHARS = 1500

// Canonical section keys that support writing samples
const VALID_SECTION_KEYS = [
  'title',
  'fieldOfInvention',
  'background',
  'objectsOfInvention',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'claims',
  'abstract',
  'technicalProblem',
  'technicalSolution',
  'advantageousEffects',
  'industrialApplicability',
  'bestMethod',
  'preamble',
  'crossReference'
]

// Helper to count words
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

// Helper to validate jurisdiction
function isValidJurisdiction(j: string): boolean {
  // "*" for universal, or 2-3 letter country codes
  return j === '*' || /^[A-Z]{2,3}$/.test(j.toUpperCase())
}

/**
 * GET /api/writing-samples
 * Get all writing samples for the current user
 * 
 * Query params:
 * - jurisdiction: optional (filter by jurisdiction)
 * - sectionKey: optional (filter by section)
 * - includeInactive: optional (include inactive samples)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')
    const personaId = url.searchParams.get('personaId')
    const includeInactive = url.searchParams.get('includeInactive') === 'true'

    // If personaId is provided, fetch samples for that persona (could be org-shared)
    // Otherwise, fetch only the user's own samples
    let where: any = {
      ...(includeInactive ? {} : { isActive: true })
    }

    if (personaId) {
      // Verify the user has access to this persona (own or org-shared)
      const persona = await prisma.writingPersona.findFirst({
        where: {
          id: personaId,
          OR: [
            { createdBy: authResult.user.id },
            { tenantId: authResult.user.tenantId, visibility: 'ORGANIZATION' }
          ]
        }
      })
      
      if (!persona) {
        return NextResponse.json({ error: 'Persona not found or access denied' }, { status: 404 })
      }
      
      where.personaId = personaId
    } else {
      // No persona specified - only return user's own samples
      where.userId = authResult.user.id
    }

    if (jurisdiction) {
      where.jurisdiction = jurisdiction.toUpperCase()
    }
    if (sectionKey) {
      where.sectionKey = sectionKey
    }

    const samples = await prisma.writingSample.findMany({
      where,
      orderBy: [
        { jurisdiction: 'asc' },
        { sectionKey: 'asc' }
      ]
    })

    // Group by jurisdiction for easier frontend consumption
    const grouped: Record<string, Record<string, any>> = {}
    for (const sample of samples) {
      if (!grouped[sample.jurisdiction]) {
        grouped[sample.jurisdiction] = {}
      }
      grouped[sample.jurisdiction][sample.sectionKey] = {
        id: sample.id,
        sampleText: sample.sampleText,
        notes: sample.notes,
        wordCount: sample.wordCount,
        isActive: sample.isActive,
        updatedAt: sample.updatedAt
      }
    }

    return NextResponse.json({
      samples,
      grouped,
      meta: {
        totalCount: samples.length,
        activeCount: samples.filter(s => s.isActive).length,
        jurisdictions: Array.from(new Set(samples.map(s => s.jurisdiction))),
        sections: Array.from(new Set(samples.map(s => s.sectionKey)))
      }
    })
  } catch (error) {
    console.error('[WritingSamples:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/writing-samples
 * Create or update a writing sample
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { jurisdiction, sectionKey, sampleText, notes, isActive } = body

    // Validation
    if (!jurisdiction || !sectionKey || !sampleText) {
      return NextResponse.json({ 
        error: 'jurisdiction, sectionKey, and sampleText are required' 
      }, { status: 400 })
    }

    const normalizedJurisdiction = jurisdiction.toUpperCase()
    
    if (!isValidJurisdiction(normalizedJurisdiction)) {
      return NextResponse.json({ 
        error: 'Invalid jurisdiction. Use "*" for universal or 2-3 letter country code (e.g., "US", "IN", "EP")' 
      }, { status: 400 })
    }

    if (!VALID_SECTION_KEYS.includes(sectionKey)) {
      return NextResponse.json({ 
        error: `Invalid sectionKey. Valid keys: ${VALID_SECTION_KEYS.join(', ')}` 
      }, { status: 400 })
    }

    const trimmedText = sampleText.trim()
    const wordCount = countWords(trimmedText)

    if (wordCount < MIN_WORDS) {
      return NextResponse.json({ 
        error: `Sample too short. Minimum ${MIN_WORDS} words required (currently ${wordCount} words)` 
      }, { status: 400 })
    }

    if (wordCount > MAX_WORDS) {
      return NextResponse.json({ 
        error: `Sample too long. Maximum ${MAX_WORDS} words allowed (currently ${wordCount} words)` 
      }, { status: 400 })
    }

    if (trimmedText.length > MAX_CHARS) {
      return NextResponse.json({ 
        error: `Sample too long. Maximum ${MAX_CHARS} characters allowed` 
      }, { status: 400 })
    }

    // Get personaId from request (optional) - required for the unique constraint
    const { personaId, personaName: providedPersonaName } = body
    const effectivePersonaName = providedPersonaName || 'Default'

    // Upsert the sample - note: unique key includes personaId
    // For samples without a persona (personaId = null), use findFirst
    let existing
    if (personaId) {
      // With persona - use compound unique key
      existing = await prisma.writingSample.findUnique({
        where: {
          userId_jurisdiction_personaId_sectionKey: {
            userId: authResult.user.id,
            jurisdiction: normalizedJurisdiction,
            personaId,
            sectionKey
          }
        }
      })
    } else {
      // Without persona - find any sample without a persona for this user/jurisdiction/section
      existing = await prisma.writingSample.findFirst({
        where: {
          userId: authResult.user.id,
          jurisdiction: normalizedJurisdiction,
          personaId: null,
          sectionKey
        }
      })
    }

    let result
    if (existing) {
      result = await prisma.writingSample.update({
        where: { id: existing.id },
        data: {
          sampleText: trimmedText,
          notes: notes?.trim() || null,
          wordCount,
          personaName: effectivePersonaName,
          isActive: isActive !== undefined ? isActive : true
        }
      })
    } else {
      result = await prisma.writingSample.create({
        data: {
          userId: authResult.user.id,
          tenantId: authResult.user.tenantId || 'default',
          personaId: personaId || null,
          personaName: effectivePersonaName,
          jurisdiction: normalizedJurisdiction,
          sectionKey,
          sampleText: trimmedText,
          notes: notes?.trim() || null,
          wordCount,
          isActive: isActive !== undefined ? isActive : true
        }
      })
    }

    return NextResponse.json({
      success: true,
      sample: result,
      message: `Writing sample ${existing ? 'updated' : 'created'} for ${sectionKey} (${normalizedJurisdiction === '*' ? 'universal' : normalizedJurisdiction})`
    })
  } catch (error) {
    console.error('[WritingSamples:POST] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/writing-samples
 * Delete a writing sample
 * 
 * Query params:
 * - id: sample ID (required)
 * OR
 * - jurisdiction + sectionKey: to delete by composite key
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')

    if (id) {
      // Delete by ID
      const sample = await prisma.writingSample.findFirst({
        where: { id, userId: authResult.user.id }
      })

      if (!sample) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      await prisma.writingSample.delete({ where: { id } })
      return NextResponse.json({ success: true, message: 'Sample deleted' })
    }

    if (jurisdiction && sectionKey) {
      // Delete by composite key
      const normalizedJurisdiction = jurisdiction.toUpperCase()
      
      const deleted = await prisma.writingSample.deleteMany({
        where: {
          userId: authResult.user.id,
          jurisdiction: normalizedJurisdiction,
          sectionKey
        }
      })

      if (deleted.count === 0) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true, message: 'Sample deleted' })
    }

    return NextResponse.json({ 
      error: 'Provide either id or (jurisdiction + sectionKey)' 
    }, { status: 400 })
  } catch (error) {
    console.error('[WritingSamples:DELETE] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/writing-samples
 * Toggle active status or bulk operations
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, id, jurisdiction, sectionKey, isActive } = body

    // Toggle single sample
    if (action === 'toggle' && id) {
      const sample = await prisma.writingSample.findFirst({
        where: { id, userId: authResult.user.id }
      })

      if (!sample) {
        return NextResponse.json({ error: 'Sample not found' }, { status: 404 })
      }

      const updated = await prisma.writingSample.update({
        where: { id },
        data: { isActive: isActive !== undefined ? isActive : !sample.isActive }
      })

      return NextResponse.json({ success: true, sample: updated })
    }

    // Enable/disable all samples for a jurisdiction
    if (action === 'bulk_toggle' && jurisdiction !== undefined) {
      const normalizedJurisdiction = jurisdiction === '*' ? '*' : jurisdiction.toUpperCase()
      
      const updated = await prisma.writingSample.updateMany({
        where: {
          userId: authResult.user.id,
          ...(jurisdiction !== 'all' ? { jurisdiction: normalizedJurisdiction } : {})
        },
        data: { isActive: isActive }
      })

      return NextResponse.json({ 
        success: true, 
        message: `${updated.count} samples ${isActive ? 'enabled' : 'disabled'}` 
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[WritingSamples:PATCH] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

