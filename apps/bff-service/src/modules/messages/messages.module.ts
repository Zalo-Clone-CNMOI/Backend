import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatClientModule } from '@app/clients';
import { AuthModule as SharedAuthModule } from '@libs/auth';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    SharedAuthModule,
    ChatClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('CHAT_SERVICE_URL') ||
          'http://chat-service:5002/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
