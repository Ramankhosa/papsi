import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import mammoth from 'mammoth';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { paperArchetypeService } from '@/lib/services/paper-archetype-service';

export const runtime = 'nodejs';

// Maximum character limit for uploaded content
const MAX_CONTENT_LENGTH = 50000; // ~50K characters
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: { researchTopic: true, paperType: true }
  });
}

function parseJsonOutput(output: string): any | null {
  let jsonText = (output || '').trim();
  if (!jsonText) return null;

  const fenceStart = jsonText.indexOf('```');
  if (fenceStart !== -1) {
    jsonText = jsonText.slice(fenceStart + 3);
    jsonText = jsonText.replace(/^json\s*/i, '');
    const fenceEnd = jsonText.indexOf('```');
    if (fenceEnd !== -1) {
      jsonText = jsonText.slice(0, fenceEnd);
    }
  }

  const startBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
    jsonText = jsonText.slice(startBrace, lastBrace + 1);
  }

  jsonText = jsonText
    .replace(/`+/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(quotedKeys);
    } catch {
      return null;
    }
  }
}

function buildExtractionPrompt(content: string, paperTypeCode?: string): string {
  return `You are an expert academic research analyst. Your task is to analyze the provided document and extract all relevant information to populate a research paper setup form.

DOCUMENT CONTENT:
---
${content.slice(0, 40000)}
${content.length > 40000 ? '\n[... content truncated ...]' : ''}
---

PAPER TYPE: ${paperTypeCode || 'academic research paper'}

TASK: Carefully read the document and extract information for each of the following fields. If a field's information is not explicitly stated but can be reasonably inferred, provide your best inference. If information cannot be determined, set to null.

EXTRACTION FIELDS:
1. title: The paper/research title (max 200 chars)
2. field: The broad academic field (e.g., Computer Science, Medicine, Psychology, Engineering)
3. subfield: The specific subfield or specialization
4. topicDescription: A brief description of what the research is about (2-3 sentences)
5. researchQuestion: The main research question being investigated (should be a question)
6. subQuestions: Array of sub-questions supporting the main research question
7. problemStatement: The problem or gap the research addresses
8. researchGaps: Gaps in existing research that this work aims to fill
9. methodology: One of: QUALITATIVE, QUANTITATIVE, MIXED_METHODS, THEORETICAL, CASE_STUDY, ACTION_RESEARCH, EXPERIMENTAL, SURVEY, OTHER
10. methodologyApproach: Description of the research approach/methodology
11. techniques: Array of specific techniques or methods used
12. datasetDescription: Description of data/datasets used
13. dataCollection: How data was/will be collected
14. sampleSize: Sample size if applicable
15. tools: Array of tools, software, or equipment used
16. experiments: Description of experiments planned or conducted
17. hypothesis: The research hypothesis or expected outcome
18. expectedResults: What results are expected
19. contributionType: One of: THEORETICAL, EMPIRICAL, METHODOLOGICAL, APPLIED, REVIEW, CONCEPTUAL
20. novelty: What makes this research novel or unique
21. limitations: Known limitations of the research
22. keywords: Array of 5-10 relevant academic keywords

OUTPUT FORMAT: Return ONLY valid JSON with the following structure (no markdown fences or explanations):
{
  "title": "string or null",
  "field": "string or null",
  "subfield": "string or null", 
  "topicDescription": "string or null",
  "researchQuestion": "string or null",
  "subQuestions": ["string"] or [],
  "problemStatement": "string or null",
  "researchGaps": "string or null",
  "methodology": "QUALITATIVE|QUANTITATIVE|MIXED_METHODS|THEORETICAL|CASE_STUDY|ACTION_RESEARCH|EXPERIMENTAL|SURVEY|OTHER",
  "methodologyApproach": "string or null",
  "techniques": ["string"] or [],
  "datasetDescription": "string or null",
  "dataCollection": "string or null",
  "sampleSize": "string or null",
  "tools": ["string"] or [],
  "experiments": "string or null",
  "hypothesis": "string or null",
  "expectedResults": "string or null",
  "contributionType": "THEORETICAL|EMPIRICAL|METHODOLOGICAL|APPLIED|REVIEW|CONCEPTUAL",
  "novelty": "string or null",
  "limitations": "string or null",
  "keywords": ["string"] or [],
  "confidence": 0.0 to 1.0,
  "extractionNotes": "Brief notes about the extraction quality or missing information"
}

RULES:
- Extract only information that is present or can be reasonably inferred from the document
- Do not invent or hallucinate information
- Use academic/formal language
- For methodology and contributionType, choose the best matching enum value
- For arrays, include all relevant items found
- Set confidence between 0-1 based on how much information was extractable
- Include helpful notes about what couldn't be extracted or needs user verification`;
}

function buildTopicOverrideFromExtracted(extracted: Record<string, any>) {
  return {
    title: typeof extracted.title === 'string' ? extracted.title : null,
    field: typeof extracted.field === 'string' ? extracted.field : null,
    subfield: typeof extracted.subfield === 'string' ? extracted.subfield : null,
    topicDescription: typeof extracted.topicDescription === 'string' ? extracted.topicDescription : null,
    researchQuestion: typeof extracted.researchQuestion === 'string' ? extracted.researchQuestion : null,
    subQuestions: Array.isArray(extracted.subQuestions) ? extracted.subQuestions : [],
    problemStatement: typeof extracted.problemStatement === 'string' ? extracted.problemStatement : null,
    researchGaps: typeof extracted.researchGaps === 'string' ? extracted.researchGaps : null,
    methodology: typeof extracted.methodology === 'string' ? extracted.methodology : null,
    methodologyApproach: typeof extracted.methodologyApproach === 'string' ? extracted.methodologyApproach : null,
    techniques: Array.isArray(extracted.techniques) ? extracted.techniques : [],
    datasetDescription: typeof extracted.datasetDescription === 'string' ? extracted.datasetDescription : null,
    dataCollection: typeof extracted.dataCollection === 'string' ? extracted.dataCollection : null,
    sampleSize: typeof extracted.sampleSize === 'string' ? extracted.sampleSize : null,
    tools: Array.isArray(extracted.tools) ? extracted.tools : [],
    experiments: typeof extracted.experiments === 'string' ? extracted.experiments : null,
    hypothesis: typeof extracted.hypothesis === 'string' ? extracted.hypothesis : null,
    expectedResults: typeof extracted.expectedResults === 'string' ? extracted.expectedResults : null,
    contributionType: typeof extracted.contributionType === 'string' ? extracted.contributionType : null,
    novelty: typeof extracted.novelty === 'string' ? extracted.novelty : null,
    limitations: typeof extracted.limitations === 'string' ? extracted.limitations : null,
    keywords: Array.isArray(extracted.keywords) ? extracted.keywords : [],
    abstractDraft: typeof extracted.abstractDraft === 'string' ? extracted.abstractDraft : null
  };
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Handle both FormData (file upload) and JSON (pasted text)
    const contentType = request.headers.get('content-type') || '';
    let textContent = '';
    let fileName = '';

    if (contentType.includes('multipart/form-data')) {
      // File upload
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
      }

      fileName = file.name.toLowerCase();
      const fileType = file.type;
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Extract text based on file type
      if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
        // Word document - use mammoth
        try {
          const result = await mammoth.extractRawText({ buffer });
          textContent = result.value;
        } catch (err) {
          console.error('[TopicExtract] DOCX parsing error:', err);
          return NextResponse.json({ error: 'Failed to parse Word document' }, { status: 400 });
        }
      } else if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
        textContent = buffer.toString('utf-8');
      } else if (fileType === 'text/markdown' || fileName.endsWith('.md')) {
        textContent = buffer.toString('utf-8');
      } else {
        return NextResponse.json({ 
          error: 'Unsupported file format. Please upload .txt, .docx, or .md files.' 
        }, { status: 400 });
      }
    } else {
      // JSON body with pasted text
      const body = await request.json();
      textContent = body.content || '';
      fileName = 'pasted_text.txt';
    }

    // Validate content
    if (!textContent || textContent.trim().length < 50) {
      return NextResponse.json({ 
        error: 'Document content is too short. Please provide more content (at least 50 characters).' 
      }, { status: 400 });
    }

    if (textContent.length > MAX_CONTENT_LENGTH) {
      textContent = textContent.slice(0, MAX_CONTENT_LENGTH);
      console.log(`[TopicExtract] Content truncated from ${textContent.length} to ${MAX_CONTENT_LENGTH} chars`);
    }

    // Build extraction prompt
    const prompt = buildExtractionPrompt(textContent, session.paperType?.code || undefined);
    const headers = Object.fromEntries(request.headers.entries());

    // Call LLM for extraction
    const llmRequest = {
      taskCode: 'LLM2_DRAFT' as const,
      stageCode: 'PAPER_TOPIC_EXTRACT_FROM_FILE',
      prompt,
      parameters: { temperature: 0.2 }, // Lower temperature for more consistent extraction
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId,
        paperId: sessionId,
        action: 'extract_from_file',
        fileName,
        contentLength: textContent.length,
        module: 'publication_ideation'
      }
    };

    console.log(`[TopicExtract] Processing file: ${fileName}, content length: ${textContent.length}`);
    
    const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);
    
    if (!result.success || !result.response) {
      console.error('[TopicExtract] LLM error:', result.error);
      return NextResponse.json({ 
        error: result.error?.message || 'AI extraction failed. Please try again.' 
      }, { status: 500 });
    }

    const parsed = parseJsonOutput(result.response.output || '');
    if (!parsed || typeof parsed !== 'object') {
      console.error('[TopicExtract] Failed to parse LLM response');
      return NextResponse.json({ 
        error: 'Failed to parse extraction results. Please try again.' 
      }, { status: 500 });
    }

    // Log extraction stats
    console.log(`[TopicExtract] Extraction complete. Confidence: ${parsed.confidence}, Fields extracted: ${
      Object.entries(parsed).filter(([k, v]) => v !== null && k !== 'confidence' && k !== 'extractionNotes').length
    }`);

    // Store raw content for reference (optional - could save to session metadata)
    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'RESEARCH_TOPIC_FILE_EXTRACTED',
        userId: user.id,
        stage: session.status,
        newData: {
          fileName,
          contentLength: textContent.length,
          confidence: parsed.confidence,
          extractedFields: Object.keys(parsed).filter(k => parsed[k] !== null && k !== 'confidence' && k !== 'extractionNotes')
        }
      }
    });

    let archetypeDetection: Awaited<ReturnType<typeof paperArchetypeService.detectAndPersist>> | null = null;
    try {
      archetypeDetection = await paperArchetypeService.detectAndPersist({
        sessionId,
        headers,
        userId: user.id,
        source: 'TOPIC_EXTRACT',
        topicOverride: buildTopicOverrideFromExtracted(parsed),
        preferPersistedTopic: true,
        helperNotes: typeof parsed.extractionNotes === 'string'
          ? { extractionNotes: parsed.extractionNotes }
          : null
      });
    } catch (detectError) {
      console.error('[TopicExtract] Archetype detection failed:', detectError);
    }

    return NextResponse.json({
      success: true,
      extracted: parsed,
      archetypeDetection,
      metadata: {
        fileName,
        contentLength: textContent.length,
        tokensUsed: result.response.outputTokens || 0
      }
    });

  } catch (error) {
    console.error('[TopicExtract] error:', error);
    return NextResponse.json({ 
      error: 'Failed to process document. Please check the file format and try again.' 
    }, { status: 500 });
  }
}

