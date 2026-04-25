import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCallSessions1777900000000 implements MigrationInterface {
  name = 'AddCallSessions1777900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "call_sessions" (
        "id"                VARCHAR(36)   NOT NULL,
        "conversation_id"   UUID          NOT NULL,
        "initiator_id"      UUID          NOT NULL,
        "call_type"         VARCHAR(10)   NOT NULL,
        "conversation_type" VARCHAR(10)   NOT NULL,
        "status"            VARCHAR(20)   NOT NULL,
        "started_at"        BIGINT        NOT NULL,
        "ended_at"          BIGINT,
        "duration_ms"       INTEGER,
        "participant_ids"   JSONB         NOT NULL DEFAULT '[]',
        "reason"            VARCHAR(50),
        "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_call_sessions_conversation_id" ON "call_sessions" ("conversation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_call_sessions_initiator_id" ON "call_sessions" ("initiator_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_call_sessions_started_at" ON "call_sessions" ("started_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_call_sessions_started_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_call_sessions_initiator_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_call_sessions_conversation_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "call_sessions"`);
  }
}
