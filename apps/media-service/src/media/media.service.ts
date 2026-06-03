import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { ClientKafka } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KAFKA_CLIENT } from '@libs/kafka';
import { S3Service, S3_CLIENT, S3_CONFIG, type S3Config } from '@libs/s3';
import { ConversationMembershipService } from '@libs/mvp-access';
import { DocumentMetadata, MediaFile } from '@libs/database';
import { isDocumentMime } from '@libs/shared';
import { inferMediaVisibility } from '@app/constant';
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
import type { PresignDownloadResponseDto } from './dto/presign-download.dto';
import type {
  CloneAttachmentRequestDto,
  CloneAttachmentResponseDto,
} from './dto/clone-attachment.dto';
import sharp from 'sharp';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private readonly THUMBNAIL_WIDTH = 300;
  private readonly THUMBNAIL_HEIGHT = 300;
  private readonly DOWNLOAD_EXPIRES_SECONDS = Number(
    process.env.MEDIA_DOWNLOAD_EXPIRES_SECONDS ?? 900,
  );

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly s3Service: S3Service,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_CONFIG) private readonly s3Config: S3Config,
    @InjectRepository(MediaFile)
    private readonly mediaFileRepo: Repository<MediaFile>,
    @InjectRepository(DocumentMetadata)
    private readonly documentMetadataRepo: Repository<DocumentMetadata>,
    private readonly membershipService: ConversationMembershipService,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async validateAttachments(
    keys: string[],
    userId: string,
  ): Promise<string | null> {
    if (!keys.length) return null;

    const files = await this.mediaFileRepo.find({
      where: { key: In(keys) },
      select: ['key', 'uploadedById', 'status'],
    });
    const fileMap = new Map(files.map((f) => [f.key, f]));

    for (const key of keys) {
      const file = fileMap.get(key);
      if (!file) return 'attachment_not_found';
      if (!file.uploadedById || file.uploadedById.trim() === '') {
        return 'attachment_not_owned';
      }
      if (file.uploadedById !== userId) return 'attachment_not_owned';
      if (file.status !== 'uploaded') return 'attachment_not_ready';
    }
    return null;
  }

  async canUserAccessFile(key: string, userId: string): Promise<boolean> {
    const file = await this.mediaFileRepo.findOne({ where: { key } });
    if (!file) return false;
    if (file.visibility === 'public') return true;
    if (file.uploadedById === userId) return true;
    if (file.conversationId) {
      return this.membershipService.canUserAccessConversation(
        userId,
        file.conversationId,
      );
    }
    return false;
  }

  async cloneAttachment(
    dto: CloneAttachmentRequestDto,
    userId: string,
  ): Promise<CloneAttachmentResponseDto> {
    const sourceFile = await this.mediaFileRepo.findOne({
      where: { key: dto.source_key },
    });
    if (!sourceFile) {
      throw new BadRequestException(`Source file not found: ${dto.source_key}`);
    }

    const canAccess = await this.canUserAccessFile(dto.source_key, userId);
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this file');
    }

    if (dto.conversation_id) {
      const canAccessDest =
        await this.membershipService.canUserAccessConversation(
          userId,
          dto.conversation_id,
        );
      if (!canAccessDest) {
        throw new ForbiddenException(
          'You do not have access to the destination conversation',
        );
      }
    }

    const prefix = sourceFile.visibility === 'public' ? 'public/' : 'private/';
    const clonedKey = `${prefix}fwd-${uuidv4()}`;

    await this.s3Service.copy(dto.source_key, clonedKey);

    const clonedFile = this.mediaFileRepo.create({
      key: clonedKey,
      bucket: this.s3Config.bucket,
      contentType: sourceFile.contentType,
      status: 'uploaded' as const,
      visibility: sourceFile.visibility,
      uploadedById: userId,
      conversationId: dto.conversation_id ?? null,
      sizeBytes: sourceFile.sizeBytes,
      thumbnailKey: null,
    });
    await this.mediaFileRepo.save(clonedFile);

    this.logger.log(`Attachment cloned: ${dto.source_key} → ${clonedKey}`);

    return {
      cloned_key: clonedKey,
      visibility: sourceFile.visibility,
      content_type: sourceFile.contentType,
      size_bytes: sourceFile.sizeBytes,
    };
  }

  async presignUpload(
    body: PresignUploadRequestDto,
    userId?: string,
  ): Promise<PresignUploadResponseDto> {
    const visibility = inferMediaVisibility(body.contentType);
    const prefix = visibility === 'public' ? 'public/' : 'private/';

    const result = await this.s3Service.presignUpload(
      body.fileName ?? 'file',
      body.contentType,
      { prefix },
    );

    const event: MediaUploadRequestedEvent = {
      key: result.key,
      bucket: result.bucket,
      content_type: body.contentType,
      visibility,
      requested_at: Date.now(),
      requested_by_user_id: userId,
    };

    this.kafka.emit(KafkaTopics.MediaUploadRequested, event);

    return { ...result, visibility };
  }

  async presignDownload(key: string): Promise<PresignDownloadResponseDto> {
    return this.s3Service.presignDownload(key, {
      expiresSeconds: this.DOWNLOAD_EXPIRES_SECONDS,
    });
  }

  async confirmUploaded(
    key: string,
    contentType: string,
    userId?: string,
    conversationId?: string,
  ): Promise<{ thumbnailKey?: string; documentId?: string }> {
    const fileExists = await this.s3Service.exists(key);
    if (!fileExists) {
      this.logger.warn(
        `confirmUploaded rejected: file not found on S3 key=${key}`,
      );
      throw new BadRequestException(`File not found on S3: ${key}`);
    }
    const visibility = inferMediaVisibility(contentType);
    const existingFile = await this.mediaFileRepo.findOne({
      where: { key },
    });

    if (existingFile) {
      Object.assign(existingFile, {
        bucket: existingFile.bucket ?? this.s3Config.bucket,
        contentType,
        status: 'uploaded',
        visibility,
        uploadedById: userId ?? existingFile.uploadedById ?? null,
        conversationId: conversationId ?? existingFile.conversationId ?? null,
        sizeBytes: existingFile.sizeBytes ?? null,
        thumbnailKey: existingFile.thumbnailKey ?? null,
      });
      await this.mediaFileRepo.save(existingFile);
    } else {
      const mediaFile = this.mediaFileRepo.create({
        key,
        bucket: this.s3Config.bucket,
        contentType,
        status: 'uploaded',
        visibility,
        uploadedById: userId ?? null,
        conversationId: conversationId ?? null,
        sizeBytes: null,
        thumbnailKey: null,
      });
      await this.mediaFileRepo.save(mediaFile);
    }

    this.logger.log(`MediaFile upserted to uploaded (sync): key=${key}`);

    const event: MediaUploadedEvent = {
      key,
      bucket: this.s3Config.bucket,
      uploaded_at: Date.now(),
      trace_id: userId,
    };

    this.kafka.emit(KafkaTopics.MediaUploaded, event);

    const documentId = await this.maybePersistDocumentMetadata({
      key,
      contentType,
      userId,
      conversationId,
    });

    if (this.isImage(contentType)) {
      try {
        const thumbnailKey = await this.generateImageThumbnail(key);
        return { thumbnailKey, documentId };
      } catch (error) {
        this.logger.error(`Failed to generate thumbnail for ${key}`, error);
      }
    }

    return { documentId };
  }

  private isImage(contentType: string): boolean {
    return (
      contentType.startsWith('image/') &&
      !contentType.includes('gif') &&
      !contentType.includes('svg')
    );
  }

  /**
   * For document uploads inside a conversation, persist a DocumentMetadata
   * row (status='pending') and emit the AiDocumentUpload Kafka event so the
   * AI core can ingest the file. Returns the persisted row's id to the
   * caller — needed by FE to immediately open a Zai document chat without
   * racing the async ingest consumer.
   *
   * Idempotency: pre-flight `findOne` plus a unique constraint on
   * (file_key, user_id, conversation_id) catches duplicate confirmUpload
   * calls from retries or concurrent FE taps.
   *
   * Authorization: callers may only persist document rows for conversations
   * they are a member of. Silently skips otherwise (no exception — the
   * upload itself still succeeds, just no AI ingest is triggered).
   */
  private async maybePersistDocumentMetadata(input: {
    key: string;
    contentType: string;
    userId?: string;
    conversationId?: string;
  }): Promise<string | undefined> {
    const { key, contentType, userId, conversationId } = input;
    if (!conversationId || !userId || !isDocumentMime(contentType)) {
      return undefined;
    }

    // W5: only members of the target conversation can anchor a document
    // chat to it. Skip silently if not a member — the media upload itself
    // is unaffected.
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      conversationId,
    );
    if (!canAccess) {
      this.logger.warn(
        `Document metadata skipped: user=${userId} is not a member of conversation=${conversationId}`,
      );
      return undefined;
    }

    const existingDoc = await this.documentMetadataRepo.findOne({
      where: { fileKey: key, userId, conversationId },
    });
    if (existingDoc) {
      this.logger.log(
        `Existing DocumentMetadata reused for key=${key}, doc_id=${existingDoc.id}`,
      );
      return existingDoc.id;
    }

    let fileSize = 0;
    try {
      const headResult = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.s3Config.bucket, Key: key }),
      );
      fileSize = headResult.ContentLength ?? 0;
    } catch (err) {
      this.logger.warn(
        `Could not fetch file size via HEAD for bucket=${this.s3Config.bucket}, key=${key}: ${String(err)}`,
      );
    }
    const fileName = key.split('/').pop() ?? key;

    let documentId: string;
    try {
      const savedDoc = await this.documentMetadataRepo.save(
        this.documentMetadataRepo.create({
          conversationId,
          userId,
          fileKey: key,
          fileName,
          fileSize,
          contentType,
          status: 'pending',
        }),
      );
      documentId = savedDoc.id;
    } catch (err) {
      // C1: concurrent confirmUpload may have inserted the row between our
      // findOne and save. Postgres returns SQLSTATE 23505 (unique_violation)
      // because of `uq_document_file_user_conv`. Re-query and reuse instead
      // of bubbling up a 500.
      if (this.isUniqueViolation(err)) {
        const winner = await this.documentMetadataRepo.findOne({
          where: { fileKey: key, userId, conversationId },
        });
        if (winner) {
          this.logger.log(
            `DocumentMetadata race resolved by reusing concurrent winner for key=${key}, doc_id=${winner.id}`,
          );
          return winner.id;
        }
      }
      throw err;
    }

    const docEvent: AiDocumentUploadEvent = {
      document_id: documentId,
      conversation_id: conversationId,
      user_id: userId,
      file_key: key,
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType,
      uploaded_at: Date.now(),
      trace_id: userId,
    };
    void this.kafka.emit(KafkaTopics.AiDocumentUpload, docEvent);
    this.logger.log(
      `AiDocumentUpload emitted for key=${key}, doc_id=${documentId}`,
    );
    return documentId;
  }

  private isUniqueViolation(err: unknown): boolean {
    // Mirrors `isUniqueViolationError` in conversation-poll.helpers.ts.
    // TypeORM's QueryFailedError surfaces the Postgres SQLSTATE on
    // either `err.code` or `err.driverError.code` depending on the pg
    // driver version, so we check both for forward compatibility.
    if (!err || typeof err !== 'object') {
      return false;
    }
    const anyErr = err as { code?: unknown; driverError?: { code?: unknown } };
    return anyErr.code === '23505' || anyErr.driverError?.code === '23505';
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
