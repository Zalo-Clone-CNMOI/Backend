import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationPolls1777800000000 implements MigrationInterface {
  name = 'AddConversationPolls1777800000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TYPE "public"."conversation_polls_status_enum"
        AS ENUM ('active', 'closed');
    `);
    await qr.query(`
      CREATE TYPE "public"."conversation_polls_closed_reason_enum"
        AS ENUM ('by_creator', 'by_admin', 'expired');
    `);

    await qr.query(`
      CREATE TABLE "conversation_polls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "creator_id" uuid NOT NULL,
        "question" varchar(500) NOT NULL,
        "allow_multiple" boolean NOT NULL DEFAULT false,
        "allow_add_option" boolean NOT NULL DEFAULT false,
        "is_anonymous" boolean NOT NULL DEFAULT false,
        "status" "public"."conversation_polls_status_enum" NOT NULL DEFAULT 'active',
        "expires_at" TIMESTAMP NULL,
        "closed_at" TIMESTAMP NULL,
        "closed_by_user_id" uuid NULL,
        "closed_reason" "public"."conversation_polls_closed_reason_enum" NULL,
        "message_id" uuid NULL,
        "edited_at" TIMESTAMP NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP NULL,
        CONSTRAINT "PK_conversation_polls" PRIMARY KEY ("id"),
        CONSTRAINT "FK_polls_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_polls_creator" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_polls_closed_consistency"
          CHECK ((closed_at IS NULL) = (status = 'active'))
      );
    `);
    await qr.query(`CREATE INDEX "IDX_polls_conversation" ON "conversation_polls"("conversation_id")`);
    await qr.query(`CREATE INDEX "IDX_polls_creator" ON "conversation_polls"("creator_id")`);
    await qr.query(`CREATE INDEX "IDX_polls_status" ON "conversation_polls"("status")`);
    await qr.query(`CREATE INDEX "IDX_polls_expires" ON "conversation_polls"("expires_at")`);
    await qr.query(`CREATE INDEX "IDX_polls_message_id" ON "conversation_polls"("message_id")`);

    await qr.query(`
      CREATE TABLE "conversation_poll_options" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "poll_id" uuid NOT NULL,
        "label" varchar(200) NOT NULL,
        "order_index" integer NOT NULL,
        "added_by_user_id" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP NULL,
        CONSTRAINT "PK_conversation_poll_options" PRIMARY KEY ("id"),
        CONSTRAINT "FK_poll_options_poll" FOREIGN KEY ("poll_id") REFERENCES "conversation_polls"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_poll_options_label_length" CHECK (char_length(label) >= 1)
      );
    `);
    await qr.query(`CREATE INDEX "IDX_poll_options_poll" ON "conversation_poll_options"("poll_id")`);
    await qr.query(`
      CREATE UNIQUE INDEX "UQ_poll_options_label_active"
        ON "conversation_poll_options"("poll_id", "label")
        WHERE "deletedAt" IS NULL;
    `);

    await qr.query(`
      CREATE TABLE "conversation_poll_votes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "poll_id" uuid NOT NULL,
        "option_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "voted_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_poll_votes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_poll_votes_poll" FOREIGN KEY ("poll_id") REFERENCES "conversation_polls"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_poll_votes_option" FOREIGN KEY ("option_id") REFERENCES "conversation_poll_options"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_poll_votes_option_user" UNIQUE ("option_id", "user_id")
      );
    `);
    await qr.query(`CREATE INDEX "IDX_poll_votes_poll_user" ON "conversation_poll_votes"("poll_id","user_id")`);
    await qr.query(`CREATE INDEX "IDX_poll_votes_poll" ON "conversation_poll_votes"("poll_id")`);
    await qr.query(`CREATE INDEX "IDX_poll_votes_option" ON "conversation_poll_votes"("option_id")`);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS "conversation_poll_votes"`);
    await qr.query(`DROP TABLE IF EXISTS "conversation_poll_options"`);
    await qr.query(`DROP TABLE IF EXISTS "conversation_polls"`);
    await qr.query(`DROP TYPE IF EXISTS "public"."conversation_polls_closed_reason_enum"`);
    await qr.query(`DROP TYPE IF EXISTS "public"."conversation_polls_status_enum"`);
  }
}
