import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 audit C2 — step 2 of 2.
 *
 * Tag the seeded Zai bot with the SYSTEM status added by the previous
 * migration (AddSystemToUserStatusEnum). Runs in its own transaction so
 * PostgreSQL can see the committed enum value (see step-1 docstring).
 *
 * Idempotent: the WHERE clause skips the row if it's already 'system',
 * so manual operators who ran the SQL by hand will get a no-op replay.
 *
 * Constants duplicated intentionally — migrations must be self-contained
 * snapshots so they replay correctly against any future enum or schema
 * change.
 */
const ZAI_BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';

export class SetZaiUserStatusSystem1782200000001 implements MigrationInterface {
  name = 'SetZaiUserStatusSystem1782200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'system' WHERE "id" = $1 AND "status" <> 'system'`,
      [ZAI_BOT_USER_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert Zai back to 'active' so user-facing queries that filter
    // status=ACTIVE pick it up again under the old behavior.
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'active' WHERE "id" = $1 AND "status" = 'system'`,
      [ZAI_BOT_USER_ID],
    );
  }
}
