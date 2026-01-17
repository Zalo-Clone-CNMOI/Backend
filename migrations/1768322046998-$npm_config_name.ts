import { MigrationInterface, QueryRunner } from "typeorm";

export class  $npmConfigName1768322046998 implements MigrationInterface {
    name = ' $npmConfigName1768322046998'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "device_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token" character varying(500) NOT NULL, "platform" character varying(20) NOT NULL, "device_id" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a070dfec1c8f06cd29b854169f2" UNIQUE ("user_id", "token"), CONSTRAINT "PK_84700be257607cfb1f9dc2e52c3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_17e1f528b993c6d55def4cf5be" ON "device_tokens" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_977e24c520c49436d08e5eeea8" ON "device_tokens" ("token") `);
        await queryRunner.query(`CREATE TABLE "media_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying(500) NOT NULL, "bucket" character varying(100) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" bigint, "uploaded_by" uuid, "conversation_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "uploaded_at" TIMESTAMP, CONSTRAINT "UQ_a1092d459371530ce0c10c20895" UNIQUE ("key"), CONSTRAINT "PK_93b4da6741cd150e76f9ac035d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_78f2e01705ad1a9b77ef3ee377" ON "media_files" ("uploaded_by") `);
        await queryRunner.query(`CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(20) NOT NULL DEFAULT 'direct', "name" character varying(255), "avatar_url" character varying(500), "created_by" uuid, "last_message_id" uuid, "last_message_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9185e4a10f53167d15f23e1720" ON "conversations" ("last_message_at") `);
        await queryRunner.query(`CREATE TABLE "conversation_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(20) NOT NULL DEFAULT 'member', "nickname" character varying(100), "is_muted" boolean NOT NULL DEFAULT false, "last_read_at" TIMESTAMP, "joined_at" TIMESTAMP NOT NULL DEFAULT now(), "left_at" TIMESTAMP, CONSTRAINT "UQ_5fa9076068b6f2a26fb793d2439" UNIQUE ("conversation_id", "user_id"), CONSTRAINT "PK_33146a476696a973a14d931e675" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_36340a1704b039608e34244511" ON "conversation_members" ("conversation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a46c76be8f62c4b00a835cdc37" ON "conversation_members" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6d78ef4bd19c3273104742c944" ON "conversation_members" ("left_at") `);
        await queryRunner.query(`CREATE TABLE "friendships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requester_id" uuid NOT NULL, "addressee_id" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2697f4d8948008ebd0784fe79c7" UNIQUE ("requester_id", "addressee_id"), CONSTRAINT "PK_08af97d0be72942681757f07bc8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4864bfab7fad9a34292e12bdb0" ON "friendships" ("status") `);
        await queryRunner.query(`CREATE TABLE "post_media" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "post_id" uuid NOT NULL, "media_url" character varying(500) NOT NULL, "media_type" character varying(20) NOT NULL, "thumbnail_url" character varying(500), "width" integer, "height" integer, "duration_seconds" integer, "display_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_049edb1ce7ab3d2a98009b171d0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f87ab15bafd1f147dd18774782" ON "post_media" ("display_order") `);
        await queryRunner.query(`CREATE TABLE "post_likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "post_id" uuid NOT NULL, "user_id" uuid NOT NULL, "reaction_type" character varying(20) NOT NULL DEFAULT 'like', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8f64693922a9e8c4e2605850d0b" UNIQUE ("post_id", "user_id"), CONSTRAINT "PK_e4ac7cb9daf243939c6eabb2e0d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b40d37469c501092203d285af8" ON "post_likes" ("post_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d5d98de2835a30ede2cf6fd06d" ON "post_likes" ("created_at") `);
        await queryRunner.query(`CREATE TABLE "comment_likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "comment_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_660059072f131c773be5f37c475" UNIQUE ("comment_id", "user_id"), CONSTRAINT "PK_2c299aaf1f903c45ee7e6c7b419" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2073bf518ef7017ec19319a65e" ON "comment_likes" ("comment_id") `);
        await queryRunner.query(`CREATE TABLE "post_comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "post_id" uuid NOT NULL, "user_id" uuid NOT NULL, "parent_comment_id" uuid, "content" text NOT NULL, "like_count" integer NOT NULL DEFAULT '0', "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2e99e04b4a1b31de6f833c18ced" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8eb985b7bd35fd7bc760b6cbe8" ON "post_comments" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_47e60da1f7aeb75961190bff75" ON "post_comments" ("parent_comment_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_1596a567d2049cee720f818e30" ON "post_comments" ("created_at") `);
        await queryRunner.query(`CREATE TABLE "posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "content" text, "visibility" character varying(20) NOT NULL DEFAULT 'friends', "like_count" integer NOT NULL DEFAULT '0', "comment_count" integer NOT NULL DEFAULT '0', "share_count" integer NOT NULL DEFAULT '0', "is_pinned" boolean NOT NULL DEFAULT false, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_60818528127866f5002e7f826d" ON "posts" ("created_at") `);
        await queryRunner.query(`CREATE TABLE "notification_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "push_enabled" boolean NOT NULL DEFAULT true, "sound_enabled" boolean NOT NULL DEFAULT true, "vibrate_enabled" boolean NOT NULL DEFAULT true, "show_preview" boolean NOT NULL DEFAULT true, "quiet_hours_start" TIME, "quiet_hours_end" TIME, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_64c90edc7310c6be7c10c96f675" UNIQUE ("user_id"), CONSTRAINT "REL_64c90edc7310c6be7c10c96f67" UNIQUE ("user_id"), CONSTRAINT "PK_e94e2b543f2f218ee68e4f4fad2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "notification_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "channel" character varying(20) NOT NULL, "provider" character varying(50) NOT NULL, "title" character varying(255), "body" text, "data" jsonb, "status" character varying(20) NOT NULL, "error_message" text, "sent_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_19c524e644cdeaebfcffc284871" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1a431dbf8e8336445526717401" ON "notification_logs" ("sent_at") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(20) NOT NULL, "email" character varying(255), "password_hash" character varying(255) NOT NULL, "full_name" character varying(255) NOT NULL, "avatar_url" character varying(500), "bio" character varying(500), "gender" character varying(10), "date_of_birth" date, "status" character varying(20) NOT NULL DEFAULT 'active', "last_seen_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a000cca60bcf04454e72769949" ON "users" ("phone") `);
        await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE INDEX "IDX_3676155292d72c67cd4e090514" ON "users" ("status") `);
        await queryRunner.query(`ALTER TABLE "device_tokens" ADD CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media_files" ADD CONSTRAINT "FK_78f2e01705ad1a9b77ef3ee3777" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "media_files" ADD CONSTRAINT "FK_21c0758119ae4c0ea4357809ab1" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_81d92d15c62b3fff79c617c9043" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_members" ADD CONSTRAINT "FK_36340a1704b039608e34244511f" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversation_members" ADD CONSTRAINT "FK_a46c76be8f62c4b00a835cdc370" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "friendships" ADD CONSTRAINT "FK_4cf3c68ed4a5a9fde8d4c2b7319" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "friendships" ADD CONSTRAINT "FK_01b0760fd2402d21f12c6dc5f89" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_media" ADD CONSTRAINT "FK_1eeb54a4fdfbe9db17899243cbe" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_likes" ADD CONSTRAINT "FK_b40d37469c501092203d285af80" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_likes" ADD CONSTRAINT "FK_9b9a7fc5eeff133cf71b8e06a7b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_2073bf518ef7017ec19319a65e5" FOREIGN KEY ("comment_id") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comment_likes" ADD CONSTRAINT "FK_bdba9a10c64ff58d36b09e3ac45" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_comments" ADD CONSTRAINT "FK_e8ffd07822f03f90f637b13cd59" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_comments" ADD CONSTRAINT "FK_8eb985b7bd35fd7bc760b6cbe8b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_comments" ADD CONSTRAINT "FK_47e60da1f7aeb75961190bff75d" FOREIGN KEY ("parent_comment_id") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "posts" ADD CONSTRAINT "FK_c4f9a7bd77b489e711277ee5986" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notification_preferences" ADD CONSTRAINT "FK_64c90edc7310c6be7c10c96f675" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notification_logs" ADD CONSTRAINT "FK_f803d5e1bd85942b24ee4248701" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notification_logs" DROP CONSTRAINT "FK_f803d5e1bd85942b24ee4248701"`);
        await queryRunner.query(`ALTER TABLE "notification_preferences" DROP CONSTRAINT "FK_64c90edc7310c6be7c10c96f675"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_c4f9a7bd77b489e711277ee5986"`);
        await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT "FK_47e60da1f7aeb75961190bff75d"`);
        await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT "FK_8eb985b7bd35fd7bc760b6cbe8b"`);
        await queryRunner.query(`ALTER TABLE "post_comments" DROP CONSTRAINT "FK_e8ffd07822f03f90f637b13cd59"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT "FK_bdba9a10c64ff58d36b09e3ac45"`);
        await queryRunner.query(`ALTER TABLE "comment_likes" DROP CONSTRAINT "FK_2073bf518ef7017ec19319a65e5"`);
        await queryRunner.query(`ALTER TABLE "post_likes" DROP CONSTRAINT "FK_9b9a7fc5eeff133cf71b8e06a7b"`);
        await queryRunner.query(`ALTER TABLE "post_likes" DROP CONSTRAINT "FK_b40d37469c501092203d285af80"`);
        await queryRunner.query(`ALTER TABLE "post_media" DROP CONSTRAINT "FK_1eeb54a4fdfbe9db17899243cbe"`);
        await queryRunner.query(`ALTER TABLE "friendships" DROP CONSTRAINT "FK_01b0760fd2402d21f12c6dc5f89"`);
        await queryRunner.query(`ALTER TABLE "friendships" DROP CONSTRAINT "FK_4cf3c68ed4a5a9fde8d4c2b7319"`);
        await queryRunner.query(`ALTER TABLE "conversation_members" DROP CONSTRAINT "FK_a46c76be8f62c4b00a835cdc370"`);
        await queryRunner.query(`ALTER TABLE "conversation_members" DROP CONSTRAINT "FK_36340a1704b039608e34244511f"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_81d92d15c62b3fff79c617c9043"`);
        await queryRunner.query(`ALTER TABLE "media_files" DROP CONSTRAINT "FK_21c0758119ae4c0ea4357809ab1"`);
        await queryRunner.query(`ALTER TABLE "media_files" DROP CONSTRAINT "FK_78f2e01705ad1a9b77ef3ee3777"`);
        await queryRunner.query(`ALTER TABLE "device_tokens" DROP CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3676155292d72c67cd4e090514"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a000cca60bcf04454e72769949"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1a431dbf8e8336445526717401"`);
        await queryRunner.query(`DROP TABLE "notification_logs"`);
        await queryRunner.query(`DROP TABLE "notification_preferences"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_60818528127866f5002e7f826d"`);
        await queryRunner.query(`DROP TABLE "posts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1596a567d2049cee720f818e30"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47e60da1f7aeb75961190bff75"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8eb985b7bd35fd7bc760b6cbe8"`);
        await queryRunner.query(`DROP TABLE "post_comments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2073bf518ef7017ec19319a65e"`);
        await queryRunner.query(`DROP TABLE "comment_likes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d5d98de2835a30ede2cf6fd06d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b40d37469c501092203d285af8"`);
        await queryRunner.query(`DROP TABLE "post_likes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f87ab15bafd1f147dd18774782"`);
        await queryRunner.query(`DROP TABLE "post_media"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4864bfab7fad9a34292e12bdb0"`);
        await queryRunner.query(`DROP TABLE "friendships"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6d78ef4bd19c3273104742c944"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a46c76be8f62c4b00a835cdc37"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36340a1704b039608e34244511"`);
        await queryRunner.query(`DROP TABLE "conversation_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9185e4a10f53167d15f23e1720"`);
        await queryRunner.query(`DROP TABLE "conversations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_78f2e01705ad1a9b77ef3ee377"`);
        await queryRunner.query(`DROP TABLE "media_files"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_977e24c520c49436d08e5eeea8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_17e1f528b993c6d55def4cf5be"`);
        await queryRunner.query(`DROP TABLE "device_tokens"`);
    }

}
