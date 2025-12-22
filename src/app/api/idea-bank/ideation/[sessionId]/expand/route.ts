/**
 * Expand Node API Route
 *
 * POST - Expand a dimension node and return only the new nodes/edges added
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
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
    const { action, nodeId } = body;

    if (action !== 'expand') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Get the current session to check ownership
    const session = await IdeationService.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Expand the node and get the new graph data
    const graphData = await IdeationService.expandDimensionNode({
      sessionId,
      nodeId,
      requestHeaders,
    });

    // Transform the returned nodes and edges for React Flow format
    const nodes = graphData.nodes.map(node => ({
      id: node.id,
      type: node.type,
      position: { x: node.positionX || 0, y: node.positionY || 0 },
      data: {
        dbId: node.id,
        title: node.title,
        description: node.descriptionShort || node.description,
        family: node.family,
        tags: node.tags,
        state: node.state,
        selectable: node.selectable,
        depth: node.depth,
        parentId: node.parentId,
        payload: node.payloadJson,
        type: node.type, // Include type for DimensionNode logic
      },
    }));

    const edges = graphData.edges.map(edge => ({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: '',
      animated: false,
      data: { relation: edge.relation },
    }));

    return NextResponse.json({
      success: true,
      graph: { nodes, edges },
      message: `Expanded ${graphData.nodes.length} nodes and ${graphData.edges.length} edges`,
    });
  } catch (error: any) {
    console.error('Failed to expand node:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to expand node' },
      { status: 500 }
    );
  }
}