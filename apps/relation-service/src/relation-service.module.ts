import { Module } from '@nestjs/common';
import { RelationServiceController } from './relation-service.controller';
import { RelationServiceService } from './relation-service.service';

@Module({
  imports: [],
  controllers: [RelationServiceController],
  providers: [RelationServiceService],
})
export class RelationServiceModule {}
