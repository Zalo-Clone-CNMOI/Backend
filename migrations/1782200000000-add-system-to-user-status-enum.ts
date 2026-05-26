import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4 audit C2 — step 1 of 2.
 *
 * Add the 'system' value to the existing users_status_enum so that the
 * Zai bot (and future automated agents) can be tagged with a status
 * that's naturally excluded from queries filtering by ACTIVE.
 *
 * Why split from the UPDATE migration: PostgreSQL forbids using a newly
 * added enum value in the SAME transaction that added it ("New enum
 * values must be committed before they can be used"). TypeORM wraps
 * each migration in a transaction; splitting ensures the ADD VALUE
 * commits before the follow-up SetZaiUserStatusSystem migration runs
 * its UPDATE.
 *
 * IF NOT EXISTS makes this safe to replay against a DB where the value
 * has already been added by hand (operators who ran the SQL manually
 * during early Phase 4 deployment).
 */
export class AddSystemToUserStatusEnum1782200000000 implements MigrationInterface {
  name = 'AddSystemToUserStatusEnum1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_status_enum" ADD VALUE IF NOT EXISTS 'system'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove enum values without a full type rebuild,
    // and leaving the unused 'system' value is harmless. Intentionally
    // a no-op so `migration:revert` does not corrupt the type.
  }
}
