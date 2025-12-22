/**
 * Expand Dimensions API
 * 
 * POST - Initialize or expand dimension nodes
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { nodeId, action } = body;

    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, status: true, classificationJson: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!ideationSession.classificationJson) {
      return NextResponse.json(
        { error: 'Session must be classified first' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Initialize dimensions (first expansion)
    if (action === 'initialize') {
      const nodes = await IdeationService.initializeDimensions(sessionId);
      
      return NextResponse.json({
        success: true,
        nodes: nodes.map(n => ({
          id: n.nodeId,
          type: n.type,
          title: n.title,
          description: n.description,
          family: n.family,
          state: n.state,
          position: { x: n.positionX, y: n.positionY },
        })),
      });
    }

    // Expand specific node
    if (action === 'expand' && nodeId) {
      const graph = await IdeationService.expandDimensionNode({
        sessionId,
        nodeId,
        requestHeaders,
      });

      return NextResponse.json({
        success: true,
        graph,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "initialize" or "expand" with nodeId' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to expand dimensions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to expand' },
      { status: 500 }
    );
  }
}

