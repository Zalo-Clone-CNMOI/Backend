import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaClientModule } from '@app/clients';
import { KafkaModule } from '@libs/kafka';
import { ScyllaModule } from '@libs/scylla';
import { User } from '@libs/database';
import { ConversationMembershipModule } from '@libs/mvp-access';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    ScyllaModule,
    TypeOrmModule.forFeature([User]),
    KafkaModule,
    ConversationMembershipModule,
    MediaClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('MEDIA_SERVICE_URL') ||
          'http://media-service:3003/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
