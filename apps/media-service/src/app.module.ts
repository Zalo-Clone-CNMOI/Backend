import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { KafkaModule } from '@libs/kafka';
import { HealthController } from './health.controller';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';

@Module({
  imports: [ConfigModule, LoggerModule, KafkaModule],
  controllers: [HealthController, MediaController],
  providers: [MediaService],
})
export class AppModule {}
