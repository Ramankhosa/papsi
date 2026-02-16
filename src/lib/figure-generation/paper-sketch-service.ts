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
import type { TaskCode } from '@prisma/client'
import type {
  IllustrationStructuredSpecV2,
  IllustrationFigureGenre,
  IllustrationRenderDirectives
} from './types'

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
  illustrationSpecV2?: IllustrationStructuredSpecV2
  figureGenre?: IllustrationFigureGenre
  renderDirectives?: IllustrationRenderDirectives
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
  qualityFlags?: string[]
}

// Constants
const SKETCH_UPLOAD_DIR = 'public/uploads/paper-sketches'
const SKETCH_STAGE_CODE = 'PAPER_SKETCH_GENERATION'
const SKETCH_TASK_CODE: TaskCode = 'LLM3_DIAGRAM'
const MAX_GENERATION_ATTEMPTS = 2

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

type EffectiveFigureGenre = IllustrationFigureGenre

interface EffectiveSketchSpec {
  specV2?: IllustrationStructuredSpecV2
  genre: EffectiveFigureGenre
  directives: IllustrationRenderDirectives
}

function resolveFigureGenre(
  explicitGenre?: IllustrationFigureGenre,
  specV2?: IllustrationStructuredSpecV2
): EffectiveFigureGenre {
  if (explicitGenre) return explicitGenre
  if (specV2?.figureGenre) return specV2.figureGenre

  const panelCount = Number(specV2?.panelCount || specV2?.panels?.length || 0)
  const layout = specV2?.layout
  if (layout === 'PANELS' || panelCount >= 2) return 'SCENARIO_STORYBOARD'
  return 'METHOD_BLOCK'
}

function defaultRenderDirectives(genre: EffectiveFigureGenre): IllustrationRenderDirectives {
  if (genre === 'SCENARIO_STORYBOARD') {
    return {
      aspectRatio: '2.5:1',
      fillCanvasPercentMin: 85,
      whitespaceMaxPercent: 15,
      textPolicy: { maxLabelsTotal: 4, maxWordsPerLabel: 3, forbidAllCaps: true, titlesOnlyPreferred: true },
      stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'grayscale_plus_one_accent' },
      compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: true }
    }
  }
  return {
    aspectRatio: '3:1',
    fillCanvasPercentMin: 85,
    whitespaceMaxPercent: 15,
    textPolicy: { maxLabelsTotal: 4, maxWordsPerLabel: 3, forbidAllCaps: true, titlesOnlyPreferred: true },
    stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'grayscale_plus_one_accent' },
    compositionPolicy: { layoutMode: 'STRIP', equalPanels: true, noTextOutsidePanels: true }
  }
}

function mergeRenderDirectives(
  genre: EffectiveFigureGenre,
  override?: IllustrationRenderDirectives
): IllustrationRenderDirectives {
  const base = defaultRenderDirectives(genre)
  if (!override) return base
  return {
    ...base,
    ...override,
    textPolicy: { ...base.textPolicy, ...(override.textPolicy || {}) },
    stylePolicy: { ...base.stylePolicy, ...(override.stylePolicy || {}) },
    compositionPolicy: { ...base.compositionPolicy, ...(override.compositionPolicy || {}) }
  }
}

function buildEffectiveSketchSpec(
  specV2?: IllustrationStructuredSpecV2,
  explicitGenre?: IllustrationFigureGenre,
  explicitRenderDirectives?: IllustrationRenderDirectives
): EffectiveSketchSpec {
  const genre = resolveFigureGenre(explicitGenre, specV2)
  const directives = mergeRenderDirectives(genre, explicitRenderDirectives || specV2?.renderDirectives)
  return { specV2, genre, directives }
}

/**
 * Build system prompt for genre-specific academic illustrations.
 */
function buildSystemPrompt(
  genre: EffectiveFigureGenre,
  style: string = 'academic',
  directives?: IllustrationRenderDirectives
): string {
  const d = mergeRenderDirectives(genre, directives)
  const textPolicy = d.textPolicy || {}
  const stylePolicy = d.stylePolicy || {}

  const styleGuide = `STYLE MODE: ${style}
- Flat vector only, schematic academic look
- No photorealism, no dramatic lighting, no marketing visuals
- White background and clean line work`

  if (genre === 'SCENARIO_STORYBOARD') {
    return `You are an expert academic illustrator generating SCENARIO_STORYBOARD figures.

${styleGuide}

HARD REQUIREMENTS:
1. Generate ONLY an image (no explanatory text).
2. Use exactly 3 equal-width panels in wide landscape composition.
3. Show a real-world scenario flow; silhouettes allowed but non-identifying.
4. Maximum one short label per panel and optional "On-device" tag only.
5. No tiny text, no dense captions, no figure numbers.
6. Aspect ratio target: ${d.aspectRatio}; content fill >= ${d.fillCanvasPercentMin}% with whitespace <= ${d.whitespaceMaxPercent}%.
7. Text policy: maxLabelsTotal=${textPolicy.maxLabelsTotal}, maxWordsPerLabel=${textPolicy.maxWordsPerLabel}, forbidAllCaps=${textPolicy.forbidAllCaps}.
8. Style policy: noGradients=${stylePolicy.noGradients}, no3D=${stylePolicy.no3D}, noClipart=${stylePolicy.noClipart}, paletteMode=${stylePolicy.paletteMode}.
9. No title/caption/watermark/signature on the image.`
  }

  return `You are an expert academic illustrator generating METHOD_BLOCK style figures.

${styleGuide}

HARD REQUIREMENTS:
1. Generate ONLY an image (no explanatory text).
2. Use modular block/pipeline composition with deterministic connectors.
3. No people; no scenario scenes.
4. Labels are titles-only and extremely short.
5. No tiny text, no dense captions, no figure numbers.
6. Aspect ratio target: ${d.aspectRatio}; content fill >= ${d.fillCanvasPercentMin}% with whitespace <= ${d.whitespaceMaxPercent}%.
7. Text policy: maxLabelsTotal=${textPolicy.maxLabelsTotal}, maxWordsPerLabel=${textPolicy.maxWordsPerLabel}, forbidAllCaps=${textPolicy.forbidAllCaps}.
8. Style policy: noGradients=${stylePolicy.noGradients}, no3D=${stylePolicy.no3D}, noClipart=${stylePolicy.noClipart}, paletteMode=${stylePolicy.paletteMode}.
9. No title/caption/watermark/signature on the image.`
}

/**
 * Convert deterministic illustration specs into prompt text for Gemini.
 */
function buildIllustrationSpecBlock(effective: EffectiveSketchSpec): string {
  const spec = effective.specV2
  if (!spec) {
    return `ILLUSTRATION SPEC: none provided.
- figureGenre: ${effective.genre}
- fallback layout: ${effective.genre === 'SCENARIO_STORYBOARD' ? 'PANELS (3 panels)' : 'STRIP (5-7 blocks)'}`
  }

  const panels = Array.isArray(spec.panels)
    ? spec.panels.slice(0, 6).map((panel, idx) => (
        `${idx + 1}. ${panel.title || `Panel ${idx + 1}`} | elements: ${(panel.elements || []).join(', ') || 'n/a'}`
      )).join('\n')
    : 'none'
  const steps = Array.isArray(spec.steps) ? spec.steps.slice(0, 8).join(' -> ') : 'none'
  const elements = Array.isArray(spec.elements) ? spec.elements.slice(0, 12).join(', ') : 'none'
  const actors = Array.isArray((effective.specV2 as any)?.actors) ? (effective.specV2 as any).actors.join(', ') : 'none'
  const props = Array.isArray((effective.specV2 as any)?.props) ? (effective.specV2 as any).props.join(', ') : 'none'
  const forbidden = Array.isArray((effective.specV2 as any)?.forbiddenElements) ? (effective.specV2 as any).forbiddenElements.join(', ') : 'none'

  return `
ILLUSTRATION SPEC (follow deterministically):
- figureGenre: ${effective.genre}
- layout: ${spec.layout || (effective.genre === 'SCENARIO_STORYBOARD' ? 'PANELS' : 'STRIP')}
- panelCount: ${spec.panelCount || 'n/a'}
- stepCount: ${spec.stepCount || 'n/a'}
- flowDirection: ${spec.flowDirection || 'LR'}
- globalElements: ${elements}
- steps: ${steps}
- panels:
${panels}
- actors: ${actors}
- props: ${props}
- forbiddenElements: ${forbidden}
- captionDraft: ${spec.captionDraft || 'n/a'}

RENDER DIRECTIVES (hard):
- aspectRatio: ${effective.directives.aspectRatio}
- fillCanvasPercentMin: ${effective.directives.fillCanvasPercentMin}
- whitespaceMaxPercent: ${effective.directives.whitespaceMaxPercent}
- textPolicy: maxLabelsTotal=${effective.directives.textPolicy?.maxLabelsTotal}, maxWordsPerLabel=${effective.directives.textPolicy?.maxWordsPerLabel}, forbidAllCaps=${effective.directives.textPolicy?.forbidAllCaps}, titlesOnlyPreferred=${effective.directives.textPolicy?.titlesOnlyPreferred}
- stylePolicy: noGradients=${effective.directives.stylePolicy?.noGradients}, no3D=${effective.directives.stylePolicy?.no3D}, noClipart=${effective.directives.stylePolicy?.noClipart}, whiteBackground=${effective.directives.stylePolicy?.whiteBackground}, paletteMode=${effective.directives.stylePolicy?.paletteMode}
- compositionPolicy: layoutMode=${effective.directives.compositionPolicy?.layoutMode}, equalPanels=${effective.directives.compositionPolicy?.equalPanels}, noTextOutsidePanels=${effective.directives.compositionPolicy?.noTextOutsidePanels}
`.trim()
}

function buildGenreReminder(genre: EffectiveFigureGenre): string {
  if (genre === 'SCENARIO_STORYBOARD') {
    return 'GENRE REMINDER: Produce a scenario storyboard (3 equal panels). Silhouettes allowed. One short label per panel max.'
  }
  return 'GENRE REMINDER: Produce a method block/pipeline schematic. No people. Titles-only labels.'
}

/**
 * Build prompt for SUGGEST mode (AI-driven based on context)
 */
function buildSuggestModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
  title?: string
): string {
  return `
Based on this research paper context, create a render-ready academic figure:

PAPER TITLE: ${context.paperTitle}

ABSTRACT:
${context.abstract || 'Not provided'}

METHODOLOGY:
${context.methodology || 'Not provided'}

KEY CONTENT:
${context.sectionContent || 'Not provided'}

${title ? `FIGURE TITLE/FOCUS: ${title}` : ''}
${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}

Create a clean, professional output that:
1. Strictly follows the genre and render directives above
2. Maps to real paper entities (input -> method -> output -> evaluation where applicable)
3. Uses minimal text (no microtext)
4. Avoids figure numbering, overlaid title text, and caption text
`.trim()
}

/**
 * Build prompt for GUIDED mode (user-directed)
 */
function buildGuidedModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
  userPrompt: string,
  title?: string
): string {
  return `
Create an academic figure using the user's request and hard rendering rules:

USER REQUEST:
${userPrompt}

${title ? `FIGURE TITLE: ${title}` : ''}
${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}

PAPER CONTEXT (for grounding):
- Paper: ${context.paperTitle}
- Abstract: ${context.abstract?.substring(0, 300) || 'Not provided'}...

Apply user intent only if it does not violate genre/render directives.
Avoid tiny text and avoid any figure numbers/title overlays.
`.trim()
}

/**
 * Build prompt for REFINE mode (from uploaded image or correction loop)
 */
function buildRefineModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
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

${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}

Please:
1. Enforce the target genre strictly
2. Remove tiny/garbled text; keep labels minimal and structural
3. Remove duplicated blocks/panels and fix alignment
4. Improve clarity and flow arrows
5. Ensure tight composition (fill canvas, low whitespace)
6. Do NOT add figure numbers or overlaid title/caption text
`.trim()
}

function parseAspectRatio(value?: string): number | null {
  if (!value) return null
  const m = value.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const left = Number(m[1])
  const right = Number(m[2])
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= 0) return null
  return left / right
}

async function autoCropWhitespace(
  imageBuffer: Buffer,
  imageMimeType: string
): Promise<{
  buffer: Buffer
  mimeType: string
  changed: boolean
  width?: number
  height?: number
  fillPercent?: number
  whitespacePercent?: number
}> {
  try {
    const jimpMod: any = await import('jimp')
    const Jimp = jimpMod.default || jimpMod
    const image = await Jimp.read(imageBuffer)
    const { width, height, data } = image.bitmap
    if (!width || !height) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false }
    }

    const isContentPixel = (r: number, g: number, b: number, a: number): boolean => {
      if (a < 20) return false
      // Treat near-white as background.
      return !(r > 245 && g > 245 && b > 245)
    }

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let contentPixels = 0

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (width * y + x) << 2
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const a = data[idx + 3]
        if (!isContentPixel(r, g, b, a)) continue
        contentPixels += 1
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }

    const totalPixels = width * height
    const fillPercent = totalPixels > 0 ? (contentPixels / totalPixels) * 100 : 0
    const whitespacePercent = 100 - fillPercent

    if (maxX < minX || maxY < minY) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false, width, height, fillPercent, whitespacePercent }
    }

    const contentWidth = maxX - minX + 1
    const contentHeight = maxY - minY + 1
    const padX = Math.max(8, Math.round(contentWidth * 0.03))
    const padY = Math.max(8, Math.round(contentHeight * 0.03))
    const cropX = Math.max(0, minX - padX)
    const cropY = Math.max(0, minY - padY)
    const cropW = Math.min(width - cropX, contentWidth + padX * 2)
    const cropH = Math.min(height - cropY, contentHeight + padY * 2)

    // If crop is effectively full image, return original.
    if (cropW >= width * 0.98 && cropH >= height * 0.98) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false, width, height, fillPercent, whitespacePercent }
    }

    const cropped = image.clone().crop(cropX, cropY, cropW, cropH)
    const targetMime = imageMimeType.includes('png') ? Jimp.MIME_PNG : Jimp.MIME_JPEG
    const out = await cropped.getBufferAsync(targetMime)
    const croppedTotalPixels = cropW * cropH
    const croppedFillPercent = croppedTotalPixels > 0 ? (contentPixels / croppedTotalPixels) * 100 : fillPercent
    const croppedWhitespacePercent = 100 - croppedFillPercent

    return {
      buffer: out,
      mimeType: targetMime,
      changed: true,
      width: cropW,
      height: cropH,
      fillPercent: croppedFillPercent,
      whitespacePercent: croppedWhitespacePercent
    }
  } catch (err) {
    console.warn('[PaperSketchService] Auto-crop skipped (jimp unavailable or failed):', err instanceof Error ? err.message : err)
    return { buffer: imageBuffer, mimeType: imageMimeType, changed: false }
  }
}

function evaluateImageQuality(
  metrics: { width?: number; height?: number; fillPercent?: number; whitespacePercent?: number },
  effective: EffectiveSketchSpec
): string[] {
  const issues: string[] = []
  const width = metrics.width || 0
  const height = metrics.height || 0
  const ratio = width > 0 && height > 0 ? width / height : 0
  const targetRatio = parseAspectRatio(effective.directives.aspectRatio || '')
  const fillMin = Number(effective.directives.fillCanvasPercentMin || 85)
  const whitespaceMax = Number(effective.directives.whitespaceMaxPercent || 15)

  if (typeof metrics.fillPercent === 'number' && metrics.fillPercent < fillMin) {
    issues.push(`fill-too-low:${metrics.fillPercent.toFixed(1)}<${fillMin}`)
  }
  if (typeof metrics.whitespacePercent === 'number' && metrics.whitespacePercent > whitespaceMax) {
    issues.push(`whitespace-too-high:${metrics.whitespacePercent.toFixed(1)}>${whitespaceMax}`)
  }
  if (targetRatio && ratio > 0) {
    const ratioDiff = Math.abs(ratio - targetRatio) / targetRatio
    if (ratioDiff > 0.22) {
      issues.push(`aspect-ratio-mismatch:${ratio.toFixed(2)}!=${targetRatio.toFixed(2)}`)
    }
  }

  // Lightweight genre mismatch heuristic.
  if (effective.genre === 'SCENARIO_STORYBOARD' && ratio > 0 && ratio < 1.7) {
    issues.push('genre-mismatch:storyboard-not-wide')
  }
  if (effective.genre === 'METHOD_BLOCK' && ratio > 0 && ratio < 2.0) {
    issues.push('genre-mismatch:method-not-wide')
  }

  return issues
}

function buildCorrectiveRefineInstructions(
  issues: string[],
  effective: EffectiveSketchSpec
): string {
  const directives = effective.directives
  const genreInstruction = effective.genre === 'SCENARIO_STORYBOARD'
    ? 'Convert to a strict 3-panel scenario storyboard with equal panels; silhouettes allowed; one short label per panel max.'
    : 'Convert to a method block/pipeline schematic with no people and titles-only labels.'

  return [
    'Correct the generated image while preserving core content.',
    genreInstruction,
    'Remove tiny/garbled text and remove duplicated blocks/panels.',
    `Target aspect ratio: ${directives.aspectRatio}.`,
    `Increase canvas fill to at least ${directives.fillCanvasPercentMin}% and keep whitespace below ${directives.whitespaceMaxPercent}%.`,
    'Tight crop composition and center content.',
    `Detected issues: ${issues.join(', ') || 'n/a'}.`
  ].join(' ')
}

function buildPersistedIllustrationSpecV2(effective: EffectiveSketchSpec): IllustrationStructuredSpecV2 {
  const spec: IllustrationStructuredSpecV2 = { ...(effective.specV2 || {}) }
  if (!spec.layout) {
    spec.layout = effective.genre === 'SCENARIO_STORYBOARD' ? 'PANELS' : 'STRIP'
  }
  if (!spec.panelCount && effective.genre === 'SCENARIO_STORYBOARD') {
    spec.panelCount = 3
  }
  if (!spec.stepCount && effective.genre === 'METHOD_BLOCK') {
    spec.stepCount = 5
  }
  spec.figureGenre = effective.genre
  spec.renderDirectives = effective.directives
  return spec
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
    illustrationSpecV2,
    figureGenre,
    renderDirectives,
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

  const effective = buildEffectiveSketchSpec(
    illustrationSpecV2,
    figureGenre,
    renderDirectives
  )
  const persistedSpecV2 = buildPersistedIllustrationSpecV2(effective)
  const systemPrompt = buildSystemPrompt(effective.genre, style, effective.directives)

  if (mode === 'GUIDED' && !userPrompt?.trim()) {
    return { success: false, error: 'GUIDED mode requires a user prompt' }
  }

  let basePrompt: string
  switch (mode) {
    case 'SUGGEST':
      basePrompt = buildSuggestModePrompt(contextBundle, effective, title)
      break
    case 'GUIDED':
      basePrompt = buildGuidedModePrompt(contextBundle, effective, userPrompt || '', title)
      break
    case 'REFINE':
      basePrompt = buildRefineModePrompt(contextBundle, effective, userPrompt, modificationRequest)
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
  } else if (mode === 'REFINE' && uploadedImageBase64) {
    inputImage = {
      base64: uploadedImageBase64,
      mimeType: 'image/png'
    }
  }

  let workingPrompt = basePrompt
  let workingInputImage = inputImage
  let finalImageBuffer: Buffer | undefined
  let finalMimeType = 'image/png'
  let qualityFlags: string[] = []
  let attemptCount = 0

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    attemptCount = attempt
    const genResult = await generateSketchWithGemini(
      systemPrompt,
      workingPrompt,
      modelCandidates,
      workingInputImage,
      tenantId
    )
    if (!genResult.success || !genResult.imageBase64) {
      return { success: false, error: genResult.error || 'Image generation failed', attemptCount }
    }

    const rawMimeType = genResult.imageMimeType || 'image/png'
    const rawBuffer = Buffer.from(genResult.imageBase64, 'base64')
    const cropped = await autoCropWhitespace(rawBuffer, rawMimeType)

    finalImageBuffer = cropped.buffer
    finalMimeType = cropped.mimeType || rawMimeType
    qualityFlags = evaluateImageQuality(cropped, effective)

    if (qualityFlags.length === 0 || attempt >= MAX_GENERATION_ATTEMPTS) {
      break
    }

    const correctiveInstructions = buildCorrectiveRefineInstructions(qualityFlags, effective)
    console.log(`[PaperSketchService] Quality issues detected (${qualityFlags.join(', ')}). Running corrective refine attempt ${attempt + 1}/${MAX_GENERATION_ATTEMPTS}.`)
    workingPrompt = buildRefineModePrompt(contextBundle, effective, userPrompt, correctiveInstructions)
    workingInputImage = {
      base64: finalImageBuffer.toString('base64'),
      mimeType: finalMimeType
    }
  }

  if (!finalImageBuffer) {
    return { success: false, error: 'Image generation failed', attemptCount }
  }

  // Save image to disk
  try {
    const uploadDir = path.join(process.cwd(), SKETCH_UPLOAD_DIR, sessionId)
    await fs.mkdir(uploadDir, { recursive: true })

    const extension = finalMimeType.includes('png') ? 'png' : 'jpg'
    const filename = `sketch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`
    const filePath = path.join(uploadDir, filename)
    
    await fs.writeFile(filePath, finalImageBuffer)

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
              figureGenre: effective.genre,
              renderDirectives: effective.directives,
              illustrationSpecV2: persistedSpecV2,
              qualityFlags,
              attemptCount,
              generatedAt: new Date().toISOString()
            } as any
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
          description: userPrompt || 'AI-generated infographic overview',
          nodes: {
            status: 'GENERATED',
            category: 'ILLUSTRATED_FIGURE',
            figureType: 'sketch',
            caption: userPrompt || 'AI-generated infographic overview',
            imagePath: publicPath,
            sketchMode: mode,
            figureGenre: effective.genre,
            renderDirectives: effective.directives,
            illustrationSpecV2: persistedSpecV2,
            qualityFlags,
            attemptCount,
            generatedAt: new Date().toISOString()
          } as any,
          edges: [] // Required field - empty array for sketches
        }
      })
      
      resultFigureId = newFigure.id
    }

    return {
      success: true,
      figureId: resultFigureId,
      imagePath: publicPath,
      attemptCount,
      qualityFlags
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
    const relativeImagePath = existingImagePath.startsWith('/')
      ? existingImagePath.slice(1)
      : existingImagePath
    const fullPath = path.join(process.cwd(), 'public', relativeImagePath)
    const imageBuffer = await fs.readFile(fullPath)
    imageBase64 = imageBuffer.toString('base64')
    imageMimeType = existingImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
  } catch (err) {
    return { success: false, error: 'Could not read existing image' }
  }

  // Get caption from nodes or description field
  const caption = nodes.caption || figure.description || ''
  const storedSpecV2 = (nodes.illustrationSpecV2 as IllustrationStructuredSpecV2 | undefined)
  const storedGenre = (nodes.figureGenre as IllustrationFigureGenre | undefined)
  const storedDirectives = (nodes.renderDirectives as IllustrationRenderDirectives | undefined)

  // Generate modified sketch
  return generatePaperSketch({
    paperId: figure.sessionId,
    sessionId: figure.sessionId,
    figureId,
    mode: 'REFINE',
    title: figure.title,
    userPrompt: caption,
    illustrationSpecV2: storedSpecV2,
    figureGenre: storedGenre,
    renderDirectives: storedDirectives,
    uploadedImageBase64: imageBase64,
    uploadedImageMimeType: imageMimeType,
    modificationRequest,
    style: 'academic'
  }, userId, tenantId)
}

