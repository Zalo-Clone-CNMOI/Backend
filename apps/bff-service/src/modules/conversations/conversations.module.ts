import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InteractionClientModule } from '@app/clients/interaction-client';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    InteractionClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('INTERACTION_SERVICE_URL') ||
          'http://interaction-service:5004/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
