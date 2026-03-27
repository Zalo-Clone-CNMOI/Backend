import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { MediaFile } from '@libs/database';
import { S3Service } from '@libs/s3';

@Injectable()
export class OrphanedFileCleanupTask {
  private readonly logger = new Logger(OrphanedFileCleanupTask.name);
  private readonly STALE_HOURS = 24;
  private readonly BATCH_SIZE = 100;

  constructor(
    @InjectRepository(MediaFile)
    private readonly mediaFileRepo: Repository<MediaFile>,
    private readonly s3Service: S3Service,
  ) {}

  @Cron('0 3 * * *')
  async handleCleanup(): Promise<void> {
    this.logger.log('Starting orphaned file cleanup...');
    const cutoff = new Date(Date.now() - this.STALE_HOURS * 60 * 60 * 1000);
    let totalCleaned = 0;

    while (true) {
      const staleFiles = await this.mediaFileRepo.find({
        where: {
          status: 'pending' as const,
          createdAt: LessThan(cutoff),
        },
        take: this.BATCH_SIZE,
      });

      if (staleFiles.length === 0) break;

      for (const file of staleFiles) {
        try {
          await this.s3Service.delete(file.key);
          await this.mediaFileRepo.update(
            { id: file.id },
            { status: 'deleted' },
          );
          totalCleaned++;
        } catch (error) {
          this.logger.error(
            `Failed to clean key=${file.key}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }

    this.logger.log(`Cleanup complete: ${totalCleaned} files cleaned`);
  }
}
