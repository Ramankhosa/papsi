import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags, isFeatureEnabled } from '@/lib/feature-flags';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';
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

async function resolveTenantContext(request: NextRequest, userId: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const tenantContext = await extractTenantContextFromRequest({ headers: { authorization } });
  if (!tenantContext) return null;
  return {
    ...tenantContext,
    userId: tenantContext.userId || userId,
  };
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

    const tenantContext = await resolveTenantContext(request, user.id);
    const result = await deepAnalysisService.getStatus(sessionId, { tenantContext });

    // Auto-trigger background Pass 1 when evidence extraction completes
    if (
      result.status === 'COMPLETED' &&
      isFeatureEnabled('ENABLE_TWO_PASS_GENERATION') &&
      (!session.bgGenStatus || session.bgGenStatus === 'IDLE')
    ) {
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (blueprintReady.ready) {
        paperSectionService.runParallelPass1(sessionId).catch(err => {
          console.error('[DeepAnalysis] Auto-trigger Pass 1 failed:', err);
        });
        (result as any).backgroundGenerationTriggered = true;
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[DeepAnalysis] status error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch deep analysis status' }, { status: 500 });
  }
}
