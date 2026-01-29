import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { S3Module } from '@libs/s3';
import { HealthController } from './health.controller';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    KafkaModule,
    S3Module.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        region: process.env.AWS_REGION ?? 'ap-southeast-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        forcePathStyle:
          (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
        bucket: process.env.S3_BUCKET ?? '',
        uploadPrefix: process.env.S3_UPLOAD_PREFIX ?? 'uploads/',
        presignExpiresSeconds: Number(
          process.env.S3_PRESIGN_EXPIRES_SECONDS ?? 60,
        ),
      }),
    }),
  ],
  controllers: [HealthController, MediaController],
  providers: [MediaService],
})
export class AppModule {}
