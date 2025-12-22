/**
 * Generate Ideas API
 * 
 * POST - Generate idea frames from the combine tray
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
    
    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      include: { combineTray: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Use tray from request or database
    const recipe = body.recipe || {
      selectedComponents: ideationSession.combineTray?.selectedComponents || [],
      selectedDimensions: ideationSession.combineTray?.selectedDimensions || [],
      selectedOperators: ideationSession.combineTray?.selectedOperators || [],
      recipeIntent: body.intent || ideationSession.combineTray?.recipeIntent || 'DIVERGENT',
      count: body.count || ideationSession.combineTray?.requestedCount || 5,
    };

    // Validate minimum selections
    const totalSelections = 
      recipe.selectedComponents.length + 
      recipe.selectedDimensions.length + 
      recipe.selectedOperators.length;

    if (totalSelections === 0) {
      return NextResponse.json(
        { error: 'Select at least one component, dimension, or operator' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const ideas = await IdeationService.generateIdeas({
      sessionId,
      recipe,
      requestHeaders,
    });

    return NextResponse.json({
      success: true,
      ideas: ideas.map(idea => ({
        ideaId: idea.ideaId,
        title: idea.title,
        problem: idea.problem,
        principle: idea.principle,
        technicalEffect: idea.technicalEffect,
        components: idea.components,
        mechanismSteps: idea.mechanismSteps,
        variants: idea.variants,
        claimHooks: idea.claimHooks,
        searchQueries: idea.searchQueries,
      })),
      count: ideas.length,
    });
  } catch (error) {
    console.error('Failed to generate ideas:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate ideas' },
      { status: 500 }
    );
  }
}

