/**
 * Reference Document Service
 * Manages PDF document upload, attachment, deduplication, and OA PDF fetching
 * for the Reference Library feature.
 */

import { prisma } from '../prisma';
import { pdfParserService } from './pdf-parser-service';
import type { ExtractedPdfMetadata } from './pdf-parser-service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Default limits
const DEFAULT_MAX_FILE_SIZE_MB = parseInt(process.env.MAX_REFERENCE_PDF_SIZE_MB || '50', 10);
const DEFAULT_UPLOADS_PATH = process.env.REFERENCE_UPLOADS_PATH || 'uploads/references';
const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || '';

export interface UploadDocumentResult {
    success: boolean;
    document?: any;
    link?: any;
    isDuplicate?: boolean;
    existingDocumentId?: string;
    extractedMetadata?: ExtractedPdfMetadata | null;
    error?: string;
}

export interface FetchOAResult {
    success: boolean;
    document?: any;
    link?: any;
    oaUrl?: string;
    error?: string;
}

class ReferenceDocumentService {
    private uploadsBasePath: string;
    private maxFileSizeBytes: number;

    constructor() {
        this.uploadsBasePath = path.resolve(process.cwd(), DEFAULT_UPLOADS_PATH);
        this.maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
    }

    /**
     * Ensure the upload directory for a user exists.
     */
    private ensureUserDir(userId: string): string {
        const userDir = path.join(this.uploadsBasePath, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        return userDir;
    }

    /**
     * Compute SHA-256 hash of a buffer.
     */
    private computeHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * Validate a file buffer before processing.
     */
    private validateFile(buffer: Buffer, filename: string): string | null {
        // Check file size
        if (buffer.length > this.maxFileSizeBytes) {
            return `File exceeds maximum size of ${DEFAULT_MAX_FILE_SIZE_MB}MB`;
        }

        // Check PDF magic bytes
        const header = buffer.slice(0, 5).toString('ascii');
        if (header !== '%PDF-') {
            return 'File does not appear to be a valid PDF';
        }

        return null;
    }

    // ============================================================================
    // UPLOAD & ATTACH
    // ============================================================================

    /**
     * Upload a PDF file and attach it to a reference.
     * Handles deduplication by file hash.
     */
    async uploadDocument(
        userId: string,
        referenceId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // Validate file
        const validationError = this.validateFile(fileBuffer, filename);
        if (validationError) {
            return { success: false, error: validationError };
        }

        // Verify reference ownership
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Check if this reference already has a primary document
        const existingLink = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
        });
        if (existingLink) {
            return { success: false, error: 'Reference already has a PDF attached. Use replace to update it.' };
        }

        // Compute hash for deduplication
        const fileHash = this.computeHash(fileBuffer);

        // Check for duplicate by hash
        const existingDoc = await prisma.referenceDocument.findUnique({
            where: { fileHash },
        });

        if (existingDoc) {
            // Same file already uploaded — link to this reference instead of re-uploading
            const link = await prisma.referenceDocumentLink.create({
                data: {
                    referenceId,
                    documentId: existingDoc.id,
                    isPrimary: true,
                    linkedBy: userId,
                },
            });

            return {
                success: true,
                document: existingDoc,
                link,
                isDuplicate: true,
                existingDocumentId: existingDoc.id,
            };
        }

        // Store file on disk
        const userDir = this.ensureUserDir(userId);
        const docId = crypto.randomUUID().replace(/-/g, '');
        const storagePath = path.join(userDir, `${docId}.pdf`);

        try {
            fs.writeFileSync(storagePath, fileBuffer);
        } catch (err) {
            return { success: false, error: 'Failed to store file on disk' };
        }

        // Create document record
        const document = await prisma.referenceDocument.create({
            data: {
                userId,
                storagePath,
                originalFilename: filename,
                fileHash,
                fileSizeBytes: fileBuffer.length,
                mimeType: 'application/pdf',
                sourceType: 'UPLOAD',
                status: 'UPLOADED',
            },
        });

        // Create link
        const link = await prisma.referenceDocumentLink.create({
            data: {
                referenceId,
                documentId: document.id,
                isPrimary: true,
                linkedBy: userId,
            },
        });

        // Start async parsing (fire and forget)
        this.processDocumentAsync(document.id);

        // Return immediately with UPLOADED status, metadata will come after parsing
        return {
            success: true,
            document,
            link,
            isDuplicate: false,
        };
    }

    /**
     * Upload a PDF without linking to a specific reference.
     * Extracts metadata from the PDF and returns it to the caller
     * so they can auto-create or match a reference.
     */
    async uploadDocumentStandalone(
        userId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // Validate file
        const validationError = this.validateFile(fileBuffer, filename);
        if (validationError) {
            return { success: false, error: validationError };
        }

        // Compute hash for deduplication
        const fileHash = this.computeHash(fileBuffer);

        // Check for duplicate by hash
        const existingDoc = await prisma.referenceDocument.findUnique({
            where: { fileHash },
        });

        if (existingDoc) {
            return {
                success: true,
                document: existingDoc,
                isDuplicate: true,
                existingDocumentId: existingDoc.id,
            };
        }

        // Store file
        const userDir = this.ensureUserDir(userId);
        const docId = crypto.randomUUID().replace(/-/g, '');
        const storagePath = path.join(userDir, `${docId}.pdf`);

        try {
            fs.writeFileSync(storagePath, fileBuffer);
        } catch (err) {
            return { success: false, error: 'Failed to store file on disk' };
        }

        // Quick metadata extraction before saving
        const extractedMetadata = await pdfParserService.extractMetadataOnly(storagePath);

        // Create document record
        const document = await prisma.referenceDocument.create({
            data: {
                userId,
                storagePath,
                originalFilename: filename,
                fileHash,
                fileSizeBytes: fileBuffer.length,
                mimeType: 'application/pdf',
                sourceType: 'UPLOAD',
                status: 'UPLOADED',
                // Save metadata immediately
                pdfTitle: extractedMetadata?.title,
                pdfAuthors: extractedMetadata?.authors,
                pdfSubject: extractedMetadata?.subject,
                pdfCreator: extractedMetadata?.creator,
                pdfProducer: extractedMetadata?.producer,
                pdfCreationDate: extractedMetadata?.creationDate,
                pdfDoi: extractedMetadata?.doi,
            },
        });

        // Start async parsing
        this.processDocumentAsync(document.id);

        return {
            success: true,
            document,
            isDuplicate: false,
            extractedMetadata,
        };
    }

    // ============================================================================
    // DETACH & REPLACE
    // ============================================================================

    /**
     * Detach (unlink) a document from a reference.
     * The document file stays if referenced elsewhere; cleaned up if orphaned.
     */
    async detachDocument(userId: string, referenceId: string): Promise<{ success: boolean; error?: string }> {
        // Verify reference ownership
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Find and remove the link
        const link = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
            include: { document: true },
        });

        if (!link) {
            return { success: false, error: 'No document attached to this reference' };
        }

        // Remove the link
        await prisma.referenceDocumentLink.delete({
            where: { id: link.id },
        });

        // Check if document is orphaned (no other links)
        const otherLinks = await prisma.referenceDocumentLink.count({
            where: { documentId: link.documentId },
        });

        if (otherLinks === 0) {
            // Soft delete: keep file but mark as orphaned for future cleanup
            // In production, a cleanup job would remove these periodically
            // For now, just delete the file
            try {
                if (fs.existsSync(link.document.storagePath)) {
                    fs.unlinkSync(link.document.storagePath);
                }
                await prisma.referenceDocument.delete({
                    where: { id: link.documentId },
                });
            } catch (err) {
                console.error('[RefDocService] Failed to clean up orphaned document:', err);
            }
        }

        return { success: true };
    }

    /**
     * Replace the document attached to a reference.
     */
    async replaceDocument(
        userId: string,
        referenceId: string,
        fileBuffer: Buffer,
        filename: string
    ): Promise<UploadDocumentResult> {
        // First detach existing
        const detachResult = await this.detachDocument(userId, referenceId);
        if (!detachResult.success && detachResult.error !== 'No document attached to this reference') {
            return { success: false, error: detachResult.error };
        }

        // Then upload new
        return this.uploadDocument(userId, referenceId, fileBuffer, filename);
    }

    // ============================================================================
    // QUERY & STATUS
    // ============================================================================

    /**
     * Get the document attached to a reference.
     */
    async getDocumentByReference(userId: string, referenceId: string) {
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) return null;

        const link = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
            include: {
                document: {
                    select: {
                        id: true,
                        originalFilename: true,
                        fileSizeBytes: true,
                        mimeType: true,
                        sourceType: true,
                        sourceIdentifier: true,
                        status: true,
                        errorCode: true,
                        pageCount: true,
                        pdfTitle: true,
                        pdfAuthors: true,
                        pdfSubject: true,
                        pdfDoi: true,
                        pdfCreationDate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        });

        return link;
    }

    /**
     * Get document processing status.
     */
    async getDocumentStatus(userId: string, documentId: string) {
        const doc = await prisma.referenceDocument.findFirst({
            where: { id: documentId, userId },
            select: {
                id: true,
                status: true,
                errorCode: true,
                pageCount: true,
                pdfTitle: true,
                pdfAuthors: true,
                pdfDoi: true,
                updatedAt: true,
            },
        });
        return doc;
    }

    // ============================================================================
    // OPEN ACCESS PDF FETCHING (Unpaywall)
    // ============================================================================

    /**
     * Fetch an OA PDF for a DOI via Unpaywall and attach to a reference.
     */
    async fetchOAPdfByDOI(
        userId: string,
        referenceId: string,
        doi: string
    ): Promise<FetchOAResult> {
        // Verify reference exists and belongs to user
        const reference = await prisma.referenceLibrary.findFirst({
            where: { id: referenceId, userId, isActive: true },
        });
        if (!reference) {
            return { success: false, error: 'Reference not found' };
        }

        // Check if already has a document
        const existingLink = await prisma.referenceDocumentLink.findFirst({
            where: { referenceId, isPrimary: true },
        });
        if (existingLink) {
            return { success: false, error: 'Reference already has a PDF attached' };
        }

        if (!UNPAYWALL_EMAIL) {
            return {
                success: false,
                error: 'Unpaywall integration not configured. Set UNPAYWALL_EMAIL in environment variables.',
            };
        }

        // Clean DOI
        const cleanDoi = this.cleanDOI(doi);
        if (!cleanDoi) {
            return { success: false, error: 'Invalid DOI format' };
        }

        try {
            // Query Unpaywall
            const unpayResponse = await fetch(
                `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`,
                { headers: { 'User-Agent': `Papsi/1.0 (${UNPAYWALL_EMAIL})` } }
            );

            if (!unpayResponse.ok) {
                if (unpayResponse.status === 404) {
                    return { success: false, error: 'DOI not found in Unpaywall database' };
                }
                return { success: false, error: `Unpaywall API error: ${unpayResponse.status}` };
            }

            const unpayData = await unpayResponse.json();

            // Find best OA PDF URL
            let pdfUrl: string | null = null;

            // Check best_oa_location first
            if (unpayData.best_oa_location?.url_for_pdf) {
                pdfUrl = unpayData.best_oa_location.url_for_pdf;
            }

            // Fallback: check all OA locations
            if (!pdfUrl && unpayData.oa_locations) {
                for (const loc of unpayData.oa_locations) {
                    if (loc.url_for_pdf) {
                        pdfUrl = loc.url_for_pdf;
                        break;
                    }
                }
            }

            if (!pdfUrl) {
                return {
                    success: false,
                    error: 'No open access PDF available for this DOI. You can upload the PDF manually if you have access.',
                };
            }

            // Download the PDF
            const pdfResponse = await fetch(pdfUrl, {
                headers: {
                    'User-Agent': 'Papsi/1.0 Academic Research Tool',
                    'Accept': 'application/pdf',
                },
                redirect: 'follow',
            });

            if (!pdfResponse.ok) {
                return { success: false, error: `Failed to download PDF from ${pdfUrl}` };
            }

            const contentType = pdfResponse.headers.get('content-type') || '';
            if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
                return { success: false, error: 'The URL did not return a PDF file' };
            }

            const arrayBuffer = await pdfResponse.arrayBuffer();
            const pdfBuffer = Buffer.from(arrayBuffer);

            // Validate it's actually a PDF
            const header = pdfBuffer.slice(0, 5).toString('ascii');
            if (header !== '%PDF-') {
                return { success: false, error: 'Downloaded file is not a valid PDF' };
            }

            // Check for duplicate by hash
            const fileHash = this.computeHash(pdfBuffer);
            const existingDoc = await prisma.referenceDocument.findUnique({
                where: { fileHash },
            });

            if (existingDoc) {
                // Link existing document
                const link = await prisma.referenceDocumentLink.create({
                    data: {
                        referenceId,
                        documentId: existingDoc.id,
                        isPrimary: true,
                        linkedBy: userId,
                    },
                });

                return {
                    success: true,
                    document: existingDoc,
                    link,
                    oaUrl: pdfUrl,
                };
            }

            // Store file
            const userDir = this.ensureUserDir(userId);
            const docId = crypto.randomUUID().replace(/-/g, '');
            const storagePath = path.join(userDir, `${docId}.pdf`);
            fs.writeFileSync(storagePath, pdfBuffer);

            // Create record
            const document = await prisma.referenceDocument.create({
                data: {
                    userId,
                    storagePath,
                    originalFilename: `${cleanDoi.replace(/[/\\]/g, '_')}.pdf`,
                    fileHash,
                    fileSizeBytes: pdfBuffer.length,
                    mimeType: 'application/pdf',
                    sourceType: 'DOI_FETCH',
                    sourceIdentifier: cleanDoi,
                    status: 'UPLOADED',
                },
            });

            // Create link
            const link = await prisma.referenceDocumentLink.create({
                data: {
                    referenceId,
                    documentId: document.id,
                    isPrimary: true,
                    linkedBy: userId,
                },
            });

            // Start async parsing
            this.processDocumentAsync(document.id);

            return {
                success: true,
                document,
                link,
                oaUrl: pdfUrl,
            };
        } catch (error: any) {
            return {
                success: false,
                error: `Failed to fetch OA PDF: ${error?.message || 'Unknown error'}`,
            };
        }
    }

    // ============================================================================
    // SERVE FILE
    // ============================================================================

    /**
     * Get the file path for serving a document to the user.
     * Verifies ownership.
     */
    async getDocumentFilePath(userId: string, documentId: string): Promise<string | null> {
        const doc = await prisma.referenceDocument.findFirst({
            where: { id: documentId, userId },
            select: { storagePath: true },
        });

        if (!doc || !fs.existsSync(doc.storagePath)) {
            return null;
        }

        return doc.storagePath;
    }

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Fire and forget document processing.
     */
    private processDocumentAsync(documentId: string): void {
        // Use setImmediate to not block the request
        setImmediate(async () => {
            try {
                await pdfParserService.processDocument(documentId);
            } catch (error) {
                console.error(`[RefDocService] Async processing failed for ${documentId}:`, error);
            }
        });
    }

    /**
     * Clean and validate DOI format.
     */
    private cleanDOI(doi: string): string | null {
        if (!doi || typeof doi !== 'string') return null;

        let cleaned = doi.trim()
            .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
            .replace(/^doi:/i, '')
            .trim();

        if (/^10\.\d{4,9}\/[^\s]+$/i.test(cleaned)) {
            return cleaned;
        }

        return null;
    }
}

export const referenceDocumentService = new ReferenceDocumentService();
