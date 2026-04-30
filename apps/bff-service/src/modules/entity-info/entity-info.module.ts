import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCoreClientModule } from '@app/clients';
import { JwtService, JwtAuthGuard } from '@libs/auth';
import { User } from '@libs/database';
import { EntityInfoController } from './entity-info.controller';
import { EntityInfoService } from './entity-info.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
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
  providers: [EntityInfoService, JwtService, JwtAuthGuard],
})
export class EntityInfoModule {}
