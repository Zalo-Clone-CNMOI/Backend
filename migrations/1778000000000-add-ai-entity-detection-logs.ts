import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiEntityDetectionLogs1778000000000 implements MigrationInterface {
  name = 'AddAiEntityDetectionLogs1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_entity_detection_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "message_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "entities" jsonb NOT NULL DEFAULT '[]',
        "provider" varchar(20) NOT NULL,
        "tokens_used" int NOT NULL DEFAULT 0,
        "trace_id" varchar(64),
        "processed_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_entity_detection_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_ai_entity_detection_logs_message_id" ON "ai_entity_detection_logs" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_entity_conversation" ON "ai_entity_detection_logs" ("conversation_id", "createdAt")`,
    );

    await queryRunner.query(`
      ALTER TABLE "ai_entity_detection_logs"
        ADD CONSTRAINT "FK_ai_entity_detection_logs_sender"
        FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_entity_detection_logs" DROP CONSTRAINT IF EXISTS "FK_ai_entity_detection_logs_sender"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_entity_conversation"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_entity_detection_logs_message_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_entity_detection_logs"`);
  }
}
