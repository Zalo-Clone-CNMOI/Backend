import { Test, TestingModule } from '@nestjs/testing';
import { ZaiImageResolverService } from './zai-image-resolver.service';
import { S3Service } from '@libs/s3';
import { APP_CONFIG } from '@libs/config';
import type { AiZaiImageRef } from '@libs/contracts';

const PNG: AiZaiImageRef = { key: 'k1', content_type: 'image/png' };

describe('ZaiImageResolverService', () => {
  let service: ZaiImageResolverService;
  let s3: jest.Mocked<S3Service>;

  async function build(config: Record<string, unknown>) {
    s3 = {
      presignDownload: jest
        .fn()
        .mockResolvedValue({ downloadUrl: 'https://s3/signed', expiresAt: 0 }),
      download: jest.fn().mockResolvedValue(Buffer.from('PNGDATA')),
    } as unknown as jest.Mocked<S3Service>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZaiImageResolverService,
        { provide: S3Service, useValue: s3 },
        { provide: APP_CONFIG, useValue: config },
      ],
    }).compile();

    service = module.get(ZaiImageResolverService);
  }

  afterEach(() => jest.clearAllMocks());

  it('returns [] for undefined / empty input (no I/O)', async () => {
    await build({});
    expect(await service.resolve(undefined)).toEqual([]);
    expect(await service.resolve([])).toEqual([]);
    expect(s3.presignDownload).not.toHaveBeenCalled();
  });

  it('url mode (default): presigns each image → image_url part with the URL', async () => {
    await build({ zaiVisionInlineBase64: false, zaiVisionMaxImages: 4 });

    const parts = await service.resolve([PNG]);

    expect(s3.presignDownload).toHaveBeenCalledWith('k1', {
      expiresSeconds: 300,
    });
    expect(s3.download).not.toHaveBeenCalled();
    expect(parts).toEqual([
      { type: 'image_url', url: 'https://s3/signed', mime_type: 'image/png' },
    ]);
  });

  it('base64 mode: downloads bytes → data URL', async () => {
    await build({ zaiVisionInlineBase64: true });

    const parts = await service.resolve([PNG]);

    expect(s3.download).toHaveBeenCalledWith('k1');
    expect(s3.presignDownload).not.toHaveBeenCalled();
    const b64 = Buffer.from('PNGDATA').toString('base64');
    expect((parts[0] as { url: string }).url).toBe(
      `data:image/png;base64,${b64}`,
    );
  });

  it('filters non-image content types', async () => {
    await build({});

    const parts = await service.resolve([
      PNG,
      { key: 'v', content_type: 'video/mp4' },
      { key: 'f', content_type: 'application/pdf' },
    ]);

    expect(parts).toHaveLength(1);
    expect(s3.presignDownload).toHaveBeenCalledTimes(1);
  });

  it('caps the number of images at zaiVisionMaxImages', async () => {
    await build({ zaiVisionMaxImages: 2 });

    const parts = await service.resolve([
      { key: 'a', content_type: 'image/png' },
      { key: 'b', content_type: 'image/png' },
      { key: 'c', content_type: 'image/png' },
    ]);

    expect(parts).toHaveLength(2);
  });

  it('skips an image that fails to resolve, keeps the rest', async () => {
    await build({});
    (s3.presignDownload as jest.Mock)
      .mockRejectedValueOnce(new Error('S3 down'))
      .mockResolvedValueOnce({ downloadUrl: 'https://s3/ok', expiresAt: 0 });

    const parts = await service.resolve([
      { key: 'bad', content_type: 'image/png' },
      { key: 'good', content_type: 'image/png' },
    ]);

    expect(parts).toHaveLength(1);
    expect((parts[0] as { url: string }).url).toBe('https://s3/ok');
  });
});
