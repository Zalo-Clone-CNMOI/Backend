import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceIvfflatWithHnsw1780000000000 implements MigrationInterface {
  name = 'ReplaceIvfflatWithHnsw1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_document_chunks_embedding"`,
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
    await queryRunner.query(`
      CREATE INDEX "idx_document_chunks_embedding"
        ON "document_chunks"
        USING ivfflat ("embedding" vector_cosine_ops)
        WITH (lists = 100)
    `);
  }
}
