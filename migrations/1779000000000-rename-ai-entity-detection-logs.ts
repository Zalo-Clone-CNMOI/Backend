import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameAiEntityDetectionLogs1779000000000
  implements MigrationInterface
{
  name = 'RenameAiEntityDetectionLogs1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ai_entity_detection_logs" RENAME TO "m_ai_entity_detection_logs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" RENAME CONSTRAINT "PK_ai_entity_detection_logs" TO "PK_m_ai_entity_detection_logs"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_entity_detection_logs_message_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ai_entity_conversation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" DROP CONSTRAINT IF EXISTS "FK_ai_entity_detection_logs_sender"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_m_ai_entity_detection_logs_message_id" ON "m_ai_entity_detection_logs" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_m_ai_entity_detection_logs_sender_id" ON "m_ai_entity_detection_logs" ("sender_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_m_ai_entity_conversation" ON "m_ai_entity_detection_logs" ("conversation_id", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" ADD CONSTRAINT "FK_m_ai_entity_detection_logs_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" DROP CONSTRAINT IF EXISTS "FK_m_ai_entity_detection_logs_sender"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_m_ai_entity_conversation"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_m_ai_entity_detection_logs_sender_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_m_ai_entity_detection_logs_message_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" RENAME CONSTRAINT "PK_m_ai_entity_detection_logs" TO "PK_ai_entity_detection_logs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "m_ai_entity_detection_logs" RENAME TO "ai_entity_detection_logs"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_entity_detection_logs_message_id" ON "ai_entity_detection_logs" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ai_entity_conversation" ON "ai_entity_detection_logs" ("conversation_id", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_entity_detection_logs" ADD CONSTRAINT "FK_ai_entity_detection_logs_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }
}
