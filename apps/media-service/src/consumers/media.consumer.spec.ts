import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MediaFile } from '@libs/database';
import { S3_CONFIG } from '@libs/s3';

import { MediaConsumer } from './media.consumer';

describe('MediaConsumer', () => {
  let consumer: MediaConsumer;
  let mediaFileRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    mediaFileRepo = {
      findOne: jest.fn(),
      create: jest.fn<MediaFile, [Partial<MediaFile>]>(
        (value) => value as MediaFile,
      ),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaConsumer,
        { provide: getRepositoryToken(MediaFile), useValue: mediaFileRepo },
        {
          provide: S3_CONFIG,
          useValue: { bucket: 'test-bucket', region: 'us-east-1' },
        },
      ],
    }).compile();

    consumer = module.get(MediaConsumer);
  });

  it('should fallback to configured bucket and trace_id when media upload event is missing them', async () => {
    mediaFileRepo.findOne.mockResolvedValue(null);

    await consumer.onMediaUploaded({
      key: 'public/avatar.jpg',
      bucket: undefined as unknown as string,
      uploaded_at: Date.now(),
      trace_id: 'user-123',
    });

    expect(mediaFileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'public/avatar.jpg',
        bucket: 'test-bucket',
        uploadedById: 'user-123',
        status: 'uploaded',
      }),
    );
  });
});
