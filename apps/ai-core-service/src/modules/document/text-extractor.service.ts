import { Injectable, Logger } from '@nestjs/common';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
]);

const PDF_MIME = 'application/pdf';

// Only DOCX (Office Open XML) — legacy `.doc` (application/msword) is not
// supported by mammoth and would silently produce garbage.
const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const XLSX_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export class UnsupportedDocumentFormatError extends Error {
  constructor(contentType: string) {
    super(`Unsupported document format: ${contentType}`);
    this.name = 'UnsupportedDocumentFormatError';
  }
}

export class DocumentExtractionError extends Error {
  constructor(format: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to extract ${format}: ${message}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = 'DocumentExtractionError';
  }
}

/**
 * Extracts plain text from uploaded document buffers.
 *
 * Supported formats:
 *   - text/plain, text/csv, text/markdown, application/json (utf-8 decode)
 *   - application/pdf (via pdf-parse)
 *   - DOCX only (via mammoth — legacy .doc binary is rejected as unsupported)
 *   - XLS/XLSX (via xlsx — converted to per-sheet CSV)
 *
 * Parser libraries are loaded via dynamic import so service startup is not
 * delayed for callers that never process binary documents.
 */
@Injectable()
export class TextExtractorService {
  private readonly logger = new Logger(TextExtractorService.name);

  async extract(
    buffer: Buffer,
    contentType: string,
    fileName: string,
  ): Promise<string> {
    if (TEXT_MIME_TYPES.has(contentType)) {
      return buffer.toString('utf-8');
    }

    try {
      if (contentType === PDF_MIME) return await this.extractPdf(buffer);
      if (DOCX_MIMES.has(contentType)) return await this.extractDocx(buffer);
      if (XLSX_MIMES.has(contentType)) return await this.extractXlsx(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Extraction failed for ${fileName} (${contentType}): ${message}`,
      );
      throw new DocumentExtractionError(contentType, error);
    }

    throw new UnsupportedDocumentFormatError(contentType);
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const pdfParseModule = await import('pdf-parse');
    const pdfParseDefault =
      typeof pdfParseModule.default === 'function'
        ? pdfParseModule.default
        : null;

    if (pdfParseDefault) {
      // pdf-parse v2.x default export function: pdfParse(buffer)
      const result = await pdfParseDefault(buffer);
      return (result?.text ?? '').trim();
    }

    if ('PDFParse' in pdfParseModule) {
      const { PDFParse } = pdfParseModule as {
        PDFParse: new (opts: { data: Buffer }) => {
          getText: () => Promise<{ text?: string }>;
          destroy: () => Promise<void>;
        };
      };
      // Buffer extends Uint8Array in Node — pass directly, no copy.
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return (result.text ?? '').trim();
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }

    throw new Error('pdf-parse module does not expose a supported API');
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return (typeof value === 'string' ? value : '').trim();
  }

  /**
   * Extract XLSX/XLS content as per-sheet CSV.
   *
   * Security note: xlsx@0.18.5 has CVE-2023-30533 (prototype pollution from
   * crafted spreadsheets). Mitigations layered in this service:
   *  - DocumentEngine enforces aiMaxDocumentSizeMb (default 10MB) before this runs
   *  - File MIME type pre-check by caller
   *  - Output is plain CSV string, not deserialised back into JS objects
   * Long-term fix: switch to a maintained alternative (e.g. exceljs) — tracked.
   */
  private async extractXlsx(buffer: Buffer): Promise<string> {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheets = wb.SheetNames.map((name) => {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return `## Sheet: ${name}\n${csv}`;
    });
    return sheets.join('\n\n').trim();
  }
}
