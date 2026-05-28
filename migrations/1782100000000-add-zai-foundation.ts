import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — Zai AI Conversation Foundation.
 *
 * (1) Adds a JSONB ai_context column to conversations for storing per-conversation
 *     AI feature metadata (e.g., which document this chat is about).
 * (2) Seeds the single Zai bot user with a fixed UUID so ai-core-service can
 *     publish messages on its behalf.
 *
 * Constants here are intentionally duplicated rather than imported — migrations
 * must be self-contained snapshots so they replay correctly against future schema.
 */

// Must match ZAI_BOT_USER_ID env default in libs/config/src/app-config.ts.
const ZAI_BOT_USER_ID = '00000000-0000-4000-8000-0000000000a1';

// Sentinel phone — intentionally not E.164 valid, so no real signup can collide.
const ZAI_PHONE = '+zai-system';

// Bcrypt cannot produce this string, so password verification always returns false.
const ZAI_PASSWORD_HASH = '!unreachable';

const ZAI_FULL_NAME = 'Zai';

// avatar_url is left null until the actual asset is uploaded to S3.
// Frontend handles null avatars by displaying an initials placeholder.
const ZAI_AVATAR_URL: string | null = null;

export class AddZaiFoundation1782100000000 implements MigrationInterface {
  name = 'AddZaiFoundation1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN "ai_context" jsonb`,
    );

    await queryRunner.query(
      `
      INSERT INTO "users" (
        "id", "phone", "password_hash", "full_name", "avatar_url",
        "status", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
      ON CONFLICT DO NOTHING
      `,
      [
        ZAI_BOT_USER_ID,
        ZAI_PHONE,
        ZAI_PASSWORD_HASH,
        ZAI_FULL_NAME,
        ZAI_AVATAR_URL,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ConversationMember.user FK is ON DELETE CASCADE → memberships cascade away.
    // Messages in ScyllaDB are not cleaned up (orphaned sender_id refs) — by design,
    // migrations only manage Postgres state.
    await queryRunner.query(`DELETE FROM "users" WHERE "id" = $1`, [
      ZAI_BOT_USER_ID,
    ]);

    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN "ai_context"`,
    );
  }
}
