import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

describe('BFF MediaController', () => {
  let controller: MediaController;
  let mediaService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mediaService = {
      presignUpload: jest.fn(),
      confirmUpload: jest.fn(),
      presignDownload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaService, useValue: mediaService }],
    }).compile();

    controller = module.get<MediaController>(MediaController);
  });

  it('should delegate presignUpload to service with access token', async () => {
    const dto = { contentType: 'image/jpeg', fileName: 'photo.jpg' };
    const expected = {
      key: 'public/photo.jpg',
      bucket: 'media-bucket',
      uploadUrl: 'https://example/upload',
      expiresAt: 123,
      visibility: 'public',
    };
    mediaService.presignUpload.mockResolvedValue(expected);

    const result = await controller.presignUpload('token-1', dto);

    expect(mediaService.presignUpload).toHaveBeenCalledWith('token-1', dto);
    expect(result).toEqual(expected);
  });

  it('should delegate confirmUpload to service with access token', async () => {
    const dto = { key: 'public/photo.jpg', contentType: 'image/jpeg' };
    const expected = { ok: true, thumbnailKey: 'thumbs/public/photo.jpg' };
    mediaService.confirmUpload.mockResolvedValue(expected);

    const result = await controller.confirmUpload('token-1', dto);

    expect(mediaService.confirmUpload).toHaveBeenCalledWith('token-1', dto);
    expect(result).toEqual(expected);
  });

  it('should delegate presignDownload to service with access token', async () => {
    const dto = { key: 'private/report.pdf' };
    const expected = {
      downloadUrl: 'https://example/download',
      expiresAt: 123,
    };
    mediaService.presignDownload.mockResolvedValue(expected);

    const result = await controller.presignDownload('token-1', dto);

    expect(mediaService.presignDownload).toHaveBeenCalledWith('token-1', dto);
    expect(result).toEqual(expected);
  });

  it('should throw UnauthorizedException when token is missing', async () => {
    await expect(
      controller.presignUpload(null, { contentType: 'image/jpeg' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
