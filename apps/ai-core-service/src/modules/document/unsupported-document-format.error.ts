export class UnsupportedDocumentFormatError extends Error {
  constructor(contentType: string) {
    super(`Unsupported document format: ${contentType}`);
    this.name = 'UnsupportedDocumentFormatError';
  }
}
