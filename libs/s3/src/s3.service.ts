import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { S3_CLIENT, S3_CONFIG } from './s3.tokens';
import type { S3Config } from './s3.interfaces';
import { Readable } from 'stream';

export interface PresignUploadResult {
  key: string;
  bucket: string;
  uploadUrl: string;
  expiresAt: number;
}

export interface PresignDownloadResult {
  downloadUrl: string;
  expiresAt: number;
}

export interface UploadResult {
  key: string;
  bucket: string;
  url: string;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_CONFIG) private readonly config: S3Config,
  ) {}

  /**
   * Generate presigned URL for direct client upload
   */
  async presignUpload(
    fileName: string,
    contentType: string,
    options?: {
      bucket?: string;
      prefix?: string;
      expiresSeconds?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<PresignUploadResult> {
    const bucket = options?.bucket ?? this.config.bucket;
    const prefix = options?.prefix ?? this.config.uploadPrefix ?? 'uploads/';
    const expiresSeconds =
      options?.expiresSeconds ?? this.config.presignExpiresSeconds ?? 60;

    const id = uuidv4();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${id}-${safeName}`;

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Metadata: options?.metadata,
    });

    const uploadUrl = await getSignedUrl(this.s3, cmd, {
      expiresIn: expiresSeconds,
    });

    const now = Date.now();

    this.logger.log(`Presigned upload URL generated for key: ${key}`);

    return {
      key,
      bucket,
      uploadUrl,
      expiresAt: now + expiresSeconds * 1000,
    };
  }

  /**
   * Generate presigned URL for direct client download
   */
  async presignDownload(
    key: string,
    options?: {
      bucket?: string;
      expiresSeconds?: number;
    },
  ): Promise<PresignDownloadResult> {
    const bucket = options?.bucket ?? this.config.bucket;
    const expiresSeconds =
      options?.expiresSeconds ?? this.config.presignExpiresSeconds ?? 60;

    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const downloadUrl = await getSignedUrl(this.s3, cmd, {
      expiresIn: expiresSeconds,
    });

    const now = Date.now();

    return {
      downloadUrl,
      expiresAt: now + expiresSeconds * 1000,
    };
  }

  /**
   * Upload file directly from server
   */
  async upload(
    buffer: Buffer,
    fileName: string,
    contentType: string,
    options?: {
      bucket?: string;
      prefix?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<UploadResult> {
    const bucket = options?.bucket ?? this.config.bucket;
    const prefix = options?.prefix ?? this.config.uploadPrefix ?? 'uploads/';

    const id = uuidv4();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}${id}-${safeName}`;

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: options?.metadata,
    });

    await this.s3.send(cmd);

    this.logger.log(`File uploaded: ${key}`);

    return {
      key,
      bucket,
      url: this.getPublicUrl(key, bucket),
    };
  }

  /**
   * Download file from S3
   */
  async download(
    key: string,
    options?: {
      bucket?: string;
    },
  ): Promise<Buffer> {
    const bucket = options?.bucket ?? this.config.bucket;

    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3.send(cmd);

    if (!response.Body) {
      throw new Error(`Empty response body from S3 for key: ${key}`);
    }

    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Delete file from S3
   */
  async delete(
    key: string,
    options?: {
      bucket?: string;
    },
  ): Promise<void> {
    const bucket = options?.bucket ?? this.config.bucket;

    const cmd = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3.send(cmd);

    this.logger.log(`File deleted: ${key}`);
  }

  /**
   * Check if file exists in S3
   */
  async exists(
    key: string,
    options?: {
      bucket?: string;
    },
  ): Promise<boolean> {
    const bucket = options?.bucket ?? this.config.bucket;

    try {
      const cmd = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await this.s3.send(cmd);
      return true;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'name' in error) {
        if ((error as { name: string }).name === 'NotFound') {
          return false;
        }
      }
      throw error;
    }
  }

  /**
   * Get public URL for a key (if bucket is public)
   */
  getPublicUrl(key: string, bucket?: string): string {
    const bucketName = bucket ?? this.config.bucket;
    const endpoint = this.config.endpoint;

    if (endpoint) {
      return `${endpoint}/${bucketName}/${key}`;
    }

    const region = this.config.region ?? 'us-east-1';
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  }

  getClient(): S3Client {
    return this.s3;
  }
}
