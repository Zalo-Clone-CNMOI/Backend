import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCallSessions1777900000000 implements MigrationInterface {
  name = 'AddCallSessions1777900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."call_sessions_call_type_enum" AS ENUM ('audio', 'video')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."call_sessions_conversation_type_enum" AS ENUM ('direct', 'group')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."call_sessions_status_enum" AS ENUM ('completed', 'missed', 'rejected', 'timeout')`,
    );
    await queryRunner.query(`
      CREATE TABLE "call_sessions" (
        "id"                UUID                                          NOT NULL,
        "conversation_id"   UUID                                          NOT NULL,
        "initiator_id"      UUID                                          NOT NULL,
        "call_type"         "public"."call_sessions_call_type_enum"       NOT NULL,
        "conversation_type" "public"."call_sessions_conversation_type_enum" NOT NULL,
        "status"            "public"."call_sessions_status_enum"          NOT NULL,
        "started_at"        BIGINT        NOT NULL,
        "ended_at"          BIGINT,
        "duration_ms"       INTEGER,
        "participant_ids"   JSONB         NOT NULL DEFAULT '[]',
        "reason"            VARCHAR(50),
        "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_call_sessions_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_call_sessions_initiator" FOREIGN KEY ("initiator_id")
          REFERENCES "users"("id") ON DELETE CASCADE
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
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_sessions_started_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_sessions_initiator_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_call_sessions_conversation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_sessions" DROP CONSTRAINT IF EXISTS "FK_call_sessions_conversation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_sessions" DROP CONSTRAINT IF EXISTS "FK_call_sessions_initiator"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "call_sessions"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."call_sessions_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."call_sessions_conversation_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."call_sessions_call_type_enum"`,
    );
  }
}
