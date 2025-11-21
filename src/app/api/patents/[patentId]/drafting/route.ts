import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { DraftingService } from '@/lib/drafting-service';
import { IdeaBankService } from '@/lib/idea-bank-service';
import { llmGateway } from '@/lib/metering/gateway';
import { getGatedStyleInstructions } from '@/lib/style-instruction-builder'
import crypto from 'crypto';
import plantumlEncoder from 'plantuml-encoder';
import path from 'path';
import fs from 'fs/promises';
import { imageSize } from 'image-size';

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
          orderBy: { version: 'desc' },
          take: 1
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
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { patentId } = params;
    const body = await request.json();
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

      // New: Section-level generation and save for Annexure 2
      case 'generate_sections':
        return await handleGenerateSections(authResult.user, patentId, data, requestHeaders);

      case 'save_sections':
        return await handleSaveSections(authResult.user, patentId, data);

      case 'autosave_sections':
        return await handleAutosaveSections(authResult.user, patentId, data);

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

      case 'set_stage':
        return await handleSetStage(authResult.user, patentId, data);

      case 'resume':
        return await handleResume(authResult.user, patentId);

      // Review & Export
      case 'run_review_checks':
        return await handleRunReview(authResult.user, patentId, data);

      case 'export_docx':
        return await handleExportDOCX(authResult.user, patentId, data, request);

      case 'preview_export':
        return await handlePreviewExport(authResult.user, patentId, data);

      case 'get_export_preview':
        return await handleGetExportPreview(authResult.user, patentId, data);

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('POST /api/patents/[patentId]/drafting error:', error);
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
  const { sessionId, runId, batchSize } = data
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

    const batchRelevancePrompt = `You are an expert patent attorney. Analyze these patent candidates for relevance to our invention and assess novelty.

INVENTION: ${title} | SEARCH: ${query}

For each patent, provide:
- relevance: 0.0-1.0 score
- novelty_threat: "anticipates" | "obvious" | "adjacent" | "remote"
- summary: 1-2 sentence explanation
- relevant_parts: List specific elements/claims/aspects of the patent that are relevant to our invention
- irrelevant_parts: List specific elements/claims/aspects of the patent that are NOT relevant to our invention
- novelty_comparison: Explain what makes our invention novel compared to this patent (key differences, improvements, or unique aspects)

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
      parameters: { maxOutputTokens: 3000 }
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
  const { sessionId } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const last = session.annexureDrafts?.[0]
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
  const extended = DraftingService.validateDraftExtended(session.annexureDrafts?.[0] || {}, session)
  return NextResponse.json({
    validationReport: validation.report,
    isValid: validation.valid,
    extendedReport: extended.report,
    extendedValid: extended.valid
  })
}

// Pre-export normalizer: prepares content blocks with blank space control and color sanitization
function preExportNormalizer(content: Record<string, string>): { blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> } {
  const blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }> = []
  let blockCounter = 0

  const sections = [
    { key: 'title', section: 'title', type: 'heading' },
    { key: 'fieldOfInvention', section: 'fieldOfInvention', type: 'body' },
    { key: 'background', section: 'background', type: 'body' },
    { key: 'summary', section: 'summary', type: 'body' },
    { key: 'briefDescriptionOfDrawings', section: 'briefDescriptionOfDrawings', type: 'body' },
    { key: 'detailedDescription', section: 'detailedDescription', type: 'body' },
    { key: 'industrialApplicability', section: 'industrialApplicability', type: 'body' },
    { key: 'bestMethod', section: 'bestMethod', type: 'body' },
    { key: 'claims', section: 'claims', type: 'body' },
    { key: 'listOfNumerals', section: 'listOfNumerals', type: 'body' },
    { key: 'abstract', section: 'abstract', type: 'body' }
  ]

  for (const { key, section, type } of sections) {
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

// Paragraph numbering injector: adds [0001] style numbering to Description sections
function injectParagraphNumbering(blocks: Array<{ type: string; section: string; subtype?: string; content: string; blockId: string }>): void {
  // Description sections that get numbered: fieldOfInvention, background, summary, briefDescriptionOfDrawings, detailedDescription, bestMethod
  const descriptionSections = ['fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod']

  let paragraphNumber = 1

  for (const block of blocks) {
    // Only number paragraphs in description sections, exclude headings, captions, tables, equations
    if (block.type === 'paragraph' && descriptionSections.includes(block.section) && !block.subtype) {
      // Check if paragraph already starts with numbering pattern and strip it
      const existingNumberMatch = block.content.match(/^\[\d{4}\]\s+/)
      if (existingNumberMatch) {
        block.content = block.content.substring(existingNumberMatch[0].length)
      }

      // Inject new numbering with non-breaking space
      const formattedNumber = `[${paragraphNumber.toString().padStart(4, '0')}] `
      block.content = formattedNumber + block.content
      paragraphNumber++
    }
  }
}

// Get proper section heading text
function getSectionHeading(sectionName: string): string {
  const headingMap: Record<string, string> = {
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
  return headingMap[sectionName] || sectionName.toUpperCase()
}

async function handleExportDOCX(user: any, patentId: string, data: any, request?: NextRequest) {
  const { sessionId, autoNumberParagraphs = false } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const last = session.annexureDrafts?.[0]
  if (!last) return NextResponse.json({ error: 'No draft to export' }, { status: 400 })

  const figuresSorted = [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo)

  // Prepare content for normalization
  const rawContent = {
    title: last.title || 'Untitled',
    fieldOfInvention: last.fieldOfInvention || '',
    background: last.background || '',
    summary: last.summary || '',
    briefDescriptionOfDrawings: last.briefDescriptionOfDrawings || '',
    detailedDescription: last.detailedDescription || '',
    bestMethod: last.bestMethod || '',
    claims: last.claims || '',
    industrialApplicability: (last as any).industrialApplicability || '',
    listOfNumerals: last.listOfNumerals || '',
    abstract: last.abstract || ''
  }

  // Run pre-export normalizer
  const { blocks } = preExportNormalizer(rawContent)

  // Apply paragraph numbering if enabled
  if (autoNumberParagraphs) {
    injectParagraphNumbering(blocks)
  }

  const exportInput = {
    title: last.title || 'Untitled',
    fieldOfInvention: last.fieldOfInvention || '',
    background: last.background || '',
    summary: last.summary || '',
    briefDescriptionOfDrawings: last.briefDescriptionOfDrawings || '',
    detailedDescription: last.detailedDescription || '',
    bestMethod: last.bestMethod || '',
    claims: last.claims || '',
    abstract: last.abstract || '',
    industrialApplicability: (last as any).industrialApplicability || '',
    listOfNumerals: last.listOfNumerals || '',
    figures: figuresSorted.map(f => {
      const ds = (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)
      return {
        figureNo: f.figureNo,
        caption: f.title || `Figure ${f.figureNo}`,
        imagePath: (ds?.imagePath as string) || '',
        imageFilename: (ds?.imageFilename as string) || ''
      }
    }),
    blocks, // Include normalized blocks
    exportOptions: { autoNumberParagraphs }
  }

  const guards = preExportGuards(exportInput)
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

    // Create document with A4 page size and 2.54cm margins (1 inch = 1440 twips, 2.54cm = ~1 inch)
    const pageMargin = 1440 // 2.54cm = 1 inch = 1440 twips

    // Page header with "Page X of Y" format
    const header = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: 'Page ',
              size: 24,
              color: '000000'
            }),
            new TextRun({
              children: [PageNumber.CURRENT]
            }),
            new TextRun({
              text: ' of ',
              size: 24,
              color: '000000'
            }),
            new TextRun({
              children: [PageNumber.TOTAL_PAGES]
            })
          ]
        })
      ]
    })

    const doc = new Document({
      sections: [],
      styles: {
        default: {
          document: {
            run: {
              size: 24, // 12pt = 24 half-points
              font: 'Times New Roman'
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
              size: 24, // 12pt
              color: '000000' // black
            },
            paragraph: {
              alignment: AlignmentType.JUSTIFIED,
              spacing: {
                line: 480, // 2.0 line spacing (240 = single, 480 = 2.0)
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
              size: 24, // 12pt
              color: '000000', // black
              bold: true
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
              size: 24, // 12pt
              color: '000000' // black
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

    // Section 1: Title
    const titleSection = {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: {
            top: pageMargin,
            right: pageMargin,
            bottom: pageMargin,
            left: pageMargin
          },
          size: {
            width: 11906, // A4 width in twips (210mm)
            height: 16838 // A4 height in twips (297mm)
          }
        },
        headers: {
          default: header
        }
      },
      children: []
    }

    // Add title
    const titleBlock = blocks.find(b => b.section === 'title')
    if (titleBlock) {
      ;(titleSection.children as any[]).push(
        new Paragraph({
          text: titleBlock.content.toUpperCase(),
          heading: HeadingLevel.HEADING_1,
          style: 'headingStyle'
        })
      )
    }

    // Add body sections in correct sequence: TITLE, FIELD, BACKGROUND, SUMMARY, BRIEF_DESCRIPTION, DETAILED_DESCRIPTION, INDUSTRIAL_APPLICABILITY, CLAIMS
    const bodySections = ['fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'industrialApplicability', 'claims']
    for (const sectionName of bodySections) {
      const sectionHeading = getSectionHeading(sectionName)
      const sectionBlocks = blocks.filter(b => b.section === sectionName)

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
                  size: 24,
                  color: '000000'
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
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            margin: {
              top: pageMargin,
              right: pageMargin,
              bottom: pageMargin,
              left: pageMargin
            },
            size: {
              width: 11906,
              height: 16838
            }
          },
          headers: {
            default: header
          }
        },
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
              const availableTwips = 11906 - (pageMargin * 2)
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
            size: 24,
            color: '000000'
          })],
          style: 'captionStyle'
        })
      )

      documentSections.push(figureSection)
    }

    // Add abstract section at the end (last page)
    const abstractSection = {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          margin: {
            top: pageMargin,
            right: pageMargin,
            bottom: pageMargin,
            left: pageMargin
          },
          size: {
            width: 11906,
            height: 16838
          }
        },
        headers: {
          default: header
        }
      },
      children: []
    }

    // Add patent title (repeated on abstract page)
    const titleBlockForAbstract = blocks.find(b => b.section === 'title')
    if (titleBlockForAbstract) {
      ;(abstractSection.children as any[]).push(
        new Paragraph({
          children: [new TextRun({
            text: titleBlockForAbstract.content,
            size: 24,
            color: '000000',
            bold: true
          })],
          spacing: { after: 120 }
        })
      )
    }

    // Add ABSTRACT heading
    ;(abstractSection.children as any[]).push(
      new Paragraph({
        children: [new TextRun({
          text: 'ABSTRACT',
          size: 24,
          color: '000000',
          bold: true
        })],
        spacing: { before: 120, after: 120 }
      })
    )

    // Add abstract content (no numbering for abstract)
    const abstractBlocks = blocks.filter(b => b.section === 'abstract')

    for (const block of abstractBlocks) {
      if (block.type === 'paragraph') {
        ;(abstractSection.children as any[]).push(
          new Paragraph({
            children: [new TextRun({
              text: block.content,
              size: 24,
              color: '000000'
            })],
            style: 'bodyStyle'
          })
        )
      }
    }

    documentSections.push(abstractSection)

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
    const docContent = buildAnnexurePlainText(exportInput)

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

// Preview export builder and guards
function buildAnnexurePlainText(doc: any): string {
  const H = (s: string) => String(s||'').toUpperCase()
  const SECTIONS: Array<[string, string]> = [
    [H('Title of the Invention'), doc.title||''],
    [H('Field of the Invention'), doc.fieldOfInvention||''],
    [H('Background of the Invention'), doc.background||''],
    [H('Summary of the Invention'), doc.summary||''],
    [H('Brief Description of the Drawings'), doc.briefDescriptionOfDrawings||''],
    [H('Detailed Description of the Invention'), doc.detailedDescription||''],
    [H('Best Method of Performing the Invention'), doc.bestMethod||''],
    [H('Claims'), doc.claims||''],
    [H('Abstract'), doc.abstract||''],
    [H('Industrial Applicability'), doc.industrialApplicability||''],
    [H('List of Reference Numerals'), doc.listOfNumerals||'']
  ]
  const BODY = SECTIONS.filter(([_,v]) => String(v||'').trim()).map(([h,v]) => `${h}\n\n${String(v).trim()}`).join('\n\n')
  const PAGE_BREAK = '\n\n<<<PAGE_BREAK>>>\n\n'
  const DRAWINGS_HEADER = H('Drawings / Figures')
  const FIGURE_PAGES = [ `${DRAWINGS_HEADER}\n\n` ].concat(
    (doc.figures||[]).sort((a:any,b:any)=>a.figureNo-b.figureNo).map((f:any)=>`Fig. ${f.figureNo} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${String(f.caption||'').replace(/^Fig\.\s*\d+\s*ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â\s*/i,'')}`)
  ).join(PAGE_BREAK)
  return [BODY, PAGE_BREAK, FIGURE_PAGES].join('')
}

function preExportGuards(doc: any): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const req = (key: keyof typeof doc, label: string) => { if (!String(doc[key]||'').trim()) issues.push(`Missing: ${label}`) }
  req('title','Title')
  req('fieldOfInvention','Field of the Invention')
  req('background','Background of the Invention')
  req('summary','Summary of the Invention')
  req('detailedDescription','Detailed Description of the Invention')
  req('bestMethod','Best Method of Performing the Invention')
  req('claims','Claims')
  req('abstract','Abstract')
  req('industrialApplicability','Industrial Applicability')

  const absWords = String(doc.abstract||'').trim().split(/\s+/).length
  if (absWords>150) issues.push(`Abstract exceeds 150 words (${absWords})`)

  const declared = (doc.figures||[]).map((f:any)=>f.figureNo).sort((a:number,b:number)=>a-b)
  const bdod = String(doc.briefDescriptionOfDrawings||'')
  if (bdod.trim()) {
    const bdodFigs = Array.from(bdod.matchAll(/\b(Fig\.?|Figure)\s*0*(\d+)\b/gi)).map(m=>Number(m[2])).sort((a,b)=>a-b)
    const missing = declared.filter((n:number)=>!bdodFigs.includes(n))
    if (missing.length) issues.push(`BDOD missing figure lines for: ${missing.join(', ')}`)
  } else if (declared.length) {
    issues.push('BDOD missing while figures are present')
  }

  if (String(doc.listOfNumerals||'').trim()) {
    const nums = Array.from(String(doc.listOfNumerals).matchAll(/\((\d{1,5})\)/g)).map(m=>Number(m[1]))
    const dup = nums.filter((n,i)=>nums.indexOf(n)!==i)
    if (dup.length) issues.push(`Duplicate numerals in list: ${Array.from(new Set(dup)).join(', ')}`)
  }
  return { ok: issues.length===0, issues }
}

async function handlePreviewExport(user: any, patentId: string, data: any) {
  const { sessionId } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  const last = session.annexureDrafts?.[0]
  if (!last) return NextResponse.json({ error: 'No draft to export' }, { status: 400 })

  const exportInput = {
    title: last.title || 'Untitled',
    fieldOfInvention: last.fieldOfInvention || '',
    background: last.background || '',
    summary: last.summary || '',
    briefDescriptionOfDrawings: last.briefDescriptionOfDrawings || '',
    detailedDescription: last.detailedDescription || '',
    bestMethod: last.bestMethod || '',
    claims: last.claims || '',
    abstract: last.abstract || '',
    industrialApplicability: (last as any).industrialApplicability || '',
    listOfNumerals: last.listOfNumerals || '',
    figures: [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>({
      figureNo: f.figureNo,
      caption: f.title || `Figure ${f.figureNo}`,
      imagePathOrBuffer: (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)?.imagePath || ''
    }))
  }

  const guards = preExportGuards(exportInput)
  const plain = buildAnnexurePlainText(exportInput)
  return NextResponse.json({ ok: guards.ok, issues: guards.issues, preview: plain, input: exportInput })
}

// Rich preview payload with figure data (for inline HTML preview)
async function handleGetExportPreview(user: any, patentId: string, data: any) {
  const { sessionId } = data
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 }, figurePlans: true, diagramSources: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })
  const last = session.annexureDrafts?.[0]
  if (!last) return NextResponse.json({ error: 'No draft to export' }, { status: 400 })

  const figures = [...(session.figurePlans||[])].sort((a,b)=>a.figureNo-b.figureNo).map(f=>{
    const ds = (session.diagramSources||[]).find((d:any)=>d.figureNo===f.figureNo)
    const hasImage = !!(ds && (ds.imagePath || ds.imageFilename))
    const url = hasImage ? `/api/patents/${patentId}/drafting?image=figure&sessionId=${session.id}&figureNo=${f.figureNo}` : null
    return {
      figureNo: f.figureNo,
      caption: f.title || `Figure ${f.figureNo}`,
      imageUrl: url
    }
  })
  return NextResponse.json({
    title: last.title || 'Untitled',
    fieldOfInvention: last.fieldOfInvention || '',
    background: last.background || '',
    summary: last.summary || '',
    briefDescriptionOfDrawings: last.briefDescriptionOfDrawings || '',
    detailedDescription: last.detailedDescription || '',
    bestMethod: last.bestMethod || '',
    claims: last.claims || '',
    abstract: last.abstract || '',
    industrialApplicability: (last as any).industrialApplicability || '',
    listOfNumerals: last.listOfNumerals || '',
    figures
  })
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

  // Create new drafting session
  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      status: 'IDEA_ENTRY'
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

async function handleSetStage(user: any, patentId: string, data: any) {
  const { sessionId, stage, manualPriorArt, selectedPatents } = data

  console.log('handleSetStage called with:', { sessionId, stage, patentId, userId: user.id, manualPriorArt: !!manualPriorArt, selectedPatentsCount: selectedPatents?.length || 0 })

  const allowedStages = [
    'IDEA_ENTRY','COMPONENT_PLANNER','FIGURE_PLANNER','RELATED_ART','ANNEXURE_DRAFT','REVIEW_FIX','EXPORT_READY','COMPLETED'
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
  // Try to find most recent session for this patent
  const existing = await prisma.draftingSession.findFirst({
    where: { patentId, userId: user.id },
    orderBy: { createdAt: 'desc' }
  })

  if (existing) {
    return NextResponse.json({ session: existing })
  }

  const session = await prisma.draftingSession.create({
    data: {
      patentId,
      userId: user.id,
      tenantId: user.tenantId,
      status: 'IDEA_ENTRY'
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
  const { sessionId, rawIdea, title, areaOfInvention } = data;

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

  const result = await DraftingService.normalizeIdea(rawIdea, title, user.tenantId, requestHeaders, areaOfInvention);

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
    return NextResponse.json(
      { error: 'Invalid component map', details: validation.errors },
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

  // Create or update figure plan
  const figurePlan = await prisma.figurePlan.upsert({
    where: {
      sessionId_figureNo: {
        sessionId,
        figureNo
      }
    },
    update: {
      title,
      nodes,
      edges,
      description
    },
    create: {
      sessionId,
      figureNo,
      title,
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
      referenceMap: true
    }
  });

  if (!session || !session.figurePlans[0]) {
    return NextResponse.json(
      { error: 'Session or figure plan not found' },
      { status: 404 }
    );
  }

  // Generate PlantUML code
  const result = await DraftingService.generatePlantUML(
    session.figurePlans[0],
    session.referenceMap
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
        .replace(/^(title|caption).*$/gmi, '')
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

async function handleGenerateDiagramsLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, prompt } = data

  if (!sessionId || !prompt) {
    return NextResponse.json({ error: 'Session ID and prompt are required' }, { status: 400 })
  }

  // Verify session
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
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

  // Persist immediately: assign figure numbers and save PlantUML + titles
  try {
    const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
    const occupied = new Set(existingPlans.map(fp => fp.figureNo))
    const saved: Array<{ figureNo: number; title: string }> = []

    let candidate = 1
    const nextNo = () => {
      while (occupied.has(candidate)) candidate++
      const n = candidate
      occupied.add(n)
      candidate++
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

      await prisma.figurePlan.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { title, ...(description ? { description } : {}) },
        create: { sessionId, figureNo, title, ...(description ? { description } : {}), nodes: [], edges: [] }
      })

      await prisma.diagramSource.upsert({
        where: { sessionId_figureNo: { sessionId, figureNo } },
        update: { plantumlCode: code, checksum },
        create: { sessionId, figureNo, plantumlCode: code, checksum }
      })

      saved.push({ figureNo, title })
    }

    return NextResponse.json({ figures, saved })
  } catch (persistErr) {
    console.error('Persist diagrams error:', persistErr)
    // Even if persistence fails, return figures so UI shows codes
    return NextResponse.json({ figures, warning: 'Figures generated but could not be saved.' })
  }
}

async function handleSavePlantUML(user: any, patentId: string, data: any) {
  const { sessionId, figureNo, title, plantumlCode } = data
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

  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { title: title || `Figure ${figureNo}` },
    create: { sessionId, figureNo, title: title || `Figure ${figureNo}`, nodes: [], edges: [] }
  })

  // Generate and save image from PlantUML code
  try {
    // Clean the PlantUML code (remove titles, themes, etc.)
    let cleaned = plantumlCode
      .replace(/^(title|caption).*$/gmi, '')
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
  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true, diagramSources: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const componentsRaw = (session.referenceMap as any)?.components
  const components = Array.isArray(componentsRaw) ? componentsRaw : []
  const numeralsPreview = components.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const title = session.figurePlans?.find((f: any) => f.figureNo === figureNo)?.title || `Figure ${figureNo}`

  const prompt = `You are refining a PlantUML diagram for a patent figure.
Keep the diagram simple and valid. Use only these components/numerals: ${numeralsPreview}.
Existing title: ${title}
User instructions: ${instructions || 'none'}
Output ONLY the PlantUML code (@startuml..@enduml).`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  const code = sanitizePlantUML(match[0])
  const checksum = crypto.createHash('sha256').update(code).digest('hex')

  const diagramSource = await prisma.diagramSource.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo } },
    update: { plantumlCode: code, checksum },
    create: { sessionId, figureNo, plantumlCode: code, checksum }
  })

  return NextResponse.json({ diagramSource })
}

async function handleAddFigureLLM(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, instructions } = data
  if (!sessionId) return NextResponse.json({ error: 'Session ID required' }, { status: 400 })

  const session = await prisma.draftingSession.findFirst({ where: { id: sessionId, patentId, userId: user.id }, include: { referenceMap: true, figurePlans: true } })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const componentsRaw2 = (session.referenceMap as any)?.components
  const components2 = Array.isArray(componentsRaw2) ? componentsRaw2 : []
  const numeralsPreview = components2.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const prompt = `Add one new simple PlantUML figure for a patent.
Use only numerals: ${numeralsPreview}.
User instructions: ${instructions || 'none'}
Return ONLY PlantUML code.`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(prompt.length / 4) })
  if (!result.success || !result.response) return NextResponse.json({ error: result.error?.message || 'LLM failed' }, { status: 400 })

  const text = (result.response.output || '').trim()
  const match = text.match(/@startuml[\s\S]*?@enduml/)
  if (!match) return NextResponse.json({ error: 'No PlantUML code found in LLM response' }, { status: 400 })

  // Assign next figure number
  const existingPlans = await prisma.figurePlan.findMany({ where: { sessionId } })
  const used = new Set(existingPlans.map(fp => fp.figureNo))
  let figureNo = 1
  while (used.has(figureNo)) figureNo++

  const title = `Figure ${figureNo}`
  const code = sanitizePlantUML(match[0])
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

  const componentsRaw3 = (session.referenceMap as any)?.components
  const components3 = Array.isArray(componentsRaw3) ? componentsRaw3 : []
  const numeralsPreview = components3.map((c: any) => `${c.name} (${c.numeral || '?'})`).join(', ')
  const existingNames = session.figurePlans?.map((f: any) => `Fig.${f.figureNo}: ${f.title}`).join('; ')
  const inventionTitle = session.ideaRecord?.title || ''

  const aggregatePrompt = `You are adding ${instructionsList.length} new simple PlantUML figures to a patent.
Invention: ${inventionTitle}
Use only components/numerals: ${numeralsPreview}
Existing figures: ${existingNames || 'none'}
For each item below, return ONLY PlantUML (@startuml..@enduml), one block per item, in the same order.
Items:\n- ${instructionsList.join('\n- ')}`

  const request = { headers: requestHeaders || {} }
  const result = await llmGateway.executeLLMOperation(request, { taskCode: 'LLM3_DIAGRAM', prompt: aggregatePrompt, idempotencyKey: crypto.randomUUID(), inputTokens: Math.ceil(aggregatePrompt.length / 4) })
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
  let figureNo = 1
  const nextNo = () => { while (used.has(figureNo)) figureNo++; used.add(figureNo); return figureNo++ }

  const created: any[] = []
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i]
    const no = nextNo()
    const title = `Figure ${no}`
    const checksum = crypto.createHash('sha256').update(code).digest('hex')
    await prisma.figurePlan.upsert({ where: { sessionId_figureNo: { sessionId, figureNo: no } }, update: { title }, create: { sessionId, figureNo: no, title, nodes: [], edges: [] } })
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

  await prisma.figurePlan.upsert({
    where: { sessionId_figureNo: { sessionId, figureNo: no } },
    update: { title: title || `Figure ${no}`, description },
    create: { sessionId, figureNo: no, title: title || `Figure ${no}`, description, nodes: [], edges: [] }
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
  const { sessionId, jurisdiction = 'IN', filingType = 'utility' } = data;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID is required' },
      { status: 400 }
    );
  }

  // Verify session ownership and get all required data
  const session = await prisma.draftingSession.findFirst({
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

  if (!session) {
    return NextResponse.json(
      { error: 'Session not found or access denied' },
      { status: 404 }
    );
  }

  // Generate draft
  const result = await DraftingService.generateAnnexureDraft(
    session,
    jurisdiction,
    filingType,
    user.tenantId,
    requestHeaders
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 }
    );
  }

  // Create new draft version
  const version = (session.annexureDrafts[0]?.version || 0) + 1;
  const draft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version,
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
      validationReport: result.validationReport || {},
      llmPromptUsed: result.llmPrompt || '',
      llmResponse: result.llmResponse || {},
      tokensUsed: result.tokensUsed || 0
    }
  });

  // Update session status
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { status: 'REVIEW_FIX' }
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
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 } }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const last = session.annexureDrafts?.[0]
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
        title: merge.title || 'Untitled',
        fullDraftText: '',
        isValid: false
      }
    })
  }

  return NextResponse.json({ draft })
}

// New: Generate specific annexure sections without persisting (e.g., ["title","abstract"]) with backend debug steps
async function handleGenerateSections(user: any, patentId: string, data: any, requestHeaders: Record<string, string>) {
  const { sessionId, sections, instructions, selectedPatents } = data

  if (!sessionId || !Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: 'sessionId and sections[] are required' }, { status: 400 })
  }

  const session = await prisma.draftingSession.findFirst({
    where: { id: sessionId, patentId, userId: user.id },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      annexureDrafts: { orderBy: { version: 'desc' }, take: 1 },
      // Needed for prior-art selection logic in DraftingService
      relatedArtSelections: true
    }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  // Merge user-provided instructions with PersonaSync style instructions if enabled and available
  const usePersonaStyle = (data && typeof data.usePersonaStyle === 'boolean') ? Boolean(data.usePersonaStyle) : true
  let mergedInstructions: Record<string, string> = { ...(instructions || {}) }
  if (usePersonaStyle) {
    try {
      const styleInstr = await getGatedStyleInstructions(user.tenantId, user.id)
      if (styleInstr) {
        for (const [k, v] of Object.entries(styleInstr)) {
          if (!v) continue
          mergedInstructions[k] = mergedInstructions[k] ? `${mergedInstructions[k]} ; ${v}` : v
        }
        if (process.env.PERSONA_SYNC_DEBUG === '1') {
          console.log('[Drafting][StyleInstr.merge]', Object.keys(styleInstr))
        }
      }
    } catch (e) {
      if (process.env.PERSONA_SYNC_DEBUG === '1') {
        console.warn('[Drafting][StyleInstr.skip]', e instanceof Error ? e.message : String(e))
      }
    }
  } else {
    if (process.env.PERSONA_SYNC_DEBUG === '1') {
      console.log('[Drafting][StyleInstr.disabled_by_user]')
    }
  }

  const result = await DraftingService.generateSections(session, sections, mergedInstructions, user.tenantId, requestHeaders, selectedPatents)
  if (!result.success) return NextResponse.json({ error: result.error, debugSteps: result.debugSteps }, { status: 400 })

  // Autosave generated sections into latest draft without bumping version
  try {
    const last = session.annexureDrafts?.[0]
    if (last && result.generated) {
      const updateData: any = {}
      // Only update fields that exist in the database schema
      const validFields = ['title', 'fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod', 'claims', 'abstract', 'industrialApplicability', 'listOfNumerals']

      for (const [k, v] of Object.entries(result.generated)) {
        if (validFields.includes(k) && typeof v === 'string' && v.trim()) {
          updateData[k] = v.trim()
        }
      }
      console.log('Autosave updateData keys:', Object.keys(updateData))
      console.log('Last draft ID:', last.id)
      console.log('Last draft exists:', !!last)
      if (Object.keys(updateData).length > 0) {
        await prisma.annexureDraft.update({ where: { id: last.id }, data: updateData })
      }
    } else if (result.generated) {
      // Create initial draft if none present
      const createData: any = { sessionId, version: 1, fullDraftText: '' }

      // Set title
      createData.title = result.generated.title || session.ideaRecord?.title || 'Untitled'

      // Only set fields that exist in the database schema
      const validFields = ['fieldOfInvention', 'background', 'summary', 'briefDescriptionOfDrawings', 'detailedDescription', 'bestMethod', 'claims', 'abstract', 'industrialApplicability', 'listOfNumerals']

      for (const field of validFields) {
        if (result.generated[field] && typeof result.generated[field] === 'string') {
          createData[field] = (result.generated[field] as string).trim()
        }
      }

      console.log('Creating new draft with keys:', Object.keys(createData))
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
    include: { annexureDrafts: { orderBy: { version: 'desc' }, take: 1 }, referenceMap: true, figurePlans: true }
  })
  if (!session) return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 })

  const last = session.annexureDrafts?.[0]
  const nextVersion = (last?.version || 0) + 1

  // Merge patch into latest (or start new)
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
    ...patch
  }

  // Assemble full text for validation
  const fullDraftText = [
    merged.fieldOfInvention ? `FIELD OF INVENTION\n\n${merged.fieldOfInvention}` : '',
    merged.background ? `BACKGROUND\n\n${merged.background}` : '',
    merged.summary ? `SUMMARY\n\n${merged.summary}` : '',
    merged.briefDescriptionOfDrawings ? `BRIEF DESCRIPTION OF DRAWINGS\n\n${merged.briefDescriptionOfDrawings}` : '',
    merged.detailedDescription ? `DETAILED DESCRIPTION\n\n${merged.detailedDescription}` : '',
    merged.bestMethod ? `BEST METHOD\n\n${merged.bestMethod}` : '',
    merged.claims ? `CLAIMS\n\n${merged.claims}` : '',
    merged.abstract ? `ABSTRACT\n\n${merged.abstract}` : '',
    merged.industrialApplicability ? `INDUSTRIAL APPLICABILITY\n\n${merged.industrialApplicability}` : '',
    merged.listOfNumerals ? `LIST OF REFERENCE NUMERALS\n\n${merged.listOfNumerals}` : ''
  ].filter(Boolean).join('\n\n')

  // Lightweight consistency validation using service
  const validation = DraftingService.validateDraftConsistencyPublic({ fullText: fullDraftText }, session as any)

  const draft = await prisma.annexureDraft.create({
    data: {
      sessionId,
      version: nextVersion,
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
      fullDraftText,
      isValid: !!validation.valid,
      validationReport: validation.report
    }
  })

  // Ensure session is at ANNEXURE_DRAFT stage
  if (session.status !== 'ANNEXURE_DRAFT') {
    await prisma.draftingSession.update({ where: { id: sessionId }, data: { status: 'ANNEXURE_DRAFT' } })
  }

  return NextResponse.json({ draft, validationReport: validation.report })
}

