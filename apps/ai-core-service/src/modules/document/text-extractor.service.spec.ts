import { Logger } from '@nestjs/common';
import { TextExtractorService } from './text-extractor.service';
import { UnsupportedDocumentFormatError } from './unsupported-document-format.error';
import { DocumentExtractionError } from './document-extraction.error';

jest.mock('pdf-parse', () => ({ default: jest.fn() }));

describe('TextExtractorService', () => {
  let service: TextExtractorService;

  beforeEach(() => {
    service = new TextExtractorService();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ── Plain text formats ──────────────────────────────────────────────

  describe('plain text formats', () => {
    it('extracts utf-8 from text/plain', async () => {
      const buf = Buffer.from('Hello world\nLine 2', 'utf-8');
      const result = await service.extract(buf, 'text/plain', 'sample.txt');
      expect(result).toBe('Hello world\nLine 2');
    });

    it('extracts utf-8 from text/csv', async () => {
      const buf = Buffer.from('a,b,c\n1,2,3', 'utf-8');
      const result = await service.extract(buf, 'text/csv', 'data.csv');
      expect(result).toContain('a,b,c');
    });

    it('extracts utf-8 from text/markdown', async () => {
      const buf = Buffer.from('# Heading\n\nBody', 'utf-8');
      const result = await service.extract(buf, 'text/markdown', 'doc.md');
      expect(result).toContain('# Heading');
    });

    it('extracts utf-8 from application/json', async () => {
      const buf = Buffer.from('{"a":1}', 'utf-8');
      const result = await service.extract(
        buf,
        'application/json',
        'data.json',
      );
      expect(result).toBe('{"a":1}');
    });

    it('preserves Vietnamese diacritics in text/plain', async () => {
      const buf = Buffer.from('Xin chào, cửa hàng số 5', 'utf-8');
      const result = await service.extract(buf, 'text/plain', 'sample.txt');
      expect(result).toBe('Xin chào, cửa hàng số 5');
    });
  });

  // ── Unsupported formats ─────────────────────────────────────────────

  describe('unsupported formats', () => {
    it('throws UnsupportedDocumentFormatError for image/png', async () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await expect(
        service.extract(buf, 'image/png', 'photo.png'),
      ).rejects.toBeInstanceOf(UnsupportedDocumentFormatError);
    });

    it('throws UnsupportedDocumentFormatError for video/mp4', async () => {
      const buf = Buffer.from([]);
      await expect(
        service.extract(buf, 'video/mp4', 'clip.mp4'),
      ).rejects.toBeInstanceOf(UnsupportedDocumentFormatError);
    });

    it('throws UnsupportedDocumentFormatError for legacy .doc (application/msword)', async () => {
      const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
      await expect(
        service.extract(buf, 'application/msword', 'legacy.doc'),
      ).rejects.toBeInstanceOf(UnsupportedDocumentFormatError);
    });
  });

  // ── PDF extraction ──────────────────────────────────────────────────

  describe('PDF extraction', () => {
    let mockPdfParse: jest.Mock;

    beforeEach(async () => {
      const mod = await import('pdf-parse');
      mockPdfParse = mod.default as unknown as jest.Mock;
    });

    it('extracts text from a valid PDF buffer', async () => {
      mockPdfParse.mockResolvedValueOnce({ text: 'Hello PDF' });
      const buf = Buffer.from('fake-pdf-bytes');
      const result = await service.extract(buf, 'application/pdf', 'hello.pdf');
      expect(result).toContain('Hello PDF');
    });

    it('throws DocumentExtractionError for malformed PDF', async () => {
      mockPdfParse.mockRejectedValueOnce(new Error('Invalid PDF structure'));
      const buf = Buffer.from('not a pdf at all', 'utf-8');
      await expect(
        service.extract(buf, 'application/pdf', 'bad.pdf'),
      ).rejects.toBeInstanceOf(DocumentExtractionError);
    });
  });

  // ── DOCX extraction ─────────────────────────────────────────────────

  describe('DOCX extraction', () => {
    it('throws DocumentExtractionError for malformed DOCX', async () => {
      const buf = Buffer.from('not a docx file', 'utf-8');
      await expect(
        service.extract(
          buf,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'bad.docx',
        ),
      ).rejects.toBeInstanceOf(DocumentExtractionError);
    });
  });

  // ── XLSX extraction ─────────────────────────────────────────────────

  describe('XLSX extraction', () => {
    const xlsxMime =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    it('extracts CSV content from a simple XLSX buffer', async () => {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow(['A', 'B']);
      sheet.addRow(['1', '2']);

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const result = await service.extract(buffer, xlsxMime, 'sample.xlsx');

      expect(result).toContain('## Sheet: Sheet1');
      expect(result).toContain('A,B');
      expect(result).toContain('1,2');
    });
  });

  // ── Error preservation ──────────────────────────────────────────────

  describe('DocumentExtractionError', () => {
    it('preserves original error via ES2022 cause property', async () => {
      const mod = await import('pdf-parse');
      (mod.default as unknown as jest.Mock).mockRejectedValueOnce(
        new Error('pdf parse failed'),
      );
      const buf = Buffer.from('not a pdf', 'utf-8');
      try {
        await service.extract(buf, 'application/pdf', 'bad.pdf');
        fail('Expected DocumentExtractionError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentExtractionError);
        expect((error as DocumentExtractionError).cause).toBeInstanceOf(Error);
      }
    });
  });
});
