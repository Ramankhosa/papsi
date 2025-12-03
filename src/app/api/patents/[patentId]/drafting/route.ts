import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { DraftingService } from '@/lib/drafting-service';
import { IdeaBankService } from '@/lib/idea-bank-service';
import { llmGateway } from '@/lib/metering/gateway';
// NOTE: Old document-based style learning (getGatedStyleInstructions) has been removed
// The new Writing Personas system uses writing samples directly in DraftingService
import { getDocumentTypeConfig, getSupportedCountryCodes, getCountryProfile } from '@/lib/country-profile-service';
import { resolveCanonicalKey, normalizeSectionKeys } from '@/lib/section-alias-service';
import { enforceServiceAccess } from '@/lib/service-access-middleware';
import { getDiagramConfig, generateDiagramPromptInstructions } from '@/lib/jurisdiction-style-service';
import { trackSectionDrafted } from '@/lib/patent-drafting-tracker';
import { resolveSourceOfTruth, computeJurisdictionStateOnDelete } from '@/lib/jurisdiction-state-service';
import crypto from 'crypto';
import plantumlEncoder from 'plantuml-encoder';
import path from 'path';
import fs from 'fs/promises';
import { imageSize } from 'image-size';

const sanitizeFigureTitleInput = (title?: string | null): string => {
  const raw = typeof title === 'string' ? title : ''
  if (!raw.trim()) return ''
  const cpcIpcPattern = /\b(?:CPC|IPC)?\s*(?:class\s*)?[A-H][0-9]{1,2}[A-Z]\s*\d+\/\d+\b/gi
  let cleaned = raw.replace(cpcIpcPattern, '')
  cleaned = cleaned.replace(/\b(?:CPC|IPC)\b[:\-]?\s*/gi, '')
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1')
  cleaned = cleaned.replace(/^[\s,:;.-]+|[\s,:;.-]+$/g, '')
  return cleaned.trim()
}

// Update figure number in title to match actual assigned figure number
const updateFigureTitleNumber = (title: string, actualFigureNo: number): string => {
  // Replace patterns like "Fig.1", "Fig 1", "Figure 1", etc. with the correct number
  return title
    .replace(/\bFig\.?\s*\d+/gi, `Fig.${actualFigureNo}`)
    .replace(/\bFigure\s*\d+/gi, `Figure ${actualFigureNo}`)
}

function getPreferredLanguageForJurisdiction(session: any, jurisdictionCode: string): string | undefined {
  try {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    const lang = status?.[jurisdictionCode]?.language
    if (typeof lang === 'string' && lang.trim()) return lang.trim()
  } catch {}
  return undefined
}

function applyPreferredLanguage(profile: any, preferred?: string) {
  if (!preferred) return profile
  const langs: string[] = Array.isArray(profile?.profileData?.meta?.languages)
    ? profile.profileData.meta.languages
    : []
  const reordered = [preferred, ...langs.filter(l => l !== preferred)]
  return {
    ...profile,
    profileData: {
      ...(profile?.profileData || {}),
      meta: {
        ...(profile?.profileData?.meta || {}),
        languages: reordered
      }
    }
  }
}


type ExportSectionDef = { key: string; label: string; required?: boolean }

const canonicalSectionMap: Record<string, string> = {
  title: 'title',
  abstract: 'abstract',
  technical_field: 'fieldOfInvention',
  field_of_invention: 'fieldOfInvention',
  field: 'fieldOfInvention',
  background: 'background',
  background_art: 'background',
  summary_of_invention: 'summary',
  summary: 'summary',
  brief_drawings: 'briefDescriptionOfDrawings',
  brief_description_of_drawings: 'briefDescriptionOfDrawings',
  description: 'detailedDescription',
  detailed_description: 'detailedDescription',
  best_mode: 'bestMethod',
  best_method: 'bestMethod',
  industrial_applicability: 'industrialApplicability',
  utility: 'industrialApplicability',
  claims: 'claims',
  abstract_section: 'abstract',
  reference_numerals: 'listOfNumerals',
  reference_signs: 'listOfNumerals',
  list_of_numerals: 'listOfNumerals'
}

const defaultExportSections: ExportSectionDef[] = [
  { key: 'title', label: 'Title', required: true },
  { key: 'fieldOfInvention', label: 'Field of the Invention', required: true },
  { key: 'background', label: 'Background of the Invention', required: true },
  { key: 'summary', label: 'Summary of the Invention', required: true },
  { key: 'briefDescriptionOfDrawings', label: 'Brief Description of the Drawings', required: false },
  { key: 'detailedDescription', label: 'Detailed Description of the Invention', required: true },
  { key: 'bestMethod', label: 'Best Method of Performing the Invention', required: false },
  { key: 'claims', label: 'Claims', required: true },
  { key: 'abstract', label: 'Abstract', required: true },
  { key: 'industrialApplicability', label: 'Industrial Applicability', required: false },
  { key: 'listOfNumerals', label: 'List of Reference Numerals', required: false }
]

async function getExportSectionsForJurisdiction(jurisdiction: string): Promise<ExportSectionDef[]> {
  try {
    // Fetch country profile and section mappings in parallel
    const [profile, sectionMappings] = await Promise.all([
      getCountryProfile(jurisdiction),
      prisma.countrySectionMapping.findMany({
        where: { countryCode: jurisdiction.toUpperCase(), isEnabled: true },
        orderBy: { displayOrder: 'asc' }
      })
    ])
    
    // Create a map of sectionKey -> mapping for quick lookup
    const mappingByKey = new Map(sectionMappings.map(m => [m.sectionKey, m]))
    
    const variant = profile?.profileData?.structure?.variants?.find((v: any) => v.id === profile?.profileData?.structure?.defaultVariant) || profile?.profileData?.structure?.variants?.[0]
    const promptSections = profile?.profileData?.prompts?.sections || {}
    if (variant?.sections?.length) {
      const sections: (ExportSectionDef & { order: number })[] = []
      for (const sec of variant.sections) {
        const keys = (sec.canonicalKeys || []).map((k: string) => k.toLowerCase())
        let mapped: string | undefined
        for (const k of keys) {
          if (canonicalSectionMap[k]) { mapped = canonicalSectionMap[k]; break }
        }
        if (!mapped && canonicalSectionMap[sec.id]) mapped = canonicalSectionMap[sec.id]
        if (!mapped) continue
        
        // Get country-specific displayOrder from mapping, fallback to section order
        const mapping = mappingByKey.get(mapped)
        const order = mapping?.displayOrder ?? sec.order ?? 999
        
        sections.push({
          key: mapped,
          label: mapping?.heading || sec.label || sec.id,
          required: mapping?.isRequired ?? sec.required ?? promptSections?.[sec.id]?.required ?? true,
          order
        })
      }
      
      // Sort by country-specific displayOrder
      sections.sort((a, b) => a.order - b.order)
      
      // Ensure title/abstract appear even if profile omits them
      const keys = new Set(sections.map(s => s.key))
      if (!keys.has('title')) sections.unshift({ key: 'title', label: 'Title', required: true, order: 0 })
      if (!keys.has('abstract')) sections.push({ key: 'abstract', label: 'Abstract', required: true, order: 999 })
      
      // Remove the order property from final result (not needed outside this function)
      return sections.map(({ order, ...rest }) => rest)
    }
  } catch (err) {
    console.warn('Failed to load export sections for jurisdiction', jurisdiction, err)
  }
  return defaultExportSections
}

function getSectionHeadingDynamic(sectionName: string, sections?: ExportSectionDef[]): string {
  const found = sections?.find(s => s.key === sectionName)
  if (found) return String(found.label || sectionName).toUpperCase()
  const fallbackMap: Record<string, string> = {
    fieldOfInvention: 'FIELD OF THE INVENTION',
    background: 'BACKGROUND OF THE INVENTION',
    summary: 'SUMMARY OF THE INVENTION',
    briefDescriptionOfDrawings: 'BRIEF DESCRIPTION OF THE DRAWINGS',
    detailedDescription: 'DETAILED DESCRIPTION OF THE INVENTION',
    industrialApplicability: 'INDUSTRIAL APPLICABILITY',
    bestMethod: 'BEST METHOD OF PERFORMING THE INVENTION',
    claims: 'CLAIMS',
    listOfNumerals: 'LIST OF REFERENCE NUMERALS',
    abstract: 'ABSTRACT'
  }
  return fallbackMap[sectionName] || sectionName.toUpperCase()
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    // Serve figure image previews without requiring Authorization headers (browser <img> cannot send them)
    const url = new URL(request.url)
    const imageKind = url.searchParams.get('image')
    if (imageKind === 'figure') {
      const sessionId = url.searchParams.get('sessionId') || ''
      const figureNo = Number(url.searchParams.get('figureNo') || '0')
      if (!sessionId || !figureNo) return NextResponse.json({ error: 'sessionId and figureNo required' }, { status: 400 })

      const ds = await prisma.diagramSource.findFirst({ where: { sessionId, figureNo } })
      try {
        const fs = await import('fs/promises')
        const path = await import('path')
        // Build locations (support both patents/ and projects/ storages and common filename patterns)
        const pat = await prisma.patent.findUnique({ where: { id: params.patentId }, select: { projectId: true } })
        const basePat = path.join(process.cwd(), 'uploads', 'patents', params.patentId, 'figures')
        const baseProj = pat?.projectId ? path.join(process.cwd(), 'uploads', 'projects', pat.projectId, 'patents', params.patentId, 'figures') : ''
        const nameCandidates = [
          ds?.imageFilename,
          `figure-${figureNo}.png`,
          `figure_${figureNo}.png`,
          `${figureNo}.png`,
          `figure-${figureNo}.jpg`,
          `figure_${figureNo}.jpg`,
          `${figureNo}.jpg`
        ].filter(Boolean) as string[]
        const candidates: string[] = []
        if (ds?.imagePath) candidates.push(ds.imagePath)
        for (const n of nameCandidates) {
          candidates.push(path.join(basePat, n))
          if (baseProj) candidates.push(path.join(baseProj, n))
        }
        let fileBuf: Buffer | null = null
        let usedPath = ''
        for (const p of candidates) {
          try {
            const buf = await fs.readFile(p)
            fileBuf = buf
            usedPath = p
            break
          } catch {}
        }
        if (!fileBuf) return NextResponse.json({ error: 'Image file not found' }, { status: 404 })
        const ext = path.extname(usedPath).toLowerCase()
        const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream'
        return new NextResponse(fileBuf as any, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=60' } })
      } catch (e) {
        return NextResponse.json({ error: 'Failed to read image' }, { status: 500 })
      }
    }

    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { patentId } = params;

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }

    // Get drafting sessions for this patent
    const sessions = await prisma.draftingSession.findMany({
      where: {
        patentId,
        userId: authResult.user.id,
        tenantId: authResult.user.tenantId
      },
      include: {
        ideaRecord: true,
        referenceMap: true,
        figurePlans: true,
        diagramSources: true,
        annexureDrafts: {
          // Keep all versions so UI can select the latest per jurisdiction
          orderBy: { version: 'desc' }
        },
        relatedArtRuns: {
          orderBy: { ranAt: 'desc' },
          take: 5, // Keep last 5 runs for reference
          include: {
            ideaBankSuggestions: true
          }
        },
        relatedArtSelections: true
      } as any,
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ sessions });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/drafting error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  let authResult: any = null;
  let body: any = null;
  let patentId: string = params.patentId;

  try {
    authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    // Check organizational service access (Tenant Admin controlled)
    if (authResult.user.tenantId) {
      const serviceCheck = await enforceServiceAccess(
        authResult.user.id,
        authResult.user.tenantId,
        'PATENT_DRAFTING'
      );
      if (!serviceCheck.allowed) {
        return serviceCheck.response;
      }
    }

    body = await request.json();
    const { action, ...data } = body;

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      );
    }

    // Extract request headers for LLM calls
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    // Route to appropriate handler based on action
    switch (action) {
      case 'start_session':
        return await handleStartSession(authResult.user, patentId, data);

      case 'normalize_idea':
        return await handleNormalizeIdea(authResult.user, patentId, data, requestHeaders);

      case 'proceed_to_components':
        return await handleProceedToComponents(authResult.user, patentId, data);

      case 'update_component_map':
        return await handleUpdateComponentMap(authResult.user, patentId, data);

      case 'update_figure_plan':
        return await handleUpdateFigurePlan(authResult.user, patentId, data);

      // Stage 3.5: Related Art search & selection
      case 'related_art_search':
        return await handleRelatedArtSearch(authResult.user, patentId, data, requestHeaders);
      case 'test_pqai_key':
        return await handleTestPQAIKey();
      case 'mock_related_art_search':
        return await handleMockRelatedArtSearch();
      case 'related_art_select':
        return await handleRelatedArtSelect(authResult.user, patentId, data);
      case 'related_art_llm_review':
        return await handleRelatedArtLLMReview(authResult.user, patentId, data, requestHeaders);

      case 'clear_related_art_selections':
        return await handleClearRelatedArtSelections(authResult.user, patentId, data);

      case 'save_manual_prior_art':
        return await handleSaveManualPriorArt(authResult.user, patentId, data);

      case 'save_ai_analysis':
        return await handleSaveAIAnalysis(authResult.user, patentId, data);

      case 'generate_plantuml':
        return await handleGeneratePlantUML(authResult.user, patentId, data);

      case 'upload_diagram':
        return await handleUploadDiagram(authResult.user, patentId, data);

      case 'generate_draft':
        return await handleGenerateDraft(authResult.user, patentId, data, requestHeaders);

      // Multi-jurisdiction: Generate reference draft (superset sections)
      case 'generate_reference_draft':
        return await handleGenerateReferenceDraft(authResult.user, patentId, data, requestHeaders);

      // Multi-jurisdiction: Translate reference draft to target jurisdiction
      case 'translate_to_jurisdiction':
        return await handleTranslateToJurisdiction(authResult.user, patentId, data, requestHeaders);

      // New: Section-level generation and save for Annexure 2
      case 'generate_sections':
        return await handleGenerateSections(authResult.user, patentId, data, requestHeaders);

      case 'save_sections':
        return await handleSaveSections(authResult.user, patentId, data);

      case 'autosave_sections':
        return await handleAutosaveSections(authResult.user, patentId, data);

      case 'delete_annexure_draft':
        return await handleDeleteAnnexureDraft(authResult.user, patentId, data);

      case 'generate_diagrams_llm':
        return await handleGenerateDiagramsLLM(authResult.user, patentId, data, requestHeaders);

      case 'save_plantuml':
        return await handleSavePlantUML(authResult.user, patentId, data);

      case 'regenerate_diagram_llm':
        return await handleRegenerateDiagramLLM(authResult.user, patentId, data, requestHeaders);

      case 'add_figure_llm':
        return await handleAddFigureLLM(authResult.user, patentId, data, requestHeaders);

      case 'add_figures_llm':
        return await handleAddFiguresLLM(authResult.user, patentId, data, requestHeaders);

      case 'delete_figure':
        return await handleDeleteFigure(authResult.user, patentId, data);

      case 'create_manual_figure':
        return await handleCreateManualFigure(authResult.user, patentId, data);

      // New actions for Stage 1 editing, navigation, and resume
      case 'update_idea_record':
        return await handleUpdateIdeaRecord(authResult.user, patentId, data);

      // Claims generation and management (Stage 1)
      case 'generate_claims':
        return await handleGenerateClaims(authResult.user, patentId, data, requestHeaders);

      case 'save_claims':
        return await handleSaveClaims(authResult.user, patentId, data);

      case 'freeze_claims':
        return await handleFreezeClaims(authResult.user, patentId, data);

      case 'unfreeze_claims':
        return await handleUnfreezeClaims(authResult.user, patentId, data);

      case 'set_stage':
        return await handleSetStage(authResult.user, patentId, data);

      case 'resume':
        return await handleResume(authResult.user, patentId);

      // Review & Export
      case 'run_review_checks':
        return await handleRunReview(authResult.user, patentId, data);

      case 'validate_draft':
        return await handleValidateDraft(authResult.user, patentId, data);

      case 'run_ai_review':
        return await handleRunAIReview(authResult.user, patentId, data, requestHeaders);

      case 'apply_ai_fix':
        return await handleApplyAIFix(authResult.user, patentId, data, requestHeaders);

      case 'get_ai_reviews':
        return await handleGetAIReviews(authResult.user, patentId, data);

      case 'ignore_ai_issue':
        return await handleIgnoreAIIssue(authResult.user, patentId, data);

      case 'revert_ai_fix':
        return await handleRevertAIFix(authResult.user, patentId, data);

      case 'export_docx':
        return await handleExportDOCX(authResult.user, patentId, data, request);

      case 'export_pdf':
        return await handleExportPDF(authResult.user, patentId, data, request);

      case 'preview_export':
        return await handlePreviewExport(authResult.user, patentId, data);

      case 'get_export_preview':
        return await handleGetExportPreview(authResult.user, patentId, data);

      case 'get_draft_versions':
        return await handleGetDraftVersions(authResult.user, patentId, data);

      case 'get_draft_by_version':
        return await handleGetDraftByVersion(authResult.user, patentId, data);

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('POST /api/patents/[patentId]/drafting error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Request body:', body || 'Not parsed yet');
    console.error('User ID:', authResult?.user?.id || 'Not authenticated yet');
    console.error('Patent ID:', patentId);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleClearRelatedArtSelections(user: any, patentId: string, data: any) {
  const { sessionId, runId } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Delete all related art selections for this session and run
  await (prisma as any).relatedArtSelection.deleteMany({
    where: {
      sessionId,
      runId: runId || null
    }
  })

  return NextResponse.json({ success: true })
}

async function handleSaveManualPriorArt(user: any, patentId: string, data: any) {
  const { sessionId, manualPriorArt } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { manualPriorArt: manualPriorArt || null } as any
  })

  return NextResponse.json({ session: updated })
}

async function handleSaveAIAnalysis(user: any, patentId: string, data: any) {
  const { sessionId, aiAnalysisData } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { aiAnalysisData: aiAnalysisData || null } as any
  })

  return NextResponse.json({ session: updated })
}

async function handleRelatedArtLLMReview(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, runId, batchSize, claimsContext } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      relatedArtRuns: {
        orderBy: { ranAt: 'desc' },
        take: 1,
        include: { ideaBankSuggestions: true }
      }
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const useRunId = runId || session.relatedArtRuns?.[0]?.id
  if (!useRunId) return NextResponse.json({ error: 'No related art run found. Run a search first.' }, { status: 400 })

  const run = await prisma.relatedArtRun.findUnique({ where: { id: useRunId as string } }) as any
  if (!run) return NextResponse.json({ error: 'Related art run not found' }, { status: 404 })

  const results: any[] = Array.isArray(run.resultsJson) ? run.resultsJson : []
  if (results.length === 0) return NextResponse.json({ error: 'No results to review' }, { status: 400 })

  const title = session.ideaRecord?.title || ''
  const query = (session.ideaRecord as any)?.searchQuery || ''
  
  // Get frozen claims from session for claim-aware analysis
  const normalizedData = (session.ideaRecord?.normalizedData as any) || {}
  const frozenClaims = claimsContext?.claims || normalizedData.claimsStructured || []
  const claimsText = normalizedData.claims || ''
  const hasClaimsContext = claimsContext?.frozenAt || normalizedData.claimsApprovedAt
  
  // Build claims summary for the prompt
  let claimsSection = ''
  if (hasClaimsContext) {
    if (Array.isArray(frozenClaims) && frozenClaims.length > 0) {
      const claimsSummary = frozenClaims.slice(0, 8).map((c: any) => 
        `Claim ${c.number} (${c.type}): ${(c.text || '').substring(0, 200)}...`
      ).join('\n')
      claimsSection = `\n\nOUR FROZEN PATENT CLAIMS (analyze prior art against these specific claims):\n${claimsSummary}`
      if (frozenClaims.length > 8) {
        claimsSection += `\n(+ ${frozenClaims.length - 8} additional claims)`
      }
    } else if (typeof frozenClaims === 'string' && frozenClaims.trim()) {
      // Handle string claims (HTML)
      const plainClaims = frozenClaims.replace(/<[^>]*>/g, '').substring(0, 1000)
      claimsSection = `\n\nOUR FROZEN PATENT CLAIMS (analyze prior art against these specific claims):\n${plainClaims}...`
    } else if (claimsText) {
      const plainClaims = claimsText.replace(/<[^>]*>/g, '').substring(0, 1000)
      claimsSection = `\n\nOUR FROZEN PATENT CLAIMS (analyze prior art against these specific claims):\n${plainClaims}...`
    }
  }

  const candidates = results.map((r: any) => ({
    pn: r.pn || r.patent_number || r.publication_number || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || '',
    title: r.title || r.invention_title || '',
    abstract: r.snippet || r.abstract || r.summary || r.description || ''
  })).filter(x => x.title && (x.pn || x.abstract))

  // Process all candidates at once instead of in batches
  const request = { headers: requestHeaders || {} }
  const allDecisions: Array<{
    pn: string;
    title: string;
    relevance: number;
    novelty_threat: 'anticipates'|'obvious'|'adjacent'|'remote';
    summary: string;
    detailedAnalysis: {
      summary: string;
      relevant_parts: string[];
      irrelevant_parts: string[];
      novelty_comparison: string;
    };
    noveltyInsights?: {
      differences?: string;
      improvementSuggestions?: string;
    }
  }> = []

  // Create candidate text for all patents
  const candidatesText = candidates.map((b, idx) => `#${idx+1}. PN:${b.pn||'N/A'}\nTitle: ${b.title}\nAbstract: ${b.abstract}`).join('\n\n')

  // STEP 1: Relevance Analysis (in batches to avoid token limits)
  console.log('Starting relevance analysis with Gemini 2.5 Flash-Lite...')
  const effectiveBatchSize = batchSize || 6 // Use provided batchSize or default to 6
  let relevanceData: any[] = []

  for (let i = 0; i < candidates.length; i += effectiveBatchSize) {
    const batch = candidates.slice(i, i + effectiveBatchSize)
    const batchText = batch.map((b, idx) => `#${idx+1}. PN:${b.pn||'N/A'}\nTitle: ${b.title}\nAbstract: ${b.abstract}`).join('\n\n')

    const batchRelevancePrompt = `You are an expert patent attorney. Analyze these patent candidates for relevance to our invention and assess novelty threat to our specific claims.

INVENTION: ${title} | SEARCH: ${query}${claimsSection}

For each patent, provide:
- relevance: 0.0-1.0 score
- novelty_threat: "anticipates" | "obvious" | "adjacent" | "remote"
  * "anticipates" = This prior art discloses ALL elements of at least one of our claims
  * "obvious" = Combining this with common knowledge would render our claims obvious
  * "adjacent" = Related technology but doesn't threaten our specific claim scope
  * "remote" = Different field, minimal relevance to our claims
- summary: 1-2 sentence explanation of how this relates to our claims
- relevant_parts: List specific elements/claims/aspects of the patent that overlap with OUR claims
- irrelevant_parts: List specific elements/claims/aspects of the patent that DON'T overlap with our claims
- novelty_comparison: Explain what makes our claims novel compared to this patent (specific claim elements not disclosed)
${hasClaimsContext ? '\nIMPORTANT: Focus analysis on whether prior art anticipates or renders obvious our SPECIFIC CLAIMS listed above.' : ''}

Return ONLY JSON:
{
  "relevance_results": [
    {
      "pn": "patent_number",
      "title": "patent_title",
      "relevance": 0.8,
      "novelty_threat": "adjacent",
      "summary": "analysis",
      "relevant_parts": ["specific element 1", "specific element 2"],
      "irrelevant_parts": ["unrelated element 1", "different aspect 1"],
      "novelty_comparison": "detailed explanation of novelty differences"
    }
  ]
}

PATENTS:
${batchText}`

    const relevanceResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM1_PRIOR_ART',
      prompt: batchRelevancePrompt,
      modelClass: 'gemini-2.5-flash-lite',
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(batchRelevancePrompt.length / 4),
      parameters: { maxOutputTokens: 3000 },
      metadata: {
        patentId,
        sessionId,
        runId: useRunId,
        purpose: 'related_art_relevance_batch'
      }
    })

    console.log(`Relevance analysis batch ${Math.floor(i/effectiveBatchSize) + 1} model used:`, relevanceResult?.response?.modelClass || 'unknown')

    if (relevanceResult.success && relevanceResult.response) {
      try {
        const txt = (relevanceResult.response.output || '').trim()
        const start = txt.indexOf('{')
        const end = txt.lastIndexOf('}')
        const json = start !== -1 && end !== -1 && end > start ? txt.substring(start, end + 1) : txt

        const parsed = JSON.parse(json)
        const batchResults = Array.isArray(parsed?.relevance_results) ? parsed.relevance_results : []
        relevanceData.push(...batchResults)
        console.log(`Batch ${Math.floor(i/effectiveBatchSize) + 1} successful:`, batchResults.length, 'patents analyzed')
      } catch (e) {
        console.log(`Batch ${Math.floor(i/effectiveBatchSize) + 1} JSON parse failed:`, e instanceof Error ? e.message : String(e))
        // Fallback for this batch
        const fallbackResults = batch.map(c => ({
          pn: c.pn,
          title: c.title,
          relevance: 0.5,
          novelty_threat: 'adjacent',
          summary: 'Basic relevance analysis - detailed analysis failed'
        }))
        relevanceData.push(...fallbackResults)
      }
    }
  }

  console.log('Total relevance analysis completed:', relevanceData.length, 'patents analyzed')

  // Process relevance results
  for (const r of relevanceData) {
    if (!r || typeof r !== 'object') continue
    const pn = String(r.pn || '').trim()
    const t = String(r.title || '').trim()
    const rel = typeof r.relevance === 'number' ? Math.max(0, Math.min(1, r.relevance)) : 0
    const noveltyThreat = (String(r.novelty_threat||'').toLowerCase() as any) || 'remote'

    let sum = String(r.summary || '').trim()
    if (noveltyThreat === 'remote' && (!sum || sum.length === 0)) {
      sum = 'AI found this prior art poses no novelty threat to this invention'
    }
    sum = sum.slice(0, 500)

    // Store complete analysis as JSON in userNotes
    const detailedAnalysis = {
      summary: sum,
      relevant_parts: Array.isArray(r.relevant_parts) ? r.relevant_parts : [],
      irrelevant_parts: Array.isArray(r.irrelevant_parts) ? r.irrelevant_parts : [],
      novelty_comparison: String(r.novelty_comparison || '').trim()
    }

    allDecisions.push({
      pn,
      title: t,
      relevance: rel,
      novelty_threat: noveltyThreat,
      summary: sum,
      detailedAnalysis
    })
  }

  // STEP 2: Idea Generation (separate call)
  console.log('Starting idea generation with Gemini 2.5 Flash-Lite...')
  const ideaPrompt = `You are a dual-headed entity:
- Left brain: ruthless patent examiner who kills any idea that is obvious under 35 U.S.C. §103 or abstract under §101.
- Right brain: visionary CTO who invents only “white-space” solutions that make the cited references obsolete.

Both brains must co-sign every concept or it is rejected.

INVENTION CONTEXT:
Title: ${title}
Search Query: ${query}

CORE OBJECTIVE:
The user is looking for "White Space" inventions—areas where no patent currently exists.
Do not just improve the references. Make them obsolete.
Think from First Principles: What is the fundamental physics/logic limit here, and how do we bypass it?

INVENTION BRIEFING:
Generate exactly 5 patent-grade concepts that:
1. Are **orthogonal** to every mechanism disclosed in REFERENCES.
2. Contain at least one **physical structure** or **chemical composition** (no pure algorithms, no “AI to optimize”).
3. Can be **enabled** by a PHOSITA with only routine experimentation (no perpetual motion, no room-temperature superconductors unless you supply the formula).
4. Pass the **“cold shower” test**: if you woke up tomorrow and read the claim on the front page of TechCrunch, you would think “wow, that’s clever—and nobody did that before.”

CREATIVITY FILTERS (apply ≥1 per idea):
A. **Anti-Solution**: Invert the primary physical state (e.g., if it's rigid, make it fluid; if it's centralized, make it swarm-based).
B. **Resource Starvation**: Design for zero electricity, zero RF bandwidth, or zero rare-earth materials.
C. **Biomimicry**: Copy a biological mechanism that has **no** existing engineering analog in the field.
D. **Dimensional Shift**: Replace spatial hardware with temporal encoding, or vice-versa.
E. **Cross-Pollination**: Import a physical phenomenon from an unrelated domain (e.g., high-frequency trading latency-arbitrage → ultrasonic acoustic arbitrage in concrete sensing).

OUTPUT SPECIFICATION:
Return ONLY valid JSON with exactly this schema.
{
  "idea_bank_suggestions": [
    {
      "title": "≤12 words, technical, no fluff",
      "core_principle": "One sentence problem statement anchored in white space, followed by: Unlike standard approaches that use X, this embodiment uses Y (2-3 sentences, physical detail)",
      "expected_advantage": "Concrete commercial scenario with $-size if possible",
      "tags": ["technical-domain", "application", "disruption-type", "cross-discipline"],
      "non_obvious_extension": "Exact sentence from REFERENCES that this idea avoids (Cross-ref Killshot)"
    }
  ]
}

GENERATE 5 RADICAL IDEAS.

REFERENCE SNAPSHOTS (Analyze these to find what to AVOID or DISRUPT):
${candidatesText}`

  const ideaResult = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM1_PRIOR_ART',
    prompt: ideaPrompt,
    modelClass: 'gemini-2.5-flash-lite',
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(ideaPrompt.length / 4),
    parameters: { 
      maxOutputTokens: 5000,
      temperature: 0.9,
      topP: 0.95
    },
    metadata: {
      patentId,
      sessionId,
      runId: useRunId,
      purpose: 'related_art_idea_generation'
    }
  })

  console.log('Idea generation model used:', ideaResult?.response?.modelClass || 'unknown')

  let ideaBank: any[] = []
  if (ideaResult.success && ideaResult.response) {
    try {
      const txt = (ideaResult.response.output || '').trim()
      const start = txt.indexOf('{'); const end = txt.lastIndexOf('}')
      const json = start !== -1 && end !== -1 ? txt.substring(start, end + 1) : txt
      const parsed = JSON.parse(json)
      ideaBank = Array.isArray(parsed?.idea_bank_suggestions) ? parsed.idea_bank_suggestions : []
      console.log('Idea generation successful:', ideaBank.length, 'ideas generated')
      if (ideaBank.length > 0) {
        console.log('Sample idea:', ideaBank[0].title)
      }
    } catch (e) {
      console.log('Idea generation JSON parse failed:', e)
    }
  }


  const autoUse: string[] = []
  const tagsFor = (d: typeof allDecisions[number]) => {
    const base = ['AI_REVIEWED']
    if (d.novelty_threat === 'anticipates') base.push('AI_ANTICIPATES')
    else if (d.novelty_threat === 'obvious') base.push('AI_OBVIOUS')
    else if (d.novelty_threat === 'adjacent') base.push('AI_ADJACENT')
    else base.push('AI_REMOTE')
    return base
  }

  for (const d of allDecisions) {
    if (!d.pn) continue
    try {
      await (prisma as any).relatedArtSelection.upsert({
        where: { sessionId_patentNumber_runId: { sessionId, patentNumber: d.pn, runId: useRunId } },
        update: { score: d.relevance, tags: tagsFor(d), userNotes: JSON.stringify(d.detailedAnalysis), title: d.title || undefined },
        create: { sessionId, runId: useRunId, patentNumber: d.pn, title: d.title || undefined, score: d.relevance, tags: tagsFor(d), userNotes: JSON.stringify(d.detailedAnalysis) }
      })
    } catch {}
    // Auto-select everything except those that anticipate the invention (very high threat)
    if (d.novelty_threat !== 'anticipates') autoUse.push(d.pn)
  }

  // Debug: log the idea bank suggestions
  console.log('Idea Bank suggestions to persist:', ideaBank.length)

  // Persist Idea Bank suggestions to the main idea bank table
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Persisting', ideaBank.length, 'idea bank suggestions to main idea bank...')
  if (ideaBank.length > 0) {
    const ideaBankService = new IdeaBankService();
    const avgRelevance = allDecisions.length
      ? (allDecisions.reduce((acc, d) => acc + (d.relevance || 0), 0) / allDecisions.length)
      : 0.5;

    for (let i = 0; i < ideaBank.length; i++) {
      const ib = ideaBank[i] || {}
      try {
        // Convert the idea format to match what addIdeaFromNoveltySearch expects
        const extractedIdea = {
          title: String(ib.title || '').slice(0, 200),
          description: String(ib.core_principle || '').slice(0, 2000),
          abstract: String(ib.expected_advantage || '').slice(0, 500),
          domainTags: Array.isArray(ib.tags) ? ib.tags.map((t: any) => String(t).slice(0, 60)) : [],
          technicalField: 'AI-Generated',
          keyFeatures: [String(ib.non_obvious_extension || '').slice(0, 200)],
          potentialApplications: ['Patentable invention'],
          noveltyScore: avgRelevance
        };

        await ideaBankService.addIdeaFromNoveltySearch(extractedIdea, user, patentId);
        console.log('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Persisted idea bank suggestion:', ib.title?.substring(0, 50))
      } catch (e) {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to persist idea bank suggestion:', ib.title, 'Error:', e)
      }
    }
    console.log('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Finished persisting', ideaBank.length, 'idea bank suggestions to main idea bank')
  } else {
    console.log('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No idea bank suggestions to persist')
  }

  const response = {
    reviewed: allDecisions.length,
    decisions: allDecisions,
    autoSelect: autoUse,
    runId: useRunId,
    ideaBankSuggestions: ideaBank
  }
  console.log('API Response structure:', {
    reviewed: response.reviewed,
    decisionsCount: response.decisions.length,
    autoSelectCount: response.autoSelect.length,
    runId: response.runId,
    ideaBankSuggestionsCount: response.ideaBankSuggestions.length,
    ideaBankSuggestions: response.ideaBankSuggestions
  })
  return NextResponse.json(response)
}
async function handleRunReview(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (requestedJurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)
  const baseProfile = await getCountryProfile(effectiveJurisdiction)
  const profile = applyPreferredLanguage(baseProfile, preferredLanguage)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft found for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  const fullText = last?.fullDraftText || [
    last?.fieldOfInvention && `FIELD OF INVENTION\n\n${last.fieldOfInvention}`,
    last?.background && `BACKGROUND\n\n${last.background}`,
    last?.summary && `SUMMARY\n\n${last.summary}`,
    last?.briefDescriptionOfDrawings && `BRIEF DESCRIPTION OF DRAWINGS\n\n${last.briefDescriptionOfDrawings}`,
    last?.detailedDescription && `DETAILED DESCRIPTION\n\n${last.detailedDescription}`,
    last?.bestMethod && `BEST METHOD\n\n${last.bestMethod}`,
    last?.claims && `CLAIMS\n\n${last.claims}`,
    last?.abstract && `ABSTRACT\n\n${last.abstract}`,
    last?.industrialApplicability && `INDUSTRIAL APPLICABILITY\n\n${last.industrialApplicability}`,
    last?.listOfNumerals && `LIST OF REFERENCE NUMERALS\n\n${last.listOfNumerals}`
  ].filter(Boolean).join('\n\n')

  const validation = DraftingService.validateDraftConsistencyPublic({ fullText }, session as any)
  const extended = DraftingService.validateDraftExtended(last || {}, session, profile, effectiveJurisdiction)
  return NextResponse.json({
    validationReport: validation.report,
    isValid: validation.valid,
    extendedReport: extended.report,
    extendedValid: extended.valid
  })
}

// Pre-export normalizer: prepares content blocks with blank space control and color sanitization
function preExportNormalizer(
  content: Record<string, string>,
  sections?: ExportSectionDef[]
): { blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> } {
  const blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> = []
  let blockCounter = 0

  const order = (sections && sections.length ? sections : defaultExportSections).map(s => ({
    key: s.key,
    section: s.key,
    type: s.key === 'title' ? 'heading' : 'body'
  }))

  for (const { key, section, type } of order) {
    const rawContent = content[key] || ''
    const cleanedContent = sanitizeContent(rawContent)

    if (type === 'heading') {
      blocks.push({
        type: 'heading',
        section,
        content: cleanedContent,
        blockId: `block_${blockCounter++}`
      })
    } else {
      // Split into paragraphs and collapse empty ones
      const paragraphs = cleanedContent.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0)
      for (const para of paragraphs) {
        blocks.push({
          type: 'paragraph',
          section,
          content: para,
          blockId: `block_${blockCounter++}`
        })
      }
    }
  }

  return { blocks }
}

// Sanitize content: remove color styles, collapse whitespace, strip trailing empties
function sanitizeContent(text: string): string {
  if (!text) return ''

  // Remove any color/style markup (basic cleanup for now)
  let cleaned = text.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI colors
  cleaned = cleaned.replace(/<[^>]*>/g, '') // Remove HTML tags (basic)

  // Normalize whitespace: collapse multiple spaces/newlines
  cleaned = cleaned.replace(/[ \t]+/g, ' ') // Multiple spaces to single
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines

  // Trim leading/trailing whitespace per line
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n')

  return cleaned.trim()
}

// Country-specific paragraph numbering formats
const PARAGRAPH_NUMBER_FORMATS: Record<string, { prefix: string; suffix: string; digits: number }> = {
  JP: { prefix: '【', suffix: '】', digits: 4 },    // Japan: 【0001】
  DEFAULT: { prefix: '[', suffix: ']', digits: 4 } // Others: [0001]
}

// Get paragraph number format for jurisdiction
function getParagraphNumberFormat(jurisdiction: string): { prefix: string; suffix: string; digits: number } {
  const code = (jurisdiction || 'US').toUpperCase()
  return PARAGRAPH_NUMBER_FORMATS[code] || PARAGRAPH_NUMBER_FORMATS.DEFAULT
}

// Format paragraph number according to jurisdiction
function formatParagraphNumber(num: number, jurisdiction: string): string {
  const format = getParagraphNumberFormat(jurisdiction)
  const paddedNum = num.toString().padStart(format.digits, '0')

  // Apply bold formatting for Japanese brackets
  if (jurisdiction.toUpperCase() === 'JP') {
    return `<strong>${format.prefix}${paddedNum}${format.suffix}</strong> `
  }

  return `${format.prefix}${paddedNum}${format.suffix} `
}

// Paragraph numbering injector: adds jurisdiction-specific numbering to Description sections
// Japan: 【0001】, Others: [0001]
function injectParagraphNumbering(
  blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }>,
  jurisdiction: string = 'US'
): void {
  // Description sections that get numbered (excludes claims, abstract, title)
  const descriptionSections = [
    'fieldOfInvention', 'technical_field', 'field',
    'background', 'background_art',
    'summary', 'summary_of_invention',
    'briefDescriptionOfDrawings', 'brief_description_of_drawings',
    'detailedDescription', 'detailed_description', 'description',
    'bestMethod', 'best_mode',
    'industrialApplicability', 'industrial_applicability',
    'objectsOfInvention', 'objects_of_invention',
    'technicalProblem', 'technical_problem',
    'technicalSolution', 'technical_solution',
    'advantageousEffects', 'advantageous_effects',
    'modeOfCarryingOut', 'mode_of_carrying_out'
  ]

  let paragraphNumber = 1
  const format = getParagraphNumberFormat(jurisdiction)
  
  // Regex to strip existing numbering patterns (all formats)
  const existingNumberRegex = /^(?:\[|\【)\d{3,4}(?:\]|\】)\s*/

  for (const block of blocks) {
    // Only number paragraphs in description sections, exclude headings, captions, tables, equations
    if (block.type === 'paragraph' && descriptionSections.includes(block.section) && !block.subtype) {
      // Strip any existing numbering pattern
      if (existingNumberRegex.test(block.content)) {
        block.content = block.content.replace(existingNumberRegex, '')
      }

      // Inject new numbering with appropriate format
      const formattedNumber = formatParagraphNumber(paragraphNumber, jurisdiction)
      block.content = formattedNumber + block.content
      paragraphNumber++
    }
  }
}

async function handleExportDOCX(user: any, patentId: string, data: any, request?: NextRequest) {
  const { sessionId, autoNumberParagraphs = false, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Determine the active jurisdiction for export (defaults to first selection)
  const fallbackJurisdiction = (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(requestedJurisdiction || fallbackJurisdiction || 'US').toUpperCase()
  const sections = await getExportSectionsForJurisdiction(effectiveJurisdiction)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  const figuresSorted = [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo)

  // Prepare content for normalization
  const rawContent: Record<string, string> = {}
  for (const s of sections) {
    switch (s.key) {
      case 'title': rawContent[s.key] = last.title || 'Untitled'; break
      case 'fieldOfInvention': rawContent[s.key] = last.fieldOfInvention || ''; break
      case 'background': rawContent[s.key] = last.background || ''; break
      case 'summary': rawContent[s.key] = last.summary || ''; break
      case 'briefDescriptionOfDrawings': rawContent[s.key] = last.briefDescriptionOfDrawings || ''; break
      case 'detailedDescription': rawContent[s.key] = last.detailedDescription || ''; break
      case 'bestMethod': rawContent[s.key] = last.bestMethod || ''; break
      case 'claims': rawContent[s.key] = last.claims || ''; break
      case 'industrialApplicability': rawContent[s.key] = (last as any).industrialApplicability || ''; break
      case 'listOfNumerals': rawContent[s.key] = last.listOfNumerals || ''; break
      case 'abstract': rawContent[s.key] = last.abstract || ''; break
      default:
        rawContent[s.key] = (last as any)?.[s.key] || ''
    }
  }

  // Run pre-export normalizer
  const { blocks } = preExportNormalizer(rawContent, sections)

  // Apply paragraph numbering if enabled (jurisdiction-specific format)
  if (autoNumberParagraphs) {
    injectParagraphNumbering(blocks, effectiveJurisdiction)
  }

  // Helper to truncate caption to fit one line on A4 (approx 85 chars at 12pt)
  const truncateCaption = (caption: string, maxLen: number = 85): string => {
    // Remove any "Fig. X -" prefix from the caption if present
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    // Truncate with ellipsis
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  const exportInput: any = {
    figures: figuresSorted.map(f => {
      const ds = (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)
      const rawCaption = f.title || `Figure ${f.figureNo}`
      return {
        figureNo: f.figureNo,
        caption: truncateCaption(rawCaption),
        imagePath: (ds?.imagePath as string) || '',
        imageFilename: (ds?.imageFilename as string) || ''
      }
    }),
    blocks, // Include normalized blocks
    exportOptions: { autoNumberParagraphs },
    sections
  }
  for (const s of sections) {
    exportInput[s.key] = rawContent[s.key] || ''
  }

  const guards = preExportGuards(exportInput, sections)
  // Note: Do not block export on pending issues; proceed regardless

  // Attempt rich DOCX export; fall back to plain text if library unavailable
  try {
    // Try to load docx at runtime without bundler resolution
    let docx: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const req = eval('require') as (m: string) => any
      docx = req('docx')
    } catch {
      throw new Error('DOCX_NOT_AVAILABLE')
    }

    const {
      Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, Media, ImageRun,
      PageBreak, Footer, Header, PageNumber, NumberOfPages, SectionType
    } = docx as any

    // Get document type configuration from country profile with user overrides
    const documentTypeConfig = await getDocumentTypeConfig(effectiveJurisdiction, 'spec_pdf')
    
    // Also get full export config with user overrides for complete settings
    const { getExportConfig } = await import('@/lib/jurisdiction-style-service')
    const exportConfig = await getExportConfig(effectiveJurisdiction, 'spec_pdf', user.id, sessionId)

    // Convert cm to twips (1 inch = 1440 twips = 2.54 cm)
    const cmToTwips = (cm: number) => Math.round(cm * 1440 / 2.54)

    // Use export config margins (includes user overrides)
    const margins = {
      top: exportConfig.marginTopCm,
      bottom: exportConfig.marginBottomCm,
      left: exportConfig.marginLeftCm,
      right: exportConfig.marginRightCm
    }

    const pageMargin = {
      top: cmToTwips(margins.top),
      bottom: cmToTwips(margins.bottom),
      left: cmToTwips(margins.left),
      right: cmToTwips(margins.right)
    }

    // Determine page size (convert to twips: A4 = 595.28 x 841.89 pt, LETTER = 612 x 792 pt)
    let pageSize = { width: 595.28, height: 841.89 } // Default A4 in points
    const pageSizeStr = exportConfig.pageSize?.toUpperCase()
    if (pageSizeStr === 'LETTER') {
      pageSize = { width: 612, height: 792 }
    } else if (pageSizeStr === 'A4') {
      pageSize = { width: 595.28, height: 841.89 }
    }

    // Get typography settings from export config (with user overrides)
    const fontFamily = exportConfig.fontFamily || 'Times New Roman'
    const fontSizePt = exportConfig.fontSizePt || 12
    const fontSizeHalfPt = fontSizePt * 2 // docx uses half-points
    const lineSpacing = exportConfig.lineSpacing || 1.5
    const lineSpacingTwips = Math.round(240 * lineSpacing) // 240 twips = single spacing
    
    // Heading font settings (fall back to body font if not specified)
    const headingFontFamily = exportConfig.headingFontFamily || fontFamily
    const headingFontSizePt = exportConfig.headingFontSizePt || (fontSizePt + 2)
    const headingFontSizeHalfPt = headingFontSizePt * 2

    // Build page header/footer based on config
    let headerElement: any = undefined
    let footerElement: any = undefined
    
    // Only add page numbers if configured
    if (exportConfig.addPageNumbers) {
      // Parse page number format - replace {page} and {total} placeholders
      const pageNumberFormat = exportConfig.pageNumberFormat || 'Page {page} of {total}'
      const formatParts = pageNumberFormat.split(/(\{page\}|\{total\})/g)
      
      const pageNumberChildren: any[] = []
      for (const part of formatParts) {
        if (part === '{page}') {
          pageNumberChildren.push(new TextRun({ children: [PageNumber.CURRENT], size: fontSizeHalfPt }))
        } else if (part === '{total}') {
          pageNumberChildren.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: fontSizeHalfPt }))
        } else if (part) {
          pageNumberChildren.push(new TextRun({ text: part, size: fontSizeHalfPt, color: '000000' }))
        }
      }
      
      // Determine alignment based on position
      const position = exportConfig.pageNumberPosition || 'header-right'
      const alignment = position.includes('right') ? AlignmentType.RIGHT 
        : position.includes('center') ? AlignmentType.CENTER 
        : AlignmentType.LEFT
      
      const pageNumberParagraph = new Paragraph({
        alignment,
        children: pageNumberChildren
      })
      
      // Place in header or footer based on position
      if (position.startsWith('footer')) {
        footerElement = new Footer({ children: [pageNumberParagraph] })
      } else {
        headerElement = new Header({ children: [pageNumberParagraph] })
      }
    }

    const doc = new Document({
      sections: [],
      styles: {
        default: {
          document: {
            run: {
              size: fontSizeHalfPt,
              font: fontFamily
            }
          }
        },
        paragraphStyles: [
          {
            id: 'bodyStyle',
            name: 'Body',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: fontSizeHalfPt,
              color: '000000', // black
              font: fontFamily
            },
            paragraph: {
              alignment: AlignmentType.JUSTIFIED,
              spacing: {
                line: lineSpacingTwips,
                before: 0,
                after: 120 // 6pt after
              }
            }
          },
          {
            id: 'headingStyle',
            name: 'Heading',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: headingFontSizeHalfPt, // Use heading font size from config
              color: '000000', // black
              bold: true,
              font: headingFontFamily // Use heading font from config
            },
            paragraph: {
              alignment: AlignmentType.LEFT,
              spacing: {
                before: 240, // 12pt before
                after: 120 // 6pt after
              }
            }
          },
          {
            id: 'captionStyle',
            name: 'Caption',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: fontSizeHalfPt,
              color: '000000', // black
              font: fontFamily
            },
            paragraph: {
              alignment: AlignmentType.LEFT,
              spacing: {
                before: 120, // 6pt before
                after: 0
              }
            }
          }
        ]
      }
    })

    // Build document sections using normalized blocks
    const documentSections: any[] = []
    const { blocks, figures, exportOptions } = exportInput

    // Build section properties with dynamic header/footer
    const buildSectionProperties = () => {
      const props: any = {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: pageMargin,
          size: {
            width: Math.round(pageSize.width * 20), // Convert points to twips (1 pt = 20 twips)
            height: Math.round(pageSize.height * 20),
            orientation: pageSize.width > pageSize.height ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT
          }
        }
      }
      // Only add headers/footers if page numbers are enabled
      if (headerElement) props.headers = { default: headerElement }
      if (footerElement) props.footers = { default: footerElement }
      return props
    }

    // Section 1: Title
    const titleSection = {
      properties: buildSectionProperties(),
      children: []
    }

    // Add title
    const titleBlock = blocks.find((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'title')
    if (titleBlock) {
      ;(titleSection.children as any[]).push(
        new Paragraph({
          text: titleBlock.content.toUpperCase(),
          heading: HeadingLevel.HEADING_1,
          style: 'headingStyle'
        })
      )
    }

    // Add body sections in jurisdiction-specific sequence
    const bodySections = sections
      .map(s => s.key)
      .filter(k => k !== 'title' && k !== 'abstract')
    for (const sectionName of bodySections) {
      // Use section heading from export config if available, otherwise fall back to profile
      const sectionHeading = exportConfig.sectionHeadings?.[sectionName] || getSectionHeadingDynamic(sectionName, sections)
      const sectionBlocks = blocks.filter((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === sectionName)

      if (sectionBlocks.length > 0) {
        // Add section heading
        ;(titleSection.children as any[]).push(
          new Paragraph({
            text: sectionHeading,
            heading: HeadingLevel.HEADING_2,
            style: 'headingStyle'
          })
        )

        // Add content blocks
        for (const block of sectionBlocks) {
          if (block.type === 'paragraph') {
            let content = block.content


            ;(titleSection.children as any[]).push(
              new Paragraph({
                children: [new TextRun({
                  text: content,
                  size: fontSizeHalfPt, // Use configured font size
                  color: '000000',
                  font: fontFamily // Use configured font family
                })],
                style: 'bodyStyle'
              })
            )
          }
        }
      }
    }

    documentSections.push(titleSection)

    // Add figure sections (one per page)
    const pat = await prisma.patent.findUnique({ where: { id: patentId }, select: { projectId: true } })
    const fs = await import('fs/promises')
    const path = await import('path')

    for (const figure of figures) {
      const figureSection = {
        properties: buildSectionProperties(),
        children: []
      }

      // Try to load and size the image
      let imageElement: any = null
      const candidates: string[] = []
      if (figure.imagePath) candidates.push(figure.imagePath)
      if (figure.imageFilename) {
        candidates.push(path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures', figure.imageFilename))
        if (pat?.projectId) candidates.push(path.join(process.cwd(), 'uploads', 'projects', pat.projectId, 'patents', patentId, 'figures', figure.imageFilename))
      }

      for (const candidatePath of candidates) {
        if (!candidatePath) continue
        try {
          const imgBuffer = await fs.readFile(candidatePath)

          // Calculate size: preserve aspect ratio
          const img = imgBuffer instanceof Buffer ? new Uint8Array(imgBuffer) : imgBuffer
          
          let width = 500 // default fallback
          let height = 400 // default fallback

          try {
            const dims = imageSize(imgBuffer)
            if (dims.width && dims.height) {
              width = dims.width
              height = dims.height

              // Calculate max width in pixels based on page settings
              // Page width (11906 TWIPS) - 2 * Margin (1440 TWIPS) = 9026 TWIPS available
              // 1440 TWIPS = 1 inch. 
              // Standard docx image resolution is often 96 DPI.
              // Max Width in Pixels = (Available TWIPS / 1440) * 96
              const availableTwips = 11906 - (pageMargin.left + pageMargin.right)
              const maxWidth = Math.floor(availableTwips / 1440 * 96)
              
              if (width > maxWidth) {
                const ratio = maxWidth / width
                width = maxWidth
                height = Math.round(height * ratio)
              }
            }
          } catch (e) {
            console.warn('Failed to calculate image dimensions', e)
          }

          imageElement = new ImageRun({
            data: img,
            transformation: {
              width: width,
              height: height
            }
          })
          break
        } catch (e) {
          // Continue to next candidate
        }
      }

      // Add image if available
      if (imageElement) {
        ;(figureSection.children as any[]).push(
          new Paragraph({
            children: [imageElement],
            alignment: AlignmentType.CENTER
          })
        )
      }

      // Add caption
      ;(figureSection.children as any[]).push(
        new Paragraph({
          children: [new TextRun({
            text: `Figure ${figure.figureNo}: ${figure.caption}`,
            size: fontSizeHalfPt, // Use configured font size
            color: '000000',
            font: fontFamily // Use configured font family
          })],
          style: 'captionStyle'
        })
      )

      documentSections.push(figureSection)
    }

    // Add abstract section at the end (last page) if applicable
    const hasAbstractSection = sections.some(s => s.key === 'abstract')
    if (hasAbstractSection) {
      const abstractSection = {
        properties: buildSectionProperties(),
        children: []
      }

      // Add patent title (repeated on abstract page)
      const titleBlockForAbstract = blocks.find((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'title')
      if (titleBlockForAbstract) {
        ;(abstractSection.children as any[]).push(
          new Paragraph({
            children: [new TextRun({
              text: titleBlockForAbstract.content,
              size: headingFontSizeHalfPt, // Use configured heading font size
              color: '000000',
              bold: true,
              font: headingFontFamily // Use configured heading font
            })],
            spacing: { after: 120 }
          })
        )
      }

      // Add ABSTRACT heading - use section headings from export config if available
      const abstractHeading = exportConfig.sectionHeadings?.['abstract'] || getSectionHeadingDynamic('abstract', sections)
      ;(abstractSection.children as any[]).push(
        new Paragraph({
          children: [new TextRun({
            text: abstractHeading,
            size: headingFontSizeHalfPt,
            color: '000000',
            bold: true,
            font: headingFontFamily
          })],
          spacing: { before: 120, after: 120 }
        })
      )

      // Add abstract content (no numbering for abstract)
      const abstractBlocks = blocks.filter((b: { type: string; section: string; subtype?: string; content: string; blockId: string }) => b.section === 'abstract')

      for (const block of abstractBlocks) {
        if (block.type === 'paragraph') {
          ;(abstractSection.children as any[]).push(
            new Paragraph({
              children: [new TextRun({
                text: block.content,
                size: fontSizeHalfPt, // Use configured font size
                color: '000000',
                font: fontFamily // Use configured font family
              })],
              style: 'bodyStyle'
            })
          )
        }
      }

      documentSections.push(abstractSection)
    }

    // Add all sections to document
    for (const section of documentSections) {
      doc.addSection(section)
    }

    const buffer = await Packer.toBuffer(doc)
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.docx"`
      }
    })
  } catch (e) {
    console.error('DOCX export error:', e)
    // Fallback to plain text packaging when docx is unavailable
    const docContent = buildAnnexurePlainText(exportInput, sections)

    const fileBuffer = Buffer.from(docContent, 'utf8')
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.txt"`
      }
    })
  }
}

// PDF Export Handler
async function handleExportPDF(user: any, patentId: string, data: any, request?: NextRequest) {
  const { sessionId, autoNumberParagraphs = false, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const fallbackJurisdiction = (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(requestedJurisdiction || fallbackJurisdiction || 'US').toUpperCase()
  const sections = await getExportSectionsForJurisdiction(effectiveJurisdiction)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Prepare content
  const rawContent: Record<string, string> = {}
  for (const s of sections) {
    switch (s.key) {
      case 'title': rawContent[s.key] = last.title || 'Untitled'; break
      case 'fieldOfInvention': rawContent[s.key] = last.fieldOfInvention || ''; break
      case 'background': rawContent[s.key] = last.background || ''; break
      case 'summary': rawContent[s.key] = last.summary || ''; break
      case 'briefDescriptionOfDrawings': rawContent[s.key] = last.briefDescriptionOfDrawings || ''; break
      case 'detailedDescription': rawContent[s.key] = last.detailedDescription || ''; break
      case 'bestMethod': rawContent[s.key] = last.bestMethod || ''; break
      case 'claims': rawContent[s.key] = last.claims || ''; break
      case 'industrialApplicability': rawContent[s.key] = (last as any).industrialApplicability || ''; break
      case 'listOfNumerals': rawContent[s.key] = last.listOfNumerals || ''; break
      case 'abstract': rawContent[s.key] = last.abstract || ''; break
      default:
        rawContent[s.key] = (last as any)?.[s.key] || ''
    }
  }

  // Run pre-export normalizer
  const { blocks } = preExportNormalizer(rawContent, sections)

  // Apply paragraph numbering if enabled (jurisdiction-specific format)
  if (autoNumberParagraphs) {
    injectParagraphNumbering(blocks, effectiveJurisdiction)
  }

  // Get full export config with user overrides
  const { getExportConfig } = await import('@/lib/jurisdiction-style-service')
  const exportConfig = await getExportConfig(effectiveJurisdiction, 'spec_pdf', user.id, sessionId)

  // Build HTML for PDF
  const pdfHtml = buildPDFHtml(rawContent, blocks, sections, effectiveJurisdiction, exportConfig, session)

  // Try to generate PDF using puppeteer or fall back to HTML
  try {
    let puppeteer: any
    try {
      const req = eval('require') as (m: string) => any
      puppeteer = req('puppeteer')
    } catch {
      // Puppeteer not available - return HTML that can be printed to PDF
      return new NextResponse(pdfHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="annexure_${sessionId}.html"`
        }
      })
    }

    // Launch browser and generate PDF
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setContent(pdfHtml, { waitUntil: 'networkidle0' })

    // Get page size and margins from export config (with user overrides)
    const pageSize = exportConfig.pageSize?.toUpperCase() === 'LETTER' ? 'Letter' : 'A4'
    const margins = {
      top: exportConfig.marginTopCm,
      bottom: exportConfig.marginBottomCm,
      left: exportConfig.marginLeftCm,
      right: exportConfig.marginRightCm
    }

    // Build header/footer templates based on config
    const headerTemplate = '<div></div>'
    let footerTemplate = '<div></div>'
    
    // Only add page numbers if configured
    if (exportConfig.addPageNumbers) {
      const position = exportConfig.pageNumberPosition || 'footer-center'
      const format = (exportConfig.pageNumberFormat || 'Page {page} of {total}')
        .replace('{page}', '<span class="pageNumber"></span>')
        .replace('{total}', '<span class="totalPages"></span>')
      
      const alignment = position.includes('right') ? 'right' 
        : position.includes('left') ? 'left' 
        : 'center'
      
      footerTemplate = `
        <div style="font-size: 10px; text-align: ${alignment}; width: 100%; color: #666; padding: 0 20px;">
          ${format}
        </div>
      `
    }

    const pdfBuffer = await page.pdf({
      format: pageSize,
      margin: {
        top: `${margins.top}cm`,
        bottom: `${margins.bottom}cm`,
        left: `${margins.left}cm`,
        right: `${margins.right}cm`
      },
      printBackground: true,
      displayHeaderFooter: exportConfig.addPageNumbers,
      headerTemplate,
      footerTemplate
    })

    await browser.close()

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.pdf"`
      }
    })
  } catch (e) {
    console.error('PDF export error:', e)
    // Fallback to HTML that can be printed to PDF
    return new NextResponse(pdfHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="annexure_${sessionId}.html"`
      }
    })
  }
}

// Build HTML for PDF export with country-specific formatting
function buildPDFHtml(
  content: Record<string, string>,
  blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }>,
  sections: ExportSectionDef[],
  jurisdiction: string,
  exportConfig: any,
  session: any
): string {
  // Use export config settings (with user overrides)
  const margins = {
    top: exportConfig.marginTopCm || 2.5,
    bottom: exportConfig.marginBottomCm || 1.0,
    left: exportConfig.marginLeftCm || 2.5,
    right: exportConfig.marginRightCm || 1.5
  }
  const fontSize = exportConfig.fontSizePt || 12
  const fontFamily = exportConfig.fontFamily || 'Times New Roman, serif'
  const lineHeight = exportConfig.lineSpacing || 1.5
  
  // Heading font settings
  const headingFontFamily = exportConfig.headingFontFamily || fontFamily
  const headingFontSize = exportConfig.headingFontSizePt || (fontSize + 2)

  // Section heading styling based on export config
  const getSectionHeading = (sectionKey: string, label: string) => {
    // Use section heading from export config if available
    const headingText = exportConfig.sectionHeadings?.[sectionKey] || label
    return `<h2 style="font-family: ${headingFontFamily}; font-size: ${headingFontSize}pt; font-weight: bold; margin-top: 24pt; margin-bottom: 12pt; text-transform: uppercase;">${headingText}</h2>`
  }

  // Build body sections
  let bodyHtml = ''
  const orderedSections = sections.filter(s => s.key !== 'title' && s.key !== 'abstract')

  for (const sec of orderedSections) {
    const sectionBlocks = blocks.filter(b => b.section === sec.key)
    if (sectionBlocks.length === 0 && !content[sec.key]?.trim()) continue

    bodyHtml += getSectionHeading(sec.key, sec.label || sec.key)

    for (const block of sectionBlocks) {
      if (block.type === 'paragraph') {
        bodyHtml += `<p style="margin-bottom: 12pt; text-align: justify;">${escapeHtml(block.content)}</p>`
      }
    }
  }

  // Add figures section
  const figures = [...(session.figurePlans || [])].sort((a, b) => a.figureNo - b.figureNo)
  if (figures.length > 0) {
    bodyHtml += getSectionHeading('briefDescriptionOfDrawings', 'Drawings / Figures')
    for (const fig of figures) {
      bodyHtml += `<p style="margin-bottom: 6pt;"><strong>Fig. ${fig.figureNo}</strong> — ${escapeHtml(fig.title || '')}</p>`
    }
  }

  // Add abstract at end
  const abstractBlocks = blocks.filter(b => b.section === 'abstract')
  if (abstractBlocks.length > 0 || content.abstract?.trim()) {
    bodyHtml += `<div style="page-break-before: always;"></div>`
    bodyHtml += getSectionHeading('abstract', 'Abstract')
    for (const block of abstractBlocks) {
      if (block.type === 'paragraph') {
        bodyHtml += `<p style="margin-bottom: 12pt; text-align: justify;">${escapeHtml(block.content)}</p>`
      }
    }
  }

  // Full HTML document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(content.title || 'Patent Annexure')}</title>
  <style>
    @page {
      size: ${exportConfig.pageSize || 'A4'};
      margin: ${margins.top}cm ${margins.right}cm ${margins.bottom}cm ${margins.left}cm;
    }
    body {
      font-family: ${fontFamily};
      font-size: ${fontSize}pt;
      line-height: ${lineHeight};
      color: #000;
      max-width: 100%;
    }
    h1 {
      font-family: ${headingFontFamily};
      font-size: ${headingFontSize + 2}pt;
      font-weight: bold;
      text-align: center;
      margin-bottom: 24pt;
      text-transform: uppercase;
    }
    h2 {
      font-family: ${headingFontFamily};
      font-size: ${headingFontSize}pt;
      font-weight: bold;
      margin-top: 24pt;
      margin-bottom: 12pt;
      text-transform: uppercase;
    }
    p {
      margin-bottom: 12pt;
      text-align: justify;
    }
    .title-block {
      text-align: center;
      margin-bottom: 36pt;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="title-block">
    <h1>${escapeHtml(content.title || 'UNTITLED')}</h1>
    <p style="text-align: center; font-style: italic;">Jurisdiction: ${jurisdiction}</p>
  </div>
  ${bodyHtml}
</body>
</html>`
}

// HTML escape helper
function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
}

// Preview export builder and guards
function buildAnnexurePlainText(doc: any, sections?: ExportSectionDef[]): string {
  const H = (s: string) => String(s||'').toUpperCase()
  const orderedSections = (sections && sections.length ? sections : defaultExportSections)
  const SECTIONS: Array<[string, string]> = orderedSections.map(s => [H(s.label || s.key), doc[s.key] || ''])
  const BODY = SECTIONS.filter(([_,v]) => String(v||'').trim()).map(([h,v]) => `${h}\n\n${String(v).trim()}`).join('\n\n')
  const PAGE_BREAK = '\n\n<<<PAGE_BREAK>>>\n\n'
  const DRAWINGS_HEADER = H('Drawings / Figures')
  const FIGURE_PAGES = [`${DRAWINGS_HEADER}\n\n`]
    .concat(
      (doc.figures || [])
        .sort((a:any,b:any)=>a.figureNo-b.figureNo)
        .map((f:any)=>`Fig. ${f.figureNo} - ${String(f.caption||'').replace(/^Fig\.\s*\d+\s*-\s*/i,'')}`)
    )
    .join(PAGE_BREAK)
  return [BODY, PAGE_BREAK, FIGURE_PAGES].join('')
}

function preExportGuards(doc: any, sections?: ExportSectionDef[]): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const orderedSections = (sections && sections.length ? sections : defaultExportSections)
  const req = (key: string, label: string, required?: boolean) => { if (required === false) return; if (!String(doc[key]||'').trim()) issues.push(`Missing: ${label}`) }
  for (const s of orderedSections) {
    req(s.key, s.label || s.key, s.required)
  }

  const hasAbstract = orderedSections.some(s => s.key === 'abstract')
  if (hasAbstract) {
    const absWords = String(doc.abstract||'').trim().split(/\s+/).filter(Boolean).length
    if (absWords>150) issues.push(`Abstract exceeds 150 words (${absWords})`)
  }

  const declared = (doc.figures||[]).map((f:any)=>f.figureNo).sort((a:number,b:number)=>a-b)
  const bdod = String(doc.briefDescriptionOfDrawings||'')
  const hasBDOD = orderedSections.some(s => s.key === 'briefDescriptionOfDrawings')
  if (hasBDOD) {
    if (bdod.trim()) {
      const bdodFigs = Array.from(bdod.matchAll(/\b(Fig\.?|Figure)\s*0*(\d+)\b/gi)).map(m=>Number(m[2])).sort((a,b)=>a-b)
      const missing = declared.filter((n:number)=>!bdodFigs.includes(n))
      if (missing.length) issues.push(`BDOD missing figure lines for: ${missing.join(', ')}`)
    } else if (declared.length) {
      issues.push('BDOD missing while figures are present')
    }
  }

  if (String(doc.listOfNumerals||'').trim()) {
    const nums = Array.from(String(doc.listOfNumerals).matchAll(/\((\d{1,5})\)/g)).map(m=>Number(m[1]))
    const dup = nums.filter((n,i)=>nums.indexOf(n)!==i)
    if (dup.length) issues.push(`Duplicate numerals in list: ${Array.from(new Set(dup)).join(', ')}`)
  }
  return { ok: issues.length===0, issues }
}

async function handlePreviewExport(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const jurisdiction = requestedJurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(jurisdiction || 'US').toUpperCase()
  const sections = await getExportSectionsForJurisdiction(effectiveJurisdiction)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Helper to truncate caption to fit one line on A4 (approx 85 chars at 12pt)
  const truncateCaptionPreview = (caption: string, maxLen: number = 85): string => {
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  const exportInput: any = {
    figures: [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>({
      figureNo: f.figureNo,
      caption: truncateCaptionPreview(f.title || `Figure ${f.figureNo}`),
      imagePathOrBuffer: (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)?.imagePath || ''
    })),
    sections
  }
  for (const s of sections) {
    exportInput[s.key] = (last as any)?.[s.key] || ''
  }

  const guards = preExportGuards(exportInput, sections)
  
  // Add word/character limit validation from country profile
  const wordLimitIssues = await validateSectionWordLimits(exportInput, effectiveJurisdiction, sections)
  const allIssues = [...guards.issues, ...wordLimitIssues]
  
  const plain = buildAnnexurePlainText(exportInput, sections)
  return NextResponse.json({ 
    ok: guards.ok && wordLimitIssues.length === 0, 
    issues: allIssues, 
    preview: plain, 
    input: exportInput, 
    sections,
    wordLimitIssues
  })
}

// Validate section word/character limits from country profile
async function validateSectionWordLimits(
  content: Record<string, string>,
  jurisdiction: string,
  sections: ExportSectionDef[]
): Promise<string[]> {
  const issues: string[] = []
  
  try {
    const profile = await getCountryProfile(jurisdiction)
    if (!profile?.profileData?.structure?.variants) return issues
    
    const variant = profile.profileData.structure.variants.find(
      (v: any) => v.id === profile.profileData.structure.defaultVariant
    ) || profile.profileData.structure.variants[0]
    
    if (!variant?.sections) return issues
    
    // Create a map of section limits
    const sectionLimits: Record<string, { maxWords?: number; maxChars?: number; label: string }> = {}
    for (const sec of variant.sections) {
      const keys = [sec.id, ...(sec.canonicalKeys || [])]
      const limits = {
        maxWords: sec.maxWords || sec.maxLengthWords,
        maxChars: sec.maxLengthChars || sec.maxChars,
        label: sec.label || sec.id
      }
      for (const key of keys) {
        sectionLimits[key.toLowerCase()] = limits
        // Also map to internal keys
        const internalKey = canonicalSectionMap[key.toLowerCase()]
        if (internalKey) {
          sectionLimits[internalKey] = limits
        }
      }
    }
    
    // Check each section
    for (const sec of sections) {
      const text = content[sec.key] || ''
      if (!text.trim()) continue
      
      const limits = sectionLimits[sec.key] || sectionLimits[sec.key.toLowerCase()]
      if (!limits) continue
      
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
      const charCount = text.length
      
      if (limits.maxWords && wordCount > limits.maxWords) {
        issues.push(`${limits.label || sec.label}: ${wordCount} words exceeds ${limits.maxWords} word limit`)
      }
      
      if (limits.maxChars && charCount > limits.maxChars) {
        issues.push(`${limits.label || sec.label}: ${charCount} characters exceeds ${limits.maxChars} character limit`)
      }
    }
    
    // Special check for Abstract (common requirement: 150 words max)
    const abstractText = content.abstract || ''
    if (abstractText.trim()) {
      const abstractWords = abstractText.split(/\s+/).filter(w => w.length > 0).length
      const abstractLimit = sectionLimits.abstract?.maxWords || 150 // Default 150 for most jurisdictions
      if (abstractWords > abstractLimit) {
        // Only add if not already covered
        if (!issues.some(i => i.includes('Abstract'))) {
          issues.push(`Abstract: ${abstractWords} words exceeds ${abstractLimit} word limit`)
        }
      }
    }
    
  } catch (err) {
    console.warn('[ExportPreview] Word limit validation error:', err)
  }
  
  return issues
}

// Rich preview payload with figure data (for inline HTML preview)
async function handleGetExportPreview(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction: requestedJurisdiction } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const jurisdiction = requestedJurisdiction || (session as any).activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US'
  const effectiveJurisdiction = String(jurisdiction || 'US').toUpperCase()
  const sections = await getExportSectionsForJurisdiction(effectiveJurisdiction)

  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  if (!last) {
    return NextResponse.json({ error: `No draft to export for jurisdiction ${effectiveJurisdiction}` }, { status: 400 })
  }

  // Helper to truncate caption for export preview (one line max on A4)
  const truncateCaptionForPreview = (caption: string, maxLen: number = 85): string => {
    let clean = caption.replace(/^(Fig\.?\s*\d+\s*[-:–]\s*)/i, '').trim()
    if (clean.length <= maxLen) return clean
    return clean.substring(0, maxLen - 3).trim() + '...'
  }

  const figures = [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>{
    const ds = (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)
    const hasImage = !!(ds && (ds.imagePath || ds.imageFilename))
    const url = hasImage ? `/api/patents/${patentId}/drafting?image=figure&sessionId=${session.id}&figureNo=${f.figureNo}` : null
    return {
      figureNo: f.figureNo,
      caption: truncateCaptionForPreview(f.title || `Figure ${f.figureNo}`),
      imageUrl: url
    }
  })
  const payload: any = { figures, sections }
  for (const s of sections) {
    payload[s.key] = (last as any)?.[s.key] || ''
  }
  return NextResponse.json(payload)
}

function sanitizePlantUML(input: string): string {
  const match = input.match(/@startuml[\s\S]*?@enduml/)
  const block = match ? match[0] : input
  // Remove multi-line skinparam blocks
  let cleaned = block.replace(/skinparam\b[^\n{]*\{[\s\S]*?\}/gmi, '')
  // Remove single lines we don't allow
  cleaned = cleaned
    .split(/\r?\n/)
    .filter(line => {
      if (/^\s*!\s*(theme|include|import|pragma)\b/i.test(line)) return false
      if (/^\s*skinparam\b/i.test(line)) return false
      if (/^\s*(title|caption)\b/i.test(line)) return false
      // Drop obviously incomplete connection lines like "500 --"
      if (/^\s*\d+\s*--\s*$/.test(line)) return false
      return true
    })
    .join('\n')
  return cleaned
}

async function handleStartSession(user: any, patentId: string, data: any) {
  // Check if a session already exists
  const existingSession = await prisma.draftingSession.findFirst({
    where: {
      patentId,
      userId: user.id,
      status: { not: 'COMPLETED' }
    }
  });

  if (existingSession) {
    return NextResponse.json({
      session: existingSession,
      message: 'Existing session found'
    });
  }

  // Default to IN (India) as the initial jurisdiction for new sessions
  const defaultJurisdiction = 'IN';

  // Create new drafting session with default jurisdiction
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      draftingJurisdictions: [defaultJurisdiction],
      activeJurisdiction: defaultJurisdiction
    }
  });

  return NextResponse.json({ session }, { status: 201 });
}

async function handleUpdateIdeaRecord(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data

  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json(
      { error: 'Session ID and patch object are required' },
      { status: 400 }
    )
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Build safe update payload (partial updates allowed)
  const allowedKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod','normalizedData',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags','title',
    'rawInput','abstract','cpcCodes','ipcCodes'
  ] as const

  const updateData: Record<string, any> = {}
  for (const key of allowedKeys) {
    if (key in patch) updateData[key] = patch[key]
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update' },
      { status: 400 }
    )
  }

  // Fetch existing to preserve required fields and normalized JSON
  const existing = await prisma.ideaRecord.findUnique({ where: { sessionId } })

  // Merge edits into normalizedData to keep a single source of truth
  const normalizedMergeKeys = [
    'problem','objectives','components','logic','inputs','outputs','variants','bestMethod',
    'fieldOfRelevance','subfield','recommendedFocus','complianceNotes','drawingsFocus','claimStrategy','riskFlags',
    'abstract','cpcCodes','ipcCodes'
  ] as const

  const baseNormalized = (existing?.normalizedData as any) || {}
  const normalizedPatch: Record<string, any> = {}
  normalizedMergeKeys.forEach((k) => {
    if (k in patch) normalizedPatch[k] = (patch as any)[k]
  })
  const mergedNormalized = { ...baseNormalized, ...normalizedPatch }

  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId },
    update: { ...updateData, normalizedData: mergedNormalized },
    create: {
      sessionId,
      title: updateData.title || 'Untitled',
      rawInput: '',
      normalizedData: Object.keys(mergedNormalized).length ? mergedNormalized : {},
      ...updateData
    }
  })

  // Persist raw input to disk if provided
  try {
    if (typeof updateData.rawInput === 'string') {
      const fs = await import('fs/promises')
      const path = await import('path')
      const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId)
      await fs.mkdir(baseDir, { recursive: true })
      const filePath = path.join(baseDir, 'raw-idea.txt')
      await fs.writeFile(filePath, updateData.rawInput, 'utf8')
    }
  } catch (e) {
    console.warn('Failed to persist raw idea to disk:', e)
  }

  return NextResponse.json({ ideaRecord })
}

// ============================================================================
// CLAIMS GENERATION AND MANAGEMENT HANDLERS (Stage 1)
// ============================================================================

async function handleGenerateClaims(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, jurisdiction, ideaContext } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Check if claims are already frozen
  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  if (existingNormalized.claimsApprovedAt) {
    return NextResponse.json({ error: 'Claims are frozen. Unfreeze to regenerate.' }, { status: 400 })
  }

  try {
    // Get country profile for jurisdiction-specific claim rules
    const activeJurisdiction = (jurisdiction || session.activeJurisdiction || 'US').toUpperCase()
    const countryProfile = await getCountryProfile(activeJurisdiction)
    
    // Extract claim rules from country profile
    const claimRules = countryProfile?.profileData?.rules?.claims || {}
    const claimPrompt = countryProfile?.profileData?.prompts?.sections?.claims || {}
    
    // Build context from idea record or provided context
    const idea = session.ideaRecord || {} as any
    const context = ideaContext || {
      title: idea.title,
      problem: idea.problem,
      objectives: idea.objectives,
      logic: idea.logic,
      components: idea.components,
      bestMethod: idea.bestMethod,
      abstract: idea.abstract
    }

    // Format components for the prompt
    const componentsList = Array.isArray(context.components)
      ? context.components.map((c: any) => `- ${c.name}${c.type ? ` (${c.type})` : ''}`).join('\n')
      : ''

    // Build jurisdiction-specific instructions
    const jurisdictionInstructions: string[] = []
    
    if (claimRules.twoPartFormPreferred === true) {
      jurisdictionInstructions.push('- Use two-part claim format: preamble + "characterized in that" + characterizing portion')
    } else if (claimRules.twoPartFormPreferred === false) {
      jurisdictionInstructions.push('- Use single-part claims (avoid two-part "characterized in that" format)')
    }
    
    if (claimRules.allowMultipleDependent === false) {
      jurisdictionInstructions.push('- Each dependent claim must reference only ONE prior claim (no multiple dependency)')
    } else if (claimRules.allowMultipleDependent === true) {
      jurisdictionInstructions.push('- Multiple dependent claims are allowed (can reference multiple prior claims)')
    }

    if (claimRules.maxClaimsWithoutFee) {
      jurisdictionInstructions.push(`- ${activeJurisdiction} allows ${claimRules.maxClaimsWithoutFee} claims without additional fees`)
    }

    if (claimRules.independentClaimsLimit) {
      jurisdictionInstructions.push(`- Limit to ${claimRules.independentClaimsLimit} independent claims`)
    }

    // Build the claims generation prompt
    const prompt = `You are an expert patent attorney drafting patent claims for jurisdiction: ${activeJurisdiction}.

INVENTION CONTEXT:
Title: ${context.title || 'Untitled Invention'}

Problem: ${context.problem || 'Not specified'}

Objectives: ${context.objectives || 'Not specified'}

Technical Logic: ${context.logic || 'Not specified'}

Key Components:
${componentsList || 'Not specified'}

Best Method: ${context.bestMethod || 'Not specified'}

Abstract: ${context.abstract || 'Not specified'}

JURISDICTION-SPECIFIC RULES (${activeJurisdiction}):
${jurisdictionInstructions.length > 0 ? jurisdictionInstructions.join('\n') : '- Follow standard patent claim drafting practices'}

${claimPrompt.instruction ? `ADDITIONAL INSTRUCTIONS:\n${claimPrompt.instruction}` : ''}

REQUIREMENTS:
1. Generate a comprehensive claim set with:
   - At least 1 independent method claim
   - At least 1 independent system/apparatus claim
   - 3-5 dependent claims for each independent claim
2. Each claim must be complete and self-contained
3. Use proper claim language and terminology
4. Reference components by name consistently
5. Claims should protect the core innovation and variations

OUTPUT FORMAT:
Return a JSON object with this structure:
{
  "claims": [
    {
      "number": 1,
      "type": "independent",
      "category": "method",
      "text": "A method for... comprising: a) first step...; b) second step..."
    },
    {
      "number": 2,
      "type": "dependent",
      "dependsOn": 1,
      "category": "method",
      "text": "The method of claim 1, wherein..."
    }
  ]
}

Return ONLY the JSON object, no markdown fencing or explanation.`

    // Call LLM to generate claims using the proper gateway API
    const request = { headers: requestHeaders || {} }
    const llmResult = await llmGateway.executeLLMOperation(request, {
      taskCode: 'LLM2_DRAFT',
      prompt,
      idempotencyKey: crypto.randomUUID(),
      inputTokens: Math.ceil(prompt.length / 4),
      metadata: {
        purpose: 'claims_generation',
        jurisdiction: activeJurisdiction,
        sessionId
      }
    })

    if (!llmResult.success || !llmResult.response) {
      console.error('Claims generation LLM error:', llmResult.error)
      return NextResponse.json({ 
        error: 'Failed to generate claims', 
        details: llmResult.error?.message || 'LLM operation failed' 
      }, { status: 500 })
    }

    // Parse the LLM response
    let generatedClaims: any[] = []
    try {
      const cleanedResponse = llmResult.response.output
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
      const parsed = JSON.parse(cleanedResponse)
      generatedClaims = Array.isArray(parsed.claims) ? parsed.claims : (Array.isArray(parsed) ? parsed : [])
    } catch (parseErr) {
      console.error('Failed to parse claims JSON:', parseErr)
      // Try to extract claims from text if JSON parsing fails
      generatedClaims = []
    }

    // Format claims as HTML for the editor
    const claimsHtml = generatedClaims.map((c: any) => {
      const typeLabel = c.type === 'dependent' && c.dependsOn ? `(Claim ${c.dependsOn})` : `(${c.category || 'independent'})`
      return `<p><strong>${c.number}.</strong> ${c.text}</p>`
    }).join('\n')

    // Save to ideaRecord normalizedData
    const updatedNormalized = {
      ...existingNormalized,
      claims: claimsHtml,
      claimsStructured: generatedClaims,
      claimsJurisdiction: activeJurisdiction,
      claimsGeneratedAt: new Date().toISOString()
    }

    await prisma.ideaRecord.update({
      where: { sessionId },
      data: { normalizedData: updatedNormalized }
    })

    return NextResponse.json({
      claims: generatedClaims,
      claimsHtml,
      jurisdiction: activeJurisdiction,
      tokensUsed: (llmResult.response?.outputTokens || 0) + Math.ceil(prompt.length / 4)
    })

  } catch (error) {
    console.error('Claims generation error:', error)
    return NextResponse.json({ error: 'Failed to generate claims' }, { status: 500 })
  }
}

async function handleSaveClaims(user: any, patentId: string, data: any) {
  const { sessionId, claims, claimsStructured } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Check if claims are frozen
  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  if (existingNormalized.claimsApprovedAt) {
    return NextResponse.json({ error: 'Claims are frozen. Unfreeze to edit.' }, { status: 400 })
  }

  // Update claims in normalizedData
  const updatedNormalized = {
    ...existingNormalized,
    claims: claims || existingNormalized.claims,
    claimsStructured: claimsStructured || existingNormalized.claimsStructured,
    claimsLastSavedAt: new Date().toISOString()
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: updatedNormalized }
  })

  return NextResponse.json({ success: true, savedAt: updatedNormalized.claimsLastSavedAt })
}

async function handleFreezeClaims(user: any, patentId: string, data: any) {
  const { sessionId, claims, claimsStructured, jurisdiction } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}
  
  // Validate claims content
  const claimsContent = claims || existingNormalized.claims
  if (!claimsContent || (typeof claimsContent === 'string' && claimsContent.trim() === '')) {
    return NextResponse.json({ error: 'Cannot freeze empty claims' }, { status: 400 })
  }

  // Freeze claims
  const updatedNormalized = {
    ...existingNormalized,
    claims: claimsContent,
    claimsStructured: claimsStructured || existingNormalized.claimsStructured,
    claimsApprovedAt: new Date().toISOString(),
    claimsApprovedBy: user.id,
    claimsJurisdiction: jurisdiction || existingNormalized.claimsJurisdiction || session.activeJurisdiction || 'US'
  }

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: updatedNormalized }
  })

  return NextResponse.json({
    success: true,
    frozenAt: updatedNormalized.claimsApprovedAt,
    jurisdiction: updatedNormalized.claimsJurisdiction
  })
}

async function handleUnfreezeClaims(user: any, patentId: string, data: any) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  // Verify ownership
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { ideaRecord: true }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const existingNormalized = (session.ideaRecord?.normalizedData as any) || {}

  // Remove freeze flags but keep the claims content
  const { claimsApprovedAt, claimsApprovedBy, ...restNormalized } = existingNormalized

  await prisma.ideaRecord.update({
    where: { sessionId },
    data: { normalizedData: restNormalized }
  })

  return NextResponse.json({ success: true, unfrozenAt: new Date().toISOString() })
}

async function handleSetStage(user: any, patentId: string, data: any) {
  const {
    sessionId,
    stage,
    manualPriorArt,
    selectedPatents,
    draftingJurisdictions,
    activeJurisdiction,
    languageByJurisdiction,
    sourceOfTruth,
    isMultiJurisdiction
  } = data

  console.log('handleSetStage called with:', { sessionId, stage, patentId, userId: user.id, manualPriorArt: !!manualPriorArt, selectedPatentsCount: selectedPatents?.length || 0 })

  // COUNTRY_WISE_DRAFTING kept for backward compatibility with existing sessions
  const allowedStages = [
    'IDEA_ENTRY',
    'COMPONENT_PLANNER',
    'FIGURE_PLANNER',
    'RELATED_ART',
    'COUNTRY_WISE_DRAFTING', // Legacy - jurisdiction now selected in Stage 0
    'ANNEXURE_DRAFT',
    'REVIEW_FIX',
    'EXPORT_READY',
    'COMPLETED'
  ]

  if (!sessionId || !allowedStages.includes(stage)) {
    console.log('Invalid sessionId or stage:', { sessionId, stage })
    return NextResponse.json(
      { error: 'Valid sessionId and stage are required' },
      { status: 400 }
    )
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  console.log('Session lookup result:', session ? 'found' : 'not found')

  if (!session) {
    // Try to find the session without patentId constraint to debug
    const sessionWithoutPatent = await prisma.draftingSession.findFirst({
      where: { id: sessionId, userId: user.id }
    })
    console.log('Session exists but wrong patent?', sessionWithoutPatent ? `belongs to patent: ${sessionWithoutPatent.patentId}` : 'session not found at all')

    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    )
  }

  // Prepare update data
  const updateData: any = { status: stage }

  // Default jurisdiction fallback (IN for India)
  const defaultJurisdiction = 'IN';

  // Normalize and persist jurisdiction choices (Stage 3.7a)
  // NOTE: 'REFERENCE' is a pseudo-jurisdiction for storing reference drafts, NOT a real country
  try {
    const statusMap: Record<string, any> = { ...(session.jurisdictionDraftStatus as any) || {} }
    const languagePrefs: Record<string, string> = {}
    let normalizedJurisdictions: string[] | undefined
    if (Array.isArray(draftingJurisdictions)) {
      normalizedJurisdictions = Array.from(new Set(
        draftingJurisdictions
          .map((c: string) => (c || '').toUpperCase())
          .filter(Boolean)
          .filter((c: string) => c !== 'REFERENCE') // Filter out REFERENCE - it's not a real country
      ))
    }

    if (normalizedJurisdictions && normalizedJurisdictions.length > 0) {
      updateData.draftingJurisdictions = normalizedJurisdictions
    } else if (!session.draftingJurisdictions || session.draftingJurisdictions.length === 0) {
      updateData.draftingJurisdictions = [defaultJurisdiction] // use default jurisdiction
    }

    const chosenList = Array.from(new Set(
      ((updateData.draftingJurisdictions as string[] | undefined) || session.draftingJurisdictions || [])
        .map((c: string) => (c || '').toUpperCase())
        .filter((c: string) => c !== 'REFERENCE') // Filter out REFERENCE
    ))
    if (!updateData.draftingJurisdictions && chosenList.length > 0) {
      updateData.draftingJurisdictions = chosenList
    }

    // AUTO-SET isMultiJurisdiction based on number of actual jurisdictions selected
    // This is crucial for reference draft generation to work correctly
    const actualJurisdictionCount = chosenList.length
    if (actualJurisdictionCount > 1) {
      updateData.isMultiJurisdiction = true
      console.log(`[handleSetStage] Auto-enabled multi-jurisdiction mode for ${actualJurisdictionCount} jurisdictions: ${chosenList.join(', ')}`)
    } else if (typeof isMultiJurisdiction === 'boolean') {
      // Allow explicit override
      updateData.isMultiJurisdiction = isMultiJurisdiction
      // Reset reference draft status when switching to single mode
      if (!isMultiJurisdiction) {
        updateData.referenceDraftComplete = false
        updateData.referenceDraftId = null
      }
    }

    // Resolve active jurisdiction - NEVER allow 'REFERENCE' as active
    const requestedActive = (activeJurisdiction || '').toUpperCase()
    const validRequestedActive = requestedActive !== 'REFERENCE' && chosenList.includes(requestedActive)
      ? requestedActive
      : null
    const resolvedActive = validRequestedActive 
      || chosenList[0] 
      || (session.activeJurisdiction !== 'REFERENCE' ? session.activeJurisdiction : null)
      || defaultJurisdiction

    updateData.activeJurisdiction = resolvedActive
    
    // Log for debugging
    console.log(`[handleSetStage] Jurisdictions: ${chosenList.join(', ')}, Active: ${resolvedActive}, MultiJurisdiction: ${updateData.isMultiJurisdiction ?? session.isMultiJurisdiction}`)

    // Resolve preferred languages per jurisdiction (if provided)
    for (const code of chosenList) {
      try {
        const profile = await getCountryProfile(code)
        const langs: string[] = Array.isArray((profile as any)?.profileData?.meta?.languages)
          ? (profile as any).profileData.meta.languages
          : []
        if (!langs.length) continue
        const requestedLang = (languageByJurisdiction && typeof languageByJurisdiction[code] === 'string')
          ? String(languageByJurisdiction[code]).trim()
          : ''
        const normalized = requestedLang && langs.includes(requestedLang) ? requestedLang : langs[0]
        if (normalized) languagePrefs[code] = normalized
      } catch (err) {
        console.warn('Failed to resolve languages for', code, err)
      }
    }

    if (Object.keys(languagePrefs).length > 0) {
      for (const [code, lang] of Object.entries(languagePrefs)) {
        statusMap[code] = { ...(statusMap?.[code] || {}), language: lang }
      }
    }

    // Resolve and persist source-of-truth jurisdiction (order drives reference draft selection)
    const requestedSource = typeof sourceOfTruth === 'string' ? sourceOfTruth.toUpperCase() : undefined
    let resolvedSource = (requestedSource && chosenList.includes(requestedSource))
      ? requestedSource
      : (typeof statusMap.__sourceOfTruth === 'string' && chosenList.includes(String(statusMap.__sourceOfTruth).toUpperCase())
        ? String(statusMap.__sourceOfTruth).toUpperCase()
        : undefined)
    if (!resolvedSource && chosenList.length > 0) resolvedSource = chosenList[0]
    if (resolvedSource) {
      statusMap.__sourceOfTruth = resolvedSource
      const ordered = [resolvedSource, ...chosenList.filter(c => c !== resolvedSource)]
      updateData.draftingJurisdictions = ordered
    }

    updateData.jurisdictionDraftStatus = statusMap
  } catch (e) {
    console.warn('Failed to persist drafting jurisdictions; continuing with defaults.', e)
  }

  if (manualPriorArt !== undefined) {
    updateData.manualPriorArt = manualPriorArt
  }

  const updated = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: updateData as any
  })

  return NextResponse.json({ session: updated })
}

async function handleResume(user: any, patentId: string) {
  // Default to IN (India) for new/legacy sessions
  const defaultJurisdiction = 'IN';

  // Try to find most recent session for this patent
  const existing = await prisma.draftingSession.findFirst({
    where: { patentId, userId: user.id },
    orderBy: { createdAt: 'desc' }
  })

  if (existing) {
    // Backfill jurisdiction defaults for legacy sessions
    if (!existing.draftingJurisdictions || existing.draftingJurisdictions.length === 0 || !existing.activeJurisdiction) {
      const updated = await prisma.draftingSession.update({
        where: { id: existing.id },
        data: {
          draftingJurisdictions: existing.draftingJurisdictions?.length ? existing.draftingJurisdictions : [defaultJurisdiction],
          activeJurisdiction: existing.activeJurisdiction || existing.draftingJurisdictions?.[0] || defaultJurisdiction
        }
      })
      return NextResponse.json({ session: updated })
    }
    return NextResponse.json({ session: existing })
  }

  // Create new session with default jurisdiction
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      draftingJurisdictions: [defaultJurisdiction],
      activeJurisdiction: defaultJurisdiction
    }
  })

  return NextResponse.json({ session }, { status: 201 })
}

async function handleProceedToComponents(user: any, patentId: string, data: any) {
  const { sessionId } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Update session status to COMPONENT_PLANNER
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'COMPONENT_PLANNER' }
  });

  return NextResponse.json({ message: 'Proceeded to component planning' });
}

async function handleNormalizeIdea(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, rawIdea, title, areaOfInvention, allowRefine } = data;

  if (!sessionId || !rawIdea || !title) {
    return NextResponse.json(
      { error: 'Session ID, raw idea, and title are required' },
      { status: 400 }
    );
  }

  // Validate title length (ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤ 15 words)
  const titleWords = title.trim().split(/\s+/).length;
  if (titleWords > 15) {
    return NextResponse.json(
      { error: 'Title must be 15 words or less' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Use LLM to normalize the idea
  console.log('Starting idea normalization for patent:', patentId, 'session:', sessionId);

  const result = await DraftingService.normalizeIdea(rawIdea, title, user.tenantId, requestHeaders, areaOfInvention, allowRefine);

  if (!result.success) {
    console.error('Idea normalization failed:', result.error);
    return NextResponse.json(
      { error: `Failed to normalize idea: ${result.error}` },
      { status: 400 }
    );
  }

  console.log('Idea normalization successful');

  // Create or update idea record
  const ideaRecord = await prisma.ideaRecord.upsert({
    where: { sessionId },
    update: ({
      title,
      rawInput: rawIdea,
      normalizedData: result.normalizedData,
      searchQuery: (result.extractedFields as any)?.searchQuery || null,
      problem: result.extractedFields?.problem,
      objectives: result.extractedFields?.objectives,
      components: result.extractedFields?.components,
      logic: result.extractedFields?.logic,
      inputs: result.extractedFields?.inputs,
      outputs: result.extractedFields?.outputs,
      variants: result.extractedFields?.variants,
      bestMethod: result.extractedFields?.bestMethod,
      abstract: result.extractedFields?.abstract,
      cpcCodes: (result.extractedFields as any)?.cpcCodes || [],
      ipcCodes: (result.extractedFields as any)?.ipcCodes || [],
      llmPromptUsed: result.llmPrompt,
      llmResponse: result.llmResponse,
      tokensUsed: result.tokensUsed
    } as any),
    create: ({
      sessionId,
      title,
      rawInput: rawIdea,
      normalizedData: result.normalizedData,
      searchQuery: (result.extractedFields as any)?.searchQuery || null,
      problem: result.extractedFields?.problem,
      objectives: result.extractedFields?.objectives,
      components: result.extractedFields?.components,
      logic: result.extractedFields?.logic,
      inputs: result.extractedFields?.inputs,
      outputs: result.extractedFields?.outputs,
      variants: result.extractedFields?.variants,
      bestMethod: result.extractedFields?.bestMethod,
      abstract: result.extractedFields?.abstract,
      cpcCodes: (result.extractedFields as any)?.cpcCodes || [],
      ipcCodes: (result.extractedFields as any)?.ipcCodes || [],
      llmPromptUsed: result.llmPrompt,
      llmResponse: result.llmResponse,
      tokensUsed: result.tokensUsed
    } as any)
  });

  // Keep session status as IDEA_ENTRY so user sees Stage 1 first
  // Status will be updated to COMPONENT_PLANNER when they proceed from Stage 1
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'IDEA_ENTRY' }
  });

  return NextResponse.json({
    ideaRecord,
    normalizedData: result.normalizedData,
    extractedFields: result.extractedFields
  });
}

async function handleUpdateComponentMap(user: any, patentId: string, data: any) {
  const { sessionId, components } = data;

  if (!sessionId || !components) {
    return NextResponse.json(
      { error: 'Session ID and components are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Validate components and assign numerals
  const validation = DraftingService.validateComponentMap(components);

  if (!validation.valid) {
    console.error('Component map validation failed:', validation.errors);
    console.error('Components received:', JSON.stringify(components, null, 2));
    return NextResponse.json(
      {
        error: 'Component validation failed. Please check that all components have valid names and the hierarchy is correct.',
        details: validation.errors,
        code: 'INVALID_COMPONENT_MAP'
      },
      { status: 400 }
    );
  }

  // Create or update reference map
  const referenceMap = await prisma.referenceMap.upsert({
    where: { sessionId },
    update: {
      components: validation.components,
      isValid: true,
      validationErrors: undefined
    },
    create: {
      sessionId,
      components: validation.components,
      isValid: true
    }
  });

  // Note: We don't automatically advance to FIGURE_PLANNER here
  // The user should manually proceed when ready

  return NextResponse.json({ referenceMap });
}

async function handleUpdateFigurePlan(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, nodes, edges, description } = data;

  if (!sessionId || !figureNo || !title) {
    return NextResponse.json(
      { error: 'Session ID, figure number, and title are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${figureNo}`

  // Create or update figure plan
  const figurePlan = await prisma.figurePlan.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      title: cleanedTitle,
      nodes,
      edges,
      description
    },
    create: {
      sessionId,
      figureNo,
      title: cleanedTitle,
      nodes,
      edges,
      description
    }
  });

  // Update session status if this is the first figure
  const figureCount = await prisma.figurePlan.count({ where: { sessionId } });
  if (figureCount === 1) {
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { status: 'FIGURE_PLANNER' }
    });
  }

  return NextResponse.json({ figurePlan });
}

async function handleTestPQAIKey() {
  // Direct PQAI only
  const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || ''
  if (!token) {
    return NextResponse.json({ keyPresent: false, message: 'No PQAI API token configured. Set PQAI_API_TOKEN.' })
  }

  const baseUrl = 'https://api.projectpq.ai/search/102'
  const params = new URLSearchParams({ q: 'drone navigation system', n: '1', type: 'patent', snip: '1', token })
  const url = `${baseUrl}?${params.toString()}`

  console.log('Testing PQAI API (Direct):', { url, hasToken: !!token, tokenLength: token.length })

  try {
    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(url, { method: 'GET', signal: controller.signal })
    clearTimeout(to)
    const text = await resp.text()
    console.log('PQAI test response:', { status: resp.status, statusText: resp.statusText, bodyPreview: text.substring(0, 200) })
    return NextResponse.json({
      keyPresent: true,
      usingDirect: true,
      testStatus: resp.status,
      testOk: resp.ok,
      method: 'GET',
      url,
      responseText: text.substring(0, 300),
      message: resp.ok ? 'API call succeeded (Direct PQAI)' : `API call returned ${resp.status}: ${resp.statusText}`
    })
  } catch (e) {
    console.log('PQAI test network error:', e)
    return NextResponse.json({ keyPresent: true, usingDirect: true, testStatus: 'error', error: String(e), message: 'Network error calling PQAI test endpoint' })
  }
}

async function handleMockRelatedArtSearch() {
  // Mock response for testing UI functionality
  const mockResults = [
    {
      title: "Autonomous drone navigation system with landmark recognition",
      pn: "US20210012345A1",
      snippet: "A system for autonomous navigation of unmanned aerial vehicles using computer vision to identify and track visual landmarks in real-time.",
      publication_date: "2021-01-15",
      score: 0.89
    },
    {
      title: "Machine learning-based object detection for UAV applications",
      pn: "US20200098765A1",
      snippet: "Method and apparatus for detecting objects in aerial imagery using convolutional neural networks trained on diverse datasets.",
      publication_date: "2020-03-22",
      score: 0.76
    },
    {
      title: "Wireless communication protocol for drone swarms",
      pn: "US20190087654A1",
      snippet: "Communication system enabling coordinated operation of multiple unmanned aerial vehicles through mesh networking protocols.",
      publication_date: "2019-11-08",
      score: 0.65
    },
    {
      title: "Battery management system for extended flight duration",
      pn: "US20180076543A1",
      snippet: "Power management apparatus that optimizes battery usage in drones through predictive algorithms and thermal regulation.",
      publication_date: "2018-07-14",
      score: 0.58
    }
  ]

  // Mock run creation
  const mockRunId = `mock_${Date.now()}`
  console.log('Returning mock related art search results for UI testing')

  return NextResponse.json({ runId: mockRunId, results: mockResults })
}

async function handleRelatedArtSearch(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, limit = 15, queryOverride, afterDate } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Use only the searchQuery field from Stage 1 (compact, optimized for PQAI search)
  const idea = session.ideaRecord as any
  const searchQueryFromDB = (idea?.searchQuery || '').toString().trim()

  // Use provided queryOverride if given, otherwise use the stored searchQuery
  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â API Query Debug:')
  console.log('  - queryOverride received:', queryOverride)
  console.log('  - queryOverride type:', typeof queryOverride)
  console.log('  - queryOverride trimmed:', queryOverride ? String(queryOverride).trim() : 'null')
  console.log('  - searchQueryFromDB:', searchQueryFromDB)

  const baseQuery = (queryOverride && String(queryOverride).trim().length>0)
    ? String(queryOverride).trim()
    : searchQueryFromDB

  console.log('  - Final baseQuery:', baseQuery)
  console.log('  - Using queryOverride?', queryOverride && String(queryOverride).trim().length>0)

  // If no query available, return error
  if (!baseQuery) {
    return NextResponse.json({
      error: 'No search query available. Please complete Stage 1 first to generate a search query.',
      showMockOption: true
    }, { status: 400 })
  }

  // Simple normalization for PQAI (keep it compact as per Stage 1 design)
  // - remove most punctuation except hyphens
  // - collapse whitespace
  // - keep it short to avoid server errors
  let safeQuery = baseQuery
    .replace(/[\u2013\u2014]/g, '-')       // en/em dash ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ hyphen
    .replace(/[\u2018\u2019\u201C\u201D]/g, '"') // curly quotes ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ plain
    .replace(/[^\w\s-]/g, ' ')             // strip punctuation except hyphen
    .replace(/-/g, ' ')                      // turn hyphens into spaces to avoid tokenization issues
    .replace(/\s+/g, ' ')                   // collapse whitespace
    .trim()
  // Constrain to first 20 words (keep it compact per Stage 1 design and avoid PQAI server 500s)
  const words = safeQuery.split(/\s+/)
  if (words.length > 20) safeQuery = words.slice(0, 20).join(' ')

  // Direct PQAI only
  const token = process.env.PQAI_API_TOKEN || process.env.PQAI_TOKEN || ''
  if (!token) return NextResponse.json({ error: 'No PQAI API token configured. Set PQAI_API_TOKEN.' }, { status: 500 })

  // PQAI endpoint: GET /search/102 with query parameters
  const baseUrl = 'https://api.projectpq.ai/search/102'

  const params = new URLSearchParams({
    q: safeQuery,
    n: String(Math.min(Math.max(10, limit), 50)),
    type: 'patent' // Only return patents, not research papers (NPL)
  })

  // Optional date filter - only add if user specifies
  if (afterDate && typeof afterDate === 'string' && afterDate.trim()) {
    params.set('after', afterDate.trim())
  }

  // Add token as query parameter for direct API
  params.set('token', token)

  const url = `${baseUrl}?${params.toString()}`

  // Debug: Log the final URL components
  console.log('PQAI Request Debug:', {
    baseUrl,
    queryLength: safeQuery.length,
    originalQueryLength: baseQuery.length,
    paramsCount: Array.from(params.entries()).length,
    hasToken: !!token,
    finalUrlLength: url.length,
    filters: 'type=patent' // Confirm patent-only filtering
  })

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }

  console.log('PQAI search (Direct):', {
    url,
    queryPreview: safeQuery.substring(0, 100) + '...',
    limit,
    hasToken: !!token,
    tokenLength: token.length
  })

  // Single API call per search (one API credit usage) with fetch + tighter headers and timeout
  let resp: Response | null = null
  try {
    const controller = new AbortController()
    const to = setTimeout(() => controller.abort(), 15000)
    resp = await fetch(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store' })
    clearTimeout(to)
    console.log('PQAI search result:', { status: resp.status, url: url.substring(0, 120) + '...' })
  } catch (e) {
    console.log('PQAI search network error:', e)
    return NextResponse.json({ error: 'Network error contacting PQAI API', details: String(e) }, { status: 502 })
  }

  if (!resp || !resp.ok) {
    let errorMsg = 'PQAI API request failed'
    let details: string | undefined
    let shouldShowMockOption = false

    if (resp) {
      errorMsg += ` (HTTP ${resp.status})`

      if (resp.status === 500) {
        errorMsg = 'PQAI API server error - the service may be temporarily unavailable'
        shouldShowMockOption = true
      } else if (resp.status === 401 || resp.status === 403) {
        errorMsg = 'PQAI API authentication failed - please check your API token'
      } else if (resp.status === 429) {
        errorMsg = 'PQAI API rate limit exceeded - please try again later'
      }
      try {
        const errorText = await resp.text()
        details = errorText || undefined
        if (errorText.includes('Server error while handling request')) {
          errorMsg = 'PQAI API is currently experiencing server issues. Please try again later or use "Mock Search" for testing.'
          shouldShowMockOption = true
        }
      } catch {}
    }

    console.log('PQAI API error:', { status: resp?.status, error: errorMsg, details })

    return NextResponse.json({
      error: errorMsg,
      details,
      showMockOption: shouldShowMockOption,
      apiStatus: resp?.status || 'unknown'
    }, { status: 502 })
  }

  let dataJson: any = {}
  try { dataJson = await resp.json() } catch (e) { console.log('Failed to parse JSON response:', e) }

  console.log('PQAI API full response:', JSON.stringify(dataJson, null, 2))

  // Try multiple possible result locations
  let results = []
  if (Array.isArray(dataJson?.results)) {
    results = dataJson.results
  } else if (Array.isArray(dataJson?.data)) {
    results = dataJson.data
  } else if (Array.isArray(dataJson)) {
    results = dataJson
  }

  console.log('PQAI API success - results count:', results.length, 'response keys:', Object.keys(dataJson))
  console.log('First result sample:', results[0] ? Object.keys(results[0]) : 'No results')
  if (results[0]) {
    console.log('First result data:', JSON.stringify(results[0], null, 2))
    console.log('Patent number fields in first result:', {
      pn: results[0].pn,
      patent_number: results[0].patent_number,
      publication_number: results[0].publication_number,
      publication_id: results[0].publication_id,
      publicationId: results[0].publicationId,
      patentId: results[0].patentId,
      patent_id: results[0].patent_id,
      id: results[0].id
    })
  }

  // Check for unique patent numbers
  const patentNumbers = results.map((r: any) => r.publication_number || r.patent_number || r.pn || r.publication_id || r.publicationId || r.patentId || r.patent_id || r.id || 'N/A').filter((pn: any) => pn !== 'N/A')
  const uniquePatentNumbers = Array.from(new Set(patentNumbers))
  console.log('Patent numbers found:', patentNumbers.length, 'unique:', uniquePatentNumbers.length)
  if (patentNumbers.length !== uniquePatentNumbers.length) {
    console.log('WARNING: Duplicate patent numbers detected!')
  }

  // Persist run
  const run = await (prisma as any).relatedArtRun.create({ data: { sessionId, queryText: safeQuery, paramsJson: { endpoint: baseUrl, limit: Math.min(Math.max(10, limit), 50), after: afterDate || undefined }, resultsJson: results, ranBy: user.id } })

  return NextResponse.json({ runId: run.id, results })
}

async function handleRelatedArtSelect(user: any, patentId: string, data: any) {
  const { sessionId, runId, selections } = data
  if (!sessionId || !Array.isArray(selections)) return NextResponse.json({ error: 'sessionId and selections[] required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const created: any[] = []
  for (const sel of selections) {
    try {
      const rec = await (prisma as any).relatedArtSelection.upsert({
        where: {
          sessionId_patentNumber_runId: {
            sessionId,
            patentNumber: String(sel.patent_number || sel.pn || '').trim(),
            runId: runId || null
          }
        },
        update: {
          title: sel.title || undefined,
          snippet: sel.snippet || undefined,
          score: typeof sel.score === 'number' ? sel.score : undefined,
          tags: Array.isArray(sel.tags) ? sel.tags : [],
          userNotes: sel.user_notes || undefined,
          publicationDate: sel.publication_date || undefined,
          cpcCodes: sel.cpc_codes || undefined,
          ipcCodes: sel.ipc_codes || undefined,
          inventors: sel.inventors || undefined,
          assignees: sel.assignees || undefined
        },
        create: {
          sessionId,
          runId: runId || null,
          patentNumber: String(sel.patent_number || sel.pn || '').trim(),
          title: sel.title || undefined,
          snippet: sel.snippet || undefined,
          score: typeof sel.score === 'number' ? sel.score : undefined,
          tags: Array.isArray(sel.tags) ? sel.tags : [],
          userNotes: sel.user_notes || undefined,
          publicationDate: sel.publication_date || undefined,
          cpcCodes: sel.cpc_codes || undefined,
          ipcCodes: sel.ipc_codes || undefined,
          inventors: sel.inventors || undefined,
          assignees: sel.assignees || undefined
        }
      })
      created.push(rec)
    } catch (e) {
      // ignore duplicates errors due to constraint race
    }
  }

  return NextResponse.json({ saved: created.length })
}

async function handleGeneratePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo } = data;

  if (!sessionId || !figureNo) {
    return NextResponse.json(
      { error: 'Session ID and figure number are required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get figure plan
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    include: {
      figurePlans: {
        where: { figureNo }
      },
      referenceMap: true,
      ideaRecord: true
    }
  });

  if (!session || !session.figurePlans[0]) {
    return NextResponse.json(
      { error: 'Session or figure plan not found' },
      { status: 404 }
    );
  }

  // Generate PlantUML code – pass archetype / field as hint if available
  const ideaNorm = session.ideaRecord?.normalizedData as any
  const inventionTypeHint = ideaNorm?.inventionType
  const fieldHint = ideaNorm?.fieldOfRelevance
  const result = await DraftingService.generatePlantUML(
    session.figurePlans[0],
    session.referenceMap,
    inventionTypeHint || fieldHint
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Create or update diagram source
  const diagramSource = await prisma.diagramSource.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      plantumlCode: result.plantumlCode || '',
      checksum: result.checksum || ''
    },
    create: {
      sessionId,
      figureNo,
      plantumlCode: result.plantumlCode || '',
      checksum: result.checksum || ''
    }
  });

  // Generate and save image from PlantUML code
  if (result.plantumlCode) {
    try {
      // Clean the PlantUML code (remove titles, themes, etc.)
      let cleaned = result.plantumlCode
        .replace(/^title.*$/gmi, '')
        .replace(/^\s*!\s*(theme|include|import|pragma).*$/gmi, '')
      // Remove multi-line skinparam blocks
      cleaned = cleaned.replace(/skinparam\b[^\n{]*\{[\s\S]*?\}/gmi, '')
      // Remove single-line skinparam statements
      cleaned = cleaned.replace(/^\s*skinparam\b.*$/gmi, '')

      const encoded = plantumlEncoder.encode(cleaned)
      const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
      const url = `${base}/png/${encoded}`

      const resp = await fetch(url, {
        cache: 'no-store',
        method: 'GET',
        headers: { 'Accept': 'image/png' }
      })

      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer())
        const imageChecksum = crypto.createHash('sha256').update(buf).digest('hex')

        // Save image to disk
        const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures')
        await fs.mkdir(baseDir, { recursive: true })
        const filename = `figure_${figureNo}_${Date.now()}.png`
        const imagePath = path.join(baseDir, filename)
        await fs.writeFile(imagePath, buf)

        // Update diagram source with image path
        await prisma.diagramSource.update({
          where: { sessionId_figureNo: { sessionId, figureNo } },
          data: {
            imageFilename: filename,
            imagePath: imagePath,
            imageChecksum: imageChecksum,
            imageUploadedAt: new Date()
          }
        })
      }
    } catch (imageError) {
      console.warn('Failed to generate/save PlantUML image:', imageError)
      // Don't fail the whole operation if image generation fails
    }
  }

  return NextResponse.json({ diagramSource });
}

/**
 * Build jurisdiction-specific diagram instructions from database config
 * This creates LLM-friendly instructions that honor patent office requirements
 */
async function buildJurisdictionDiagramInstructions(
  jurisdiction: string,
  config: any,
  diagramType: string = 'block'
): Promise<string> {
  const lines: string[] = []

  // Jurisdiction identification
  lines.push(`Target Jurisdiction: ${jurisdiction}`)
  
  // Figure labeling format
  if (config.figureLabelFormat) {
    lines.push(`Figure Label Format: Use "${config.figureLabelFormat}" format (e.g., ${config.figureLabelFormat.replace('{number}', '1')})`)
  }

  // Color requirements
  if (config.colorAllowed) {
    lines.push(`Color: Color diagrams ARE permitted for ${jurisdiction}`)
    if (config.colorUsageNote) {
      lines.push(`Color Note: ${config.colorUsageNote}`)
    }
  } else {
    lines.push(`Color: BLACK AND WHITE ONLY - No color, grayscale, or shading. Use solid black lines on white background.`)
  }

  // Line style
  if (config.lineStyle) {
    const styleMap: Record<string, string> = {
      'black_and_white_solid': 'Use solid black lines only (no dashed, dotted, or colored lines)',
      'solid': 'Use solid lines only',
      'dashed_allowed': 'Dashed lines are permitted where appropriate'
    }
    lines.push(`Line Style: ${styleMap[config.lineStyle] || config.lineStyle}`)
  }

  // Reference numerals
  if (config.referenceNumeralsMandatory) {
    lines.push(`Reference Numerals: MANDATORY - Every component must have a reference numeral (e.g., "Processor 100", "Memory 200")`)
  }

  // Text size requirements
  if (config.minReferenceTextSizePt) {
    lines.push(`Minimum Text Size: ${config.minReferenceTextSizePt}pt (ensure all labels are clearly readable)`)
  }

  // Paper size for context
  if (config.paperSize) {
    lines.push(`Target Paper Size: ${config.paperSize} (design diagrams to fit within standard margins)`)
  }

  // Add diagram-type specific hints from database
  if (config.hints && config.hints[diagramType]) {
    lines.push('')
    lines.push(`DIAGRAM TYPE INSTRUCTIONS (${diagramType}):`)
    lines.push(config.hints[diagramType])
  }

  // Add hints for other supported diagram types as fallback context
  if (config.hints && Object.keys(config.hints).length > 0) {
    const otherTypes = Object.entries(config.hints)
      .filter(([type]) => type !== diagramType)
      .slice(0, 2) // Limit to 2 other types
    
    if (otherTypes.length > 0) {
      lines.push('')
      lines.push('OTHER DIAGRAM STYLES (for reference):')
      for (const [type, hint] of otherTypes) {
        lines.push(`• ${type}: ${hint}`)
      }
    }
  }

  // Add supported diagram types
  if (config.supportedDiagramTypes && config.supportedDiagramTypes.length > 0) {
    lines.push('')
    lines.push(`Supported Diagram Types for ${jurisdiction}: ${config.supportedDiagramTypes.join(', ')}`)
  }

  return lines.join('\n')
}

async function handleGenerateDiagramsLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, prompt, replaceExisting } = data

  if (!sessionId || !prompt) {
    return NextResponse.json({ error: 'Session ID and prompt are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Get active jurisdiction for this session
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Check if multi-jurisdiction mode - if so, get compatibility rules
  const isMultiJurisdiction = (session as any).isMultiJurisdiction === true
  const allJurisdictions = Array.isArray((session as any).draftingJurisdictions) && (session as any).draftingJurisdictions.length > 0
    ? (session as any).draftingJurisdictions
    : [activeJurisdiction]

  // Fetch jurisdiction-specific diagram configuration from database
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  
  // Get multi-jurisdiction compatibility if applicable
  let multiJurisdictionInstructions = ''
  if (isMultiJurisdiction && allJurisdictions.length > 1) {
    const { getDiagramCompatibility, buildMultiJurisdictionDiagramPrompt } = await import('@/lib/multi-jurisdiction-service')
    const compatibility = await getDiagramCompatibility(allJurisdictions)
    
    if (compatibility.compatibilityNotes.length > 0) {
      multiJurisdictionInstructions = `
═══════════════════════════════════════════════════════════════════════════════
MULTI-JURISDICTION COMPATIBILITY (${allJurisdictions.join(', ')})
═══════════════════════════════════════════════════════════════════════════════
These diagrams must be compatible with ALL target jurisdictions.
Most restrictive rules apply:
- Color allowed: ${compatibility.mostRestrictiveRules.colorAllowed ? 'Yes' : 'NO - BLACK AND WHITE ONLY'}
- Paper size: ${compatibility.mostRestrictiveRules.paperSize}
- Minimum text size: ${compatibility.mostRestrictiveRules.minReferenceTextSizePt}pt
- Line style: ${compatibility.mostRestrictiveRules.lineStyle}

${compatibility.compatibilityNotes.map(n => `⚠️ ${n}`).join('\n')}
`
    }
  }

  // Build jurisdiction-specific instructions
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(
    activeJurisdiction, 
    diagramConfig,
    'block' // Default to block diagram for multi-diagram generation
  )

  // Determine Diagram Archetype from invention type
  const idea = session.ideaRecord?.normalizedData as any
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  let styleGuide = 'Use standard UML blocks.'
  let nomenclature = 'Use standard technical terms.'

  if (archetype.includes('SOFTWARE')) {
    styleGuide += ' Use Flowcharts (activity diagrams) or System Blocks (component diagrams).'
    nomenclature += ' Use: Module, Engine, Database, API, Interface, Server, Client (and similar logical units).'
  }
  if (archetype.includes('MECHANICAL')) {
    styleGuide += ' Use Block Definition Diagrams or Internal Block Diagrams (SysML style) to show physical parts.'
    nomenclature += ' Use: Housing, Shaft, Assembly, Coupler, Mechanism, Actuator (and similar physical components).'
  }
  if (archetype.includes('ELECTRICAL')) {
    styleGuide += ' Use high-level circuit blocks or signal flow diagrams.'
    nomenclature += ' Use: Circuit, Terminal, Bus, Transceiver, Node, Sensor (and similar electronic parts).'
  }
  if (archetype.includes('BIO') || archetype.includes('CHEMICAL')) {
    styleGuide += ' Use process flows or reaction schemas.'
    nomenclature += ' Use: Reagent, Compound, Stage, Phase, Catalyst, Reactor (and similar domain entities).'
  }

  const finalPrompt = `${prompt}
${multiJurisdictionInstructions}
═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
INVENTION TYPE GUIDE
═══════════════════════════════════════════════════════════════════════════════
DIAGRAM STYLE GUIDE: This is a ${archetype} invention. ${styleGuide}
NOMENCLATURE GUIDE: ${nomenclature}

═══════════════════════════════════════════════════════════════════════════════
PLANTUML TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
COMMON PLANTUML PITFALLS (AVOID THESE):
- Do not mix "[hidden]" with directions in one arrow. Use either "-[hidden]-" or "-down-"/"-up-"/"-left-"/"-right-" etc., but not "-[hidden]down-".
- Do not leave incomplete connection lines like "500 --". Always specify both endpoints (for example "500 --> 600").
- Always close control and note blocks: every "if" has a matching "endif"; every "note" has a matching "end note"; every "start" has a matching "end".
- Do not nest or repeat "@startuml"/"@enduml"; there must be exactly one pair per diagram.

INSTRUCTION: Follow jurisdiction-specific requirements first, then apply invention-type conventions. Use precise domain-specific terms where applicable.`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    prompt: finalPrompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(finalPrompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      purpose: 'generate_diagrams_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  // Parse JSON array of figures
  let figures: any[] = []
  try {
    const text = (result.response.output || '').trim()
    // First try: parse JSON array
    try {
      const start = text.indexOf('[')
      const end = text.lastIndexOf(']')
      const json = start !== -1 && end !== -1 ? text.substring(start, end + 1) : text
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) figures = parsed
    } catch {}
    // Second try: extract PlantUML code blocks directly
    if (!Array.isArray(figures) || figures.length === 0) {
  const blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => sanitizePlantUML(m[0]))
      if (blocks.length > 0) {
        figures = blocks.map((code, i) => ({ title: `Fig.${i + 1}`, purpose: 'Auto-extracted diagram', plantuml: code }))
      }
    }
    // Third try: if response is object with figures key
    if ((!Array.isArray(figures) || figures.length === 0)) {
      try {
        const obj = JSON.parse(text)
        if (Array.isArray(obj?.figures)) figures = obj.figures
      } catch {}
    }
  } catch (e) {
    return NextResponse.json({ error: 'Invalid LLM response format' }, { status: 400 })
  }

  const shouldReplace = replaceExisting !== false

  // Optionally clear existing figures before generating new ones
  if (shouldReplace) {
    try {
      await prisma.figurePlan.deleteMany({ where: { sessionId } })
      await prisma.diagramSource.deleteMany({ where: { sessionId } })
    } catch (clearErr) {
      console.error('Error clearing old figures:', clearErr)
      // Continue with generation even if clearing fails
    }
  }

  // Persist immediately: assign figure numbers and save PlantUML + titles
  try {
    const saved: Array<{ figureNo: number; title: string }> = []

    // When appending, continue numbering after existing figures; when replacing, start fresh
    const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
    const used = new Set(existingPlans.map(fp => fp.figureNo))
    let figureNoCounter = 1
    const nextNo = () => {
      while (used.has(figureNoCounter)) figureNoCounter++
      const n = figureNoCounter
      used.add(n)
      figureNoCounter++
      return n
    }

    for (const fig of figures) {
      const title = typeof fig?.title === 'string' ? fig.title : 'Figure'
      const description = typeof fig?.purpose === 'string' ? fig.purpose : undefined
      const codeRaw = typeof fig?.plantuml === 'string' ? fig.plantuml : ''
      const code = sanitizePlantUML(codeRaw)
      if (!code.includes('@startuml')) continue

      const figureNo = nextNo()
      const checksum = crypto.createHash('sha256').update(code).digest('hex')
      const cleanedTitle = sanitizeFigureTitleInput(title)
      const safeTitle = updateFigureTitleNumber(cleanedTitle, figureNo) || `Figure ${figureNo}`

      await prisma.figurePlan.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { title: safeTitle, ...(description ? { description } : {}) },
        create: { sessionId, figureNo, title: safeTitle, ...(description ? { description } : {}), nodes: [], edges: [] }
      })

      await prisma.diagramSource.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { plantumlCode: code, checksum },
        create: { sessionId, figureNo, plantumlCode: code, checksum }
      })

      saved.push({ figureNo, title: safeTitle })
    }

    const responseFigures = Array.isArray(figures)
      ? figures.map((fig: any) => ({
          ...fig,
          title: sanitizeFigureTitleInput(fig?.title) || fig?.title
        }))
      : figures
    return NextResponse.json({ figures: responseFigures, saved })
  } catch (persistErr) {
    console.error('Persist diagrams error:', persistErr)
    // Even if persistence fails, return figures so UI shows codes
    return NextResponse.json({ figures, warning: 'Figures generated but could not be saved.' })
  }
}

async function handleSavePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, plantumlCode, description } = data
  if (!sessionId || !figureNo || !plantumlCode) {
    return NextResponse.json({ error: 'Session ID, figure number and code are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Upsert diagram source and figure plan title
  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { plantumlCode, checksum: crypto.createHash('sha256').update(plantumlCode).digest('hex') },
    create: { sessionId, figureNo, plantumlCode, checksum: crypto.createHash('sha256').update(plantumlCode).digest('hex') }
  })

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${figureNo}`

  // Include description in both update and create operations
  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { title: cleanedTitle, ...(description ? { description } : {}) },
    create: { sessionId, figureNo, title: cleanedTitle, ...(description ? { description } : {}), nodes: [], edges: [] }
  })

  // Generate and save image from PlantUML code
  try {
    // Clean the PlantUML code (remove titles, themes, etc.)
    let cleaned = plantumlCode
      .replace(/^title.*$/gmi, '')
      .replace(/^\s*!\s*(theme|include|import|pragma).*$/gmi, '')
    // Remove multi-line skinparam blocks
    cleaned = cleaned.replace(/skinparam\b[^\n{]*\{[\s\S]*?\}/gmi, '')
    // Remove single-line skinparam statements
    cleaned = cleaned.replace(/^\s*skinparam\b.*$/gmi, '')

    const encoded = plantumlEncoder.encode(cleaned)
    const base = process.env.PLANTUML_BASE_URL || 'https://www.plantuml.com/plantuml'
    const url = `${base}/png/${encoded}`

    const resp = await fetch(url, {
      cache: 'no-store',
      method: 'GET',
      headers: { 'Accept': 'image/png' }
    })

    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer())
      const imageChecksum = crypto.createHash('sha256').update(buf).digest('hex')

      // Save image to disk
      const baseDir = path.join(process.cwd(), 'uploads', 'patents', patentId, 'figures')
      await fs.mkdir(baseDir, { recursive: true })
      const filename = `figure_${figureNo}_${Date.now()}.png`
      const imagePath = path.join(baseDir, filename)
      await fs.writeFile(imagePath, buf)

      // Update diagram source with image path
      await prisma.diagramSource.update({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        data: {
          imageFilename: filename,
          imagePath: imagePath,
          imageChecksum: imageChecksum,
          imageUploadedAt: new Date()
        }
      })
    }
  } catch (imageError) {
    console.warn('Failed to generate/save PlantUML image:', imageError)
    // Don't fail the whole operation if image generation fails
  }

  return NextResponse.json({ diagramSource })
}

async function handleRegenerateDiagramLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, figureNo, instructions } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  // Verify session and pull numerals
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, diagramSources: true, ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const componentsRaw = (session.referenceMap as any)?.components
  const components = Array.isArray(componentsRaw) ? componentsRaw : []
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const title = session.figurePlans?.find((f: any) => f.figureNo === figureNo)?.title || `Figure ${figureNo}`

  // Determine Diagram Archetype
  const idea = session.ideaRecord?.normalizedData as any
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  const prompt = `You are refining a PlantUML diagram for a patent figure.
Keep the diagram simple and valid. Use only these components/numerals: ${numeralsPreview}.
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
PLANTUML TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
- Do not mix "[hidden]" with directions in one arrow. Use either "-[hidden]-" or "-down-"/"-up-"/"-left-"/"-right-" etc., but not "-[hidden]down-".
- Do not leave incomplete connection lines like "500 --". Always specify both endpoints (for example "500 --> 600").
- Always close control and note blocks: every "if" has a matching "endif"; every "note" has a matching "end note"; every "start" has a matching "end".
- Do not nest or repeat "@startuml"/"@enduml"; there must be exactly one pair per diagram.

INSTRUCTION: Follow jurisdiction-specific requirements first. Use precise domain-specific terms where applicable.

Existing title: ${title}
User instructions: ${instructions || 'none'}
Output ONLY the PlantUML code (@startuml..@enduml).`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(prompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      figureNo,
      purpose: 'regenerate_diagram_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  const code = sanitizePlantUML(match[0])
  // Validate sanitized code is still valid PlantUML
  if (!code.includes('@startuml') || !code.includes('@enduml')) {
    return NextResponse.json({ error: 'PlantUML code became invalid after sanitization. Please try again with different instructions.' }, { status: 400 })
  }
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  // IMPORTANT: When code changes, clear image data so frontend triggers re-render
  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { 
      plantumlCode: code, 
      checksum,
      // Clear cached image data to force re-rendering
      imageFilename: null,
      imagePath: null,
      imageChecksum: null,
      imageUploadedAt: null
    },
    create: { sessionId, figureNo, plantumlCode: code, checksum }
  })

  return NextResponse.json({ diagramSource })
}

async function handleAddFigureLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructions } = data
  if (!sessionId) return NextResponse.json({ error: 'Session ID required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, ideaRecord: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const componentsRaw2 = (session.referenceMap as any)?.components
  const components2 = Array.isArray(componentsRaw2) ? componentsRaw2 : []
  const numeralsPreview = components2.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')

  // Determine Diagram Archetype
  const idea = session.ideaRecord?.normalizedData as any
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  const prompt = `Add one new simple PlantUML figure for a patent.
Use only numerals: ${numeralsPreview}.
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
PLANTUML TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
- Do not mix "[hidden]" with directions in one arrow. Use either "-[hidden]-" or "-down-"/"-up-"/"-left-"/"-right-" etc., but not "-[hidden]down-".
- Do not leave incomplete connection lines like "500 --". Always specify both endpoints (for example "500 --> 600").
- Always close control and note blocks: every "if" has a matching "endif"; every "note" has a matching "end note"; every "start" has a matching "end".
- Do not nest or repeat "@startuml"/"@enduml"; there must be exactly one pair per diagram.

INSTRUCTION: Follow jurisdiction-specific requirements first. Use precise domain-specific terms where applicable.

User instructions: ${instructions || 'none'}
Return ONLY PlantUML code.`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    prompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(prompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      purpose: 'add_figure_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  // Sanitize and validate the PlantUML code
  const code = sanitizePlantUML(match[0])
  if (!code.includes('@startuml') || !code.includes('@enduml')) {
    return NextResponse.json({ error: 'PlantUML code became invalid after sanitization. Please try again with different instructions.' }, { status: 400 })
  }

  // Assign next figure number
  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNo = 1
  while (used.has(figureNo)) figureNo++

  const title = `Figure ${figureNo}`
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo } }, update: { title }, create: { sessionId, figureNo, title, nodes: [], edges: [] } })
  const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo: { sessionId, figureNo } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo, plantumlCode: code, checksum } })

  return NextResponse.json({ diagramSource })
}

async function handleAddFiguresLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructionsList } = data
  if (!sessionId || !Array.isArray(instructionsList) || instructionsList.length === 0) return NextResponse.json({ error: 'Session ID and instructions list required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { referenceMap: true, figurePlans: true, diagramSources: true, ideaRecord: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Get active jurisdiction
  const activeJurisdiction = (session as any).activeJurisdiction || 
    ((session as any).draftingJurisdictions?.[0]) || 'US'

  // Fetch jurisdiction-specific diagram configuration
  const diagramConfig = await getDiagramConfig(activeJurisdiction, user.id, sessionId)
  const jurisdictionInstructions = await buildJurisdictionDiagramInstructions(activeJurisdiction, diagramConfig, 'block')

  const componentsRaw3 = (session.referenceMap as any)?.components
  const components3 = Array.isArray(componentsRaw3) ? componentsRaw3 : []
  const numeralsPreview = components3.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const existingNames = session.figurePlans?.map((f: any) => {
    const clean = sanitizeFigureTitleInput(f.title) || `Figure ${f.figureNo}`
    return `Fig.${f.figureNo}: ${clean}`
  }).join('; ')
  const inventionTitle = session.ideaRecord?.title || ''
  const idea = session.ideaRecord?.normalizedData as any
  const types = Array.isArray(idea?.inventionType) ? idea.inventionType : (idea?.inventionType ? [idea.inventionType] : [])
  const archetype = types.length > 0 ? types.join('+') : 'GENERAL'

  const aggregatePrompt = `You are adding ${instructionsList.length} new simple PlantUML figures to a patent.
Invention: ${inventionTitle}
Use only components/numerals: ${numeralsPreview}
Existing figures: ${existingNames || 'none'}
Invention Type: ${archetype}

═══════════════════════════════════════════════════════════════════════════════
JURISDICTION-SPECIFIC REQUIREMENTS (${activeJurisdiction})
═══════════════════════════════════════════════════════════════════════════════
${jurisdictionInstructions}

═══════════════════════════════════════════════════════════════════════════════
NOMENCLATURE GUIDE (Apply based on Invention Type)
═══════════════════════════════════════════════════════════════════════════════
- MECHANICAL: Housing, Shaft, Assembly, Coupler, Actuator (and similar physical components).
- SOFTWARE: Module, Engine, Database, API, Interface (and similar logical units).
- ELECTRICAL: Circuit, Terminal, Bus, Transceiver, Sensor (and similar electronic parts).
- BIO: Reagent, Cell, Sequence, Assay, Vector (and similar biological entities).
- CHEMICAL: Compound, Catalyst, Phase, Solution, Reactor (and similar chemical substances).

═══════════════════════════════════════════════════════════════════════════════
PLANTUML TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
- Do not mix "[hidden]" with directions in one arrow. Use either "-[hidden]-" or "-down-"/"-up-"/"-left-"/"-right-" etc., but not "-[hidden]down-".
- Do not leave incomplete connection lines like "500 --". Always specify both endpoints (for example "500 --> 600").
- Always close control and note blocks: every "if" has a matching "endif"; every "note" has a matching "end note"; every "start" has a matching "end".
- Do not nest or repeat "@startuml"/"@enduml"; there must be exactly one pair per diagram.

INSTRUCTION: Follow jurisdiction-specific requirements first. Use precise domain-specific terms where applicable.

For each item below, return ONLY PlantUML (@startuml..@enduml), one block per item, in the same order.
Items:\n- ${instructionsList.join('\n- ')}`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, {
    taskCode: 'LLM3_DIAGRAM',
    prompt: aggregatePrompt,
    idempotencyKey: crypto.randomUUID(),
    inputTokens: Math.ceil(aggregatePrompt.length / 4),
    metadata: {
      patentId,
      sessionId,
      purpose: 'add_figures_llm'
    }
  })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  let blocks = Array.from(text.matchAll(/@startuml[\s\S]*?@enduml/g)).map(m => m[0])
  if (blocks.length === 0) {
    // Try JSON array
    try {
      const json = JSON.parse(text)
      const arr = Array.isArray(json?.figures) ? json.figures : (Array.isArray(json) ? json : [])
      blocks = arr
        .map((it: any) => (typeof it?.plantuml === 'string' ? it.plantuml : null))
        .filter((it: any) => typeof it === 'string' && it.includes('@startuml'))
    } catch {}
  }
  if (blocks.length === 0) return NextResponse.json({ error: 'No PlantUML blocks found' }, { status: 400 })

  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNoCounter = 1
  const nextNo = () => {
    while (used.has(figureNoCounter)) figureNoCounter++
    const n = figureNoCounter
    used.add(n)
    figureNoCounter++
    return n
  }

  const created: any[] = []
  for (let i = 0; i < blocks.length; i++) {
    const rawCode = blocks[i]
    // IMPORTANT: Sanitize PlantUML code to remove forbidden directives that would cause render failure
    const code = sanitizePlantUML(rawCode)
    if (!code.includes('@startuml')) continue // Skip invalid blocks after sanitization
    
    const no = nextNo()
    const title = `Figure ${no}`
    const safeTitle = sanitizeFigureTitleInput(title) || title
    const checksum = crypto.createHash('sha256').update(code).digest('hex')
    await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { title: safeTitle }, create: { sessionId, figureNo: no, title: safeTitle, nodes: [], edges: [] } })
    const diagramSource = await prisma.diagramSource.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { plantumlCode: code, checksum }, create: { sessionId, figureNo: no, plantumlCode: code, checksum } })
    created.push({ figureNo: no, diagramSource })
  }

  return NextResponse.json({ created })
}

async function handleDeleteFigure(user: any, patentId: string, data: any) {
  const { sessionId, figureNo } = data
  if (!sessionId || !figureNo) return NextResponse.json({ error: 'Session ID and figure number required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  await prisma.diagramSource.deleteMany({ where: { sessionId, figureNo } })
  await prisma.figurePlan.deleteMany({ where: { sessionId, figureNo } })

  return NextResponse.json({ deleted: true })
}

async function handleCreateManualFigure(user: any, patentId: string, data: any) {
  const { sessionId, title, description, figureNo } = data
  if (!sessionId || !description || (description as string).trim().split(/\s+/).length < 20) {
    return NextResponse.json({ error: 'At least 20 words description required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Assign number if not provided
  let no = figureNo
  if (!no) {
    const existing = await prisma.figurePlan.findMany({ where: { sessionId } })
    const used = new Set(existing.map(e => e.figureNo))
    no = 1
    while (used.has(no)) no++
  }

  const cleanedTitle = sanitizeFigureTitleInput(title) || `Figure ${no}`

  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo: no } },
    update: { title: cleanedTitle, description },
    create: { sessionId, figureNo: no, title: cleanedTitle, description, nodes: [], edges: [] }
  })

  // Create empty source to allow upload linkage later
  await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo: no } },
    update: {},
    create: { sessionId, figureNo: no, plantumlCode: '', checksum: '' }
  })

  return NextResponse.json({ created: { figureNo: no } })
}
async function handleUploadDiagram(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, filename, checksum, imagePath } = data;

  if (!sessionId || !figureNo || !filename || !checksum) {
    return NextResponse.json(
      { error: 'Session ID, figure number, filename, and checksum are required' },
      { status: 400 }
    );
  }

  // Verify session ownership
  const session = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    }
  });

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Ensure a figurePlan exists for this figure number (some uploads may come first)
  const existingPlan = await prisma.figurePlan.findUnique({ where: { sessionId_figureNo: { sessionId, figureNo } } })
  if (!existingPlan) {
    await prisma.figurePlan.create({ data: { sessionId, figureNo, title: `Figure ${figureNo}`, nodes: [], edges: [] } })
  }

  // Upsert diagram source and set upload metadata
  await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: {
      imageFilename: filename,
      imageChecksum: checksum,
      imagePath: imagePath,
      imageUploadedAt: new Date()
    },
    create: {
      sessionId,
      figureNo,
      plantumlCode: '',
      checksum: '',
      imageFilename: filename,
      imageChecksum: checksum,
      imagePath: imagePath,
      imageUploadedAt: new Date()
    }
  })

  // Return success with counts; do not auto-advance stage
  const totalFigures = await prisma.figurePlan.count({ where: { sessionId } });
  const uploadedFigures = await prisma.diagramSource.count({
    where: { sessionId, imageUploadedAt: { not: null } }
  });

  return NextResponse.json({
    message: 'Diagram uploaded successfully',
    uploadedFigures,
    totalFigures,
    allUploaded: uploadedFigures === totalFigures
  });
}

async function handleGenerateDraft(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, jurisdiction = 'US', filingType = 'utility' } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get all required data
  const baseSession = await prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      patentId,
      userId: user.id
    },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      },
      // Will be added after Prisma generate; use manual load elsewhere if needed
    }
  });

  if (!baseSession) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  const session = baseSession
  // Determine effective jurisdiction (Stage 3.7b)
  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)
  const sourceJurisdiction = resolveSourceOfTruth(session, effectiveJurisdiction)

  // Load reference draft for source-of-truth jurisdiction (first selection or user override) when generating other jurisdictions
  let referenceDraft = effectiveJurisdiction === sourceJurisdiction
    ? null
    : await prisma.annexureDraft.findFirst({
        where: { sessionId, jurisdiction: sourceJurisdiction },
        orderBy: { version: 'desc' }
      })
  if (!referenceDraft && effectiveJurisdiction !== sourceJurisdiction) {
    // Fallback to any other available draft (excluding the active one) so users can add jurisdictions later
    referenceDraft = await prisma.annexureDraft.findFirst({
      where: { sessionId, NOT: { jurisdiction: effectiveJurisdiction } },
      orderBy: { version: 'desc' }
    }) || null
  }

  // Generate draft
  const result = await DraftingService.generateAnnexureDraft(
    session,
    effectiveJurisdiction,
    filingType,
    user.tenantId,
    requestHeaders,
    referenceDraft || undefined,
    preferredLanguage,
    sourceJurisdiction
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Create new draft version
  const extraSections = { ...(result.validationReport?.extraSections || {}) }
  if (result.draft?.crossReference) {
    extraSections.crossReference = result.draft.crossReference
  }
  const lastForJurisdiction = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: effectiveJurisdiction },
    orderBy: { version: 'desc' }
  })
  const version = ((lastForJurisdiction?.version) || 0) + 1;
  const draft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: effectiveJurisdiction,
      title: result.draft?.title || session.ideaRecord?.title || 'Untitled',
      fieldOfInvention: result.draft?.fieldOfInvention || '',
      background: result.draft?.background || '',
      summary: result.draft?.summary || '',
      briefDescriptionOfDrawings: result.draft?.briefDescriptionOfDrawings || '',
      detailedDescription: result.draft?.detailedDescription || '',
      bestMethod: result.draft?.bestMethod || '',
      claims: result.draft?.claims || '',
      abstract: result.draft?.abstract || '',
      listOfNumerals: result.draft?.listOfNumerals || '',
      fullDraftText: result.draft?.fullText || '',
      isValid: !!result.isValid,
      validationReport: {
        ...(result.validationReport || {}),
        ...(Object.keys(extraSections).length ? { extraSections } : {})
      },
      llmPromptUsed: result.llmPrompt || '',
      llmResponse: result.llmResponse || {},
      tokensUsed: result.tokensUsed || 0
    }
  });

  // Update session status
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      status: 'REVIEW_FIX',
      jurisdictionDraftStatus: {
        ...(session.jurisdictionDraftStatus as any || {}),
        [effectiveJurisdiction]: {
          status: 'done',
          latestVersion: version,
          updatedAt: new Date().toISOString()
        }
      }
    }
  });

  return NextResponse.json({ draft });
}

// New: Autosave unapproved sections to a working draft version (does not advance stage)
async function handleAutosaveSections(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data
  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'sessionId and patch object required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } } }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  const merge: any = {
    title: last?.title || '',
    fieldOfInvention: last?.fieldOfInvention || null,
    background: last?.background || null,
    summary: last?.summary || null,
    briefDescriptionOfDrawings: last?.briefDescriptionOfDrawings || null,
    detailedDescription: last?.detailedDescription || null,
    bestMethod: last?.bestMethod || null,
    claims: last?.claims || null,
    abstract: last?.abstract || null,
    industrialApplicability: last?.industrialApplicability || null,
    listOfNumerals: last?.listOfNumerals || null,
    ...patch
  }
  const crossReferenceText = typeof patch?.crossReference === 'string' ? patch.crossReference.trim() : ''

  // Create or update a working draft in place: if last exists, update it; else create version 1
  let draft
  if (last) {
    draft = await prisma.annexureDraft.update({
      where: { id: last.id },
      data: {
        title: merge.title || last.title,
        fieldOfInvention: merge.fieldOfInvention || last.fieldOfInvention,
        background: merge.background || last.background,
        summary: merge.summary || last.summary,
        briefDescriptionOfDrawings: merge.briefDescriptionOfDrawings || last.briefDescriptionOfDrawings,
        detailedDescription: merge.detailedDescription || last.detailedDescription,
        bestMethod: merge.bestMethod || last.bestMethod,
        claims: merge.claims || last.claims,
        abstract: merge.abstract || last.abstract,
        industrialApplicability: merge.industrialApplicability || last.industrialApplicability,
        listOfNumerals: merge.listOfNumerals || last.listOfNumerals
      }
    })
  } else {
    draft = await prisma.annexureDraft.create({
      data: {
        session: { connect: { id: sessionId } },
        version: 1,
        jurisdiction: effectiveJurisdiction,
        title: merge.title || 'Untitled',
        fullDraftText: '',
        isValid: false
      }
    })
  }

  if (crossReferenceText) {
    const existingVR = (draft.validationReport as any) || {}
    const nextVR = { ...existingVR, extraSections: { ...(existingVR.extraSections || {}), crossReference: crossReferenceText } }
    draft = await prisma.annexureDraft.update({ where: { id: draft.id }, data: { validationReport: nextVR } })
  }

  // Track essential sections for patent-based quota counting
  // A patent counts toward quota when both detailedDescription AND claims are drafted
  if (session.tenantId) {
    const savedSectionKeys = Object.keys(patch).filter(k => patch[k] && typeof patch[k] === 'string' && patch[k].trim())
    for (const sectionKey of savedSectionKeys) {
      if (sectionKey === 'detailedDescription' || sectionKey === 'description' || sectionKey === 'claims') {
        await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          sectionKey
        )
      }
    }
  }

  return NextResponse.json({ draft })
}



// Allow users to reset/delete a jurisdiction-specific draft (without removing the jurisdiction unless explicitly asked)
async function handleDeleteAnnexureDraft(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, removeFromList } = data
  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'sessionId and jurisdiction are required' }, { status: 400 })
  }
  const normalized = String(jurisdiction).toUpperCase()

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const existingStatus = (session.jurisdictionDraftStatus as any) || {}
  const retainedLanguage = existingStatus?.[normalized]?.language

  await prisma.annexureDraft.deleteMany({ where: { sessionId, jurisdiction: normalized } })

  const statusMap: Record<string, any> = { ...existingStatus }
  delete statusMap[normalized]
  if (retainedLanguage) statusMap[normalized] = { language: retainedLanguage }

  const shouldRemove = Boolean(removeFromList)
  const initialJurisdictions = Array.isArray(session.draftingJurisdictions)
    ? Array.from(new Set(session.draftingJurisdictions.map((c: string) => (c || '').toUpperCase())))
    : []

  const { jurisdictions, statusMap: nextStatusMap, nextActive } = computeJurisdictionStateOnDelete({
    session,
    statusMap,
    jurisdictions: initialJurisdictions,
    normalized,
    shouldRemove
  })

  const updatedSession = await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      draftingJurisdictions: jurisdictions,
      activeJurisdiction: nextActive,
      jurisdictionDraftStatus: nextStatusMap
    }
  })

  return NextResponse.json({ success: true, session: updatedSession })
}

// New: Generate specific annexure sections without persisting (e.g., ["title","abstract"]) with backend debug steps
async function handleGenerateSections(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, sections, instructions, selectedPatents, jurisdiction } = data

  if (!sessionId || !Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: 'sessionId and sections[] are required' }, { status: 400 })
  }

  const baseSession = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true, // Needed for figure merging in DraftingService
      // Needed for prior-art selection logic in DraftingService
      relatedArtSelections: true
    }
  })
  const session = baseSession
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Example-based style mimicry via Writing Personas (new system)
  // OFF by default, user must explicitly enable in UI
  // When enabled, DraftingService fetches user's writing samples and injects them into prompts
  const usePersonaStyle = (data && typeof data.usePersonaStyle === 'boolean') ? Boolean(data.usePersonaStyle) : false
  
  // Use provided instructions directly (no legacy style injection)
  const mergedInstructions: Record<string, string> = { ...(instructions || {}) }

  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()

  // Check for frozen claims - use them instead of regenerating
  const normalizedData = (session.ideaRecord?.normalizedData as any) || {}
  const frozenClaimsText = normalizedData.claims || ''
  const frozenClaimsStructured = normalizedData.claimsStructured || []
  const claimsFrozen = !!normalizedData.claimsApprovedAt
  const claimsJurisdiction = normalizedData.claimsJurisdiction || effectiveJurisdiction
  
  // If claims are frozen and user is trying to generate claims, use frozen claims instead
  let sectionsToGenerate = [...sections]
  let frozenClaimsUsed = false
  
  if (claimsFrozen && sections.includes('claims')) {
    // Remove 'claims' from sections to generate - we'll use frozen claims
    sectionsToGenerate = sections.filter((s: string) => s !== 'claims')
    frozenClaimsUsed = true
    console.log(`[generateSections] Using frozen claims from Stage 1 (frozen at: ${normalizedData.claimsApprovedAt})`)
  }

  // Load latest draft for this jurisdiction (if any) and inject into session for context
  const lastDraftForJurisdiction = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: effectiveJurisdiction },
    orderBy: { version: 'desc' }
  })
  
  // Extend session with user context for writing sample-based style mimicry
  const sessionWithDrafts: any = { 
    ...session, 
    annexureDrafts: lastDraftForJurisdiction ? [lastDraftForJurisdiction] : [],
    usePersonaStyle, // Pass to DraftingService for writing sample injection
    userId: user.id  // Required for fetching user's writing samples
  }

  const preferredLanguage = getPreferredLanguageForJurisdiction(session, effectiveJurisdiction)

  // Only generate sections that aren't using frozen claims
  let result: any = { success: true, generated: {}, debugSteps: [] }
  
  if (sectionsToGenerate.length > 0) {
    result = await DraftingService.generateSections(
      sessionWithDrafts,
      sectionsToGenerate,
      mergedInstructions,
      user.tenantId,
      requestHeaders,
      selectedPatents,
      effectiveJurisdiction,
      preferredLanguage
    )
    if (!result.success) return NextResponse.json({ error: result.error, debugSteps: result.debugSteps }, { status: 400 })
  }
  
  // Add frozen claims to the result if they were used
  if (frozenClaimsUsed) {
    // Convert HTML claims to plain text format suitable for patent draft
    let claimsForDraft = frozenClaimsText
    
    // If we have structured claims, format them properly
    if (Array.isArray(frozenClaimsStructured) && frozenClaimsStructured.length > 0) {
      claimsForDraft = frozenClaimsStructured.map((c: any) => {
        return `${c.number}. ${c.text}`
      }).join('\n\n')
    } else if (frozenClaimsText) {
      // Strip HTML tags for plain text format
      claimsForDraft = frozenClaimsText
        .replace(/<p>/gi, '')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<strong>/gi, '')
        .replace(/<\/strong>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim()
    }
    
    result.generated = result.generated || {}
    result.generated.claims = claimsForDraft
    result.debugSteps = result.debugSteps || []
    result.debugSteps.push({ 
      step: 'frozen_claims_used', 
      status: 'ok', 
      meta: { 
        frozenAt: normalizedData.claimsApprovedAt,
        jurisdiction: claimsJurisdiction,
        claimCount: Array.isArray(frozenClaimsStructured) ? frozenClaimsStructured.length : 'unknown'
      } 
    })
  }

  // Autosave generated sections into latest draft without bumping version
  try {
    const last = lastDraftForJurisdiction
    
    // Legacy columns (backward compatible) - these are dedicated DB columns
    const legacyFields = ['title', 'fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod', 'claims', 'abstract', 'industrialApplicability', 'listOfNumerals']
    
    // Normalize all generated keys using database-driven alias resolution
    const normalizedGenerated = result.generated ? await normalizeSectionKeys(result.generated as Record<string, any>) : {}
    
    if (last && Object.keys(normalizedGenerated).length > 0) {
      const updateData: any = {}
      // extraSections is a JSON column for scalable section storage
      const extraSections: Record<string, string> = { ...(((last as any).extraSections) || {}) }

      for (const [canonicalKey, v] of Object.entries(normalizedGenerated)) {
        if (typeof v === 'string' && v.trim()) {
          if (legacyFields.includes(canonicalKey)) {
            // Store in legacy column
            updateData[canonicalKey] = v.trim()
          } else {
            // Store in extraSections JSON - key is already canonical
            extraSections[canonicalKey] = v.trim()
          }
        }
      }
      
      // Save extra sections if any were updated
      if (Object.keys(extraSections).length > 0) {
        updateData.extraSections = extraSections
      }
      
      console.log('Autosave updateData keys:', Object.keys(updateData))
      console.log('Extra sections keys:', Object.keys(extraSections))
      console.log('Last draft ID:', last.id)
      if (Object.keys(updateData).length > 0) {
        await prisma.annexureDraft.update({ where: { id: last.id }, data: updateData })
      }
    } else if (Object.keys(normalizedGenerated).length > 0) {
      // Create initial draft if none present
      const createData: any = { sessionId, version: 1, jurisdiction: effectiveJurisdiction, fullDraftText: '' }
      const extraSections: Record<string, string> = {}

      // Set title
      createData.title = normalizedGenerated.title || session.ideaRecord?.title || 'Untitled'

      for (const [canonicalKey, v] of Object.entries(normalizedGenerated)) {
        if (canonicalKey === 'title') continue // Already handled
        if (typeof v === 'string' && v.trim()) {
          if (legacyFields.includes(canonicalKey)) {
            // Store in legacy column
            createData[canonicalKey] = v.trim()
          } else {
            // Store in extraSections JSON - key is already canonical
            extraSections[canonicalKey] = v.trim()
        }
      }
      }
      
      // Save extra sections if any exist
      if (Object.keys(extraSections).length > 0) {
        createData.extraSections = extraSections
      }

      console.log('Creating new draft with keys:', Object.keys(createData))
      console.log('Extra sections keys:', Object.keys(extraSections))
      await prisma.annexureDraft.create({ data: createData })
    }
  } catch (e) {
    console.error('Autosave after generation failed:', e)
    console.error('Error details:', e instanceof Error ? e.message : 'Unknown error')
  }

  return NextResponse.json({ generated: result.generated, debugSteps: result.debugSteps, llmMeta: result.llmMeta })
}

// New: Persist approved sections and run consistency validation
async function handleSaveSections(user: any, patentId: string, data: any) {
  const { sessionId, patch } = data
  if (!sessionId || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'sessionId and patch object required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const effectiveJurisdiction = (session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  const drafts = Array.isArray(session.annexureDrafts) ? session.annexureDrafts : []
  const last = drafts.find((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
  const nextVersion = (last?.version || 0) + 1

  // Legacy columns (backward compatible)
  const legacyFields = ['title', 'fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod', 'claims', 'abstract', 'industrialApplicability', 'listOfNumerals']
  
  // Normalize patch keys using database-driven alias resolution
  const normalizedPatch = await normalizeSectionKeys(patch as Record<string, any>)

  // Get previous extra sections (extraSections is a JSON column for scalable section storage)
  const prevExtraSections = ((last as any)?.extraSections as Record<string, string>) || {}

  // Merge normalized patch into latest (or start new)
  const merged: any = {
    title: last?.title || '',
    fieldOfInvention: last?.fieldOfInvention || null,
    background: last?.background || null,
    summary: last?.summary || null,
    briefDescriptionOfDrawings: last?.briefDescriptionOfDrawings || null,
    detailedDescription: last?.detailedDescription || null,
    bestMethod: last?.bestMethod || null,
    claims: last?.claims || null,
    abstract: last?.abstract || null,
    industrialApplicability: last?.industrialApplicability || null,
    listOfNumerals: last?.listOfNumerals || null,
    ...normalizedPatch
  }

  // Build extra sections from previous + normalized patch
  const extraSections: Record<string, string> = { ...prevExtraSections }
  for (const [canonicalKey, patchValue] of Object.entries(normalizedPatch)) {
    // If key is not a legacy field, it goes to extraSections
    if (!legacyFields.includes(canonicalKey) && typeof patchValue === 'string' && patchValue.trim()) {
      extraSections[canonicalKey] = patchValue.trim()
    }
  }

  // Assemble full text for validation (including extra sections)
  const fullDraftText = [
    extraSections.crossReference ? `CROSS-REFERENCE TO RELATED APPLICATIONS\n\n${extraSections.crossReference}` : '',
    extraSections.preamble ? `PREAMBLE\n\n${extraSections.preamble}` : '',
    merged.fieldOfInvention ? `FIELD OF INVENTION\n\n${merged.fieldOfInvention}` : '',
    merged.background ? `BACKGROUND\n\n${merged.background}` : '',
    extraSections.objectsOfInvention ? `OBJECT(S) OF THE INVENTION\n\n${extraSections.objectsOfInvention}` : '',
    extraSections.technicalProblem ? `TECHNICAL PROBLEM\n\n${extraSections.technicalProblem}` : '',
    extraSections.technicalSolution ? `TECHNICAL SOLUTION\n\n${extraSections.technicalSolution}` : '',
    extraSections.advantageousEffects ? `ADVANTAGEOUS EFFECTS\n\n${extraSections.advantageousEffects}` : '',
    merged.summary ? `SUMMARY\n\n${merged.summary}` : '',
    merged.briefDescriptionOfDrawings ? `BRIEF DESCRIPTION OF DRAWINGS\n\n${merged.briefDescriptionOfDrawings}` : '',
    merged.detailedDescription ? `DETAILED DESCRIPTION\n\n${merged.detailedDescription}` : '',
    extraSections.modeOfCarryingOut ? `MODE(S) FOR CARRYING OUT THE INVENTION\n\n${extraSections.modeOfCarryingOut}` : '',
    merged.bestMethod ? `BEST METHOD\n\n${merged.bestMethod}` : '',
    merged.claims ? `CLAIMS\n\n${merged.claims}` : '',
    merged.abstract ? `ABSTRACT\n\n${merged.abstract}` : '',
    merged.industrialApplicability ? `INDUSTRIAL APPLICABILITY\n\n${merged.industrialApplicability}` : '',
    merged.listOfNumerals ? `LIST OF REFERENCE NUMERALS\n\n${merged.listOfNumerals}` : ''
  ].filter(Boolean).join('\n\n')

  // Lightweight consistency validation using service
  const validation = DraftingService.validateDraftConsistencyPublic({ fullText: fullDraftText }, session as any)
  const validationReport = {
    ...(validation.report || {})
  }

  // Note: extraSections is a JSON column added for scalability - TypeScript types may need IDE restart to update
  const draftData: any = {
      sessionId,
      version: nextVersion,
      jurisdiction: effectiveJurisdiction,
      title: merged.title || last?.title || 'Untitled',
      fieldOfInvention: merged.fieldOfInvention || undefined,
      background: merged.background || undefined,
      summary: merged.summary || undefined,
      briefDescriptionOfDrawings: merged.briefDescriptionOfDrawings || undefined,
      detailedDescription: merged.detailedDescription || undefined,
      bestMethod: merged.bestMethod || undefined,
      claims: merged.claims || undefined,
      abstract: merged.abstract || undefined,
      industrialApplicability: merged.industrialApplicability || undefined,
      listOfNumerals: merged.listOfNumerals || undefined,
    extraSections: Object.keys(extraSections).length > 0 ? extraSections : undefined,
      fullDraftText,
      isValid: !!validation.valid,
      validationReport
    }
  const draft = await prisma.annexureDraft.create({ data: draftData })

  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session.jurisdictionDraftStatus as any || {}),
        [effectiveJurisdiction]: {
          status: 'done',
          latestVersion: nextVersion,
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  // Ensure session is at ANNEXURE_DRAFT stage
  if (session.status !== 'ANNEXURE_DRAFT') {
    await prisma.draftingSession.update({ where: { id: sessionId }, data: { status: 'ANNEXURE_DRAFT' } })
  }

  // Track essential sections for patent-based quota counting
  // A patent counts toward quota when both detailedDescription AND claims are drafted
  if (session.tenantId) {
    const savedSectionKeys = Object.keys(normalizedPatch).filter(k => normalizedPatch[k] && typeof normalizedPatch[k] === 'string' && (normalizedPatch[k] as string).trim())
    for (const sectionKey of savedSectionKeys) {
      if (sectionKey === 'detailedDescription' || sectionKey === 'description' || sectionKey === 'claims') {
        await trackSectionDrafted(
          session.tenantId,
          sessionId,
          patentId,
          user.id,
          sectionKey
        )
      }
    }
  }

  return NextResponse.json({ draft, validationReport })
}

// Get all draft versions for a session/jurisdiction - enables version history and comparison
async function handleGetDraftVersions(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      annexureDrafts: {
        orderBy: { version: 'desc' }
      }
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || session.draftingJurisdictions?.[0] || 'US').toUpperCase()
  
  // Filter drafts by jurisdiction and return version summary
  const drafts = (session.annexureDrafts || [])
    .filter((d: any) => (d.jurisdiction || 'US').toUpperCase() === effectiveJurisdiction)
    .map((d: any) => ({
      id: d.id,
      version: d.version,
      jurisdiction: d.jurisdiction,
      title: d.title,
      isValid: d.isValid,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      // Include section keys that have content (for quick overview)
      sectionsWithContent: [
        d.title && 'title',
        d.fieldOfInvention && 'fieldOfInvention',
        d.background && 'background',
        d.summary && 'summary',
        d.briefDescriptionOfDrawings && 'briefDescriptionOfDrawings',
        d.detailedDescription && 'detailedDescription',
        d.bestMethod && 'bestMethod',
        d.claims && 'claims',
        d.abstract && 'abstract',
        d.industrialApplicability && 'industrialApplicability',
        d.listOfNumerals && 'listOfNumerals',
        // Extra sections from JSON column
        ...Object.keys((d as any).extraSections || {})
      ].filter(Boolean),
      // Include extra sections keys
      extraSectionsKeys: Object.keys((d as any).extraSections || {})
    }))

  return NextResponse.json({
    versions: drafts,
    totalVersions: drafts.length,
    latestVersion: drafts[0]?.version || 0,
    jurisdiction: effectiveJurisdiction
  })
}

// Get a specific draft version by ID or version number - for viewing/comparing old versions
async function handleGetDraftByVersion(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, version, draftId } = data
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  let draft: any = null

  if (draftId) {
    // Get by specific draft ID
    draft = await prisma.annexureDraft.findFirst({
      where: { id: draftId, sessionId }
    })
  } else if (version !== undefined) {
    // Get by version number and jurisdiction
    const effectiveJurisdiction = (jurisdiction || session.activeJurisdiction || (session as any).draftingJurisdictions?.[0] || 'US').toUpperCase()
    draft = await prisma.annexureDraft.findFirst({
      where: {
        sessionId,
        version: parseInt(version, 10),
        jurisdiction: effectiveJurisdiction
      }
    })
  }

  if (!draft) {
    return NextResponse.json({ error: 'Draft version not found' }, { status: 404 })
  }

  // Return full draft content including extra sections
  return NextResponse.json({
    draft: {
      id: draft.id,
      version: draft.version,
      jurisdiction: draft.jurisdiction,
      title: draft.title,
      fieldOfInvention: draft.fieldOfInvention,
      background: draft.background,
      summary: draft.summary,
      briefDescriptionOfDrawings: draft.briefDescriptionOfDrawings,
      detailedDescription: draft.detailedDescription,
      bestMethod: draft.bestMethod,
      claims: draft.claims,
      abstract: draft.abstract,
      industrialApplicability: draft.industrialApplicability,
      listOfNumerals: draft.listOfNumerals,
      // Include extra sections from JSON column
      extraSections: (draft as any).extraSections || {},
      // Metadata
      fullDraftText: draft.fullDraftText,
      isValid: draft.isValid,
      validationReport: draft.validationReport,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    }
  })
}

// ============================================================================
// Multi-Jurisdiction Filing Handlers
// ============================================================================

import { 
  generateReferenceDraft, 
  translateReferenceDraft, 
  getSectionMapping,
  validateDraft,
  SUPERSET_SECTIONS
} from '@/lib/multi-jurisdiction-service'

/**
 * Generate Reference Draft (dynamic superset sections based on selected jurisdictions)
 * Required as first step in multi-jurisdiction filing
 * 
 * Optimization: Only generates sections that are actually needed by the selected jurisdictions,
 * reducing cost, complexity, and generation time.
 */
async function handleGenerateReferenceDraft(
  user: any, 
  patentId: string, 
  data: any, 
  requestHeaders: Record<string, string>
) {
  const { sessionId } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get the selected jurisdictions (filter out 'REFERENCE' pseudo-jurisdiction)
  const selectedJurisdictions = (Array.isArray(session.draftingJurisdictions) ? session.draftingJurisdictions : [])
    .filter((j: string) => j && j.toUpperCase() !== 'REFERENCE')

  // Check if multi-jurisdiction mode is enabled OR if multiple jurisdictions are actually selected
  // This allows reference draft generation even if isMultiJurisdiction wasn't explicitly set
  const hasMultipleJurisdictions = selectedJurisdictions.length > 1
  const isMultiMode = session.isMultiJurisdiction === true || hasMultipleJurisdictions

  if (!isMultiMode) {
    return NextResponse.json({ 
      error: 'Reference draft only applicable for multi-jurisdiction mode. Select 2+ jurisdictions first.',
      hint: 'To enable multi-jurisdiction mode, select multiple countries in the jurisdiction selection step.'
    }, { status: 400 })
  }

  // If multi-mode but flag not set, auto-enable it
  if (hasMultipleJurisdictions && !session.isMultiJurisdiction) {
    console.log(`[handleGenerateReferenceDraft] Auto-enabling multi-jurisdiction mode for ${selectedJurisdictions.length} jurisdictions`)
    await prisma.draftingSession.update({
      where: { id: sessionId },
      data: { isMultiJurisdiction: true }
    })
  }

  // Ensure we have jurisdictions to work with
  const jurisdictionsToUse = selectedJurisdictions.length > 0 ? selectedJurisdictions : ['US']

  console.log(`[handleGenerateReferenceDraft] Generating reference draft for jurisdictions: ${jurisdictionsToUse.join(', ')}`)

  // Generate reference draft with ONLY the sections needed by selected jurisdictions
  const result = await generateReferenceDraft(session, jurisdictionsToUse, user.tenantId, requestHeaders)

  if (!result.success || !result.draft) {
    return NextResponse.json({ error: result.error || 'Failed to generate reference draft' }, { status: 500 })
  }

  // Build full text for storage (only include generated sections)
  const fullDraftText = Object.entries(result.draft)
    .filter(([_, value]) => value && value.trim()) // Only include non-empty sections
    .map(([key, value]) => `## ${key}\n\n${value}`)
    .join('\n\n---\n\n')

  // Store as AnnexureDraft with jurisdiction='REFERENCE'
  const lastReferenceDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: 'REFERENCE' },
    orderBy: { version: 'desc' }
  })
  const version = (lastReferenceDraft?.version || 0) + 1

  const referenceDraft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: 'REFERENCE',
      // Map superset keys to AnnexureDraft schema fields (use empty string if not in dynamic superset)
      title: result.draft.title || '',
      fieldOfInvention: result.draft.fieldOfInvention || '',
      background: result.draft.background || '',
      summary: result.draft.summary || '',
      briefDescriptionOfDrawings: result.draft.briefDescriptionOfDrawings || '',
      detailedDescription: result.draft.detailedDescription || '',
      bestMethod: result.draft.bestMode || '',
      claims: result.draft.claims || '',
      abstract: result.draft.abstract || '',
      industrialApplicability: result.draft.industrialApplicability || '',
      listOfNumerals: result.draft.listOfNumerals || '',
      fullDraftText,
      extraSections: {
        // Store extended superset sections
        preamble: result.draft.preamble || '',
        objectsOfInvention: result.draft.objectsOfInvention || '',
        technicalProblem: result.draft.technicalProblem || '',
        technicalSolution: result.draft.technicalSolution || '',
        advantageousEffects: result.draft.advantageousEffects || '',
        crossReference: result.draft.crossReference || '',
        // Store metadata about the dynamic superset
        _dynamicSections: result.dynamicSections, // The sections that were actually generated
        _sectionDetails: result.sectionDetails, // Which jurisdictions needed which sections
        _selectedJurisdictions: selectedJurisdictions,
        _rawDraft: result.draft
      },
      isValid: true
    }
  })

  // Update session to mark reference draft as complete
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      referenceDraftComplete: true,
      referenceDraftId: referenceDraft.id,
      jurisdictionDraftStatus: {
        ...(session.jurisdictionDraftStatus as any || {}),
        REFERENCE: {
          status: 'done',
          latestVersion: version,
          sectionsGenerated: result.dynamicSections?.length || 0,
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  return NextResponse.json({
    success: true,
    draft: result.draft,
    draftId: referenceDraft.id,
    version,
    tokensUsed: result.tokensUsed,
    // Include metadata about optimization
    optimization: {
      sectionsGenerated: result.dynamicSections?.length || 0,
      fullSupersetSize: SUPERSET_SECTIONS.length,
      sectionsSaved: SUPERSET_SECTIONS.length - (result.dynamicSections?.length || SUPERSET_SECTIONS.length),
      selectedJurisdictions: jurisdictionsToUse,
      dynamicSections: result.dynamicSections
    }
  })
}

/**
 * Translate Reference Draft to a target jurisdiction
 * Uses section mapping and temp=0 for consistency
 * Supports language selection for jurisdictions with multiple languages
 */
async function handleTranslateToJurisdiction(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, targetJurisdiction, targetLanguage } = data

  if (!sessionId || !targetJurisdiction) {
    return NextResponse.json({ error: 'Session ID and target jurisdiction required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } } }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Verify reference draft exists
  if (!session.referenceDraftComplete || !session.referenceDraftId) {
    return NextResponse.json({ error: 'Reference draft must be generated first' }, { status: 400 })
  }

  // Get reference draft
  const referenceDraft = await prisma.annexureDraft.findUnique({
    where: { id: session.referenceDraftId }
  })

  if (!referenceDraft) {
    return NextResponse.json({ error: 'Reference draft not found' }, { status: 404 })
  }

  // Resolve target language - from request, session status, or profile default
  const targetCode = targetJurisdiction.toUpperCase()
  let resolvedLanguage = targetLanguage
  if (!resolvedLanguage) {
    // Try to get from session's jurisdiction draft status
    const jurisdictionStatus = (session.jurisdictionDraftStatus as any)?.[targetCode]
    resolvedLanguage = jurisdictionStatus?.language
  }
  // Language will be further resolved by translateReferenceDraft if still undefined

  // Extract raw draft from extra sections - include all superset sections
  const extraSections = referenceDraft.extraSections as any || {}
  const rawDraft = extraSections._rawDraft || {
    // Core sections from AnnexureDraft fields
    title: referenceDraft.title,
    fieldOfInvention: referenceDraft.fieldOfInvention,
    background: referenceDraft.background,
    summary: referenceDraft.summary,
    briefDescriptionOfDrawings: referenceDraft.briefDescriptionOfDrawings,
    detailedDescription: referenceDraft.detailedDescription,
    bestMode: referenceDraft.bestMethod, // Map to canonical superset key
    claims: referenceDraft.claims,
    abstract: referenceDraft.abstract,
    industrialApplicability: referenceDraft.industrialApplicability,
    // Extended superset sections from extraSections
    preamble: extraSections.preamble || '',
    objectsOfInvention: extraSections.objectsOfInvention || '',
    technicalProblem: extraSections.technicalProblem || '',
    technicalSolution: extraSections.technicalSolution || '',
    advantageousEffects: extraSections.advantageousEffects || ''
  }

  // Translate to target jurisdiction with language support
  const result = await translateReferenceDraft(rawDraft, targetCode, resolvedLanguage, user.tenantId, requestHeaders)

  if (!result.success || !result.draft) {
    return NextResponse.json({ 
      error: 'Translation failed',
      details: result.errors 
    }, { status: 500 })
  }

  // Validate the translated draft
  const validationIssues = await validateDraft(result.draft, targetCode)
  const hasErrors = validationIssues.some(i => i.type === 'error')

  // Build full text
  const fullDraftText = Object.entries(result.draft)
    .map(([key, value]) => `## ${key}\n\n${value}`)
    .join('\n\n---\n\n')

  // Get section mapping for proper field assignment
  const mappings = await getSectionMapping(targetCode)
  const mappedDraft: Record<string, string> = {}
  for (const m of mappings) {
    mappedDraft[m.countryKey] = result.draft[m.countryKey] || ''
  }

  // Store translated draft
  const lastDraft = await prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: targetCode },
    orderBy: { version: 'desc' }
  })
  const version = (lastDraft?.version || 0) + 1

  const translatedDraft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
      jurisdiction: targetCode,
      title: mappedDraft.title || result.draft.title || '',
      fieldOfInvention: mappedDraft.fieldOfInvention || mappedDraft.field || result.draft.field || '',
      background: mappedDraft.background || result.draft.background || '',
      summary: mappedDraft.summary || result.draft.summary || '',
      briefDescriptionOfDrawings: mappedDraft.briefDescriptionOfDrawings || result.draft.briefDescriptionOfDrawings || '',
      detailedDescription: mappedDraft.detailedDescription || result.draft.detailedDescription || '',
      bestMethod: mappedDraft.bestMethod || result.draft.bestMethod || '',
      claims: mappedDraft.claims || result.draft.claims || '',
      abstract: mappedDraft.abstract || result.draft.abstract || '',
      industrialApplicability: mappedDraft.industrialApplicability || result.draft.industrialApplicability || '',
      listOfNumerals: mappedDraft.listOfNumerals || '',
      fullDraftText,
      extraSections: {
        ...result.draft,
        _translatedFrom: 'REFERENCE',
        _translationErrors: result.errors,
        _language: result.language || resolvedLanguage // Store the language used for this draft
      },
      isValid: !hasErrors,
      validationReport: {
        issues: validationIssues as any,
        hasErrors,
        checkedAt: new Date().toISOString()
      }
    }
  })

  // Update session status with language used
  const usedLanguage = result.language || resolvedLanguage
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session.jurisdictionDraftStatus as any || {}),
        [targetCode]: {
          status: hasErrors ? 'needs_review' : 'done',
          latestVersion: version,
          translatedFrom: 'REFERENCE',
          language: usedLanguage, // Persist the language used
          updatedAt: new Date().toISOString()
        }
      }
    }
  })

  return NextResponse.json({
    success: true,
    draft: result.draft,
    draftId: translatedDraft.id,
    version,
    jurisdiction: targetCode,
    language: usedLanguage, // Return the language used
    validation: {
      issues: validationIssues,
      hasErrors
    },
    errors: result.errors
  })
}

/**
 * Validate a draft against jurisdiction-specific rules
 */
async function handleValidateDraft(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, draft } = data

  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'Session ID and jurisdiction required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Get draft to validate
  let draftToValidate: Record<string, string> = draft || {}
  
  // If no draft provided, get latest from database
  if (!draft || Object.keys(draft).length === 0) {
    const latestDraft = await prisma.annexureDraft.findFirst({
      where: { sessionId, jurisdiction: jurisdiction.toUpperCase() },
      orderBy: { version: 'desc' }
    })
    
    if (latestDraft) {
      draftToValidate = {
        title: latestDraft.title || '',
        fieldOfInvention: latestDraft.fieldOfInvention || '',
        background: latestDraft.background || '',
        summary: latestDraft.summary || '',
        briefDescriptionOfDrawings: latestDraft.briefDescriptionOfDrawings || '',
        detailedDescription: latestDraft.detailedDescription || '',
        bestMethod: latestDraft.bestMethod || '',
        claims: latestDraft.claims || '',
        abstract: latestDraft.abstract || '',
        industrialApplicability: latestDraft.industrialApplicability || '',
        ...(latestDraft.extraSections as Record<string, string> || {})
      }
    }
  }

  // Run validation
  const issues = await validateDraft(draftToValidate, jurisdiction.toUpperCase())
  
  return NextResponse.json({
    success: true,
    jurisdiction: jurisdiction.toUpperCase(),
    issues,
    hasErrors: issues.some(i => i.type === 'error'),
    hasWarnings: issues.some(i => i.type === 'warning'),
    checkedAt: new Date().toISOString()
  })
}

// ============================================================================
// AI Review Handlers
// ============================================================================

import { runAIReview, buildFixPrompt, type AIReviewIssue, type FixContext } from '@/lib/ai-review-service'

/**
 * Run comprehensive AI review on draft
 * Analyzes cross-section consistency, diagram alignment, claims support
 * NOTE: This is a premium feature - requires PATENT_REVIEW service access (Pro tier)
 */
async function handleRunAIReview(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, jurisdiction, draft: providedDraft } = data

  if (!sessionId || !jurisdiction) {
    return NextResponse.json({ error: 'Session ID and jurisdiction required' }, { status: 400 })
  }

  // Check if user has access to PATENT_REVIEW service (Pro tier feature)
  if (user.tenantId) {
    const serviceCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'PATENT_REVIEW'
    )
    if (!serviceCheck.allowed) {
      return NextResponse.json({
        error: 'AI Review is a Pro feature',
        reason: serviceCheck.response?.statusText || 'Upgrade to Pro plan to access AI-powered patent review',
        code: 'SERVICE_ACCESS_DENIED',
        upgradeRequired: true
      }, { status: 403 })
    }
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: { orderBy: { version: 'desc' } }
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Get draft content - prefer provided, then latest from DB
  let draftContent: Record<string, string> = providedDraft || {}
  
  if (!providedDraft || Object.keys(providedDraft).length === 0) {
    const latestDraft = session.annexureDrafts.find(
      (d: any) => (d.jurisdiction || '').toUpperCase() === code
    )
    
    if (latestDraft) {
      draftContent = {
        title: latestDraft.title || '',
        fieldOfInvention: latestDraft.fieldOfInvention || '',
        background: latestDraft.background || '',
        summary: latestDraft.summary || '',
        briefDescriptionOfDrawings: latestDraft.briefDescriptionOfDrawings || '',
        detailedDescription: latestDraft.detailedDescription || '',
        bestMethod: latestDraft.bestMethod || '',
        claims: latestDraft.claims || '',
        abstract: latestDraft.abstract || '',
        industrialApplicability: latestDraft.industrialApplicability || '',
        ...(latestDraft.extraSections as Record<string, string> || {})
      }
    }
  }

  if (Object.keys(draftContent).length === 0) {
    return NextResponse.json({ error: 'No draft content available for review' }, { status: 400 })
  }

  // Get figures with PlantUML code from diagram sources
  const figures = (session.figurePlans || []).map((plan: any) => {
    const source = (session.diagramSources || []).find((d: any) => d.figureNo === plan.figureNo)
    return {
      figureNo: plan.figureNo,
      title: plan.title || `Figure ${plan.figureNo}`,
      plantuml: source?.plantumlCode || '' // Use plantumlCode field from DB
    }
  }).filter((f: any) => f.plantuml) // Only include figures with PlantUML

  // Get components from reference map
  const components = Array.isArray((session.referenceMap as any)?.components)
    ? (session.referenceMap as any).components.map((c: any) => ({
        name: c.name || '',
        numeral: c.numeral || ''
      }))
    : []

  // Get invention title
  const inventionTitle = (session.ideaRecord as any)?.title || draftContent.title || ''

  // Run AI review
  const reviewResult = await runAIReview(
    {
      draft: draftContent,
      figures,
      jurisdiction: code,
      inventionTitle,
      components
    },
    user.tenantId,
    requestHeaders
  )

  // Get the latest draft ID for linking
  const latestDraft = session.annexureDrafts.find(
    (d: any) => (d.jurisdiction || '').toUpperCase() === code
  )

  // Persist the full review result to database
  const savedReview = await prisma.aIReviewResult.create({
    data: {
      sessionId,
      draftId: latestDraft?.id || null,
      jurisdiction: code,
      issues: reviewResult.issues as any || [],
      summary: reviewResult.summary || {},
      tokensUsed: reviewResult.tokensUsed,
      reviewedAt: new Date(reviewResult.reviewedAt)
    }
  })

  // Also update session status for quick reference
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: {
      jurisdictionDraftStatus: {
        ...(session.jurisdictionDraftStatus as any || {}),
        [code]: {
          ...(session.jurisdictionDraftStatus as any)?.[code],
          lastAIReview: {
            reviewId: savedReview.id,
            reviewedAt: reviewResult.reviewedAt,
            issueCount: reviewResult.summary.totalIssues,
            overallScore: reviewResult.summary.overallScore
          }
        }
      }
    }
  })

  return NextResponse.json({
    reviewId: savedReview.id,
    ...reviewResult
  })
}

/**
 * Apply an AI-suggested fix to a section
 * Regenerates the section with the fix prompt
 * NOTE: This is a premium feature - requires PATENT_REVIEW service access (Pro tier)
 */
async function handleApplyAIFix(
  user: any,
  patentId: string,
  data: any,
  requestHeaders: Record<string, string>
) {
  const { sessionId, jurisdiction, sectionKey, issue, currentContent, relatedContent } = data

  if (!sessionId || !jurisdiction || !sectionKey || !issue) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, section key, and issue are required' 
    }, { status: 400 })
  }

  // Check if user has access to PATENT_REVIEW service (Pro tier feature)
  if (user.tenantId) {
    const serviceCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'PATENT_REVIEW'
    )
    if (!serviceCheck.allowed) {
      return NextResponse.json({
        error: 'AI Review Fix is a Pro feature',
        reason: 'Upgrade to Pro plan to apply AI-suggested fixes',
        code: 'SERVICE_ACCESS_DENIED',
        upgradeRequired: true
      }, { status: 403 })
    }
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { 
      annexureDrafts: { orderBy: { version: 'desc' } },
      diagramSources: true // Include PlantUML diagrams
    }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Get current section content if not provided
  let content = currentContent
  if (!content) {
    const latestDraft = session.annexureDrafts.find(
      (d: any) => (d.jurisdiction || '').toUpperCase() === code
    )
    if (latestDraft) {
      content = (latestDraft as any)[sectionKey] || 
        (latestDraft.extraSections as any)?.[sectionKey] || ''
    }
  }

  if (!content) {
    return NextResponse.json({ error: 'No content found for section' }, { status: 400 })
  }

  // Extract figures (PlantUML) from diagram sources
  const figures = (session.diagramSources || []).map((ds: any) => ({
    figureNo: ds.figureNo,
    title: `Figure ${ds.figureNo}`,
    plantuml: ds.plantumlCode || ''
  })).filter((f: any) => f.plantuml)

  // Extract components from reference map
  const referenceMap = (session as any).referenceMap || {}
  const components = Array.isArray(referenceMap.components) 
    ? referenceMap.components.map((c: any) => ({
        name: c.name || c.label || '',
        numeral: String(c.numeral || c.referenceNumeral || '')
      })).filter((c: any) => c.name && c.numeral)
    : []

  // Build the fix prompt with full context including diagrams
  const fixPrompt = buildFixPrompt(content, issue as AIReviewIssue, {
    relatedContent,
    figures: issue.category === 'diagram' ? figures : undefined, // Only include diagrams for diagram-related issues
    components
  })

  // Use LLM to regenerate the section with the fix
  const result = await llmGateway.executeLLMOperation(
    { headers: requestHeaders || {} },
    {
      taskCode: 'LLM2_DRAFT',
      prompt: fixPrompt,
      parameters: {
        tenantId: user.tenantId,
        jurisdiction: code,
        temperature: 0.2, // Low temperature for focused fixes
        purpose: 'apply_ai_fix'
      },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId,
        sessionId,
        sectionKey,
        issueId: issue.id,
        purpose: 'apply_ai_fix'
      }
    }
  )

  if (!result.success || !result.response) {
    return NextResponse.json({ 
      error: result.error?.message || 'Failed to apply fix' 
    }, { status: 500 })
  }

  // Clean up response
  let fixedContent = (result.response.output || '').trim()
  fixedContent = fixedContent.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '')

  // Compute diff data for micro-versioning
  const diffData = computeTextDiff(content, fixedContent)

  // Track the applied fix in the latest review with full history
  const latestReview = await prisma.aIReviewResult.findFirst({
    where: { sessionId, jurisdiction: code },
    orderBy: { reviewedAt: 'desc' }
  })

  const fixHistoryEntry = {
    id: `fix-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    issueId: issue.id,
    sectionKey,
    timestamp: new Date().toISOString(),
    status: 'fixed' as const,
    changeSummary: issue.title || 'Applied AI fix',
    beforeText: content,
    afterText: fixedContent,
    diffData,
    issueCode: issue.issueCode || issue.code,
    issueSeverity: issue.severity
  }

  if (latestReview) {
    const existingFixes = Array.isArray(latestReview.appliedFixes) ? latestReview.appliedFixes : []
    
    // Update issues array to mark this issue as fixed
    const existingIssues = Array.isArray(latestReview.issues) ? latestReview.issues : []
    const updatedIssues = existingIssues.map((i: any) => 
      i.id === issue.id ? { ...i, status: 'fixed', resolvedAt: new Date().toISOString(), resolvedBy: 'fix' } : i
    )
    
    await prisma.aIReviewResult.update({
      where: { id: latestReview.id },
      data: {
        issues: updatedIssues,
        appliedFixes: [
          ...existingFixes,
          fixHistoryEntry
        ]
      }
    })
  }

  return NextResponse.json({
    success: true,
    sectionKey,
    originalContent: content,
    fixedContent,
    diffData,
    fixHistoryEntry,
    issue: { ...issue, status: 'fixed' },
    tokensUsed: result.response.outputTokens
  })
}

/**
 * Compute text diff for before/after comparison
 * Handles empty strings and patent-specific patterns (numerals, figures)
 */
function computeTextDiff(before: string, after: string) {
  // Handle edge cases
  if (!before && !after) {
    return {
      beforeText: '',
      afterText: '',
      segments: [],
      summary: 'No changes'
    }
  }
  
  if (before === after) {
    return {
      beforeText: before,
      afterText: after,
      segments: [{ type: 'unchanged' as const, text: after }],
      summary: 'No changes'
    }
  }
  
  if (!before) {
    return {
      beforeText: '',
      afterText: after,
      segments: [{ type: 'addition' as const, text: after }],
      summary: `Added ${after.split(/\s+/).filter(Boolean).length} words`
    }
  }
  
  if (!after) {
    return {
      beforeText: before,
      afterText: '',
      segments: [{ type: 'deletion' as const, text: before }],
      summary: `Removed ${before.split(/\s+/).filter(Boolean).length} words`
    }
  }

  // Tokenize preserving patent patterns like (100), Fig. 1, etc.
  // Split on whitespace but keep the whitespace tokens for reconstruction
  const tokenize = (text: string) => text.split(/(\s+)/).filter(t => t.length > 0)
  
  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  
  // Simple diff computation using LCS
  const segments: Array<{ type: 'addition' | 'deletion' | 'unchanged'; text: string }> = []
  let addedCount = 0
  let removedCount = 0
  
  const m = beforeTokens.length
  const n = afterTokens.length
  
  // Limit diff computation for very large texts (performance safeguard)
  if (m * n > 1000000) {
    // Fallback: show as full replacement for very large diffs
    return {
      beforeText: before,
      afterText: after,
      segments: [
        { type: 'deletion' as const, text: before.substring(0, 500) + (before.length > 500 ? '...' : '') },
        { type: 'addition' as const, text: after.substring(0, 500) + (after.length > 500 ? '...' : '') }
      ],
      summary: 'Large text replacement (diff truncated)'
    }
  }
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeTokens[i - 1] === afterTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  // Backtrack to build segments
  let i = m, j = n
  const tempSegments: typeof segments = []
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeTokens[i - 1] === afterTokens[j - 1]) {
      tempSegments.unshift({ type: 'unchanged', text: beforeTokens[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempSegments.unshift({ type: 'addition', text: afterTokens[j - 1] })
      // Only count non-whitespace as "words"
      if (afterTokens[j - 1].trim()) addedCount++
      j--
    } else if (i > 0) {
      tempSegments.unshift({ type: 'deletion', text: beforeTokens[i - 1] })
      if (beforeTokens[i - 1].trim()) removedCount++
      i--
    }
  }
  
  // Merge adjacent segments of the same type for cleaner output
  const mergedSegments: typeof segments = []
  for (const seg of tempSegments) {
    const last = mergedSegments[mergedSegments.length - 1]
    if (last && last.type === seg.type) {
      last.text += seg.text
    } else {
      mergedSegments.push({ ...seg })
    }
  }
  
  return {
    beforeText: before,
    afterText: after,
    segments: mergedSegments,
    summary: addedCount === 0 && removedCount === 0 
      ? 'Minor formatting changes' 
      : `Added ${addedCount} words, removed ${removedCount} words`
  }
}

/**
 * Get existing AI reviews for a session/jurisdiction
 */
async function handleGetAIReviews(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction } = data

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  // Build query
  const whereClause: any = { sessionId }
  if (jurisdiction) {
    whereClause.jurisdiction = jurisdiction.toUpperCase()
  }

  // Get reviews with most recent first
  const reviews = await prisma.aIReviewResult.findMany({
    where: whereClause,
    orderBy: { reviewedAt: 'desc' },
    take: 10 // Limit to last 10 reviews per jurisdiction
  })

  // Get the latest review for each jurisdiction
  const latestByJurisdiction: Record<string, any> = {}
  for (const review of reviews) {
    if (!latestByJurisdiction[review.jurisdiction]) {
      latestByJurisdiction[review.jurisdiction] = review
    }
  }

  return NextResponse.json({
    success: true,
    reviews,
    latest: latestByJurisdiction,
    count: reviews.length
  })
}

/**
 * Mark an AI issue as ignored
 */
async function handleIgnoreAIIssue(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, issueId, reviewId } = data

  if (!sessionId || !jurisdiction || !issueId) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, and issue ID required' 
    }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Find the review to update
  let review
  if (reviewId) {
    review = await prisma.aIReviewResult.findUnique({ where: { id: reviewId } })
  } else {
    review = await prisma.aIReviewResult.findFirst({
      where: { sessionId, jurisdiction: code },
      orderBy: { reviewedAt: 'desc' }
    })
  }

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  // Validate the issue exists in this review
  const issues = Array.isArray(review.issues) ? (review.issues as any[]) : []
  const targetIssue = issues.find((i: any) => i.id === issueId) as { id: string; status?: string } | undefined
  
  if (!targetIssue) {
    return NextResponse.json({ error: 'Issue not found in this review' }, { status: 404 })
  }

  // Check if already ignored or fixed
  if (targetIssue.status === 'ignored') {
    return NextResponse.json({ 
      success: true, 
      message: 'Issue is already ignored',
      reviewId: review.id 
    })
  }
  
  if (targetIssue.status === 'fixed') {
    return NextResponse.json({ 
      error: 'Cannot ignore a fixed issue. Revert the fix first if needed.' 
    }, { status: 400 })
  }

  // Add to ignored issues and update issue status
  const existingIgnored = Array.isArray(review.ignoredIssues) ? (review.ignoredIssues as string[]) : []
  
  // Update the issue status to 'ignored'
  const updatedIssues = issues.map((i: any) => 
    i.id === issueId 
      ? { ...i, status: 'ignored', resolvedAt: new Date().toISOString(), resolvedBy: 'ignore' } 
      : i
  )
  
  await prisma.aIReviewResult.update({
    where: { id: review.id },
    data: {
      issues: updatedIssues,
      ignoredIssues: existingIgnored.includes(issueId) 
        ? existingIgnored 
        : [...existingIgnored, issueId]
    }
  })

  return NextResponse.json({
    success: true,
    reviewId: review.id,
    ignoredIssues: existingIgnored.includes(issueId) ? existingIgnored : [...existingIgnored, issueId],
    updatedIssueStatus: 'ignored'
  })
}

/**
 * Revert an applied AI fix
 * Restores the section to its state before the fix was applied
 */
async function handleRevertAIFix(user: any, patentId: string, data: any) {
  const { sessionId, jurisdiction, sectionKey, fixHistoryId } = data

  if (!sessionId || !jurisdiction || !sectionKey || !fixHistoryId) {
    return NextResponse.json({ 
      error: 'Session ID, jurisdiction, section key, and fix history ID required' 
    }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' } } }
  })

  if (!session) {
    return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  }

  const code = jurisdiction.toUpperCase()

  // Find the review with the fix history
  const review = await prisma.aIReviewResult.findFirst({
    where: { sessionId, jurisdiction: code },
    orderBy: { reviewedAt: 'desc' }
  })

  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  // Type for fix history entries
  interface FixHistoryEntry {
    id: string
    sectionKey: string
    status?: string
    beforeText?: string
    issueId: string
  }

  // Find the fix history entry - SECURITY: validate it belongs to this review
  const appliedFixes = Array.isArray(review.appliedFixes) ? (review.appliedFixes as unknown as FixHistoryEntry[]) : []
  const fixEntry = appliedFixes.find((f) => f.id === fixHistoryId)

  if (!fixEntry) {
    return NextResponse.json({ error: 'Fix history entry not found in this review' }, { status: 404 })
  }

  // SECURITY: Verify the fix belongs to the requested section
  if (fixEntry.sectionKey !== sectionKey) {
    return NextResponse.json({ error: 'Fix does not belong to specified section' }, { status: 400 })
  }

  // Check if already reverted
  if (fixEntry.status === 'reverted') {
    return NextResponse.json({ error: 'This fix has already been reverted' }, { status: 400 })
  }

  // Get the before text from the fix entry
  const revertedContent = fixEntry.beforeText

  if (!revertedContent && revertedContent !== '') {
    return NextResponse.json({ error: 'No previous content available for revert' }, { status: 400 })
  }

  // Update the review to mark the issue as reverted (back to pending for re-fixing)
  const issues = Array.isArray(review.issues) ? (review.issues as any[]) : []
  const updatedIssues = issues.map((i: any) => 
    i.id === fixEntry.issueId 
      ? { ...i, status: 'pending', revertedAt: new Date().toISOString(), previousStatus: i.status } 
      : i
  )

  // Update the fix entry status
  const updatedFixes = appliedFixes.map((f) =>
    f.id === fixHistoryId
      ? { ...f, status: 'reverted', revertedAt: new Date().toISOString() }
      : f
  )

  await prisma.aIReviewResult.update({
    where: { id: review.id },
    data: {
      issues: updatedIssues,
      appliedFixes: updatedFixes as any
    }
  })

  return NextResponse.json({
    success: true,
    sectionKey,
    revertedContent,
    fixHistoryId,
    issueId: fixEntry.issueId,
    message: 'Fix reverted successfully. Issue is now pending again.'
  })
}
