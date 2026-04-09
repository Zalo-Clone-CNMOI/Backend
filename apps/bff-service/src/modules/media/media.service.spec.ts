import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { MediaService } from './media.service';
import { SsoClientService } from '@app/clients';
import { MediaClientService } from '@app/clients/media-client/media-client.service';

describe('BFF MediaService', () => {
  let service: MediaService;
  let mediaClient: Record<string, jest.Mock>;
  let ssoClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    mediaClient = {
      presignUpload: jest.fn(),
      confirmUpload: jest.fn(),
      presignDownload: jest.fn(),
    };

    ssoClient = {
      getMyProfile: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: MediaClientService, useValue: mediaClient },
        { provide: SsoClientService, useValue: ssoClient },
      ],
    }).compile();

    service = module.get<MediaService>(MediaService);
  });

  it('should resolve user id and delegate presignUpload', async () => {
    const dto = { contentType: 'image/jpeg', fileName: 'photo.jpg' };
    const expected = {
      key: 'public/photo.jpg',
      bucket: 'media-bucket',
      uploadUrl: 'https://example/upload',
      expiresAt: 123,
      visibility: 'public',
    };
    mediaClient.presignUpload.mockResolvedValue(expected);

    const result = await service.presignUpload('token-1', dto);

    expect(ssoClient.getMyProfile).toHaveBeenCalledWith('token-1');
    expect(mediaClient.presignUpload).toHaveBeenCalledWith(dto, 'user-1');
    expect(result).toEqual(expected);
  });

  it('should resolve user id and delegate confirmUpload', async () => {
    const dto = { key: 'public/photo.jpg', contentType: 'image/jpeg' };
    const expected = { ok: true, thumbnailKey: 'thumbs/public/photo.jpg' };
    mediaClient.confirmUpload.mockResolvedValue(expected);

    const result = await service.confirmUpload('token-1', dto);

    expect(ssoClient.getMyProfile).toHaveBeenCalledWith('token-1');
    expect(mediaClient.confirmUpload).toHaveBeenCalledWith(dto, 'user-1');
    expect(result).toEqual(expected);
  });

  it('should resolve user id and delegate presignDownload', async () => {
    const dto = { key: 'private/report.pdf' };
    const expected = {
      downloadUrl: 'https://example/download',
      expiresAt: 123,
    };
    mediaClient.presignDownload.mockResolvedValue(expected);

    const result = await service.presignDownload('token-1', dto);

    expect(ssoClient.getMyProfile).toHaveBeenCalledWith('token-1');
    expect(mediaClient.presignDownload).toHaveBeenCalledWith(dto, 'user-1');
    expect(result).toEqual(expected);
  });

  it('should throw UnauthorizedException when user id cannot be resolved', async () => {
    ssoClient.getMyProfile.mockResolvedValue({});

    await expect(
      service.presignDownload('token-1', { key: 'private/report.pdf' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
