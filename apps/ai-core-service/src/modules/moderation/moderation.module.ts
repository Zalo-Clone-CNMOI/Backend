import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModerationLog } from '@libs/database/entities';
import { ModerationEngine } from './moderation.engine';

@Module({
  imports: [TypeOrmModule.forFeature([AiModerationLog])],
  providers: [ModerationEngine],
  exports: [ModerationEngine],
})
export class ModerationModule {}
