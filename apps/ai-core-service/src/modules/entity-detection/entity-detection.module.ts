import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScyllaModule } from '@libs/scylla';
import { AiEntityDetectionLog } from '@libs/database/entities';
import { EntityDetectionEngine } from './entity-detection.engine';
import { EntityInfoController } from './entity-info.controller';
import { EntityDetectionHistoryController } from './entity-detection-history.controller';
import { EntityDetectionHistoryService } from './entity-detection-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiEntityDetectionLog]), ScyllaModule],
  controllers: [EntityInfoController, EntityDetectionHistoryController],
  providers: [EntityDetectionEngine, EntityDetectionHistoryService],
  exports: [EntityDetectionEngine],
})
export class EntityDetectionModule {}
