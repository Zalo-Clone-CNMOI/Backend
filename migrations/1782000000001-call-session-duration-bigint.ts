import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RC#21: widen call_sessions.duration_ms from INTEGER to BIGINT.
 * Int4 max ms ≈ 24.8 days; BIGINT prevents overflow on long-running calls
 * and keeps the column type consistent with started_at / ended_at (already BIGINT).
 */
export class CallSessionDurationBigint1782000000001
  implements MigrationInterface
{
  name = 'CallSessionDurationBigint1782000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_sessions" ALTER COLUMN "duration_ms" TYPE BIGINT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "call_sessions" ALTER COLUMN "duration_ms" TYPE INTEGER`,
    );
  }
}
