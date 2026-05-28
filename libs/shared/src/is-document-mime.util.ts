/**
 * Single source of truth for which content types we treat as "documents" for
 * the Zai AI ingest/RAG pipeline. Used by:
 *   - media-service.confirmUploaded → decides whether to emit AiDocumentUpload
 *   - chat-service.send-message handler → decides whether to attempt auto-link
 *
 * Keep these two callers in sync via this util. Adding a new doc type means
 * updating one list, not two.
 */
const DOCUMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

export function isDocumentMime(
  contentType: string | null | undefined,
): boolean {
  return (
    typeof contentType === 'string' && DOCUMENT_CONTENT_TYPES.has(contentType)
  );
}
