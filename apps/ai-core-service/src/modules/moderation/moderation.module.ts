import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModerationLog } from '@libs/database/entities';
import { ModerationEngine } from './moderation.engine';
import { ModerationController } from './moderation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AiModerationLog])],
  controllers: [ModerationController],
  providers: [ModerationEngine],
  exports: [ModerationEngine],
})
export class ModerationModule {}
