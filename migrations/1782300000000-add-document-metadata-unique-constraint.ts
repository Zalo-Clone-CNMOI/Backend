import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a unique constraint on document_metadata
 * (file_key, user_id, conversation_id) to enforce idempotency for the
 * post-upload AI document ingest flow.
 *
 * Why: MediaService.confirmUploaded now persists a DocumentMetadata row
 * (status='pending') before emitting the AiDocumentUpload Kafka event so
 * the FE can immediately call /api/ai-assist/conversations/document with
 * the returned documentId. Without this constraint, two concurrent
 * confirmUpload calls for the same (file, user, conversation) would both
 * pass the in-app `findOne` returning null and both INSERT — producing
 * duplicate rows with different UUIDs that point at the same physical
 * upload, wasting embedding tokens and breaking the doc-chat anchor.
 *
 * Pre-condition: the table must not currently contain duplicate
 * (file_key, user_id, conversation_id) tuples. In dev/staging this is
 * safe because the feature is gated behind the Zai foundation rollout
 * and no production rows have been created yet. If this migration ever
 * needs to run against a populated table, run the dedup query in the
 * comment block below first.
 *
 * Dedup query (run manually before this migration if needed):
 *   DELETE FROM document_metadata a
 *   USING document_metadata b
 *   WHERE a.id > b.id
 *     AND a.file_key = b.file_key
 *     AND a.user_id = b.user_id
 *     AND a.conversation_id = b.conversation_id;
 *
 * Postgres automatically creates a backing composite index for the unique
 * constraint, which also accelerates the idempotency `findOne` query.
 */
export class AddDocumentMetadataUniqueConstraint1782300000000
  implements MigrationInterface
{
  name = 'AddDocumentMetadataUniqueConstraint1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_metadata"
        ADD CONSTRAINT "uq_document_file_user_conv"
        UNIQUE ("file_key", "user_id", "conversation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_metadata" DROP CONSTRAINT IF EXISTS "uq_document_file_user_conv"`,
    );
  }
}
