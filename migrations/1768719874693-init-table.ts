import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTables1773478886753 implements MigrationInterface {
  name = 'InitTables1773478886753';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension for document_chunks embedding column
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
    );
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS vector`,
    );

    // Create enum types
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'inactive', 'suspended', 'deleted')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversation_members_role_enum" AS ENUM('owner', 'admin', 'member')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."friendships_status_enum" AS ENUM('pending', 'accepted', 'blocked')`,
    );

    // 1. users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "phone" varchar(20) NOT NULL,
        "email" varchar(255),
        "password_hash" varchar(255) NOT NULL,
        "full_name" varchar(255) NOT NULL,
        "avatar_url" varchar(500),
        "bio" varchar(500),
        "gender" varchar(10),
        "date_of_birth" date,
        "status" "public"."users_status_enum" NOT NULL DEFAULT 'active',
        "last_seen_at" TIMESTAMP,
        CONSTRAINT "UQ_users_phone" UNIQUE ("phone"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_users_phone" ON "users" ("phone")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_status" ON "users" ("status")`);

    // 2. conversations
    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "type" varchar(20) NOT NULL DEFAULT 'direct',
        "name" varchar(255),
        "avatar_url" varchar(500),
        "created_by" uuid,
        "last_message_id" uuid,
        "last_message_at" TIMESTAMP,
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_conversations_last_message_at" ON "conversations" ("last_message_at")`);

    // 3. conversation_members
    await queryRunner.query(`
      CREATE TABLE "conversation_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" "public"."conversation_members_role_enum" NOT NULL DEFAULT 'member',
        "nickname" varchar(100),
        "is_muted" boolean NOT NULL DEFAULT false,
        "last_read_at" TIMESTAMP,
        "joined_at" TIMESTAMP NOT NULL DEFAULT now(),
        "left_at" TIMESTAMP,
        CONSTRAINT "UQ_conversation_members_conv_user" UNIQUE ("conversation_id", "user_id"),
        CONSTRAINT "PK_conversation_members" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_conversation_members_conversation_id" ON "conversation_members" ("conversation_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_conversation_members_user_id" ON "conversation_members" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_conversation_members_left_at" ON "conversation_members" ("left_at")`);

    // 4. friendships
    await queryRunner.query(`
      CREATE TABLE "friendships" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "requester_id" uuid NOT NULL,
        "addressee_id" uuid NOT NULL,
        "status" "public"."friendships_status_enum" NOT NULL DEFAULT 'pending',
        CONSTRAINT "UQ_friendships_requester_addressee" UNIQUE ("requester_id", "addressee_id"),
        CONSTRAINT "PK_friendships" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_friendships_status" ON "friendships" ("status")`);

    // 5. device_tokens
    await queryRunner.query(`
      CREATE TABLE "device_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "token" varchar(500) NOT NULL,
        "platform" varchar(20) NOT NULL,
        "device_id" varchar(255),
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_device_tokens_user_token" UNIQUE ("user_id", "token"),
        CONSTRAINT "PK_device_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_device_tokens_user_id" ON "device_tokens" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_device_tokens_token" ON "device_tokens" ("token")`);

    // 6. media_files
    await queryRunner.query(`
      CREATE TABLE "media_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "key" varchar(500) NOT NULL,
        "bucket" varchar(100) NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "size_bytes" bigint,
        "uploaded_by" uuid,
        "conversation_id" uuid,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        CONSTRAINT "UQ_media_files_key" UNIQUE ("key"),
        CONSTRAINT "PK_media_files" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_media_files_uploaded_by" ON "media_files" ("uploaded_by")`);

    // 7. posts
    await queryRunner.query(`
      CREATE TABLE "posts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "content" text,
        "visibility" varchar(20) NOT NULL DEFAULT 'friends',
        "like_count" int NOT NULL DEFAULT 0,
        "comment_count" int NOT NULL DEFAULT 0,
        "share_count" int NOT NULL DEFAULT 0,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "is_deleted" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_posts" PRIMARY KEY ("id")
      )
    `);

    // 8. post_media
    await queryRunner.query(`
      CREATE TABLE "post_media" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "post_id" uuid NOT NULL,
        "media_url" varchar(500) NOT NULL,
        "media_type" varchar(20) NOT NULL,
        "thumbnail_url" varchar(500),
        "width" int,
        "height" int,
        "duration_seconds" int,
        "display_order" int NOT NULL DEFAULT 0,
        CONSTRAINT "PK_post_media" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_post_media_display_order" ON "post_media" ("display_order")`);

    // 9. post_likes
    await queryRunner.query(`
      CREATE TABLE "post_likes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "post_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "reaction_type" varchar(20) NOT NULL DEFAULT 'like',
        CONSTRAINT "UQ_post_likes_post_user" UNIQUE ("post_id", "user_id"),
        CONSTRAINT "PK_post_likes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_post_likes_post_id" ON "post_likes" ("post_id")`);

    // 10. post_comments
    await queryRunner.query(`
      CREATE TABLE "post_comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "post_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "parent_comment_id" uuid,
        "content" text NOT NULL,
        "like_count" int NOT NULL DEFAULT 0,
        "is_deleted" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_post_comments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_post_comments_user_id" ON "post_comments" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_post_comments_parent_comment_id" ON "post_comments" ("parent_comment_id")`);

    // 11. comment_likes
    await queryRunner.query(`
      CREATE TABLE "comment_likes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "comment_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "UQ_comment_likes_comment_user" UNIQUE ("comment_id", "user_id"),
        CONSTRAINT "PK_comment_likes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_comment_likes_comment_id" ON "comment_likes" ("comment_id")`);

    // 12. notification_preferences
    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "push_enabled" boolean NOT NULL DEFAULT true,
        "sound_enabled" boolean NOT NULL DEFAULT true,
        "vibrate_enabled" boolean NOT NULL DEFAULT true,
        "show_preview" boolean NOT NULL DEFAULT true,
        "quiet_hours_start" time,
        "quiet_hours_end" time,
        CONSTRAINT "UQ_notification_preferences_user_id" UNIQUE ("user_id"),
        CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id")
      )
    `);

    // 13. notification_logs
    await queryRunner.query(`
      CREATE TABLE "notification_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "channel" varchar(20) NOT NULL,
        "provider" varchar(50) NOT NULL,
        "title" varchar(255),
        "body" text,
        "data" jsonb,
        "status" varchar(20) NOT NULL,
        "error_message" text,
        "sent_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_notification_logs_sent_at" ON "notification_logs" ("sent_at")`);

    // 14. document_metadata
    await queryRunner.query(`
      CREATE TABLE "document_metadata" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "file_key" varchar(512) NOT NULL,
        "file_name" varchar(255) NOT NULL,
        "file_size" int NOT NULL,
        "content_type" varchar(100) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "chunk_count" int NOT NULL DEFAULT 0,
        "total_tokens" int NOT NULL DEFAULT 0,
        "page_count" int,
        "error_message" text,
        "embedding_model" varchar(50),
        "embedding_version" int NOT NULL DEFAULT 1,
        CONSTRAINT "PK_document_metadata" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_document_conversation" ON "document_metadata" ("conversation_id")`);
    await queryRunner.query(`CREATE INDEX "idx_document_user" ON "document_metadata" ("user_id")`);

    // 15. document_chunks
    await queryRunner.query(`
      CREATE TABLE "document_chunks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "document_id" uuid NOT NULL,
        "chunk_index" int NOT NULL,
        "content" text NOT NULL,
        "token_count" int NOT NULL DEFAULT 0,
        "embedding" vector(1536),
        "embedding_model" varchar(50),
        "embedding_version" int NOT NULL DEFAULT 1,
        "page_number" int,
        CONSTRAINT "PK_document_chunks" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_chunk_document" ON "document_chunks" ("document_id")`);

    // 16. ai_moderation_logs
    await queryRunner.query(`
      CREATE TABLE "ai_moderation_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "message_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "is_flagged" boolean NOT NULL DEFAULT false,
        "labels" text,
        "confidence" float NOT NULL DEFAULT 0,
        "provider" varchar(20) NOT NULL,
        "ensemble" boolean NOT NULL DEFAULT false,
        "tokens_used" int NOT NULL DEFAULT 0,
        "trace_id" varchar(64),
        "processed_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_moderation_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ai_moderation_logs_message_id" ON "ai_moderation_logs" ("message_id")`);
    await queryRunner.query(`CREATE INDEX "idx_ai_moderation_conversation" ON "ai_moderation_logs" ("conversation_id", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "idx_ai_moderation_flagged" ON "ai_moderation_logs" ("is_flagged", "createdAt")`);

    // 17. ai_usage_logs
    await queryRunner.query(`
      CREATE TABLE "ai_usage_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "feature" varchar(30) NOT NULL,
        "provider" varchar(20) NOT NULL,
        "model" varchar(50),
        "tokens_in" int NOT NULL DEFAULT 0,
        "tokens_out" int NOT NULL DEFAULT 0,
        "total_tokens" int NOT NULL DEFAULT 0,
        "estimated_cost_usd" decimal(10,6) NOT NULL DEFAULT 0,
        "latency_ms" int NOT NULL DEFAULT 0,
        "success" boolean NOT NULL DEFAULT true,
        "error_message" text,
        "trace_id" varchar(64),
        CONSTRAINT "PK_ai_usage_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_ai_usage_user_date" ON "ai_usage_logs" ("user_id", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "idx_ai_usage_feature" ON "ai_usage_logs" ("feature", "createdAt")`);

    // ===== FOREIGN KEYS =====

    // conversations.created_by -> users.id
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD CONSTRAINT "FK_conversations_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // conversation_members.conversation_id -> conversations.id
    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        ADD CONSTRAINT "FK_conversation_members_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
    `);

    // conversation_members.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        ADD CONSTRAINT "FK_conversation_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // friendships.requester_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "friendships"
        ADD CONSTRAINT "FK_friendships_requester" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // friendships.addressee_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "friendships"
        ADD CONSTRAINT "FK_friendships_addressee" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // device_tokens.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "device_tokens"
        ADD CONSTRAINT "FK_device_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // media_files.uploaded_by -> users.id
    await queryRunner.query(`
      ALTER TABLE "media_files"
        ADD CONSTRAINT "FK_media_files_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // media_files.conversation_id -> conversations.id
    await queryRunner.query(`
      ALTER TABLE "media_files"
        ADD CONSTRAINT "FK_media_files_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL
    `);

    // posts.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "posts"
        ADD CONSTRAINT "FK_posts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // post_media.post_id -> posts.id
    await queryRunner.query(`
      ALTER TABLE "post_media"
        ADD CONSTRAINT "FK_post_media_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE
    `);

    // post_likes.post_id -> posts.id
    await queryRunner.query(`
      ALTER TABLE "post_likes"
        ADD CONSTRAINT "FK_post_likes_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE
    `);

    // post_likes.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "post_likes"
        ADD CONSTRAINT "FK_post_likes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // post_comments.post_id -> posts.id
    await queryRunner.query(`
      ALTER TABLE "post_comments"
        ADD CONSTRAINT "FK_post_comments_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE
    `);

    // post_comments.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "post_comments"
        ADD CONSTRAINT "FK_post_comments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // post_comments.parent_comment_id -> post_comments.id (self-referencing)
    await queryRunner.query(`
      ALTER TABLE "post_comments"
        ADD CONSTRAINT "FK_post_comments_parent" FOREIGN KEY ("parent_comment_id") REFERENCES "post_comments"("id") ON DELETE CASCADE
    `);

    // comment_likes.comment_id -> post_comments.id
    await queryRunner.query(`
      ALTER TABLE "comment_likes"
        ADD CONSTRAINT "FK_comment_likes_comment" FOREIGN KEY ("comment_id") REFERENCES "post_comments"("id") ON DELETE CASCADE
    `);

    // comment_likes.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "comment_likes"
        ADD CONSTRAINT "FK_comment_likes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // notification_preferences.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "notification_preferences"
        ADD CONSTRAINT "FK_notification_preferences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // notification_logs.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "notification_logs"
        ADD CONSTRAINT "FK_notification_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // document_metadata.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "document_metadata"
        ADD CONSTRAINT "FK_document_metadata_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // document_chunks.document_id -> document_metadata.id
    await queryRunner.query(`
      ALTER TABLE "document_chunks"
        ADD CONSTRAINT "FK_document_chunks_document" FOREIGN KEY ("document_id") REFERENCES "document_metadata"("id") ON DELETE CASCADE
    `);

    // ai_moderation_logs.sender_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "ai_moderation_logs"
        ADD CONSTRAINT "FK_ai_moderation_logs_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // ai_usage_logs.user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE "ai_usage_logs"
        ADD CONSTRAINT "FK_ai_usage_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // IVFFlat index for vector similarity search on document_chunks
    await queryRunner.query(`
      CREATE INDEX "idx_document_chunks_embedding" ON "document_chunks"
        USING ivfflat ("embedding" vector_cosine_ops)
        WITH (lists = 100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop IVFFlat index
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_chunks_embedding"`);

    // Drop all foreign keys
    await queryRunner.query(`ALTER TABLE "ai_usage_logs" DROP CONSTRAINT IF EXISTS "FK_ai_usage_logs_user"`);
    await queryRunner.query(`ALTER TABLE "ai_moderation_logs" DROP CONSTRAINT IF EXISTS "FK_ai_moderation_logs_sender"`);
    await queryRunner.query(`ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "FK_document_chunks_document"`);
    await queryRunner.query(`ALTER TABLE "document_metadata" DROP CONSTRAINT IF EXISTS "FK_document_metadata_user"`);
    await queryRunner.query(`ALTER TABLE "notification_logs" DROP CONSTRAINT IF EXISTS "FK_notification_logs_user"`);
    await queryRunner.query(`ALTER TABLE "notification_preferences" DROP CONSTRAINT IF EXISTS "FK_notification_preferences_user"`);
    await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT IF EXISTS "FK_comment_likes_user"`);
    await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT IF EXISTS "FK_comment_likes_comment"`);
    await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT IF EXISTS "FK_post_comments_parent"`);
    await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT IF EXISTS "FK_post_comments_user"`);
    await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT IF EXISTS "FK_post_comments_post"`);
    await queryRunner.query(`ALTER TABLE "post_likes" DROP CONSTRAINT IF EXISTS "FK_post_likes_user"`);
    await queryRunner.query(`ALTER TABLE "post_likes" DROP CONSTRAINT IF EXISTS "FK_post_likes_post"`);
    await queryRunner.query(`ALTER TABLE "post_media" DROP CONSTRAINT IF EXISTS "FK_post_media_post"`);
    await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "FK_posts_user"`);
    await queryRunner.query(`ALTER TABLE "media_files" DROP CONSTRAINT IF EXISTS "FK_media_files_conversation"`);
    await queryRunner.query(`ALTER TABLE "media_files" DROP CONSTRAINT IF EXISTS "FK_media_files_uploaded_by"`);
    await queryRunner.query(`ALTER TABLE "device_tokens" DROP CONSTRAINT IF EXISTS "FK_device_tokens_user"`);
    await queryRunner.query(`ALTER TABLE "friendships" DROP CONSTRAINT IF EXISTS "FK_friendships_addressee"`);
    await queryRunner.query(`ALTER TABLE "friendships" DROP CONSTRAINT IF EXISTS "FK_friendships_requester"`);
    await queryRunner.query(`ALTER TABLE "conversation_members" DROP CONSTRAINT IF EXISTS "FK_conversation_members_user"`);
    await queryRunner.query(`ALTER TABLE "conversation_members" DROP CONSTRAINT IF EXISTS "FK_conversation_members_conversation"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "FK_conversations_created_by"`);

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_usage_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_moderation_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_chunks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_metadata"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comment_likes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_likes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post_media"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "media_files"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "friendships"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."friendships_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."conversation_members_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_status_enum"`);
  }
}
