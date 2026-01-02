/**
 * Paper Sketch Generation Service
 * 
 * Handles AI-powered sketch/illustration generation for research paper figures
 * using Gemini image generation models.
 * 
 * Supports three modes:
 * - SUGGEST: AI generates based on paper context (abstract, sections)
 * - GUIDED: User provides specific instructions
 * - REFINE: User uploads an image (hand-drawn or existing) for AI refinement
 * 
 * Adapted from the patent sketch service for research paper needs.
 */

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { resolveModel } from '@/lib/metering/model-resolver'
import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'

// Types
export type PaperSketchMode = 'SUGGEST' | 'GUIDED' | 'REFINE'
export type PaperSketchStatus = 'PENDING' | 'SUCCESS' | 'FAILED'

export interface PaperSketchRequest {
  paperId: string
  sessionId: string
  figureId?: string // Existing figure plan to update
  mode: PaperSketchMode
  title?: string
  userPrompt?: string
  uploadedImageBase64?: string
  uploadedImageMimeType?: string
  sourceSketchId?: string // For modification chains
  modificationRequest?: string // User's modification feedback
  style?: 'academic' | 'scientific' | 'conceptual' | 'technical'
}

export interface PaperSketchContextBundle {
  paperTitle: string
  abstract: string
  sectionContent: string
  methodology: string
  keywords: string[]
  figureContext?: string // Existing figure description if modifying
}

export interface PaperSketchResult {
  success: boolean
  figureId?: string
  imagePath?: string
  error?: string
  attemptCount?: number
}

// Constants
const SKETCH_UPLOAD_DIR = 'public/uploads/paper-sketches'
const MAX_MODIFY_ATTEMPTS = 10
const SKETCH_STAGE_CODE = 'PAPER_SKETCH_GENERATION'
const SKETCH_TASK_CODE: TaskCode = 'LLM3_DIAGRAM'

/**
 * Get active plan ID for tenant
 */
async function getActivePlanIdForTenant(tenantId?: string | null): Promise<string | null> {
  if (!tenantId) return null
  const now = new Date()
  const plan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { planId: true }
  })
  return plan?.planId || null
}

/**
 * Resolve sketch model from database configuration
 */
async function resolveSketchModelCandidates(tenantId?: string | null): Promise<string[]> {
  const candidates: string[] = []

  try {
    const planId = await getActivePlanIdForTenant(tenantId)
    if (planId) {
      console.log(`[PaperSketchService] Resolving model for planId=${planId}, stage=${SKETCH_STAGE_CODE}`)
      const resolved = await resolveModel(planId, SKETCH_TASK_CODE, SKETCH_STAGE_CODE)
      
      if (resolved?.modelCode) {
        console.log(`[PaperSketchService] Model resolved: ${resolved.modelCode}`)
        candidates.push(resolved.modelCode)
        
        if (resolved.fallbacks && resolved.fallbacks.length > 0) {
          resolved.fallbacks.forEach(fb => {
            if (fb?.modelCode) candidates.push(fb.modelCode)
          })
        }
      }
    }
  } catch (e) {
    console.error('[PaperSketchService] Model resolution failed:', e instanceof Error ? e.message : e)
  }

  // Fallback to environment variable for development
  const envModel = process.env.GEMINI_SKETCH_MODEL
  if (envModel && !candidates.includes(envModel)) {
    candidates.push(envModel)
  }

  // Default fallback - use Gemini image generation model
  // Note: Must use gemini-3-pro-image-preview which supports image OUTPUT
  if (candidates.length === 0) {
    candidates.push('gemini-3-pro-image-preview')
  }

  return candidates
}

/**
 * Build context bundle from paper data
 * Uses DraftingSession and ResearchTopic models
 */
async function buildPaperContextBundle(
  paperId: string,
  sessionId: string
): Promise<PaperSketchContextBundle> {
  // Defensive check for prisma
  if (!prisma || !prisma.draftingSession) {
    console.error('[PaperSketchService] Prisma client not initialized')
    return {
      paperTitle: 'Research Paper',
      abstract: '',
      sectionContent: '',
      methodology: '',
      keywords: []
    }
  }

  try {
    // Get session with research topic data
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      include: {
        researchTopic: true
      }
    })

    const researchTopic = session?.researchTopic
    
    // Extract relevant content for context
    const sections: string[] = []
    const methodology: string[] = []
    const keywords: string[] = researchTopic?.keywords || []
    
    // Add research question if available
    if (researchTopic?.researchQuestion) {
      sections.push(`Research Question: ${researchTopic.researchQuestion}`)
    }
    
    // Add hypothesis if available
    if (researchTopic?.hypothesis) {
      sections.push(`Hypothesis: ${researchTopic.hypothesis}`)
    }
    
    // Add methodology from research topic
    if (researchTopic?.methodology) {
      methodology.push(`Methodology: ${researchTopic.methodology}`)
    }
    
    // Add dataset description if available
    if (researchTopic?.datasetDescription) {
      sections.push(`Dataset: ${researchTopic.datasetDescription}`)
    }

    return {
      paperTitle: researchTopic?.title || 'Research Paper',
      abstract: researchTopic?.abstractDraft || '',
      sectionContent: sections.join('\n\n'),
      methodology: methodology.join('\n'),
      keywords
    }
  } catch (err) {
    console.error('[PaperSketchService] Failed to build context:', err)
    return {
      paperTitle: 'Research Paper',
      abstract: '',
      sectionContent: '',
      methodology: '',
      keywords: []
    }
  }
}

/**
 * Build system prompt for academic illustrations
 */
function buildSystemPrompt(style: string = 'academic'): string {
  const styleGuides: Record<string, string> = {
    academic: `
Create a professional academic illustration suitable for publication in a research paper.
- Use clean, simple lines with high contrast
- Avoid unnecessary decoration or embellishment
- Labels should be clear and legible
- Use a white or light background
- Arrows and connectors should be precise
- Maintain professional, scholarly appearance
    `.trim(),
    scientific: `
Create a scientific diagram with technical precision.
- Use standard scientific notation and symbols
- Include measurement scales where appropriate
- Use consistent line weights
- Employ standard scientific color coding if colors are needed
- Ensure all elements are clearly labeled
- Follow scientific illustration conventions
    `.trim(),
    conceptual: `
Create a conceptual illustration that explains abstract ideas visually.
- Use metaphorical representations where appropriate
- Employ visual hierarchy to guide understanding
- Use simple shapes and clear relationships
- Include minimal text, let visuals communicate
- Create a balanced, easy-to-understand composition
    `.trim(),
    technical: `
Create a technical diagram with engineering precision.
- Use technical drawing conventions
- Include dimensions and specifications where relevant
- Use cross-sections or exploded views if helpful
- Follow technical illustration standards
- Ensure accuracy and clarity of all elements
    `.trim()
  }

  return `You are an expert academic illustrator creating figures for research papers.

${styleGuides[style] || styleGuides.academic}

IMPORTANT GUIDELINES:
1. Generate ONLY the image - no explanatory text in the response
2. The illustration should be self-explanatory
3. Use high resolution and clear lines
4. Ensure the figure would be suitable for academic publication
5. Do NOT include watermarks, signatures, or AI-generated labels like "Generated by..."
6. Do NOT add figure numbers like "Figure 1", "Fig. 1", "Figure:", etc. - the numbering will be added separately
7. Do NOT include any title text or caption overlaid on the image itself
`
}

/**
 * Build prompt for SUGGEST mode (AI-driven based on context)
 */
function buildSuggestModePrompt(context: PaperSketchContextBundle, title?: string): string {
  return `
Based on this research paper context, create an appropriate academic illustration:

PAPER TITLE: ${context.paperTitle}

ABSTRACT:
${context.abstract || 'Not provided'}

METHODOLOGY:
${context.methodology || 'Not provided'}

KEY CONTENT:
${context.sectionContent || 'Not provided'}

${title ? `FIGURE TITLE/FOCUS: ${title}` : ''}

Create a clear, professional academic illustration that:
1. Visualizes a key concept, process, or finding from this research
2. Would enhance reader understanding
3. Is suitable for academic publication
4. Uses appropriate visual conventions for the field
5. Does NOT include any figure numbers (like "Figure 1" or "Fig. 1") - leave numbering out
6. Does NOT overlay any title or caption text on the image
`.trim()
}

/**
 * Build prompt for GUIDED mode (user-directed)
 */
function buildGuidedModePrompt(
  context: PaperSketchContextBundle,
  userPrompt: string,
  title?: string
): string {
  return `
Create an academic illustration based on these specifications:

USER REQUEST:
${userPrompt}

${title ? `FIGURE TITLE: ${title}` : ''}

PAPER CONTEXT (for reference):
- Paper: ${context.paperTitle}
- Abstract: ${context.abstract?.substring(0, 300) || 'Not provided'}...

Create the illustration following the user's specific instructions while maintaining academic standards.
IMPORTANT: Do NOT add figure numbers (like "Figure 1", "Fig. 1") or title/caption text overlaid on the image.
`.trim()
}

/**
 * Build prompt for REFINE mode (from uploaded image)
 */
function buildRefineModePrompt(
  context: PaperSketchContextBundle,
  userPrompt?: string,
  modificationRequest?: string
): string {
  const instructions = modificationRequest || userPrompt || 'Refine this sketch for academic publication'
  
  return `
Refine and improve the provided image/sketch for use in a research paper.

REFINEMENT INSTRUCTIONS:
${instructions}

PAPER CONTEXT:
- Paper: ${context.paperTitle}
- Topic: ${context.abstract?.substring(0, 200) || 'Academic research'}

Please:
1. Clean up any rough lines or sketchy elements
2. Add proper labels if needed (but NOT figure numbers like "Figure 1")
3. Improve visual clarity and professional appearance
4. Maintain the original concept and structure
5. Make it suitable for academic publication
6. Do NOT add figure numbers (like "Figure 1", "Fig. 1") or title/caption text on the image
`.trim()
}

/**
 * Generate sketch using Gemini image generation
 */
export async function generateSketchWithGemini(
  systemPrompt: string,
  userPrompt: string,
  modelCandidates: string[],
  inputImage?: { base64: string; mimeType: string },
  tenantId?: string
): Promise<{ success: boolean; imageBase64?: string; imageMimeType?: string; error?: string }> {
  
  // Dynamic import
  const { GoogleGenerativeAI } = require('@google/generative-ai')
  
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'Google AI API key not configured' }
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const maxRetries = 3
  let lastError = ''

  for (const modelCode of modelCandidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const isImagenModel = modelCode.toLowerCase().includes('imagen')
        
        const generationConfig: any = isImagenModel ? {} : {
          responseModalities: ["TEXT", "IMAGE"],
        }
        
        const model = genAI.getGenerativeModel({
          model: modelCode,
          generationConfig,
        })

        const fullPrompt = systemPrompt + '\n\n' + userPrompt
        const parts: any[] = [{ text: fullPrompt }]

        // Add input image for REFINE mode
        if (inputImage) {
          console.log(`[PaperSketchService] Including source image for refinement`)
          parts.push({
            inlineData: {
              mimeType: inputImage.mimeType,
              data: inputImage.base64
            }
          })
        }

        console.log(`[PaperSketchService] Calling ${modelCode} (attempt ${attempt}/${maxRetries})...`)
        
        const result = await model.generateContent(parts)
        const response = result.response

        const candidates = response.candidates
        if (!candidates || candidates.length === 0) {
          throw new Error('No candidates in response')
        }

        const content = candidates[0].content
        if (!content || !content.parts) {
          throw new Error('No content parts in response')
        }

        // Extract image from response
        for (const part of content.parts) {
          if (part.inlineData && part.inlineData.data) {
            console.log(`[PaperSketchService] Successfully generated image with ${modelCode}`)
            return {
              success: true,
              imageBase64: part.inlineData.data,
              imageMimeType: part.inlineData.mimeType || 'image/png'
            }
          }
        }

        throw new Error('No image data in response')
        
      } catch (err: any) {
        lastError = err.message || 'Unknown error'
        console.warn(`[PaperSketchService] ${modelCode} attempt ${attempt} failed:`, lastError)
        
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt))
        }
      }
    }
  }

  return { success: false, error: `Generation failed: ${lastError}` }
}

/**
 * Main entry point for paper sketch generation
 */
export async function generatePaperSketch(
  request: PaperSketchRequest,
  userId: string,
  tenantId?: string
): Promise<PaperSketchResult> {
  const {
    paperId,
    sessionId,
    figureId,
    mode,
    title,
    userPrompt,
    uploadedImageBase64,
    uploadedImageMimeType,
    modificationRequest,
    style = 'academic'
  } = request

  // Validate REFINE mode
  if (mode === 'REFINE' && !uploadedImageBase64) {
    return { success: false, error: 'REFINE mode requires an uploaded image' }
  }

  // Build context
  const contextBundle = await buildPaperContextBundle(paperId, sessionId)
  
  // Resolve model
  const modelCandidates = await resolveSketchModelCandidates(tenantId)
  
  if (modelCandidates.length === 0) {
    return {
      success: false,
      error: 'No sketch generation model configured. Please configure PAPER_SKETCH_GENERATION in Super Admin.'
    }
  }

  console.log(`[PaperSketchService] Using model: ${modelCandidates[0]}`)

  // Build prompts based on mode
  const systemPrompt = buildSystemPrompt(style)
  let userPromptFinal: string

  switch (mode) {
    case 'SUGGEST':
      userPromptFinal = buildSuggestModePrompt(contextBundle, title)
      break
    case 'GUIDED':
      userPromptFinal = buildGuidedModePrompt(contextBundle, userPrompt || '', title)
      break
    case 'REFINE':
      userPromptFinal = buildRefineModePrompt(contextBundle, userPrompt, modificationRequest)
      break
    default:
      return { success: false, error: `Unknown mode: ${mode}` }
  }

  // Prepare input image if present
  let inputImage: { base64: string; mimeType: string } | undefined
  if (mode === 'REFINE' && uploadedImageBase64 && uploadedImageMimeType) {
    inputImage = {
      base64: uploadedImageBase64,
      mimeType: uploadedImageMimeType
    }
  }

  // Generate image
  const genResult = await generateSketchWithGemini(
    systemPrompt,
    userPromptFinal,
    modelCandidates,
    inputImage,
    tenantId
  )

  if (!genResult.success || !genResult.imageBase64) {
    return { success: false, error: genResult.error || 'Image generation failed' }
  }

  // Save image to disk
  try {
    const uploadDir = path.join(process.cwd(), SKETCH_UPLOAD_DIR, sessionId)
    await fs.mkdir(uploadDir, { recursive: true })

    const extension = genResult.imageMimeType?.includes('png') ? 'png' : 'jpg'
    const filename = `sketch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`
    const filePath = path.join(uploadDir, filename)
    
    const imageBuffer = Buffer.from(genResult.imageBase64, 'base64')
    await fs.writeFile(filePath, imageBuffer)

    const publicPath = `/uploads/paper-sketches/${sessionId}/${filename}`
    console.log(`[PaperSketchService] Saved sketch to: ${publicPath}`)

    // Update or create figure plan
    let resultFigureId = figureId

    if (figureId) {
      // Update existing figure
      const existing = await prisma.figurePlan.findUnique({
        where: { id: figureId }
      })
      
      if (existing) {
        const existingNodes = (existing.nodes as any) || {}
        await prisma.figurePlan.update({
          where: { id: figureId },
          data: {
            nodes: {
              ...existingNodes,
              status: 'GENERATED',
              imagePath: publicPath,
              sketchMode: mode,
              generatedAt: new Date().toISOString()
            }
          }
        })
      }
    } else {
      // Create new figure plan
      const maxFigureNo = await prisma.figurePlan.aggregate({
        where: { sessionId },
        _max: { figureNo: true }
      })
      
      const newFigureNo = (maxFigureNo._max.figureNo || 0) + 1
      
      const newFigure = await prisma.figurePlan.create({
        data: {
          sessionId,
          figureNo: newFigureNo,
          title: title || `Sketch ${newFigureNo}`,
          description: userPrompt || 'AI-generated sketch',
          nodes: {
            status: 'GENERATED',
            category: 'SKETCH',
            figureType: 'sketch',
            caption: userPrompt || 'AI-generated sketch',
            imagePath: publicPath,
            sketchMode: mode,
            generatedAt: new Date().toISOString()
          },
          edges: [] // Required field - empty array for sketches
        }
      })
      
      resultFigureId = newFigure.id
    }

    return {
      success: true,
      figureId: resultFigureId,
      imagePath: publicPath
    }

  } catch (saveError: any) {
    console.error('[PaperSketchService] Failed to save image:', saveError)
    return { success: false, error: `Failed to save image: ${saveError.message}` }
  }
}

/**
 * Modify an existing sketch with user feedback
 */
export async function modifyPaperSketch(
  figureId: string,
  modificationRequest: string,
  userId: string,
  tenantId?: string
): Promise<PaperSketchResult> {
  // Get existing figure - FigurePlan relates to DraftingSession
  const figure = await prisma.figurePlan.findUnique({
    where: { id: figureId }
  })

  if (!figure) {
    return { success: false, error: 'Figure not found' }
  }

  const nodes = (figure.nodes as any) || {}
  const existingImagePath = nodes.imagePath

  if (!existingImagePath) {
    return { success: false, error: 'No existing image to modify' }
  }

  // Read existing image
  let imageBase64: string
  let imageMimeType: string

  try {
    const fullPath = path.join(process.cwd(), 'public', existingImagePath)
    const imageBuffer = await fs.readFile(fullPath)
    imageBase64 = imageBuffer.toString('base64')
    imageMimeType = existingImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
  } catch (err) {
    return { success: false, error: 'Could not read existing image' }
  }

  // Get caption from nodes or description field
  const caption = nodes.caption || figure.description || ''

  // Generate modified sketch
  return generatePaperSketch({
    paperId: figure.sessionId,
    sessionId: figure.sessionId,
    figureId,
    mode: 'REFINE',
    title: figure.title,
    userPrompt: caption,
    uploadedImageBase64: imageBase64,
    uploadedImageMimeType: imageMimeType,
    modificationRequest,
    style: 'academic'
  }, userId, tenantId)
}

