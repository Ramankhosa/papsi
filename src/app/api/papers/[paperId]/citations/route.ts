import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';

export const runtime = 'nodejs';

const manualCitationSchema = z.object({
  sourceType: z.enum([
    'JOURNAL_ARTICLE',
    'CONFERENCE_PAPER',
    'BOOK',
    'BOOK_CHAPTER',
    'THESIS',
    'WORKING_PAPER',
    'REPORT',
    'WEBSITE',
    'PATENT',
    'OTHER'
  ]),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const createCitationSchema = z.object({
  citation: manualCitationSchema.optional(),
  searchResult: z.any().optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      citationStyle: true
    }
  });
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    citationKey: citation.citationKey
  };
}

function getDefaultStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
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

    const citations = await citationService.getCitationsForSession(sessionId);
    const styleCode = getDefaultStyleCode(session);

    const formatted = await Promise.all(citations.map(async citation => {
      const data = toCitationData(citation);
      let inText = '';
      let bibliography = '';

      try {
        inText = await citationStyleService.formatInTextCitation(data, styleCode);
        bibliography = await citationStyleService.formatBibliographyEntry(data, styleCode);
      } catch (formatError) {
        console.warn('[Citations] Format preview failed:', formatError);
      }

      return {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      };
    }));

    return NextResponse.json({
      citations: formatted,
      citationStyle: styleCode
    });
  } catch (error) {
    console.error('[Citations] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch citations' }, { status: 500 });
  }
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

    const body = await request.json();
    const data = createCitationSchema.parse(body);

    let citation;
    if (data.searchResult) {
      citation = await citationService.importFromSearchResult(sessionId, data.searchResult);
    } else if (data.citation) {
      citation = await citationService.addManualCitation(sessionId, data.citation);
    } else {
      return NextResponse.json({ error: 'Citation payload is required' }, { status: 400 });
    }

    const styleCode = getDefaultStyleCode(session);
    const citationData = toCitationData(citation);
    let inText = '';
    let bibliography = '';

    try {
      inText = await citationStyleService.formatInTextCitation(citationData, styleCode);
      bibliography = await citationStyleService.formatBibliographyEntry(citationData, styleCode);
    } catch (formatError) {
      console.warn('[Citations] Format preview failed:', formatError);
    }

    return NextResponse.json({
      citation: {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      }
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to add citation';
    const status = message.toLowerCase().includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
