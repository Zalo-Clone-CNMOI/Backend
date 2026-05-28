import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M3 of the Zai doc auto-link rollout (3-wave deploy: M1 → M2 → M3).
 *
 * Finalizes the chunks-by-file_key schema. Pre-conditions (must hold in
 * production before deploying this migration):
 *   - M2 has been live ≥ 7 days with no spike in DocumentRagService or
 *     DocumentLinkService error rate.
 *   - `SELECT COUNT(*) FROM document_chunks WHERE file_key IS NULL` returns 0.
 *
 * Steps:
 *   1. Defense-in-depth NULL check — abort if any chunk still has NULL
 *      file_key. The M3 ALTER ... SET NOT NULL would fail anyway, but a
 *      clear error message at this step is friendlier to ops.
 *   2. DROP the legacy FK constraint `FK_document_chunks_document`.
 *   3. DROP the legacy index `idx_chunk_document` (no longer queried).
 *   4. DROP COLUMN `document_id` — readers stopped using it in M2,
 *      writers stop populating it in this PR.
 *   5. ALTER `file_key` SET NOT NULL — the column is now load-bearing.
 *
 * Rollback (down): re-add `document_id` (NULLABLE), recreate the index,
 * restore the FK as ON DELETE NO ACTION (matching M1's post-state),
 * and re-add NULLABLE to file_key. The DDL is wrapped in a transaction,
 * so `up()` is all-or-nothing: a mid-step failure rolls back cleanly
 * (and `down()` is not even needed). The data-loss caveat applies only
 * when `up()` has already committed successfully in production — at
 * that point `down()` restores the column SHAPE but the per-row
 * `document_id` values are permanently lost. Operators who genuinely
 * need to rebuild the column post-commit must backfill manually
 * (e.g., by joining on file_key + earliest document_metadata row,
 * accepting that re-linked chunks lose their original ownership trail).
 */
export class FinalizeDocumentChunksByFileKey1782500000000 implements MigrationInterface {
  name = 'FinalizeDocumentChunksByFileKey1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Pre-flight: abort if any chunk has NULL file_key. This would
    //    otherwise blow up at step 5 with an opaque NOT NULL error.
    const orphanRows = (await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM "document_chunks" WHERE "file_key" IS NULL`,
    )) as Array<{ count: number }>;
    const orphanCount = orphanRows[0]?.count ?? 0;
    if (orphanCount > 0) {
      throw new Error(
        `FinalizeDocumentChunksByFileKey: ${orphanCount} chunk(s) still have NULL file_key. ` +
          `M2 dual-write should have populated this column for all rows. ` +
          `Inspect with: SELECT id, document_id FROM document_chunks WHERE file_key IS NULL; ` +
          `Then either backfill from document_metadata (JOIN on document_id) or delete the orphan chunks.`,
      );
    }

    // 2. Drop the legacy FK. After this, document_metadata deletes are
    //    completely decoupled from document_chunks (chunks are now scoped
    //    by file_key alone).
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_document"`,
    );

    // 3. Drop the legacy index — readers switched to file_key in M2.
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chunk_document"`);

    // 4. Drop the column. No reader queries it, M3's entity removes it.
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "document_id"`,
    );

    // 5. Make file_key non-null. The column is now the canonical chunk
    //    identifier and load-bearing for every reader.
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ALTER COLUMN "file_key" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order. Schema-only restore — row-level document_id data is
    // unrecoverable from `down()` alone; if a rollback is genuinely needed
    // after production has run for a while, the operator must backfill
    // document_id manually (e.g., by joining on file_key + earliest
    // document_metadata row, accepting that re-linked chunks lose their
    // original ownership trail).
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ALTER COLUMN "file_key" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "document_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chunk_document" ON "document_chunks" ("document_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks"
        ADD CONSTRAINT "FK_document_chunks_document"
        FOREIGN KEY ("document_id") REFERENCES "document_metadata"("id")
        ON DELETE NO ACTION`,
    );
  }
}
