import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  KafkaTopics,
  type MediaUploadRequestedEvent,
  type MediaUploadedEvent,
} from '@libs/contracts';
import type {
  PresignUploadRequestDto,
  PresignUploadResponseDto,
} from './dto/presign-upload.dto';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly s3: S3Client;

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {
    const region = process.env.AWS_REGION ?? 'ap-southeast-1';

    this.s3 = new S3Client({
      region,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle:
        (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
    });
  }

  async onModuleInit() {
    await this.kafka.connect();
  }

  async presignUpload(
    body: PresignUploadRequestDto,
    userId?: string,
  ): Promise<PresignUploadResponseDto> {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error('S3_BUCKET is required');
    }

    const expiresSeconds = Number(process.env.S3_PRESIGN_EXPIRES_SECONDS ?? 60);
    const prefix = process.env.S3_UPLOAD_PREFIX ?? 'uploads/';

    const id = uuidv4();
    const safeName = (body.fileName ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${id}-${safeName}`;

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: body.contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, cmd, {
      expiresIn: expiresSeconds,
    });
    const now = Date.now();

    const event: MediaUploadRequestedEvent = {
      key,
      bucket,
      content_type: body.contentType,
      requested_at: now,
      requested_by_user_id: userId,
    };

    this.kafka.emit(KafkaTopics.MediaUploadRequested, event);

    return {
      key,
      bucket,
      uploadUrl,
      expiresAt: now + expiresSeconds * 1000,
    };
  }

  confirmUploaded(key: string, userId?: string): void {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error('S3_BUCKET is required');
    }

    const event: MediaUploadedEvent = {
      key,
      bucket,
      uploaded_at: Date.now(),
      trace_id: userId,
    };

    void this.kafka.emit(KafkaTopics.MediaUploaded, event);
  }
}
