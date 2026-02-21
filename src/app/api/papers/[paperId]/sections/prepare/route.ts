/**
 * Section Prepare API — Background Pass 1 Generation
 *
 * POST: Trigger parallel Pass 1 for all sections (auto-fired after evidence extraction)
 * GET:  Poll background generation status
 *
 * Pass 1 generates evidence-grounded drafts with [CITE:key] anchors preserved.
 * When the user navigates to section drafting, Pass 2 (polish) runs on demand.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperSectionService } from '@/lib/services/paper-section-service';
import { isFeatureEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({ where, select: { id: true, userId: true, bgGenStatus: true } });
}

// ============================================================================
// GET — Poll background generation status
// ============================================================================

export async function GET(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const bgStatus = await paperSectionService.getBackgroundGenStatus(sessionId);
    return NextResponse.json({ success: true, ...bgStatus });
  } catch (err) {
    console.error('[Prepare] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch preparation status' }, { status: 500 });
  }
}

// ============================================================================
// POST — Trigger parallel Pass 1
// ============================================================================

export async function POST(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    if (!isFeatureEnabled('ENABLE_TWO_PASS_GENERATION')) {
      return NextResponse.json({ error: 'Two-pass generation is not enabled' }, { status: 403 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Prevent duplicate runs
    if (session.bgGenStatus === 'RUNNING') {
      const bgStatus = await paperSectionService.getBackgroundGenStatus(sessionId);
      return NextResponse.json({
        success: true,
        message: 'Background generation already in progress',
        ...bgStatus
      });
    }

    // Fire-and-forget: start the parallel Pass 1 run and return immediately
    // so the UI gets an instant response while generation runs in background
    paperSectionService.runParallelPass1(sessionId).catch(err => {
      console.error('[Prepare] Background Pass 1 failed:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Background section preparation started',
      status: 'RUNNING',
    });
  } catch (err) {
    console.error('[Prepare] POST error:', err);
    return NextResponse.json({ error: 'Failed to start preparation' }, { status: 500 });
  }
}
