/**
 * Serve Reference Document PDF
 * GET /api/library/[referenceId]/document/serve - Stream PDF file to client
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(
    request: NextRequest,
    { params }: { params: { referenceId: string } }
) {
    try {
        const { user, error } = await authenticateUser(request);
        if (error || !user) {
            return NextResponse.json(
                { error: error?.message || 'Unauthorized' },
                { status: error?.status || 401 }
            );
        }

        if (!params.referenceId || params.referenceId.trim() === '') {
            return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
        }

        // Get the document link
        const link = await referenceDocumentService.getDocumentByReference(
            user.id,
            params.referenceId
        );

        if (!link || !link.document) {
            return NextResponse.json({ error: 'No document attached' }, { status: 404 });
        }

        // Get the file path (verifies ownership)
        const filePath = await referenceDocumentService.getDocumentFilePath(
            user.id,
            link.document.id
        );

        if (!filePath) {
            return NextResponse.json({ error: 'Document file not found on server' }, { status: 404 });
        }

        // Read file and stream as response
        const fileBuffer = fs.readFileSync(filePath);
        const filename = (link.document as any).originalFilename || 'document.pdf';

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
                'Content-Length': String(fileBuffer.length),
                'Cache-Control': 'private, max-age=3600',
            },
        });
    } catch (err) {
        console.error('Document serve error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to serve document' },
            { status: 500 }
        );
    }
}
