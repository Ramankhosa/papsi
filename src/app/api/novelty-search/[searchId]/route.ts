import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService } from '@/lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const noveltySearchService = new NoveltySearchService();

/**
 * GET /api/novelty-search/[searchId]
 * Get novelty search status and results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Validate user from JWT token
    const payload = verifyJWT(jwtToken);
    if (!payload || !payload.sub) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user.id;

    // Get novelty search with all related data
    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: {
        id: searchId,
        userId: userId
      },
      include: {
        llmCalls: {
          orderBy: { calledAt: 'desc' },
          take: 10 // Last 10 LLM calls
        }
      }
    });

    if (!searchRun) {
      return NextResponse.json(
        { error: 'Novelty search not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      search: {
        id: searchRun.id,
        title: searchRun.title,
        status: searchRun.status,
        currentStage: searchRun.currentStage,
        jurisdiction: searchRun.jurisdiction,
        filingType: searchRun.filingType,
        createdAt: searchRun.createdAt,
        stage0CompletedAt: searchRun.stage0CompletedAt,
        stage1CompletedAt: searchRun.stage1CompletedAt,
        stage35CompletedAt: searchRun.stage35CompletedAt,
        stage4CompletedAt: searchRun.stage4CompletedAt,
        reportUrl: searchRun.reportUrl,
        results: {
          stage0: searchRun.stage0Results,
          stage1: searchRun.stage1Results,
          stage35: searchRun.stage35Results,
          stage4: searchRun.stage4Results
        },
        recentActivity: searchRun.llmCalls.map(call => ({
          stage: call.stage,
          taskCode: call.taskCode,
          tokensUsed: call.tokensUsed,
          calledAt: call.calledAt
        }))
      }
    });

  } catch (error) {
    console.error('Get novelty search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/novelty-search/[searchId]/resume
 * Resume a failed novelty search from the last completed stage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Validate user from JWT token
    const payload = verifyJWT(jwtToken);
    if (!payload || !payload.sub) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user.id;

    // Extract request headers for LLM gateway
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Resume the search
    const result = await noveltySearchService.resumeNoveltySearch(searchId, userId, requestHeaders);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      searchId,
      status: result.status,
      currentStage: result.currentStage,
      results: result.results,
      message: 'Search resumed successfully'
    });

  } catch (error) {
    console.error('Resume search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/novelty-search/[searchId]
 * Update novelty search stage data (e.g., edit Stage 0 results)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Validate user from JWT token
    const payload = verifyJWT(jwtToken);
    if (!payload || !payload.sub) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user.id;

    // Parse request body
    const body = await request.json();
    const { stage, searchQuery, inventionFeatures } = body;

    console.log('🔄 PATCH API called with:', {
      searchId,
      stage,
      searchQuery,
      inventionFeatures
    });

    // Update the novelty search run with edited data
    if (stage === 'stage0') {
      console.log('💾 Updating database with stage0Results...');
      const updatedRecord = await prisma.noveltySearchRun.update({
        where: {
          id: searchId,
          userId: userId
        },
        data: {
          stage0Results: {
            searchQuery: searchQuery,
            inventionFeatures: inventionFeatures
          }
        }
      });
      console.log('✅ Database update successful:', {
        id: updatedRecord.id,
        stage0Results: updatedRecord.stage0Results
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Stage 0 data updated successfully'
    });

  } catch (error) {
    console.error('PATCH /api/novelty-search/[searchId] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

