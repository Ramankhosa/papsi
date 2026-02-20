/**
 * PDF Import API
 * POST /api/library/import-pdf - Import reference by uploading a PDF
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import { pdfParserService } from '@/lib/services/pdf-parser-service';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_REFERENCE_PDF_SIZE_MB || '50', 10);
const MAX_FILES_PER_REQUEST = parseInt(process.env.MAX_REFERENCE_IMPORT_FILES || '30', 10);

function normalizeDoi(value?: string | null): string | undefined {
  if (!value) return undefined;

  const match = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .match(/10\.\d{4,9}\/\S+/i);

  if (!match) return undefined;

  const cleaned = match[0]
    .replace(/[)\],;]+$/, '')
    .replace(/\.+$/, '');

  return cleaned || undefined;
}

function parseAuthors(authors?: string): string[] {
  if (!authors) return [];

  // Support common separators from PDF metadata.
  return authors
    .split(/;|,|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function extractDoiFromRawPdf(buffer: Buffer): string | undefined {
  // Inspect only a bounded prefix to avoid expensive scans on large PDFs.
  const rawText = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('latin1');
  const patterns = [
    /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)/i,
    /doi[:\s]+(10\.\d{4,9}\/\S+)/i,
    /(10\.\d{4,9}\/\S{3,})/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    const normalized = normalizeDoi(match?.[1]);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

async function extractMetadataFromBuffer(buffer: Buffer): Promise<Awaited<ReturnType<typeof pdfParserService.extractMetadataOnly>>> {
  const tempDir = path.resolve(process.cwd(), 'uploads', 'tmp', 'reference-import');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${crypto.randomUUID().replace(/-/g, '')}.pdf`);

  fs.writeFileSync(tempPath, buffer);
  try {
    return await pdfParserService.extractMetadataOnly(tempPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors for temp files.
    }
  }
}

interface ImportPdfResult {
  fileName: string;
  success: boolean;
  referenceId?: string;
  referenceTitle?: string;
  doi?: string | null;
  doiEnriched?: boolean;
  pdfAttached?: boolean;
  pdfAlreadyExistsForReference?: boolean;
  pdfStatus?: string | null;
  error?: string;
}

async function importSinglePdf(
  userId: string,
  file: File,
  collectionIdValue?: string
): Promise<ImportPdfResult> {
  if (file.type !== 'application/pdf') {
    return {
      fileName: file.name,
      success: false,
      error: 'Only PDF files are accepted',
    };
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return {
      fileName: file.name,
      success: false,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const existingDocument = await prisma.referenceDocument.findUnique({
    where: { fileHash },
    select: {
      id: true,
      pdfTitle: true,
      pdfAuthors: true,
      pdfDoi: true,
      pdfCreationDate: true,
      status: true,
    },
  });

  const existingLinkedReference = existingDocument?.id
    ? await prisma.referenceDocumentLink.findFirst({
      where: {
        documentId: existingDocument.id,
        isPrimary: true,
        reference: {
          userId,
          isActive: true,
        },
      },
      include: {
        reference: true,
      },
    })
    : null;

  if (existingLinkedReference) {
    if (collectionIdValue) {
      try {
        await referenceLibraryService.addToCollection(userId, collectionIdValue, [existingLinkedReference.reference.id]);
      } catch (collectionErr) {
        console.error('Failed to add existing PDF-linked reference to collection:', collectionErr);
      }
    }

    return {
      fileName: file.name,
      success: true,
      referenceId: existingLinkedReference.reference.id,
      referenceTitle: existingLinkedReference.reference.title,
      doi: normalizeDoi(existingLinkedReference.reference.doi) || normalizeDoi(existingDocument?.pdfDoi) || null,
      doiEnriched: Boolean(existingLinkedReference.reference.doi),
      pdfAttached: false,
      pdfAlreadyExistsForReference: true,
      pdfStatus: existingDocument?.status,
    };
  }

  const extractedMetadata = await extractMetadataFromBuffer(buffer);
  const mergedMetadata = {
    title: extractedMetadata?.title || existingDocument?.pdfTitle || undefined,
    authors: extractedMetadata?.authors || existingDocument?.pdfAuthors || undefined,
    creationDate: extractedMetadata?.creationDate || existingDocument?.pdfCreationDate || undefined,
    doi:
      normalizeDoi(extractedMetadata?.doi) ||
      normalizeDoi(existingDocument?.pdfDoi) ||
      extractDoiFromRawPdf(buffer) ||
      undefined,
  };
  const extractedDoi = mergedMetadata.doi;

  let reference: any = null;
  let doiEnriched = false;

  if (extractedDoi) {
    try {
      reference = await referenceLibraryService.importFromDOI(userId, extractedDoi);
      doiEnriched = true;
    } catch (doiErr) {
      const msg = doiErr instanceof Error ? doiErr.message : '';
      if (msg.includes('already exists')) {
        reference = await prisma.referenceLibrary.findFirst({
          where: {
            userId,
            isActive: true,
            doi: { equals: extractedDoi, mode: 'insensitive' },
          },
        });
        if (reference) {
          doiEnriched = true;
        }
      } else if (msg) {
        console.warn(`[PDF Import] DOI lookup failed for ${extractedDoi}: ${msg}`);
      }
    }
  }

  if (!reference) {
    const fallbackTitle = mergedMetadata.title?.trim() || file.name.replace(/\.pdf$/i, '').trim() || 'Untitled PDF';
    reference = await referenceLibraryService.createReference({
      userId,
      title: fallbackTitle,
      authors: parseAuthors(mergedMetadata.authors),
      year: mergedMetadata.creationDate ? mergedMetadata.creationDate.getFullYear() : undefined,
      doi: extractedDoi || undefined,
      sourceType: extractedDoi ? 'JOURNAL_ARTICLE' : 'OTHER',
      importSource: extractedDoi ? 'DOI_LOOKUP' : 'MANUAL',
      notes: extractedDoi ? 'Created from uploaded PDF using extracted DOI.' : 'Created from uploaded PDF metadata.',
    });
  }

  if (collectionIdValue && reference?.id) {
    try {
      await referenceLibraryService.addToCollection(userId, collectionIdValue, [reference.id]);
    } catch (collectionErr) {
      console.error('Failed to add PDF-imported reference to collection:', collectionErr);
    }
  }

  const attachResult = await referenceDocumentService.uploadDocument(
    userId,
    reference.id,
    buffer,
    file.name
  );

  if (!attachResult.success && attachResult.error !== 'Reference already has a PDF attached. Use replace to update it.') {
    return {
      fileName: file.name,
      success: false,
      referenceId: reference.id,
      referenceTitle: reference.title,
      error: attachResult.error || 'Failed to attach PDF to reference',
    };
  }

  const alreadyHadPdf = attachResult.error === 'Reference already has a PDF attached. Use replace to update it.';

  return {
    fileName: file.name,
    success: true,
    referenceId: reference.id,
    referenceTitle: reference.title,
    doi: extractedDoi || null,
    doiEnriched,
    pdfAttached: attachResult.success,
    pdfAlreadyExistsForReference: alreadyHadPdf,
    pdfStatus: attachResult.document?.status || null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const formData = await request.formData();
    const filesFromField = formData.getAll('files');
    const singleFile = formData.get('file');
    const files = (filesFromField.length > 0 ? filesFromField : [singleFile]).filter(
      (entry): entry is File => entry instanceof File
    );
    const collectionId = formData.get('collectionId');
    const collectionIdValue = typeof collectionId === 'string' && collectionId.trim().length > 0
      ? collectionId.trim()
      : undefined;

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} files per upload.` },
        { status: 400 }
      );
    }

    const results: ImportPdfResult[] = [];
    for (const file of files) {
      try {
        const result = await importSinglePdf(user.id, file, collectionIdValue);
        results.push(result);
      } catch (itemErr) {
        results.push({
          fileName: file.name,
          success: false,
          error: itemErr instanceof Error ? itemErr.message : 'Import failed',
        });
      }
    }

    const imported = results.filter((result) => result.success).length;
    const failed = results.length - imported;
    const firstSuccess = results.find((result) => result.success);

    // Backward compatibility for older single-file UI consumers.
    if (results.length === 1 && firstSuccess) {
      return NextResponse.json(
        {
          ...firstSuccess,
          reference: {
            id: firstSuccess.referenceId,
            title: firstSuccess.referenceTitle,
          },
          results,
          summary: { total: 1, imported, failed },
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        results,
        summary: {
          total: results.length,
          imported,
          failed,
        },
      },
      { status: failed > 0 ? 207 : 201 }
    );
  } catch (err) {
    console.error('PDF import error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import from PDF' },
      { status: 500 }
    );
  }
}
