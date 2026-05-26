import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mark the Zai bot user with the new SYSTEM status so it is naturally
 * excluded from user-facing queries that filter by UserStatus.ACTIVE
 * (e.g., searchUsers, sendFriendRequest target validation).
 *
 * The Zai bot was originally seeded with status='active' by migration
 * AddZaiFoundation1782100000000. That migration is left immutable per
 * repo convention; this follow-up corrects the status.
 *
 * Constants are intentionally duplicated rather than imported so the
 * migration replays correctly against any future schema or enum changes.
 */
const ZAI_BOT_USER_ID = '00000000-0000-0000-0000-0000000000a1';

export class SetZaiUserStatusSystem1782200000000 implements MigrationInterface {
  name = 'SetZaiUserStatusSystem1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Extend the users_status_enum (created by 1768719874693-init-table)
    // with the new SYSTEM value before tagging the Zai bot.
    // IF NOT EXISTS guards against re-runs (e.g., partial-failure replay).
    await queryRunner.query(
      `ALTER TYPE "public"."users_status_enum" ADD VALUE IF NOT EXISTS 'system'`,
    );

    await queryRunner.query(
      `UPDATE "users" SET "status" = 'system' WHERE "id" = $1`,
      [ZAI_BOT_USER_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert Zai back to 'active' so user-facing queries still match it
    // under the old enum. We do NOT drop the 'system' value from the enum:
    // Postgres cannot remove enum values without a full type rebuild, and
    // leaving an unused value is harmless.
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'active' WHERE "id" = $1`,
      [ZAI_BOT_USER_ID],
    );
  }
}
