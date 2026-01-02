/**
 * API Routes for User Section Instructions
 * 
 * Allows users to save section-specific instructions that are applied
 * during paper generation. Supports both:
 * - Session-level instructions (specific to this paper)
 * - User-level instructions (persistent across papers)
 */

import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

// ============================================================================
// Validation Schemas
// ============================================================================

const upsertInstructionSchema = z.object({
  sectionKey: z.string().min(1).max(50),
  paperTypeCode: z.string().max(50).optional(), // e.g., "JOURNAL_ARTICLE", "CONFERENCE_PAPER", "*" for all
  instruction: z.string().min(1).max(5000),
  emphasis: z.string().max(2000).optional(),
  avoid: z.string().max(2000).optional(),
  style: z.enum(['formal', 'technical', 'concise', 'detailed', 'narrative']).optional(),
  wordCount: z.number().int().min(50).max(10000).optional(),
  scope: z.enum(['session', 'user']).default('session') // session = this paper only, user = all papers
});

const deleteInstructionSchema = z.object({
  sectionKey: z.string().min(1),
  paperTypeCode: z.string().max(50).optional(),
  scope: z.enum(['session', 'user']).default('session')
});

// ============================================================================
// GET - Fetch all section instructions for this session/user
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paperId } = await params;

    // Verify session ownership
    const draftingSession = await prisma.draftingSession.findUnique({
      where: { id: paperId },
      select: { userId: true }
    });

    if (!draftingSession || draftingSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Fetch session-level instructions
    const sessionInstructions = await prisma.userSectionInstruction.findMany({
      where: {
        userId: session.user.id,
        sessionId: paperId,
        isActive: true
      },
      orderBy: { sectionKey: 'asc' }
    });

    // Fetch user-level (persistent) instructions
    const userInstructions = await prisma.userSectionInstruction.findMany({
      where: {
        userId: session.user.id,
        sessionId: null,
        isActive: true
      },
      orderBy: { sectionKey: 'asc' }
    });

    return NextResponse.json({
      success: true,
      sessionInstructions: sessionInstructions.map(i => ({
        id: i.id,
        sectionKey: i.sectionKey,
        paperTypeCode: i.paperTypeCode || '*',
        instruction: i.instruction,
        emphasis: i.emphasis,
        avoid: i.avoid,
        style: i.style,
        wordCount: i.wordCount,
        scope: 'session'
      })),
      userInstructions: userInstructions.map(i => ({
        id: i.id,
        sectionKey: i.sectionKey,
        paperTypeCode: i.paperTypeCode || '*',
        instruction: i.instruction,
        emphasis: i.emphasis,
        avoid: i.avoid,
        style: i.style,
        wordCount: i.wordCount,
        scope: 'user'
      }))
    });

  } catch (error) {
    console.error('GET section-instructions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch section instructions' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create or update a section instruction
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paperId } = await params;
    const body = await request.json();

    // Validate input
    const validation = upsertInstructionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { sectionKey, paperTypeCode, instruction, emphasis, avoid, style, wordCount, scope } = validation.data;

    // Verify session ownership and get paper type
    // Note: Cannot use both select and include in Prisma - use select with nested relation
    const draftingSession = await prisma.draftingSession.findUnique({
      where: { id: paperId },
      select: { 
        userId: true, 
        paperTypeId: true,
        paperType: { select: { code: true } }
      }
    });

    if (!draftingSession || draftingSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Determine sessionId and paperTypeCode based on scope
    const targetSessionId = scope === 'session' ? paperId : null;
    // Use provided paperTypeCode, or session's paper type, or '*' for universal
    const targetPaperTypeCode = paperTypeCode || draftingSession.paperType?.code || '*';

    // Upsert the instruction
    const result = await prisma.userSectionInstruction.upsert({
      where: {
        userId_sessionId_jurisdiction_sectionKey: {
          userId: session.user.id,
          sessionId: targetSessionId,
          jurisdiction: '*', // Legacy field, kept for backward compat
          sectionKey
        }
      },
      update: {
        instruction,
        paperTypeCode: targetPaperTypeCode,
        emphasis: emphasis || null,
        avoid: avoid || null,
        style: style || null,
        wordCount: wordCount || null,
        isActive: true,
        updatedAt: new Date()
      },
      create: {
        userId: session.user.id,
        sessionId: targetSessionId,
        jurisdiction: '*',
        paperTypeCode: targetPaperTypeCode,
        sectionKey,
        instruction,
        emphasis: emphasis || null,
        avoid: avoid || null,
        style: style || null,
        wordCount: wordCount || null,
        isActive: true
      }
    });

    return NextResponse.json({
      success: true,
      instruction: {
        id: result.id,
        sectionKey: result.sectionKey,
        paperTypeCode: result.paperTypeCode,
        instruction: result.instruction,
        emphasis: result.emphasis,
        avoid: result.avoid,
        style: result.style,
        wordCount: result.wordCount,
        scope
      }
    });

  } catch (error) {
    console.error('POST section-instructions error:', error);
    return NextResponse.json(
      { error: 'Failed to save section instruction' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Remove a section instruction
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { paperId } = await params;
    const body = await request.json();

    // Validate input
    const validation = deleteInstructionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.errors },
        { status: 400 }
      );
    }

    const { sectionKey, scope } = validation.data;

    // Verify session ownership
    const draftingSession = await prisma.draftingSession.findUnique({
      where: { id: paperId },
      select: { userId: true }
    });

    if (!draftingSession || draftingSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Determine sessionId based on scope
    const targetSessionId = scope === 'session' ? paperId : null;

    // Soft delete (set isActive = false)
    await prisma.userSectionInstruction.updateMany({
      where: {
        userId: session.user.id,
        sessionId: targetSessionId,
        jurisdiction: '*',
        sectionKey
      },
      data: {
        isActive: false,
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: `Instruction for ${sectionKey} removed`
    });

  } catch (error) {
    console.error('DELETE section-instructions error:', error);
    return NextResponse.json(
      { error: 'Failed to delete section instruction' },
      { status: 500 }
    );
  }
}

