import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import {
  getUserInstruction,
  getAllUserInstructions,
  deleteUserInstruction,
  deactivateUserInstruction,
  invalidateSessionInstructionCache,
  cloneInstructionsBetweenSessions
} from '@/lib/user-instruction-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/patents/[patentId]/drafting/user-instructions
 * Get user instructions for a session
 * 
 * Query params:
 * - sessionId: required
 * - jurisdiction: optional (filter by jurisdiction)
 * - sectionKey: optional (get specific section)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    // Verify session belongs to user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId: params.patentId,
        userId: authResult.user.id
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Get specific section instruction
    if (sectionKey) {
      const instruction = await getUserInstruction(sessionId, sectionKey, jurisdiction || undefined)
      return NextResponse.json({ instruction })
    }

    // Get all instructions for session
    let instructions = await getAllUserInstructions(sessionId, jurisdiction || undefined)

    // If none exist for this session, attempt to clone from the latest prior session for this patent/user
    if (!instructions.length) {
      const fallbackSession = await prisma.draftingSession.findFirst({
        where: {
          patentId: params.patentId,
          userId: authResult.user.id,
          NOT: { id: sessionId },
          userSectionInstructions: { some: {} }
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      })

      if (fallbackSession?.id) {
        const copied = await cloneInstructionsBetweenSessions(fallbackSession.id, sessionId)
        if (copied > 0) {
          instructions = await getAllUserInstructions(sessionId, jurisdiction || undefined)
          console.log(`[UserInstructions:GET] Auto-copied ${copied} instructions from ${fallbackSession.id} to ${sessionId}`)
        }
      }
    }
    
    // Group by jurisdiction for easier frontend use
    const grouped: Record<string, Record<string, any>> = {}
    for (const instr of instructions) {
      if (!grouped[instr.jurisdiction]) {
        grouped[instr.jurisdiction] = {}
      }
      grouped[instr.jurisdiction][instr.sectionKey] = {
        id: instr.id,
        instruction: instr.instruction,
        emphasis: instr.emphasis,
        avoid: instr.avoid,
        style: instr.style,
        wordCount: instr.wordCount,
        isActive: instr.isActive,
        updatedAt: instr.updatedAt
      }
    }

    return NextResponse.json({ 
      instructions,
      grouped,
      sessionId,
      jurisdiction: jurisdiction || 'all'
    })
  } catch (error) {
    console.error('[UserInstructions:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/patents/[patentId]/drafting/user-instructions
 * Create or update user instruction
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sessionId, jurisdiction, sectionKey, instruction, emphasis, avoid, style, wordCount, isActive } = body

    if (!sessionId || !sectionKey) {
      return NextResponse.json({ error: 'sessionId and sectionKey required' }, { status: 400 })
    }

    // Word limit validation (50 words max)
    const MAX_WORDS = 50
    const wordCount_instructions = (instruction || '').trim().split(/\s+/).filter((w: string) => w.length > 0).length
    if (wordCount_instructions > MAX_WORDS) {
      return NextResponse.json({ 
        error: `Instruction exceeds ${MAX_WORDS} word limit (${wordCount_instructions} words)` 
      }, { status: 400 })
    }

    // Verify session belongs to user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId: params.patentId,
        userId: authResult.user.id
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Check if we need to update isActive for an existing record
    const jurisdictionCode = (jurisdiction || '*').toUpperCase()
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId,
        jurisdiction: jurisdictionCode,
        sectionKey
      }
    })

    let result
    if (existing) {
      // Update existing - include isActive if provided
      result = await prisma.userSectionInstruction.update({
        where: { id: existing.id },
        data: {
          instruction: instruction || existing.instruction,
          emphasis: emphasis !== undefined ? emphasis : existing.emphasis,
          avoid: avoid !== undefined ? avoid : existing.avoid,
          style: style !== undefined ? style : existing.style,
          wordCount: wordCount !== undefined ? wordCount : existing.wordCount,
          isActive: isActive !== undefined ? isActive : existing.isActive
        }
      })
    } else {
      // Create new
      result = await prisma.userSectionInstruction.create({
        data: {
          sessionId,
          jurisdiction: jurisdictionCode,
          sectionKey,
          instruction: instruction || '',
          emphasis: emphasis || null,
          avoid: avoid || null,
          style: style || null,
          wordCount: wordCount || null,
          isActive: isActive !== undefined ? isActive : true
        }
      })
    }

    // Invalidate cache
    invalidateSessionInstructionCache(sessionId)

    return NextResponse.json({ 
      success: true, 
      instruction: result,
      message: `Instruction saved for ${sectionKey}${jurisdiction && jurisdiction !== '*' ? ` (${jurisdiction})` : ' (all jurisdictions)'}`
    })
  } catch (error) {
    console.error('[UserInstructions:POST] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/patents/[patentId]/drafting/user-instructions
 * Delete or deactivate user instruction
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    const instructionId = url.searchParams.get('id')
    const sectionKey = url.searchParams.get('sectionKey')
    const jurisdiction = url.searchParams.get('jurisdiction')

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    // Verify session belongs to user
    const session = await prisma.draftingSession.findFirst({
      where: {
        id: sessionId,
        patentId: params.patentId,
        userId: authResult.user.id
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Delete by ID
    if (instructionId) {
      await deleteUserInstruction(instructionId)
      return NextResponse.json({ success: true, message: 'Instruction deleted' })
    }

    // Deactivate by section key
    if (sectionKey) {
      await deactivateUserInstruction(sessionId, sectionKey)
      return NextResponse.json({ success: true, message: `Instruction deactivated for ${sectionKey}` })
    }

    return NextResponse.json({ error: 'id or sectionKey required' }, { status: 400 })
  } catch (error) {
    console.error('[UserInstructions:DELETE] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

