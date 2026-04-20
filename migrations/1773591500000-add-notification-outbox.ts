import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationOutbox1773591500000 implements MigrationInterface {
  name = 'AddNotificationOutbox1773591500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notification_outbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "producer" character varying(120) NOT NULL,
        "topic" character varying(120) NOT NULL,
        "payload" jsonb NOT NULL,
        "retry_count" integer NOT NULL DEFAULT 0,
        "first_failed_at" TIMESTAMP NOT NULL,
        "next_attempt_at" TIMESTAMP NOT NULL,
        "last_error" text,
        CONSTRAINT "PK_notification_outbox" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_producer" ON "notification_outbox" ("producer")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_topic" ON "notification_outbox" ("topic")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_next_attempt_at" ON "notification_outbox" ("next_attempt_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_producer_next_attempt_at" ON "notification_outbox" ("producer", "next_attempt_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_producer_next_attempt_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_next_attempt_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_topic"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_producer"`,
    );
    await queryRunner.query(`DROP TABLE "notification_outbox"`);
  }
}
