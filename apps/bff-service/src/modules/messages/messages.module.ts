import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatClientModule, MediaClientModule } from '@app/clients';
import { KafkaModule } from '@libs/kafka';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { User } from '@libs/database';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    ChatClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('CHAT_SERVICE_URL') ||
          'http://chat-service:5002/api',
      }),
      inject: [ConfigService],
    }),
    MediaClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('MEDIA_SERVICE_URL') ||
          'http://media-service:3003/api',
      }),
      inject: [ConfigService],
    }),
    KafkaModule,
    ConversationMembershipModule,
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
