import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Resizes the document_chunks embedding column from vector(1536) to vector(1024)
 * to support Voyage AI (voyage-3, 1024 dims) as the embedding provider.
 *
 * Safe to run with no data loss: document embedding has been non-functional
 * (no OpenAI key) so document_chunks is empty. The HNSW index is dropped
 * and recreated with the new dimension.
 *
 * Pre-condition: SELECT COUNT(*) FROM document_chunks must return 0.
 * If any rows exist, they were embedded with text-embedding-3-small (1536 dims)
 * and will be incompatible — delete them before running this migration.
 */
export class ResizeEmbeddingVector10241783000000000
  implements MigrationInterface
{
  name = 'ResizeEmbeddingVector10241783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM "document_chunks"`,
    )) as Array<{ count: number }>;
    const count = rows[0]?.count ?? 0;
    if (count > 0) {
      throw new Error(
        `ResizeEmbeddingVector1024: ${count} chunk(s) exist with the old 1536-dim vectors. ` +
          `Delete them first: TRUNCATE document_chunks;`,
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_document_chunks_embedding"`,
    );

    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP COLUMN "embedding"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(1024)`,
    );

    await queryRunner.query(`
      CREATE INDEX "idx_document_chunks_embedding"
        ON "document_chunks"
        USING hnsw ("embedding" vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_document_chunks_embedding"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP COLUMN "embedding"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(1536)`,
    );
    await queryRunner.query(`
      CREATE INDEX "idx_document_chunks_embedding"
        ON "document_chunks"
        USING hnsw ("embedding" vector_cosine_ops)
    `);
  }
}
