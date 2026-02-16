/**
 * PDF Parser Service
 * Extracts text content and metadata from PDF files.
 * Updates ReferenceDocument status through the processing pipeline:
 *   UPLOADED -> PARSING -> READY (or FAILED)
 */

import { prisma } from '../prisma';
import * as fs from 'fs';

// Error codes for failed parsing
export const PDF_ERROR_CODES = {
  PASSWORD_PROTECTED: 'password_protected',
  CORRUPTED: 'corrupted',
  SCANNED_ONLY: 'scanned_only',
  UNSUPPORTED: 'unsupported',
  FILE_NOT_FOUND: 'file_not_found',
  PARSE_ERROR: 'parse_error',
} as const;

export type PdfErrorCode = typeof PDF_ERROR_CODES[keyof typeof PDF_ERROR_CODES];

// Human-readable error messages for each code
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

interface PDFTextResult {
  text?: string;
  total?: number;
}

interface PDFDateNode {
  CreationDate?: Date | null;
  XmpCreateDate?: Date | null;
  XapCreateDate?: Date | null;
}

interface PDFInfoResult {
  total?: number;
  info?: Record<string, unknown>;
  metadata?: unknown;
  getDateNode?: () => PDFDateNode;
}

interface PDFParserInstance {
  getText: () => Promise<PDFTextResult>;
  getInfo: () => Promise<PDFInfoResult>;
  destroy: () => Promise<void>;
}

type PDFParseConstructor = new (options: { data: Buffer | Uint8Array }) => PDFParserInstance;

let pdfParseConstructorPromise: Promise<PDFParseConstructor> | null = null;

async function getPDFParseConstructor(): Promise<PDFParseConstructor> {
  if (!pdfParseConstructorPromise) {
    pdfParseConstructorPromise = import('pdf-parse').then((module: any) => {
      const ctor = module?.PDFParse || module?.default?.PDFParse;
      if (!ctor) {
        throw new Error('PDFParse class not found in pdf-parse module');
      }
      return ctor as PDFParseConstructor;
    });
  }
  return pdfParseConstructorPromise;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function extractDoiFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const meta = metadata as {
    get?: (key: string) => unknown;
    getAll?: () => Record<string, unknown> | undefined;
  };

  const candidateKeys = ['dc:identifier', 'prism:doi', 'doi', 'dc:doi'];
  for (const key of candidateKeys) {
    const value = asString(meta.get?.(key));
    if (!value) continue;
    const doiMatch = value.match(/(10\.\d{4,9}\/[^\s,;)}\]]+)/i);
    if (doiMatch) {
      return cleanExtractedDoi(doiMatch[1]);
    }
  }

  const allValues = meta.getAll?.();
  if (allValues && typeof allValues === 'object') {
    for (const value of Object.values(allValues)) {
      const text = asString(value);
      if (!text) continue;
      const doiMatch = text.match(/(10\.\d{4,9}\/[^\s,;)}\]]+)/i);
      if (doiMatch) {
        return cleanExtractedDoi(doiMatch[1]);
      }
    }
  }

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

  if (!/^10\.\d{4,9}\/\S+$/i.test(normalized)) {
    return undefined;
  }

  return normalized;
}

/**
 * Extract a DOI from text content.
 * Looks for DOI patterns in the first few pages of text.
 */
function extractDoiFromText(text: string): string | undefined {
  if (!text) return undefined;

  // Search a wider text window because many PDFs place DOI outside page 1.
  const searchArea = text.substring(0, 50000);

  // Common DOI patterns:
  // doi:10.xxxx/xxxxx
  // DOI: 10.xxxx/xxxxx
  // https://doi.org/10.xxxx/xxxxx
  // http://dx.doi.org/10.xxxx/xxxxx
  const doiPatterns = [
    /(?:doi[:\s]+)(10\.\d{4,9}\/[^\s,;)}\]]+)/i,
    /(?:https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s,;)}\]]+)/i,
    /(10\.\d{4,9}\/[^\s,;)}\]]{3,})/i, // bare DOI as fallback
  ];

  for (const pattern of doiPatterns) {
    const match = searchArea.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanExtractedDoi(match[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return undefined;
}

/**
 * Parse PDF creation date from various formats.
 * PDF dates can be in format: D:YYYYMMDDHHmmSSOHH'mm'
 */
function parsePdfDate(dateStr: string | undefined): Date | undefined {
  if (!dateStr) return undefined;

  try {
    // Standard PDF date format: D:YYYYMMDDHHmmSSOHH'mm'
    const pdfDateMatch = dateStr.match(
      /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/
    );
    if (pdfDateMatch) {
      const [, year, month, day, hour = '0', min = '0', sec = '0'] = pdfDateMatch;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(min),
        parseInt(sec)
      );
    }

    // Try standard Date parsing as fallback
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    // Ignore parse errors
  }

  return undefined;
}

class PdfParserService {
  /**
   * Parse a PDF file and extract text + metadata.
   * Returns parsed data without touching the database.
   */
  async parsePdf(filePath: string): Promise<PdfParseResult> {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        errorCode: PDF_ERROR_CODES.FILE_NOT_FOUND,
        errorMessage: PDF_ERROR_MESSAGES.file_not_found,
      };
    }

    try {
      const dataBuffer = fs.readFileSync(filePath);
      const PDFParse = await getPDFParseConstructor();
      const parser = new PDFParse({ data: dataBuffer });

      let text = '';
      let pageCount = 1;
      let info: Record<string, unknown> = {};
      let parserMetadata: unknown;
      let creationDate: Date | undefined;

      try {
        // NOTE: pdf-parse v2 cannot run getText/getInfo concurrently on one parser
        // instance; doing so triggers "Cannot transfer object of unsupported type."
        const infoResult = await parser.getInfo();
        const textResult = await parser.getText();

        text = textResult.text || '';
        pageCount = infoResult.total || textResult.total || 1;
        info = (infoResult.info || {}) as Record<string, unknown>;
        parserMetadata = infoResult.metadata;

        // Prefer parser-normalized date extraction when available.
        const dateNode = infoResult.getDateNode?.();
        creationDate =
          dateNode?.CreationDate ||
          dateNode?.XmpCreateDate ||
          dateNode?.XapCreateDate ||
          parsePdfDate(asString(info.CreationDate));
      } finally {
        await parser.destroy().catch(() => undefined);
      }

      // Extract metadata from PDF info dictionary
      const metadata: ExtractedPdfMetadata = {
        title: asString(info.Title),
        authors: asString(info.Author),
        subject: asString(info.Subject) || asString(info.Keywords),
        creator: asString(info.Creator),
        producer: asString(info.Producer),
        creationDate,
      };

      // Try to extract DOI from XMP metadata first, then from text
      metadata.doi = extractDoiFromMetadata(parserMetadata);

      // Fallback: extract DOI from text content
      if (!metadata.doi && text) {
        metadata.doi = extractDoiFromText(text);
      }

      // Check for scanned-only PDFs (very little text relative to page count)
      const textLength = text.trim().length;
      const avgCharsPerPage = textLength / pageCount;

      // If average characters per page is very low, it's likely scanned
      if (avgCharsPerPage < 30 && pageCount > 0) {
        return {
          success: false,
          pageCount,
          metadata,
          errorCode: PDF_ERROR_CODES.SCANNED_ONLY,
          errorMessage: PDF_ERROR_MESSAGES.scanned_only,
        };
      }

      return {
        success: true,
        text,
        pageCount,
        metadata,
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);

      // Detect password-protected PDFs
      if (
        errorMessage.includes('password') ||
        errorMessage.includes('encrypted') ||
        errorMessage.includes('Permission denied')
      ) {
        return {
          success: false,
          errorCode: PDF_ERROR_CODES.PASSWORD_PROTECTED,
          errorMessage: PDF_ERROR_MESSAGES.password_protected,
        };
      }

      // Detect corrupted files
      if (
        errorMessage.includes('Invalid PDF') ||
        errorMessage.includes('not a PDF') ||
        errorMessage.includes('stream') ||
        errorMessage.includes('xref')
      ) {
        return {
          success: false,
          errorCode: PDF_ERROR_CODES.CORRUPTED,
          errorMessage: PDF_ERROR_MESSAGES.corrupted,
        };
      }

      // Generic parse error
      return {
        success: false,
        errorCode: PDF_ERROR_CODES.PARSE_ERROR,
        errorMessage: `${PDF_ERROR_MESSAGES.parse_error} (${errorMessage.substring(0, 200)})`,
      };
    }
  }

  /**
   * Parse a PDF and update the corresponding ReferenceDocument in the database.
   * This is the main entry point for the async processing pipeline.
   */
  async processDocument(documentId: string): Promise<void> {
    // Set status to PARSING
    await prisma.referenceDocument.update({
      where: { id: documentId },
      data: { status: 'PARSING' },
    });

    try {
      const document = await prisma.referenceDocument.findUnique({
        where: { id: documentId },
      });

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
            parsedText: result.text,
            pageCount: result.pageCount,
            pdfTitle: result.metadata?.title,
            pdfAuthors: result.metadata?.authors,
            pdfSubject: result.metadata?.subject,
            pdfCreator: result.metadata?.creator,
            pdfProducer: result.metadata?.producer,
            pdfCreationDate: result.metadata?.creationDate,
            pdfDoi: result.metadata?.doi,
            errorCode: null,
          },
        });
      } else {
        await prisma.referenceDocument.update({
          where: { id: documentId },
          data: {
            status: 'FAILED',
            errorCode: result.errorCode,
            // Still save partial metadata even on failure
            pageCount: result.pageCount,
            pdfTitle: result.metadata?.title,
            pdfAuthors: result.metadata?.authors,
          },
        });
      }
    } catch (error) {
      console.error(`[PdfParser] Unexpected error processing document ${documentId}:`, error);
      await prisma.referenceDocument.update({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          errorCode: PDF_ERROR_CODES.PARSE_ERROR,
        },
      });
    }
  }

  /**
   * Extract metadata from a PDF file without full text extraction.
   * Useful for quick metadata extraction during upload to auto-populate citation fields.
   */
  async extractMetadataOnly(filePath: string): Promise<ExtractedPdfMetadata | null> {
    const result = await this.parsePdf(filePath);
    return result.metadata || null;
  }
}

export const pdfParserService = new PdfParserService();

