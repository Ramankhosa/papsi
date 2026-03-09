/**
 * Paper Sketch Generation API Route
 * 
 * Handles AI-powered sketch generation for research paper figures.
 * Supports three modes: SUGGEST (AI-driven), GUIDED (user-directed), REFINE (from image)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generatePaperSketch, modifyPaperSketch, PaperSketchMode } from '@/lib/figure-generation/paper-sketch-service'

// Schema for sketch generation request
const sketchGenerateSchema = z.object({
  mode: z.enum(['SUGGEST', 'GUIDED', 'REFINE']),
  title: z.string().optional(),
  userPrompt: z.string().optional(),
  illustrationSpecV2: z.object({
    layout: z.enum(['PANELS', 'STRIP']).optional(),
    panelCount: z.number().int().min(1).max(8).optional(),
    stepCount: z.number().int().min(1).max(10).optional(),
    flowDirection: z.enum(['LR', 'TD']).optional(),
    panels: z.array(z.object({
      idHint: z.string(),
      title: z.string(),
      elements: z.array(z.string()).optional()
    })).optional(),
    elements: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
    captionDraft: z.string().optional(),
    splitSuggestion: z.string().optional(),
    figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
    renderDirectives: z.any().optional(),
    actors: z.array(z.string()).optional(),
    props: z.array(z.string()).optional(),
    forbiddenElements: z.array(z.string()).optional()
  }).optional(),
  figureGenre: z.enum(['METHOD_BLOCK', 'SCENARIO_STORYBOARD', 'CONCEPTUAL_FRAMEWORK', 'GRAPHICAL_ABSTRACT', 'NEURAL_ARCHITECTURE', 'EXPERIMENTAL_SETUP', 'DATA_PIPELINE', 'COMPARISON_MATRIX', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']).optional(),
  renderDirectives: z.any().optional(),
  uploadedImageBase64: z.string().optional(),
  uploadedImageMimeType: z.string().optional(),
  modificationRequest: z.string().optional(),
  style: z.enum(['academic', 'scientific', 'conceptual', 'technical']).optional()
})

// Schema for sketch modification request
const sketchModifySchema = z.object({
  modificationRequest: z.string().min(1, 'Modification request is required')
})

/**
 * POST - Generate a new sketch or update existing figure with sketch
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const params = await context.params
    const { paperId, figureId } = params
    
    // Get auth token
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate body
    const body = await request.json()
    const validation = sketchGenerateSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const data = validation.data
    
    // Validate REFINE mode has image
    if (data.mode === 'REFINE' && !data.uploadedImageBase64) {
      return NextResponse.json(
        { error: 'REFINE mode requires an uploaded image' },
        { status: 400 }
      )
    }

    // Validate GUIDED mode has prompt
    if (data.mode === 'GUIDED' && (!data.userPrompt || data.userPrompt.length < 10)) {
      return NextResponse.json(
        { error: 'GUIDED mode requires at least 10 characters of instructions' },
        { status: 400 }
      )
    }

    // Generate sketch
    // Note: figureId can be 'new' for creating a new figure
    const isNewFigure = figureId === 'new'
    
    const result = await generatePaperSketch({
      paperId,
      sessionId: paperId, // In paper context, paperId is the sessionId
      figureId: isNewFigure ? undefined : figureId,
      mode: data.mode as PaperSketchMode,
      title: data.title,
      userPrompt: data.userPrompt,
      illustrationSpecV2: data.illustrationSpecV2,
      figureGenre: data.figureGenre || data.illustrationSpecV2?.figureGenre,
      renderDirectives: data.renderDirectives || data.illustrationSpecV2?.renderDirectives,
      uploadedImageBase64: data.uploadedImageBase64,
      uploadedImageMimeType: data.uploadedImageMimeType,
      modificationRequest: data.modificationRequest,
      style: data.style
    }, 'system', undefined)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      figureId: result.figureId,
      imagePath: result.imagePath
    })

  } catch (error: any) {
    console.error('[PaperSketchAPI] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH - Modify an existing sketch with user feedback
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ paperId: string; figureId: string }> }
) {
  try {
    const params = await context.params
    const { figureId } = params
    
    // Get auth token
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate body
    const body = await request.json()
    const validation = sketchModifySchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { modificationRequest } = validation.data

    // Modify existing sketch
    const result = await modifyPaperSketch(
      figureId,
      modificationRequest,
      'system',
      undefined
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      figureId: result.figureId,
      imagePath: result.imagePath
    })

  } catch (error: any) {
    console.error('[PaperSketchAPI] Modify error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

