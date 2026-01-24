import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import {
  User,
  DeviceToken,
  Conversation,
  ConversationMember,
  Friendship,
  MediaFile,
  Post,
  PostMedia,
  PostLike,
  PostComment,
  CommentLike,
  NotificationPreference,
  NotificationLog,
} from './entities';

export const entities = [
  User,
  DeviceToken,
  Conversation,
  ConversationMember,
  Friendship,
  MediaFile,
  Post,
  PostMedia,
  PostLike,
  PostComment,
  CommentLike,
  NotificationPreference,
  NotificationLog,
];

const useSsl = process.env.DB_SSL === 'true';


@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        host: config.postgresHost ?? 'localhost',
        port: config.postgresPort ?? 5439,
        username: config.postgresUser ?? 'postgres',
        password: config.postgresPassword ?? 'postgres',
        database: config.postgresDatabase ?? 'zaloclone',
        ssl: { rejectUnauthorized: false },
        entities,
        synchronize: config.nodeEnv === 'development', // Only sync in dev
        logging: config.nodeEnv === 'development',
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
