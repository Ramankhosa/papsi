/**
 * PDF Parser Service
 * Extracts text content and metadata from PDF files using pdfjs-dist (Mozilla PDF.js).
 * Updates ReferenceDocument status through the processing pipeline:
 *   UPLOADED -> PARSING -> READY (or FAILED)
 */

import { prisma } from '../prisma';
import * as fs from 'fs';
import { normalizeExtractedText, reconstructPageText } from './proactive-parsing-service';
import type { TextItem } from './proactive-parsing-service';
import { removeNullCharacters, sanitizeTextForPostgres } from '../utils/postgres-sanitize';

export const PDF_ERROR_CODES = {
  PASSWORD_PROTECTED: 'password_protected',
  CORRUPTED: 'corrupted',
  SCANNED_ONLY: 'scanned_only',
  UNSUPPORTED: 'unsupported',
  FILE_NOT_FOUND: 'file_not_found',
  PARSE_ERROR: 'parse_error',
} as const;

export type PdfErrorCode = typeof PDF_ERROR_CODES[keyof typeof PDF_ERROR_CODES];

export const PDF_ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  password_protected: 'PDF is password-protected. Please upload an unprotected version.',
  corrupted: 'PDF file appears to be corrupted or damaged. Please upload a different copy.',
  scanned_only: 'PDF contains only scanned images without selectable text. OCR is not supported in this version.',
  unsupported: 'Unsupported PDF format. Please try a different version of the document.',
  file_not_found: 'PDF file was not found on the server. Please upload it again.',
  parse_error: 'An unexpected error occurred while processing the PDF. Please try again or upload a different file.',
};

export interface ExtractedPdfMetadata {
  title?: string;
  authors?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  doi?: string;
}

export interface PdfParseResult {
  success: boolean;
  text?: string;
  pageCount?: number;
  metadata?: ExtractedPdfMetadata;
  errorCode?: PdfErrorCode;
  errorMessage?: string;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => {
      try {
        const pkgDir = require('path').dirname(require.resolve('pdfjs-dist/package.json'));
        const workerPath = require('path').join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
        if (require('fs').existsSync(workerPath)) {
          mod.GlobalWorkerOptions.workerSrc = `file://${workerPath.replace(/\\/g, '/')}`;
        }
      } catch {
        console.warn('[PdfParser] Could not resolve pdfjs worker path, using main-thread fallback');
      }
      return mod;
    });
  }
  return pdfjsPromise;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = removeNullCharacters(value).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') return String(value);
  return undefined;
}

function cleanExtractedDoi(rawDoi: string | undefined): string | undefined {
  if (!rawDoi) return undefined;

  const normalized = rawDoi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[\s]+/g, '')
    .replace(/[)\],;]+$/, '')
    .replace(/\.+$/, '');

  if (!/^10\.\d{4,9}\/\S+$/i.test(normalized)) return undefined;
  return normalized;
}

function extractDoiFromText(text: string): string | undefined {
  if (!text) return undefined;

  const searchArea = text.substring(0, 50000);
  const doiPatterns = [
    /(?:doi[:\s]+)(10\.\d{4,9}\/[^\s,;)}\]]+)/i,
    /(?:https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s,;)}\]]+)/i,
    /(10\.\d{4,9}\/[^\s,;)}\]]{3,})/i,
  ];

  for (const pattern of doiPatterns) {
    const match = searchArea.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanExtractedDoi(match[1]);
      if (cleaned) return cleaned;
    }
  }

  return undefined;
}

function parsePdfDate(dateStr: string | undefined): Date | undefined {
  if (!dateStr) return undefined;

  try {
    const pdfDateMatch = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (pdfDateMatch) {
      const [, year, month, day, hour = '0', min = '0', sec = '0'] = pdfDateMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  } catch { /* ignore */ }

  return undefined;
}

class PdfParserService {
  async parsePdf(filePath: string): Promise<PdfParseResult> {
    if (!fs.existsSync(filePath)) {
      return { success: false, errorCode: PDF_ERROR_CODES.FILE_NOT_FOUND, errorMessage: PDF_ERROR_MESSAGES.file_not_found };
    }

    try {
      const pdfjs = await getPdfjs();
      const data = new Uint8Array(fs.readFileSync(filePath));

      const doc = await pdfjs.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false,
      }).promise;

      const pageCount = doc.numPages;
      const pages: string[] = [];

      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        const textItems: TextItem[] = [];
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const ti = item as { str: string; transform: number[]; width: number };
          textItems.push({
            str: ti.str,
            x: ti.transform[4],
            y: ti.transform[5],
            width: ti.width ?? 0,
          });
        }

        pages.push(reconstructPageText(textItems, viewport.width));
      }

      const text = normalizeExtractedText(pages.join('\n\n'));

      // Extract metadata from PDF info
      let metadata: ExtractedPdfMetadata = {};
      try {
        const pdfMetadata = await doc.getMetadata();
        const info = (pdfMetadata?.info || {}) as Record<string, unknown>;
        metadata = {
          title: asString(info.Title),
          authors: asString(info.Author),
          subject: asString(info.Subject),
          keywords: asString(info.Keywords),
          creator: asString(info.Creator),
          producer: asString(info.Producer),
          creationDate: parsePdfDate(asString(info.CreationDate)),
        };
      } catch { /* metadata extraction is best-effort */ }

      if (!metadata.doi && text) {
        metadata.doi = extractDoiFromText(text);
      }

      const textLength = text.length;
      const avgCharsPerPage = textLength / Math.max(pageCount, 1);

      if (avgCharsPerPage < 30 && pageCount > 0) {
        return {
          success: false,
          pageCount,
          metadata,
          errorCode: PDF_ERROR_CODES.SCANNED_ONLY,
          errorMessage: PDF_ERROR_MESSAGES.scanned_only,
        };
      }

      return { success: true, text, pageCount, metadata };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      if (errorMessage.includes('password') || errorMessage.includes('encrypted') || errorMessage.includes('Permission denied')) {
        return { success: false, errorCode: PDF_ERROR_CODES.PASSWORD_PROTECTED, errorMessage: PDF_ERROR_MESSAGES.password_protected };
      }

      if (errorMessage.includes('Invalid PDF') || errorMessage.includes('not a PDF') || errorMessage.includes('stream') || errorMessage.includes('xref')) {
        return { success: false, errorCode: PDF_ERROR_CODES.CORRUPTED, errorMessage: PDF_ERROR_MESSAGES.corrupted };
      }

      return { success: false, errorCode: PDF_ERROR_CODES.PARSE_ERROR, errorMessage: `${PDF_ERROR_MESSAGES.parse_error} (${errorMessage.substring(0, 200)})` };
    }
  }

  async processDocument(documentId: string): Promise<void> {
    try {
      await prisma.referenceDocument.update({
        where: { id: documentId },
        data: { status: 'PARSING' },
      });
    } catch {
      console.error(`[PdfParser] Document ${documentId} not found or cannot update status`);
      return;
    }

    try {
      const document = await prisma.referenceDocument.findUnique({ where: { id: documentId } });
      if (!document) {
        console.error(`[PdfParser] Document ${documentId} not found`);
        return;
      }

      const result = await this.parsePdf(document.storagePath);

      if (result.success) {
        await prisma.referenceDocument.update({
          where: { id: documentId },
          data: {
            status: 'READY',
            parsedText: sanitizeTextForPostgres(result.text),
            pageCount: result.pageCount,
            pdfTitle: sanitizeTextForPostgres(result.metadata?.title),
            pdfAuthors: sanitizeTextForPostgres(result.metadata?.authors),
            pdfSubject: sanitizeTextForPostgres(result.metadata?.subject),
            pdfCreator: sanitizeTextForPostgres(result.metadata?.creator),
            pdfProducer: sanitizeTextForPostgres(result.metadata?.producer),
            pdfCreationDate: result.metadata?.creationDate,
            pdfDoi: sanitizeTextForPostgres(result.metadata?.doi),
            errorCode: null,
          },
        });
      } else {
        await prisma.referenceDocument.update({
          where: { id: documentId },
          data: {
            status: 'FAILED',
            errorCode: result.errorCode,
            pageCount: result.pageCount,
            pdfTitle: sanitizeTextForPostgres(result.metadata?.title),
            pdfAuthors: sanitizeTextForPostgres(result.metadata?.authors),
          },
        });
      }
    } catch (error) {
      console.error(`[PdfParser] Unexpected error processing document ${documentId}:`, error);
      await prisma.referenceDocument.update({
        where: { id: documentId },
        data: { status: 'FAILED', errorCode: PDF_ERROR_CODES.PARSE_ERROR },
      });
    }
  }

  async extractMetadataOnly(filePath: string): Promise<ExtractedPdfMetadata | null> {
    const result = await this.parsePdf(filePath);
    return result.metadata || null;
  }
}

export const pdfParserService = new PdfParserService();
