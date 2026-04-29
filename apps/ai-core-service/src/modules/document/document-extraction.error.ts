export class DocumentExtractionError extends Error {
  constructor(format: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to extract ${format}: ${message}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = 'DocumentExtractionError';
  }
}
