import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCoreClientModule } from '@app/clients';
import { AuthModule } from '@libs/auth';
import { EntityInfoController } from './entity-info.controller';
import { EntityInfoService } from './entity-info.service';

@Module({
  imports: [
    AuthModule,
    AiCoreClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('AI_CORE_SERVICE_URL') ??
          'http://ai-core-service:5005/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [EntityInfoController],
  providers: [EntityInfoService],
})
export class EntityInfoModule {}
