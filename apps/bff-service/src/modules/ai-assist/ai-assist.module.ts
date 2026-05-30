import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCoreClientModule } from '@app/clients';
import { InteractionClientModule } from '@app/clients/interaction-client';
import { JwtService } from '@libs/auth';
import { AiAssistController } from './ai-assist.controller';
import { AiAssistService } from './ai-assist.service';

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
    InteractionClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('INTERACTION_SERVICE_URL') ||
          'http://interaction-service:5004/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AiAssistController],
  providers: [AiAssistService, JwtService],
})
export class AiAssistModule {}
