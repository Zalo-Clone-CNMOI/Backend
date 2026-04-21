import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaFilesVisibilityAndThumbnail1773600000000 implements MigrationInterface {
  name = 'AddMediaFilesVisibilityAndThumbnail1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media_files"
      ADD COLUMN IF NOT EXISTS "visibility" varchar(10) NOT NULL DEFAULT 'public'
    `);

    await queryRunner.query(`
      ALTER TABLE "media_files"
      ADD COLUMN IF NOT EXISTS "thumbnail_key" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "media_files"
      DROP COLUMN IF EXISTS "thumbnail_key"
    `);

    await queryRunner.query(`
      ALTER TABLE "media_files"
      DROP COLUMN IF EXISTS "visibility"
    `);
  }
}
