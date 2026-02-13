/**
 * API Route: Panel Citations
 * Fetches paper session citations and user's reference library for the floating panel
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT, type JWTPayload } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ============================================================================
// Types
// ============================================================================

interface CitationItem {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationKey: string;
  source: 'paper' | 'library';
  sourceType: string;
}

// ============================================================================
// GET - Fetch citations for the panel
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const token = authHeader.slice(7);
    const decoded = await verifyJWT(token) as JWTPayload | null;
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    
    const { paperId: sessionId } = await params;
    const userId = decoded.sub;

    // Get search query if provided
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get('q') || '';
    const sourceFilter = url.searchParams.get('source') || 'all'; // 'all', 'paper', 'library'
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    // Build search condition
    const searchCondition = searchQuery
      ? {
          OR: [
            { title: { contains: searchQuery, mode: 'insensitive' as const } },
            { venue: { contains: searchQuery, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const results: CitationItem[] = [];

    // Fetch paper citations (from session)
    if (sourceFilter === 'all' || sourceFilter === 'paper') {
      const paperCitations = await prisma.citation.findMany({
        where: {
          sessionId,
          isActive: true,
          ...searchCondition,
        },
        orderBy: { createdAt: 'desc' },
        take: sourceFilter === 'paper' ? limit : Math.floor(limit / 2),
      });

      for (const c of paperCitations) {
        results.push({
          id: c.id,
          title: c.title,
          authors: c.authors.join(', '),
          year: c.year,
          venue: c.venue,
          doi: c.doi,
          citationKey: c.citationKey,
          source: 'paper',
          sourceType: c.sourceType,
        });
      }
    }

    // Fetch user's reference library
    if (sourceFilter === 'all' || sourceFilter === 'library') {
      const libraryRefs = await prisma.referenceLibrary.findMany({
        where: {
          userId,
          isActive: true,
          ...searchCondition,
        },
        orderBy: [
          { isFavorite: 'desc' },
          { createdAt: 'desc' },
        ],
        take: sourceFilter === 'library' ? limit : Math.floor(limit / 2),
      });

      for (const r of libraryRefs) {
        // Skip if this reference is already in paper citations (by DOI or title)
        const alreadyInPaper = results.some(
          (c) => 
            (c.doi && r.doi && c.doi === r.doi) ||
            c.title.toLowerCase() === r.title.toLowerCase()
        );
        
        if (!alreadyInPaper) {
          results.push({
            id: r.id,
            title: r.title,
            authors: r.authors.join(', '),
            year: r.year,
            venue: r.venue,
            doi: r.doi,
            citationKey: r.citationKey || `${r.authors[0]?.split(' ').pop() || 'Unknown'}${r.year || ''}`,
            source: 'library',
            sourceType: r.sourceType,
          });
        }
      }
    }

    // Get total counts
    const [paperCount, libraryCount] = await Promise.all([
      prisma.citation.count({ where: { sessionId, isActive: true } }),
      prisma.referenceLibrary.count({ where: { userId, isActive: true } }),
    ]);

    return NextResponse.json({
      citations: results.slice(0, limit),
      counts: {
        paper: paperCount,
        library: libraryCount,
        total: paperCount + libraryCount,
      },
    });
  } catch (error) {
    console.error('Failed to fetch panel citations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch citations' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Import citation from library to paper
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const token = authHeader.slice(7);
    const decoded = await verifyJWT(token) as JWTPayload | null;
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    
    const { paperId: sessionId } = await params;
    const userId = decoded.sub;

    const body = await request.json();
    const { referenceId } = body;

    if (!referenceId) {
      return NextResponse.json({ error: 'Reference ID required' }, { status: 400 });
    }

    // Fetch the reference from library
    const reference = await prisma.referenceLibrary.findUnique({
      where: { id: referenceId },
    });

    if (!reference || reference.userId !== userId) {
      return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    }

    // Check if already imported (by DOI or title)
    const existing = await prisma.citation.findFirst({
      where: {
        sessionId,
        OR: [
          ...(reference.doi ? [{ doi: reference.doi }] : []),
          { title: reference.title },
        ],
      },
    });

    if (existing) {
      return NextResponse.json({
        citation: {
          id: existing.id,
          title: existing.title,
          authors: existing.authors.join(', '),
          year: existing.year,
          venue: existing.venue,
          doi: existing.doi,
          citationKey: existing.citationKey,
          source: 'paper',
          sourceType: existing.sourceType,
        },
        imported: false,
        message: 'Citation already exists in paper',
      });
    }

    // Generate unique citation key
    const authorLastName = reference.authors[0]?.split(' ').pop() || 'Unknown';
    let baseCitationKey = `${authorLastName}${reference.year || ''}`;
    let citationKey = baseCitationKey;
    let suffix = 'a';
    
    while (await prisma.citation.findFirst({ where: { sessionId, citationKey } })) {
      citationKey = `${baseCitationKey}${suffix}`;
      suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
    }

    // Create citation from reference
    const newCitation = await prisma.citation.create({
      data: {
        sessionId,
        sourceType: reference.sourceType,
        title: reference.title,
        authors: reference.authors,
        year: reference.year,
        venue: reference.venue,
        volume: reference.volume,
        issue: reference.issue,
        pages: reference.pages,
        doi: reference.doi,
        url: reference.url,
        isbn: reference.isbn,
        publisher: reference.publisher,
        edition: reference.edition,
        editors: reference.editors,
        publicationPlace: reference.publicationPlace,
        publicationDate: reference.publicationDate,
        accessedDate: reference.accessedDate,
        articleNumber: reference.articleNumber,
        issn: reference.issn,
        journalAbbreviation: reference.journalAbbreviation,
        pmid: reference.pmid,
        pmcid: reference.pmcid,
        arxivId: reference.arxivId,
        abstract: reference.abstract,
        citationKey,
        bibtex: reference.bibtex,
        importSource: 'MANUAL',
        notes: reference.notes,
        tags: reference.tags,
        isActive: true,
      },
    });

    return NextResponse.json({
      citation: {
        id: newCitation.id,
        title: newCitation.title,
        authors: newCitation.authors.join(', '),
        year: newCitation.year,
        venue: newCitation.venue,
        doi: newCitation.doi,
        citationKey: newCitation.citationKey,
        source: 'paper' as const,
        sourceType: newCitation.sourceType,
      },
      imported: true,
      message: 'Citation imported successfully',
    });
  } catch (error) {
    console.error('Failed to import citation:', error);
    return NextResponse.json(
      { error: 'Failed to import citation' },
      { status: 500 }
    );
  }
}

