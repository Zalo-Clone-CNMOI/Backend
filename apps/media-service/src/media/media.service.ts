import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import { S3Service, S3_CLIENT, S3_CONFIG, type S3Config } from '@libs/s3';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  KafkaTopics,
  type MediaUploadRequestedEvent,
  type MediaUploadedEvent,
  type MediaThumbnailGeneratedEvent,
  type AiDocumentUploadEvent,
} from '@libs/contracts';
import type {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/presign-upload.dto';
import * as sharp from 'sharp';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private readonly THUMBNAIL_WIDTH = 300;
  private readonly THUMBNAIL_HEIGHT = 300;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly s3Service: S3Service,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_CONFIG) private readonly s3Config: S3Config,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async presignUpload(
    body: PresignUploadRequestDto,
    userId?: string,
  ): Promise<PresignUploadResponseDto> {
    const result = await this.s3Service.presignUpload(
      body.fileName ?? 'file',
      body.contentType,
    );

    const event: MediaUploadRequestedEvent = {
      key: result.key,
      bucket: result.bucket,
      content_type: body.contentType,
      requested_at: Date.now(),
      requested_by_user_id: userId,
    };

    this.kafka.emit(KafkaTopics.MediaUploadRequested, event);

    return result;
  }

  async confirmUploaded(
    key: string,
    contentType: string,
    userId?: string,
    conversationId?: string,
  ): Promise<{ thumbnailKey?: string }> {
    const event: MediaUploadedEvent = {
      key,
      bucket: this.s3Config.bucket,
      uploaded_at: Date.now(),
      trace_id: userId,
    };

    this.kafka.emit(KafkaTopics.MediaUploaded, event);

    if (conversationId && userId && this.isDocument(contentType)) {
      const docEvent: AiDocumentUploadEvent = {
        document_id: uuidv4(),
        conversation_id: conversationId,
        user_id: userId,
        file_key: key,
        file_name: key.split('/').pop() ?? key,
        file_size: 0,
        content_type: contentType,
        uploaded_at: Date.now(),
        trace_id: userId,
      };
      void this.kafka.emit(KafkaTopics.AiDocumentUpload, docEvent);
      this.logger.log(
        `AiDocumentUpload emitted for key=${key}, doc_id=${docEvent.document_id}`,
      );
    }

    if (this.isImage(contentType)) {
      try {
        const thumbnailKey = await this.generateImageThumbnail(key);
        return { thumbnailKey };
      } catch (error) {
        this.logger.error(`Failed to generate thumbnail for ${key}`, error);
      }
    }

    return {};
  }

  private isImage(contentType: string): boolean {
    return (
      contentType.startsWith('image/') &&
      !contentType.includes('gif') &&
      !contentType.includes('svg')
    );
  }

  private isDocument(contentType: string): boolean {
    const documentTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    ];
    return documentTypes.includes(contentType);
  }

  private async generateImageThumbnail(originalKey: string): Promise<string> {
    const getCmd = new GetObjectCommand({
      Bucket: this.s3Config.bucket,
      Key: originalKey,
    });

    const response = await this.s3.send(getCmd);

    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk) as Buffer);
    }

    const originalBuffer = Buffer.concat(chunks);

    const thumbnailBuffer = await sharp(originalBuffer)
      .resize(this.THUMBNAIL_WIDTH, this.THUMBNAIL_HEIGHT, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    const thumbnailKey = `thumbs/${originalKey}`;

    const putCmd = new PutObjectCommand({
      Bucket: this.s3Config.bucket,
      Key: thumbnailKey,
      Body: thumbnailBuffer,
      ContentType: 'image/jpeg',
    });

    await this.s3.send(putCmd);

    const thumbnailEvent: MediaThumbnailGeneratedEvent = {
      original_key: originalKey,
      thumbnail_key: thumbnailKey,
      bucket: this.s3Config.bucket,
      width: this.THUMBNAIL_WIDTH,
      height: this.THUMBNAIL_HEIGHT,
      generated_at: Date.now(),
    };

    this.kafka.emit(KafkaTopics.MediaThumbnailGenerated, thumbnailEvent);

    this.logger.log(`Generated thumbnail: ${thumbnailKey}`);

    return thumbnailKey;
  }
}
