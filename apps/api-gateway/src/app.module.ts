import { Module } from '@nestjs/common';
import { ConfigModule } from '@libs/config';
import { LoggerModule } from '@libs/logger';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule, LoggerModule],
  controllers: [HealthController],
})
export class AppModule {}
