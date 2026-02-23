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
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';

export const runtime = 'nodejs';

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({ where, select: { id: true, userId: true, tenantId: true, bgGenStatus: true } });
}

async function resolveTenantContext(
  request: NextRequest,
  userId: string,
  tenantId?: string | null
) {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const tenantContext = await extractTenantContextFromRequest({ headers: { authorization } });
    if (tenantContext) {
      return {
        ...tenantContext,
        userId: tenantContext.userId || userId,
      };
    }
  }

  if (!tenantId) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });

  if (tenant && tenant.status === 'ACTIVE' && tenant.tenantPlans[0]) {
    return {
      tenantId: tenant.id,
      planId: tenant.tenantPlans[0].planId,
      tenantStatus: tenant.status,
      userId,
    };
  }

  return null;
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
    const tenantContext = await resolveTenantContext(request, user.id, session.tenantId);
    if (!tenantContext) {
      return NextResponse.json({ error: 'Unable to resolve tenant context' }, { status: 400 });
    }

    let requestBody: Record<string, unknown> | null = null;
    try {
      requestBody = await request.json();
    } catch {
      requestBody = null;
    }

    const forceFromQuery = request.nextUrl.searchParams.get('force');
    const retryFailedOnlyFromQuery = request.nextUrl.searchParams.get('retryFailedOnly');
    const forceRerun = parseBooleanFlag(forceFromQuery) || parseBooleanFlag(requestBody?.force);
    const retryFailedOnly = parseBooleanFlag(retryFailedOnlyFromQuery) || parseBooleanFlag(requestBody?.retryFailedOnly);

    let sectionKeys: string[] | undefined;
    if (retryFailedOnly) {
      const bgStatus = await paperSectionService.getBackgroundGenStatus(sessionId);
      const sectionStateMap = bgStatus.progress?.sections || {};
      sectionKeys = Object.entries(sectionStateMap)
        .filter(([, state]) => state === 'failed')
        .map(([sectionKey]) => sectionKey)
        .filter(Boolean);

      if (!sectionKeys.length) {
        return NextResponse.json(
          {
            success: false,
            error: 'No failed sections found to retry',
            retryFailedOnly: true,
          },
          { status: 400 }
        );
      }
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
    paperSectionService.runParallelPass1(sessionId, tenantContext, {
      forceRerun,
      sectionKeys
    }).catch(err => {
      console.error('[Prepare] Background Pass 1 failed:', err);
    });

    return NextResponse.json({
      success: true,
      message: retryFailedOnly
        ? `Retrying ${sectionKeys?.length || 0} failed section(s)`
        : forceRerun
          ? 'Background section preparation rerun started'
          : 'Background section preparation started',
      status: 'RUNNING',
      forced: forceRerun,
      retryFailedOnly,
      targetedSections: sectionKeys || null,
    });
  } catch (err) {
    console.error('[Prepare] POST error:', err);
    return NextResponse.json({ error: 'Failed to start preparation' }, { status: 500 });
  }
}
