import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MediaFile } from '@libs/database';
import { S3_CONFIG, type S3Config } from '@libs/s3';
import { Inject } from '@nestjs/common';
import { inferMediaVisibility } from '@app/constant';
import {
  KafkaTopics,
  type MediaUploadRequestedEvent,
  type MediaUploadedEvent,
  type MediaThumbnailGeneratedEvent,
  type ChatMessageCreatedEvent,
} from '@libs/contracts';

@Controller()
export class MediaConsumer {
  private readonly logger = new Logger(MediaConsumer.name);

  constructor(
    @InjectRepository(MediaFile)
    private readonly mediaFileRepo: Repository<MediaFile>,
    @Inject(S3_CONFIG) private readonly s3Config: S3Config,
  ) {}

  @EventPattern(KafkaTopics.MediaUploadRequested)
  async onMediaUploadRequested(
    @Payload() event: MediaUploadRequestedEvent,
  ): Promise<void> {
    this.logger.log(`MediaUploadRequested: key=${event.key}`);

    try {
      const existing = await this.mediaFileRepo.findOne({
        where: { key: event.key },
      });
      if (existing) {
        this.logger.debug(
          `MediaFile already exists for key=${event.key}, skipping`,
        );
        return;
      }

      const mediaFile = this.mediaFileRepo.create({
        key: event.key,
        bucket: event.bucket,
        contentType: event.content_type,
        status: 'pending',
        visibility: event.visibility ?? 'public',
        uploadedById: event.requested_by_user_id ?? null,
        conversationId: null,
        sizeBytes: null,
        thumbnailKey: null,
      });

      await this.mediaFileRepo.save(mediaFile);
      this.logger.log(`MediaFile created (pending): key=${event.key}`);
    } catch (error) {
      this.logger.error(
        `Failed to persist MediaUploadRequested for key=${event.key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @EventPattern(KafkaTopics.MediaUploaded)
  async onMediaUploaded(@Payload() event: MediaUploadedEvent): Promise<void> {
    this.logger.log(`MediaUploaded: key=${event.key}`);

    try {
      const result = await this.mediaFileRepo.update(
        { key: event.key },
        { status: 'uploaded' },
      );

      if (result.affected === 0) {
        this.logger.warn(
          `No pending MediaFile found for key=${event.key}, creating uploaded record`,
        );
        const mediaFile = this.mediaFileRepo.create({
          key: event.key,
          bucket: event.bucket,
          status: 'uploaded',
          contentType: 'application/octet-stream',
          uploadedById: null,
          sizeBytes: null,
          conversationId: null,
          thumbnailKey: null,
          visibility: 'public',
        });
        await this.mediaFileRepo.save(mediaFile);
      }

      this.logger.log(`MediaFile status updated to uploaded: key=${event.key}`);
    } catch (error) {
      this.logger.error(
        `Failed to persist MediaUploaded for key=${event.key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @EventPattern(KafkaTopics.MediaThumbnailGenerated)
  async onMediaThumbnailGenerated(
    @Payload() event: MediaThumbnailGeneratedEvent,
  ): Promise<void> {
    this.logger.log(
      `MediaThumbnailGenerated: original=${event.original_key}, thumb=${event.thumbnail_key}`,
    );

    try {
      const result = await this.mediaFileRepo.update(
        { key: event.original_key },
        { thumbnailKey: event.thumbnail_key },
      );

      if (result.affected === 0) {
        this.logger.warn(
          `No MediaFile found for original_key=${event.original_key} to attach thumbnail`,
        );
      } else {
        this.logger.log(
          `Thumbnail attached: ${event.original_key} -> ${event.thumbnail_key}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to persist thumbnail for original_key=${event.original_key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @EventPattern(KafkaTopics.ChatMessageCreated)
  async onChatMessageCreated(
    @Payload() event: ChatMessageCreatedEvent,
  ): Promise<void> {
    if (!event.attachments || event.attachments.length === 0) {
      return;
    }

    this.logger.log(
      `ChatMessageCreated with ${event.attachments.length} attachment(s): msg=${event.message_id}`,
    );

    try {
      const keys = event.attachments.map((a) => a.key);
      const existingFiles = await this.mediaFileRepo.find({
        where: { key: In(keys) },
      });
      const existingMap = new Map(existingFiles.map((f) => [f.key, f]));

      for (const attachment of event.attachments) {
        try {
          const existing = existingMap.get(attachment.key);

          if (existing) {
            const updates: Partial<MediaFile> = {};
            if (!existing.conversationId) {
              updates.conversationId = event.conversation_id;
            }
            if (existing.status !== 'uploaded') {
              updates.status = 'uploaded';
            }
            if (!existing.sizeBytes && attachment.size) {
              updates.sizeBytes = attachment.size;
            }
            if (attachment.thumbnail_key && !existing.thumbnailKey) {
              updates.thumbnailKey = attachment.thumbnail_key;
            }
            if (attachment.visibility && !existing.visibility) {
              updates.visibility = attachment.visibility;
            }

            if (Object.keys(updates).length > 0) {
              await this.mediaFileRepo.update({ key: attachment.key }, updates);
              this.logger.debug(`Updated MediaFile for key=${attachment.key}`);
            }
          } else {
            const visibility =
              attachment.visibility ??
              inferMediaVisibility(attachment.content_type);
            const mediaFile = this.mediaFileRepo.create({
              key: attachment.key,
              bucket: this.s3Config.bucket,
              contentType: attachment.content_type,
              sizeBytes: attachment.size ?? null,
              uploadedById: event.sender_id,
              conversationId: event.conversation_id,
              status: 'uploaded',
              visibility,
              thumbnailKey: attachment.thumbnail_key ?? null,
            });
            await this.mediaFileRepo.save(mediaFile);
            this.logger.log(
              `MediaFile created from chat attachment: key=${attachment.key}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to track attachment key=${attachment.key} from msg=${event.message_id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to batch-fetch attachments for msg=${event.message_id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
