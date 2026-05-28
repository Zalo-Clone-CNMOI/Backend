import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DocumentMetadata } from '@libs/database';

/**
 * Outcome of resolving a document attachment to a DocumentMetadata row for the
 * sender/conversation pair. Drives chat-service's routing decision:
 *   - 'ready'  → override ai_context to feature='document' for this request
 *   - 'pending'/'failed'/'missing' → fall back to general routing + log
 */
export type DocumentResolveOutcome =
  | { kind: 'ready'; documentId: string; fileKey: string }
  | { kind: 'pending'; documentId: string }
  | { kind: 'failed'; documentId: string }
  | { kind: 'missing' };

export interface DocumentAttachmentRef {
  file_key: string;
  file_name: string;
  file_size: number;
  content_type: string;
}

// Whitelist of fields safe to copy from a reference DocumentMetadata when
// re-linking. Conversation_id / user_id intentionally come from the TARGET
// request — never the source — to prevent cross-conversation leakage. Status
// is forced to 'ready' because re-link only happens when chunks already exist
// for the file_key. Billing/quota fields (cost, token attribution) live
// elsewhere; do NOT add them here without a separate review.
const REUSABLE_REFERENCE_FIELDS = [
  'fileKey',
  'fileName',
  'fileSize',
  'contentType',
  'chunkCount',
  'totalTokens',
  'embeddingModel',
  'embeddingVersion',
] as const;

const READY_STATUSES = new Set(['ready', 'completed']);

@Injectable()
export class DocumentLinkService {
  private readonly logger = new Logger(DocumentLinkService.name);

  constructor(
    @InjectRepository(DocumentMetadata)
    private readonly docMetaRepo: Repository<DocumentMetadata>,
  ) {}

  /**
   * Look up an existing DocumentMetadata row for `(file_key, senderId,
   * conversationId)`. If absent, attempt re-link by copying whitelisted
   * fields from any ready reference row sharing the same file_key. The
   * unique constraint `uq_document_file_user_conv` makes the insert
   * race-safe — concurrent inserts surface as SQLSTATE 23505 and we
   * re-query the winner.
   */
  async resolveForUser(
    senderId: string,
    conversationId: string,
    attachment: DocumentAttachmentRef,
  ): Promise<DocumentResolveOutcome> {
    // 1. Fast path — this user already has a row for this file in this conv.
    const own = await this.docMetaRepo.findOne({
      where: {
        fileKey: attachment.file_key,
        userId: senderId,
        conversationId,
      },
    });
    if (own) {
      return this.classifyByStatus(own);
    }

    // 2. Look for a ready reference row anywhere (any user, any conv).
    //    Earliest one wins — deterministic so concurrent re-links converge.
    const reference = await this.docMetaRepo.findOne({
      where: {
        fileKey: attachment.file_key,
        status: In(Array.from(READY_STATUSES)),
      },
      order: { createdAt: 'ASC' },
    });
    if (!reference) {
      // No chunks exist for this file_key. Caller should fall back to general
      // routing; the FE upload flow (media-service.confirmUploaded) is what
      // emits AiDocumentUpload — re-emitting here would race with that path.
      return { kind: 'missing' };
    }

    // 3. Re-link: build a new row with whitelisted fields copied from the
    //    reference. The target user/conversation come from the request.
    const newRow = this.docMetaRepo.create({
      conversationId,
      userId: senderId,
      status: 'ready',
      ...this.pickReusableFields(reference),
    });

    try {
      const saved = await this.docMetaRepo.save(newRow);
      this.logger.log(
        `Re-linked document for user=${senderId} conv=${conversationId} file_key=${attachment.file_key} → doc_id=${saved.id} (referenced doc=${reference.id})`,
      );
      return {
        kind: 'ready',
        documentId: saved.id,
        fileKey: attachment.file_key,
      };
    } catch (err) {
      // Race-safe: another worker (e.g., a parallel confirmUploaded) may have
      // inserted the same (file_key, sender, conv) tuple between our findOne
      // and save. The unique constraint surfaces SQLSTATE 23505; re-query and
      // reuse the winner instead of bubbling up a 500.
      if (this.isUniqueViolation(err)) {
        const winner = await this.docMetaRepo.findOne({
          where: {
            fileKey: attachment.file_key,
            userId: senderId,
            conversationId,
          },
        });
        if (winner) {
          this.logger.log(
            `Re-link race resolved by reusing concurrent winner doc_id=${winner.id}`,
          );
          return this.classifyByStatus(winner);
        }
      }
      throw err;
    }
  }

  private classifyByStatus(row: DocumentMetadata): DocumentResolveOutcome {
    if (READY_STATUSES.has(row.status)) {
      return { kind: 'ready', documentId: row.id, fileKey: row.fileKey };
    }
    if (row.status === 'pending' || row.status === 'processing') {
      return { kind: 'pending', documentId: row.id };
    }
    if (row.status === 'failed') {
      return { kind: 'failed', documentId: row.id };
    }
    // Unknown status — treat as missing rather than route into a broken state.
    this.logger.warn(
      `DocumentMetadata id=${row.id} has unrecognized status="${row.status}"; treating as missing`,
    );
    return { kind: 'missing' };
  }

  private pickReusableFields(
    reference: DocumentMetadata,
  ): Partial<DocumentMetadata> {
    const out: Partial<DocumentMetadata> = {};
    for (const field of REUSABLE_REFERENCE_FIELDS) {
      (out as Record<string, unknown>)[field] = (
        reference as unknown as Record<string, unknown>
      )[field];
    }
    return out;
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const anyErr = err as { code?: unknown; driverError?: { code?: unknown } };
    return anyErr.code === '23505' || anyErr.driverError?.code === '23505';
  }
}
