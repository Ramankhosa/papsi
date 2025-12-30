/**
 * DOI Import API
 * POST /api/library/import-doi - Import reference by DOI
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

const importSchema = z.object({
  doi: z.string().min(1),
  collectionId: z.string().optional(), // Auto-add imported reference to this collection
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const data = importSchema.parse(body);

    const reference = await referenceLibraryService.importFromDOI(user.id, data.doi);
    
    // If a collectionId is provided, add the reference to that collection
    if (data.collectionId && reference) {
      try {
        await referenceLibraryService.addToCollection(user.id, data.collectionId, [reference.id]);
      } catch (collectionErr) {
        console.error('Failed to add imported reference to collection:', collectionErr);
        // Don't fail the import, just log the error
      }
    }
    
    return NextResponse.json({ reference }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid DOI format' }, { status: 400 });
    }
    console.error('DOI import error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import from DOI' },
      { status: 500 }
    );
  }
}

