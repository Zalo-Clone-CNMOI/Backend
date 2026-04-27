import { Logger } from '@nestjs/common';
import {
  TextExtractorService,
  UnsupportedDocumentFormatError,
  DocumentExtractionError,
} from './text-extractor.service';

describe('TextExtractorService', () => {
  let service: TextExtractorService;

  beforeEach(() => {
    service = new TextExtractorService();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    it('extracts text from a valid PDF buffer', async () => {
      const pdfBase64 =
        'JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MCA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDEyMCBUZCAoSGVsbG8gUERGKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMzMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQwMQolJUVPRgo=';
      const buf = Buffer.from(pdfBase64, 'base64');

      const result = await service.extract(buf, 'application/pdf', 'hello.pdf');

      expect(result).toContain('Hello PDF');
    });

    it('throws DocumentExtractionError for malformed PDF', async () => {
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

    it('returns near-empty result for empty/garbage XLSX (xlsx is lenient)', async () => {
      // xlsx@0.18.x accepts empty/garbage buffers and produces a default
      // empty sheet rather than throwing — assert the output is trivial
      // (just the sheet header, no real data) so the engine downstream
      // sees no content to embed.
      const buf = Buffer.alloc(0);
      const result = await service.extract(buf, xlsxMime, 'empty.xlsx');
      expect(result).toMatch(/^## Sheet:/);
      expect(result.length).toBeLessThan(100);
    });
  });

  // ── Error preservation ──────────────────────────────────────────────

  describe('DocumentExtractionError', () => {
    it('preserves original error via ES2022 cause property', async () => {
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
