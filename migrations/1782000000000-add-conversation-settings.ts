import { MigrationInterface, QueryRunner } from 'typeorm';

// Intentionally duplicated from @app/constant — migrations must be self-contained snapshots.
// Do NOT import from the library. If the default changes, write a new migration to UPDATE existing rows.
const DEFAULT_SETTINGS = JSON.stringify({
  permissions: {
    change_info: true,
    pin_message: true,
    create_note: true,
    create_poll: true,
    send_message: true,
  },
  policies: {
    join_approval: false,
    allow_read_history: true,
    allow_join_link: true,
  },
  features: {
    admin_tagging: true,
  },
});

export class AddConversationSettings1782000000000 implements MigrationInterface {
  name = 'AddConversationSettings1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN "settings" jsonb`,
    );
    // Backfill only group conversations — direct conversations remain null by design.
    await queryRunner.query(
      `UPDATE "conversations" SET "settings" = $1 WHERE "type" = 'group'`,
      [DEFAULT_SETTINGS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN "settings"`,
    );
  }
}
