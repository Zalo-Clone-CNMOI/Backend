import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationPinColumns1773500000000
  implements MigrationInterface
{
  name = 'AddConversationPinColumns1773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_members" ADD "is_pinned" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" ADD "pinned_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_members_is_pinned" ON "conversation_members" ("is_pinned")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_members_pinned_at" ON "conversation_members" ("pinned_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_members_pinned_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_members_is_pinned"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" DROP COLUMN "pinned_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" DROP COLUMN "is_pinned"`,
    );
  }
}
