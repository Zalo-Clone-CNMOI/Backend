import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationInvites1773591400000 implements MigrationInterface {
  name = 'AddConversationInvites1773591400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."conversation_invites_status_enum" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'expired')`,
    );

    await queryRunner.query(`
      CREATE TABLE "conversation_invites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "conversation_id" uuid NOT NULL,
        "invited_user_id" uuid NOT NULL,
        "inviter_user_id" uuid NOT NULL,
        "status" "public"."conversation_invites_status_enum" NOT NULL DEFAULT 'pending',
        "message" varchar(500),
        "expires_at" TIMESTAMP NOT NULL,
        "responded_at" TIMESTAMP,
        CONSTRAINT "PK_conversation_invites" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_invites_conversation_id" ON "conversation_invites" ("conversation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_invites_invited_user_id" ON "conversation_invites" ("invited_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_invites_inviter_user_id" ON "conversation_invites" ("inviter_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_invites_status" ON "conversation_invites" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_invites_expires_at" ON "conversation_invites" ("expires_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_conversation_invites_active" ON "conversation_invites" ("conversation_id", "invited_user_id") WHERE "status" = 'pending' AND "deletedAt" IS NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "conversation_invites"
      ADD CONSTRAINT "FK_conversation_invites_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_invites"
      ADD CONSTRAINT "FK_conversation_invites_invited_user" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_invites"
      ADD CONSTRAINT "FK_conversation_invites_inviter_user" FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_invites" DROP CONSTRAINT "FK_conversation_invites_inviter_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_invites" DROP CONSTRAINT "FK_conversation_invites_invited_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_invites" DROP CONSTRAINT "FK_conversation_invites_conversation"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_conversation_invites_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_invites_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_invites_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_invites_inviter_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_invites_invited_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_invites_conversation_id"`,
    );

    await queryRunner.query(`DROP TABLE "conversation_invites"`);
    await queryRunner.query(
      `DROP TYPE "public"."conversation_invites_status_enum"`,
    );
  }
}
