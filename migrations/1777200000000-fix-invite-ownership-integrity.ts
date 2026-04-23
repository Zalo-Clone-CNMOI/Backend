import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixInviteOwnershipIntegrity1777200000000
  implements MigrationInterface
{
  name = 'FixInviteOwnershipIntegrity1777200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversation_members_single_owner"
      ON "conversation_members" ("conversation_id")
      WHERE "role" = 'owner' AND "left_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_conversation_members_single_owner"`,
    );
  }
}
