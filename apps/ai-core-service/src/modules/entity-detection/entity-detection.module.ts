import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiEntityDetectionLog } from '@libs/database/entities';
import { EntityDetectionEngine } from './entity-detection.engine';
import { EntityInfoController } from './entity-info.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AiEntityDetectionLog])],
  controllers: [EntityInfoController],
  providers: [EntityDetectionEngine],
  exports: [EntityDetectionEngine],
})
export class EntityDetectionModule {}
