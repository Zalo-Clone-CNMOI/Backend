import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCoreClientModule } from '@app/clients';
import { JwtService } from '@libs/auth';
import { EntityDetectionsController } from './entity-detections.controller';
import { EntityDetectionsService } from './entity-detections.service';

@Module({
  imports: [
    AiCoreClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('AI_CORE_SERVICE_URL') ??
          'http://ai-core-service:5005/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [EntityDetectionsController],
  providers: [EntityDetectionsService, JwtService],
})
export class EntityDetectionsModule {}
