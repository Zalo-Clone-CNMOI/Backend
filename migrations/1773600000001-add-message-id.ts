import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageIdToConversationInvites1773600000000 implements MigrationInterface {
  name = 'AddMessageIdToConversationInvites1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add column
    await queryRunner.query(`
      ALTER TABLE "conversation_invites"
      ADD COLUMN "message_id" uuid NULL
    `);

    // 2. Add index
    await queryRunner.query(`
      CREATE INDEX "IDX_conversation_invites_message_id"
      ON "conversation_invites" ("message_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // rollback index trước
    await queryRunner.query(`
      DROP INDEX "IDX_conversation_invites_message_id"
    `);

    // rồi drop column
    await queryRunner.query(`
      ALTER TABLE "conversation_invites"
      DROP COLUMN "message_id"
    `);
  }
}