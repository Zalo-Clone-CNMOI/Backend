import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixInviteOwnershipIntegrity1777200000000 implements MigrationInterface {
  name = 'FixInviteOwnershipIntegrity1777200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ranked_owners AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY conversation_id
            ORDER BY joined_at ASC, id ASC
          ) AS rn
        FROM conversation_members
        WHERE role = 'owner' AND left_at IS NULL
      )
      UPDATE conversation_members
      SET role = 'admin'
      WHERE id IN (SELECT id FROM ranked_owners WHERE rn > 1)
    `);

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
