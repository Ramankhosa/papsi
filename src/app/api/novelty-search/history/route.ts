import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService } from '@/lib/novelty-search-service';

const noveltySearchService = new NoveltySearchService();

/**
 * GET /api/novelty-search/history
 * Get novelty search history for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

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
    const user = await noveltySearchService.validateUser(jwtToken);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get search history
    const history = await noveltySearchService.getNoveltySearchHistory(user.id, projectId || undefined);

    return NextResponse.json({
      success: true,
      history,
      userStats: {
        totalSearches: user.noveltySearchesCompleted,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Novelty search history API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
