/**
 * @file media.controller.spec.ts (media-service)
 *
 * Unit tests for MediaController — verifies route delegation to
 * MediaService and response shaping for presign and confirm endpoints.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

describe('MediaController', () => {
  let controller: MediaController;
  let mediaService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mediaService = {
      presignUpload: jest.fn().mockResolvedValue({
        key: 'uploads/abc/photo.jpg',
        bucket: 'media-bucket',
        uploadUrl: 'https://s3.example.com/presigned',
        expiresAt: Date.now() + 3600000,
      }),
      confirmUploaded: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compile();

    controller = module.get<MediaController>(MediaController);
  });

  // ─── presignUpload ───────────────────────────────────

  describe('POST presign/upload', () => {
    it('should delegate to MediaService.presignUpload', async () => {
      const body = { contentType: 'image/jpeg', fileName: 'photo.jpg' };
      const result = await controller.presignUpload(body, 'user-1');

      expect(mediaService.presignUpload).toHaveBeenCalledWith(body, 'user-1');
      expect(result).toEqual(
        expect.objectContaining({ key: 'uploads/abc/photo.jpg' }),
      );
    });

    it('should pass undefined userId when header is missing', async () => {
      const body = { contentType: 'image/png' };
      await controller.presignUpload(body);

      expect(mediaService.presignUpload).toHaveBeenCalledWith(body, undefined);
    });

    it('should return full presign response (key, bucket, uploadUrl, expiresAt)', async () => {
      const body = { contentType: 'image/jpeg' };
      const result = await controller.presignUpload(body);

      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('bucket');
      expect(result).toHaveProperty('uploadUrl');
      expect(result).toHaveProperty('expiresAt');
    });

    it('should propagate service errors', async () => {
      mediaService.presignUpload.mockRejectedValue(new Error('fail'));

      await expect(
        controller.presignUpload({ contentType: 'image/jpeg' }),
      ).rejects.toThrow('fail');
    });
  });

  // ─── confirmUpload ──────────────────────────────────

  describe('POST upload/confirm', () => {
    it('should delegate to MediaService.confirmUploaded with correct args', async () => {
      const body = {
        key: 'uploads/abc/photo.jpg',
        contentType: 'image/jpeg',
        conversationId: 'conv-1',
      };
      await controller.confirmUpload(body, 'user-1');

      expect(mediaService.confirmUploaded).toHaveBeenCalledWith(
        'uploads/abc/photo.jpg',
        'image/jpeg',
        'user-1',
        'conv-1',
      );
    });

    it('should wrap result with ok: true', async () => {
      const body = { key: 'file.txt', contentType: 'text/plain' };
      const result = await controller.confirmUpload(body);

      expect(result).toEqual({ ok: true, thumbnailKey: undefined });
    });

    it('should include thumbnailKey when service returns one', async () => {
      mediaService.confirmUploaded.mockResolvedValue({
        thumbnailKey: 'thumbs/uploads/abc/photo.jpg',
      });

      const body = { key: 'uploads/abc/photo.jpg', contentType: 'image/jpeg' };
      const result = await controller.confirmUpload(body, 'user-1');

      expect(result).toEqual({
        ok: true,
        thumbnailKey: 'thumbs/uploads/abc/photo.jpg',
      });
    });

    it('should include documentId when service returns one (document upload)', async () => {
      mediaService.confirmUploaded.mockResolvedValue({
        documentId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const body = {
        key: 'uploads/abc/doc.pdf',
        contentType: 'application/pdf',
        conversationId: 'conv-1',
      };
      const result = await controller.confirmUpload(body, 'user-1');

      expect(result).toEqual({
        ok: true,
        documentId: '550e8400-e29b-41d4-a716-446655440000',
      });
    });

    it('should pass undefined conversationId when not in body', async () => {
      const body = { key: 'file.txt', contentType: 'text/plain' };
      await controller.confirmUpload(body, 'user-1');

      expect(mediaService.confirmUploaded).toHaveBeenCalledWith(
        'file.txt',
        'text/plain',
        'user-1',
        undefined,
      );
    });

    it('should propagate service errors', async () => {
      mediaService.confirmUploaded.mockRejectedValue(new Error('S3 fail'));

      await expect(
        controller.confirmUpload({ key: 'k', contentType: 'text/plain' }),
      ).rejects.toThrow('S3 fail');
    });
  });
});
