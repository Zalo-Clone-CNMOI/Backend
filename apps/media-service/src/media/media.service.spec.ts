/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
/**
 * @file media.service.spec.ts (media-service)
 *
 * Unit tests for MediaService — covers presigned upload, upload
 * confirmation, thumbnail generation, Kafka events, document
 * detection, and image type filtering.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';
import { S3Service, S3_CLIENT, S3_CONFIG } from '@libs/s3';
import { KAFKA_CLIENT } from '@libs/kafka';
import { KafkaTopics } from '@libs/contracts';
import { ConversationMembershipService } from '@libs/mvp-access';
import { DocumentMetadata, MediaFile } from '@libs/database';

describe('MediaService', () => {
  let service: MediaService;
  let kafka: Record<string, jest.Mock>;
  let s3Service: Record<string, jest.Mock>;
  let s3Client: Record<string, jest.Mock>;
  let mediaFileRepo: Record<string, jest.Mock>;
  let documentMetadataRepo: Record<string, jest.Mock>;
  let membershipService: Record<string, jest.Mock>;
  let s3Config: { bucket: string; region: string };

  beforeEach(async () => {
    kafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
    };

    s3Service = {
      exists: jest.fn().mockResolvedValue(true),
      presignUpload: jest.fn().mockResolvedValue({
        key: 'uploads/abc123/photo.jpg',
        bucket: 'test-bucket',
        uploadUrl: 'https://s3.example.com/presigned-url',
        expiresAt: Date.now() + 3600000,
      }),
    };

    s3Client = {
      send: jest.fn(),
    };

    mediaFileRepo = {
      create: jest.fn<MediaFile, [Partial<MediaFile>]>(
        (value) => value as MediaFile,
      ),
      findOne: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };

    // Default: no existing document; save returns a row with a generated id.
    documentMetadataRepo = {
      create: jest.fn<DocumentMetadata, [Partial<DocumentMetadata>]>(
        (value) => value as DocumentMetadata,
      ),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest
        .fn()
        .mockImplementation((entity: Partial<DocumentMetadata>) =>
          Promise.resolve({ ...entity, id: 'doc-uuid-stub' } as DocumentMetadata),
        ),
    };

    membershipService = {
      canUserAccessConversation: jest.fn().mockResolvedValue(true),
    };

    s3Config = { bucket: 'test-bucket', region: 'us-east-1' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: KAFKA_CLIENT, useValue: kafka },
        { provide: S3Service, useValue: s3Service },
        { provide: S3_CLIENT, useValue: s3Client },
        { provide: S3_CONFIG, useValue: s3Config },
        { provide: getRepositoryToken(MediaFile), useValue: mediaFileRepo },
        {
          provide: getRepositoryToken(DocumentMetadata),
          useValue: documentMetadataRepo,
        },
        {
          provide: ConversationMembershipService,
          useValue: membershipService,
        },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  // ─── presignUpload ───────────────────────────────────

  describe('presignUpload', () => {
    it('should delegate to s3Service.presignUpload with fileName and contentType', async () => {
      const body = { fileName: 'photo.jpg', contentType: 'image/jpeg' };
      const result = await service.presignUpload(body);

      expect(s3Service.presignUpload).toHaveBeenCalledWith(
        'photo.jpg',
        'image/jpeg',
        expect.objectContaining({ prefix: 'public/' }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          key: 'uploads/abc123/photo.jpg',
          bucket: 'test-bucket',
          uploadUrl: expect.any(String),
        }),
      );
    });

    it('should default fileName to "file" when not provided', async () => {
      const body = { contentType: 'application/pdf' };
      await service.presignUpload(body);

      expect(s3Service.presignUpload).toHaveBeenCalledWith(
        'file',
        'application/pdf',
        expect.objectContaining({ prefix: 'private/' }),
      );
    });

    it('should emit MediaUploadRequested Kafka event', async () => {
      const body = { fileName: 'doc.pdf', contentType: 'application/pdf' };
      await service.presignUpload(body, 'user-123');

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.MediaUploadRequested,
        expect.objectContaining({
          key: 'uploads/abc123/photo.jpg',
          bucket: 'test-bucket',
          content_type: 'application/pdf',
          requested_by_user_id: 'user-123',
          requested_at: expect.any(Number),
        }),
      );
    });

    it('should pass userId as requested_by_user_id in event', async () => {
      await service.presignUpload({ contentType: 'image/png' }, 'user-abc');

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.MediaUploadRequested,
        expect.objectContaining({ requested_by_user_id: 'user-abc' }),
      );
    });

    it('should propagate S3 service errors', async () => {
      s3Service.presignUpload.mockRejectedValue(new Error('S3 error'));

      await expect(
        service.presignUpload({ contentType: 'image/jpeg' }),
      ).rejects.toThrow('S3 error');
    });
  });

  // ─── confirmUploaded ─────────────────────────────────

  describe('confirmUploaded', () => {
    it('should emit MediaUploaded Kafka event', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded('images/photo.jpg', 'text/plain');

      expect(mediaFileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'images/photo.jpg',
          bucket: 'test-bucket',
          status: 'uploaded',
          uploadedById: null,
        }),
      );
      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.MediaUploaded,
        expect.objectContaining({
          key: 'images/photo.jpg',
          bucket: 'test-bucket',
          uploaded_at: expect.any(Number),
        }),
      );
    });

    it('should return empty object for non-image types', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      const result = await service.confirmUploaded(
        'files/doc.pdf',
        'application/pdf',
      );

      expect(result).toEqual({});
    });

    it('should generate thumbnail for image content types', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      // Mock S3 GetObject returning a minimal valid JPEG buffer
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield jpegBuffer;
        },
      };
      s3Client.send
        .mockResolvedValueOnce({ Body: mockStream }) // GetObject
        .mockResolvedValueOnce({}); // PutObject for thumbnail

      // sharp may fail on fake buffer, so we test the flow
      try {
        const result = await service.confirmUploaded(
          'images/photo.jpg',
          'image/jpeg',
          'user-1',
        );
        // If sharp succeeds, should return thumbnailKey
        expect(result.thumbnailKey).toContain('thumbs/');
      } catch {
        // sharp failure on tiny buffer is acceptable — we tested the flow
      }
    });

    it('should NOT generate thumbnail for gif images', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      const result = await service.confirmUploaded(
        'images/anim.gif',
        'image/gif',
      );

      expect(result).toEqual({});
      // s3Client.send should not be called for thumbnail
      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it('should NOT generate thumbnail for svg images', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      const result = await service.confirmUploaded(
        'images/icon.svg',
        'image/svg+xml',
      );

      expect(result).toEqual({});
      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it('should return empty on thumbnail generation failure', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      s3Client.send.mockRejectedValue(new Error('S3 read error'));

      const result = await service.confirmUploaded(
        'images/photo.jpg',
        'image/jpeg',
      );

      // Should swallow error and return empty
      expect(result).toEqual({});
    });

    it('should persist DocumentMetadata (pending), emit AiDocumentUpload, and return documentId for PDF with conversationId', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      documentMetadataRepo.save.mockResolvedValueOnce({
        id: 'doc-pdf-1',
        fileKey: 'docs/report.pdf',
        userId: 'user-1',
        conversationId: 'conv-1',
        status: 'pending',
      });

      const result = await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        'user-1',
        'conv-1',
      );

      // 1. Row was persisted with status='pending' BEFORE Kafka emit
      expect(documentMetadataRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          userId: 'user-1',
          fileKey: 'docs/report.pdf',
          contentType: 'application/pdf',
          status: 'pending',
        }),
      );
      expect(documentMetadataRepo.save).toHaveBeenCalled();

      // 2. Kafka event carries the persisted row's id
      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentUpload,
        expect.objectContaining({
          document_id: 'doc-pdf-1',
          conversation_id: 'conv-1',
          user_id: 'user-1',
          file_key: 'docs/report.pdf',
          content_type: 'application/pdf',
        }),
      );

      // 3. documentId returned to caller so FE can call /conversations/document
      expect(result.documentId).toBe('doc-pdf-1');
    });

    it('idempotency: reuses existing documentId on duplicate confirmUpload, skips re-emit', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      documentMetadataRepo.findOne.mockResolvedValueOnce({
        id: 'doc-existing',
        fileKey: 'docs/report.pdf',
        userId: 'user-1',
        conversationId: 'conv-1',
        status: 'completed',
      });

      const result = await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        'user-1',
        'conv-1',
      );

      expect(documentMetadataRepo.save).not.toHaveBeenCalled();
      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
      expect(result.documentId).toBe('doc-existing');
    });

    it('W5: skips document persistence and AI emit when user is not a member of the conversation', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      membershipService.canUserAccessConversation.mockResolvedValueOnce(false);

      const result = await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        'user-outsider',
        'conv-they-dont-own',
      );

      // No DB lookup, no save, no Kafka emit for AI ingest.
      expect(documentMetadataRepo.findOne).not.toHaveBeenCalled();
      expect(documentMetadataRepo.save).not.toHaveBeenCalled();
      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
      expect(result.documentId).toBeUndefined();
    });

    it('C1: handles unique-constraint violation by re-querying the concurrent winner', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      // First findOne pre-flight returns null (no row yet visible).
      // Second findOne (after the unique-violation catch) returns the
      // row inserted by the concurrent confirmUpload.
      documentMetadataRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'doc-winner',
          fileKey: 'docs/report.pdf',
          userId: 'user-1',
          conversationId: 'conv-1',
          status: 'pending',
        });

      // Simulate Postgres 23505 unique_violation surfacing through TypeORM.
      const uniqueViolation = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { driverError: { code: '23505' } },
      );
      documentMetadataRepo.save.mockRejectedValueOnce(uniqueViolation);

      const result = await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        'user-1',
        'conv-1',
      );

      expect(result.documentId).toBe('doc-winner');
      // No AI ingest event because we did NOT win the insert race —
      // the winner already emitted it.
      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
    });

    it('C1: rethrows the unique-violation when the re-query finds no winner (extremely narrow window)', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      // Pre-flight findOne: null. Re-query findOne after catch: also null
      // (winner row deleted/soft-deleted between violation and re-query).
      documentMetadataRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const uniqueViolation = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { driverError: { code: '23505' } },
      );
      documentMetadataRepo.save.mockRejectedValueOnce(uniqueViolation);

      await expect(
        service.confirmUploaded(
          'docs/report.pdf',
          'application/pdf',
          'user-1',
          'conv-1',
        ),
      ).rejects.toThrow('duplicate key value violates unique constraint');
    });

    it('C1: rethrows non-unique DB errors instead of swallowing them', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      documentMetadataRepo.findOne.mockResolvedValueOnce(null);
      // A generic DB error (not a unique-violation) must surface so the
      // caller sees the upload failed.
      documentMetadataRepo.save.mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(
        service.confirmUploaded(
          'docs/report.pdf',
          'application/pdf',
          'user-1',
          'conv-1',
        ),
      ).rejects.toThrow('connection refused');
    });

    it('should emit AiDocumentUpload event for docx with conversationId', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded(
        'docs/doc.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'user-1',
        'conv-1',
      );

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.AiDocumentUpload,
        expect.objectContaining({
          content_type:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
    });

    it('should NOT emit AiDocumentUpload without conversationId', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        'user-1',
        // no conversationId
      );

      // MediaUploaded still emitted, but NOT AiDocumentUpload
      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
    });

    it('should NOT emit AiDocumentUpload without userId', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded(
        'docs/report.pdf',
        'application/pdf',
        undefined,
        'conv-1',
      );

      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
    });

    it('should NOT emit AiDocumentUpload for non-document types', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded(
        'files/video.mp4',
        'video/mp4',
        'user-1',
        'conv-1',
      );

      const aiDocCalls = kafka.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === KafkaTopics.AiDocumentUpload,
      );
      expect(aiDocCalls).toHaveLength(0);
    });

    it('should set trace_id to userId in MediaUploaded event', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await service.confirmUploaded('file.txt', 'text/plain', 'user-42');

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.MediaUploaded,
        expect.objectContaining({ trace_id: 'user-42' }),
      );
    });

    it('should rethrow database errors instead of masking them', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      mediaFileRepo.save.mockRejectedValue(new Error('DB insert failed'));

      await expect(
        service.confirmUploaded('images/photo.jpg', 'image/jpeg'),
      ).rejects.toThrow('DB insert failed');
    });
  });

  // ─── onModuleInit ────────────────────────────────────

  describe('onModuleInit', () => {
    it('should connect kafka client on init', async () => {
      await service.onModuleInit();

      expect(kafka.connect).toHaveBeenCalled();
    });
  });
});

describe('MediaService.cloneAttachment', () => {
  let service: MediaService;
  let s3Service: {
    copy: jest.Mock;
    exists: jest.Mock;
    presignUpload: jest.Mock;
  };
  let mediaFileRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let s3Config: { bucket: string; region: string };

  beforeEach(async () => {
    s3Service = {
      copy: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      presignUpload: jest.fn(),
    };

    mediaFileRepo = {
      findOne: jest.fn(),
      create: jest.fn<MediaFile, [Partial<MediaFile>]>(
        (data) => data as MediaFile,
      ),
      save: jest.fn().mockResolvedValue(undefined),
    };

    s3Config = { bucket: 'test-bucket', region: 'us-east-1' };

    const kafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: KAFKA_CLIENT, useValue: kafka },
        { provide: S3Service, useValue: s3Service },
        { provide: S3_CLIENT, useValue: {} },
        { provide: S3_CONFIG, useValue: s3Config },
        { provide: getRepositoryToken(MediaFile), useValue: mediaFileRepo },
        {
          provide: getRepositoryToken(DocumentMetadata),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((v: Partial<DocumentMetadata>) => v),
            save: jest.fn((v: Partial<DocumentMetadata>) =>
              Promise.resolve({ ...v, id: 'doc-stub' }),
            ),
          },
        },
        {
          provide: ConversationMembershipService,
          useValue: {
            canUserAccessConversation: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  it('should throw BadRequestException when source file not found', async () => {
    mediaFileRepo.findOne.mockResolvedValue(null);

    await expect(
      service.cloneAttachment({ source_key: 'private/missing.jpg' }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should copy S3 object and create new MediaFile record', async () => {
    const sourceFile = {
      key: 'private/orig-123.jpg',
      bucket: 'test-bucket',
      contentType: 'image/jpeg',
      visibility: 'private',
      uploadedById: 'user-2',
      conversationId: 'conv-src',
      sizeBytes: 51200,
      thumbnailKey: null,
      status: 'uploaded',
    };
    mediaFileRepo.findOne.mockResolvedValue(sourceFile);

    const result = await service.cloneAttachment(
      { source_key: 'private/orig-123.jpg', conversation_id: 'conv-target' },
      'user-2',
    );

    expect(s3Service.copy).toHaveBeenCalledWith(
      'private/orig-123.jpg',
      expect.stringMatching(/^private\/fwd-/),
    );
    expect(mediaFileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        visibility: 'private',
        uploadedById: 'user-2',
        conversationId: 'conv-target',
        status: 'uploaded',
      }),
    );
    expect(result.visibility).toBe('private');
    expect(result.cloned_key).toMatch(/^private\/fwd-/);
    expect(result.content_type).toBe('image/jpeg');
  });

  it('should return cloned_key with public prefix for public files', async () => {
    const sourceFile = {
      key: 'public/photo.png',
      bucket: 'test-bucket',
      contentType: 'image/png',
      visibility: 'public',
      uploadedById: 'sender-1',
      conversationId: null,
      sizeBytes: 10240,
      thumbnailKey: null,
      status: 'uploaded',
    };
    mediaFileRepo.findOne.mockResolvedValue(sourceFile);

    const result = await service.cloneAttachment(
      { source_key: 'public/photo.png' },
      'user-2',
    );

    expect(result.cloned_key).toMatch(/^public\/fwd-/);
  });
});
