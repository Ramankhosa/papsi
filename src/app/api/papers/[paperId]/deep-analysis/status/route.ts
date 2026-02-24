import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags, isFeatureEnabled } from '@/lib/feature-flags';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';
import { MAX_DEEP_ANALYSIS_CONCURRENCY } from '@/lib/services/deep-analysis-types';
import { paperSectionService } from '@/lib/services/paper-section-service';
import { blueprintService } from '@/lib/services/blueprint-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, tenantId: true, bgGenStatus: true },
    });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true, tenantId: true, bgGenStatus: true },
  });
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

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
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
    const result = await deepAnalysisService.getStatus(sessionId, {
      tenantContext,
      concurrency: MAX_DEEP_ANALYSIS_CONCURRENCY
    });

    // Auto-trigger background Pass 1 when evidence extraction reaches a terminal state
    const deepAnalysisTerminal =
      result.totalJobs > 0 &&
      result.inProgress === 0 &&
      (result.status === 'COMPLETED' || result.status === 'PARTIAL');
    const bgAutoTriggerEligible =
      !session.bgGenStatus || ['IDLE', 'FAILED', 'PARTIAL'].includes(session.bgGenStatus);

    if (
      deepAnalysisTerminal &&
      isFeatureEnabled('ENABLE_TWO_PASS_GENERATION') &&
      bgAutoTriggerEligible
    ) {
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (blueprintReady.ready) {
        if (!tenantContext) {
          console.warn('[DeepAnalysis] Auto-trigger Pass 1 skipped: tenant context unavailable');
          (result as any).backgroundGenerationTriggerSkipped = 'missing_tenant_context';
        } else {
          paperSectionService.runParallelPass1(sessionId, tenantContext).catch(err => {
            console.error('[DeepAnalysis] Auto-trigger Pass 1 failed:', err);
          });
          (result as any).backgroundGenerationTriggered = true;
        }
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[DeepAnalysis] status error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch deep analysis status' }, { status: 500 });
  }
}
