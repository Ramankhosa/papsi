import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { libraryConnectionService } from '@/lib/services/library-connection-service';
import { isMendeleyConfigured } from '@/lib/library-oauth-config';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const connections = await libraryConnectionService.getActiveConnections(user.id);

    return NextResponse.json({
      connections,
      providers: {
        mendeley: { configured: isMendeleyConfigured() },
        zotero: { configured: true }, // always available (user provides own key)
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load connections' },
      { status: 500 }
    );
  }
}
