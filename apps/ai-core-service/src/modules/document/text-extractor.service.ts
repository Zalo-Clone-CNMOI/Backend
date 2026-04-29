import { Injectable, Logger } from '@nestjs/common';
import { DocumentExtractionError } from './document-extraction.error';
import { UnsupportedDocumentFormatError } from './unsupported-document-format.error';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
]);

const PDF_MIME = 'application/pdf';
const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const XLSX_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

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
      const parseFn = pdfParseDefault as unknown as (
        b: Buffer,
      ) => Promise<{ text?: string }>;
      const result = await parseFn(buffer as unknown as Buffer);
      return (result?.text ?? '').trim();
    }

    if ('PDFParse' in pdfParseModule) {
      const { PDFParse } = pdfParseModule as {
        PDFParse: new (opts: { data: Buffer }) => {
          getText: () => Promise<{ text?: string }>;
          destroy: () => Promise<void>;
        };
      };
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

  private async extractXlsx(buffer: Buffer): Promise<string> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    // @ts-expect-error -- ExcelJS type expects pre-Node22 Buffer; runtime-compatible
    await workbook.xlsx.load(buffer);

    const sheets = workbook.worksheets.map((sheet) => {
      const rows = sheet.getSheetValues().slice(1) as Array<
        unknown[] | undefined
      >;
      const csv = rows
        .map((row) => {
          if (!row) return '';
          const cells = row.slice(1).map((value) => this.formatCsvValue(value));
          return cells.join(',');
        })
        .join('\n');
      return `## Sheet: ${sheet.name}\n${csv}`.trim();
    });

    return sheets.join('\n\n').trim();
  }

  private formatCsvValue(value: unknown): string {
    const text =
      value == null
        ? ''
        : value instanceof Date
          ? value.toISOString()
          : typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
            ? String(value)
            : '';
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
}
