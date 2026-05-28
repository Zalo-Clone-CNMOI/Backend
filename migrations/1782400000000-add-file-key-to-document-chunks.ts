import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * M1 of the Zai doc auto-link rollout (3-wave deploy: M1 → M2 → M3).
 *
 * What this migration does:
 *   1. ADD COLUMN document_chunks.file_key VARCHAR(512) NULL
 *   2. Backfill file_key from JOIN document_metadata.file_key
 *   3. Fail-loud verification: NULL count MUST be 0 after backfill
 *      (an orphan chunk would otherwise become invisible to the new
 *      file_key-keyed reader path landing in M2)
 *   4. CREATE INDEX idx_chunk_file_key (used by M2 readers)
 *   5. Replace FK on document_chunks.document_id: drop ON DELETE CASCADE,
 *      re-add as ON DELETE NO ACTION so chunks survive when a single
 *      DocumentMetadata row is deleted (required for M2 re-link semantics
 *      where multiple DocumentMetadata rows share one file_key)
 *
 * What this migration does NOT do (deferred to M2/M3):
 *   - M2 will switch readers (DocumentRagService, document.engine query) to
 *     look up chunks by file_key instead of document_id
 *   - M3 (after ≥7 days of clean monitoring) will drop document_id column
 *     and the legacy idx_chunk_document index, and stop dual-write
 *
 * Rollback (down): restores ON DELETE CASCADE, drops index + column. Safe
 * to run only BEFORE M2 ships (after M2, dropping file_key breaks readers).
 * Document this in the runbook.
 *
 * Transactional note: TypeORM wraps `up()` in a single transaction by default,
 * and PostgreSQL is fully transactional for DDL (ALTER TABLE, CREATE INDEX,
 * DROP/ADD CONSTRAINT). If the fail-loud check on step 3 throws, all earlier
 * steps roll back cleanly — re-running the migration is safe.
 *
 * Concurrency note: between step 2 (UPDATE) and step 3 (COUNT), a concurrent
 * INSERT from pre-deploy code (without the dual-write patch) would land with
 * NULL file_key and correctly trip the fail-loud check. New code emits with
 * file_key populated, so it cannot leave NULLs. M2 should re-verify the
 * backfill (SELECT COUNT(*) WHERE file_key IS NULL → 0) before switching
 * readers, as an extra safety net against late-arriving in-flight writes.
 */
export class AddFileKeyToDocumentChunks1782400000000 implements MigrationInterface {
  name = 'AddFileKeyToDocumentChunks1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add nullable column (idempotent — IF NOT EXISTS).
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "file_key" VARCHAR(512)`,
    );

    // 2. Backfill from document_metadata. Single UPDATE — the join column is
    //    indexed (PK on document_metadata.id) so this is bounded.
    await queryRunner.query(
      `UPDATE "document_chunks" AS "dc"
         SET "file_key" = "dm"."file_key"
        FROM "document_metadata" AS "dm"
       WHERE "dc"."document_id" = "dm"."id"
         AND "dc"."file_key" IS NULL`,
    );

    // 3. Fail-loud verification. If any chunk still has NULL file_key, the
    //    JOIN above missed it (orphan: chunk without matching metadata row).
    //    Aborting here keeps the deploy in a recoverable state — the column
    //    is added but readers haven't switched yet, so a rollback is just
    //    `down()`.
    const orphanRows = (await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM "document_chunks" WHERE "file_key" IS NULL`,
    )) as Array<{ count: number }>;
    const orphanCount = orphanRows[0]?.count ?? 0;
    if (orphanCount > 0) {
      throw new Error(
        `AddFileKeyToDocumentChunks: backfill left ${orphanCount} chunk(s) with NULL file_key. ` +
          `Inspect with: SELECT id, document_id FROM document_chunks WHERE file_key IS NULL; ` +
          `Either delete the orphan chunks or restore their parent document_metadata row, then re-run.`,
      );
    }

    // 4. Index for the M2 reader path (chunks-by-file_key).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chunk_file_key" ON "document_chunks" ("file_key")`,
    );

    // 5. Swap the FK from ON DELETE CASCADE → ON DELETE NO ACTION so chunks
    //    survive when one of multiple DocumentMetadata rows pointing at the
    //    same file_key is deleted. M3 will drop the column entirely.
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_document"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks"
        ADD CONSTRAINT "FK_document_chunks_document"
        FOREIGN KEY ("document_id") REFERENCES "document_metadata"("id")
        ON DELETE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore CASCADE first so the schema matches pre-M1 state.
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_document"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks"
        ADD CONSTRAINT "FK_document_chunks_document"
        FOREIGN KEY ("document_id") REFERENCES "document_metadata"("id")
        ON DELETE CASCADE`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chunk_file_key"`);
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP COLUMN IF EXISTS "file_key"`,
    );
  }
}
