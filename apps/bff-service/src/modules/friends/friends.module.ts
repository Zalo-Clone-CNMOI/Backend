import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InteractionClientModule } from '@app/clients/interaction-client';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

@Module({
  imports: [
    InteractionClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('INTERACTION_SERVICE_URL') ||
          'http://localhost:5004/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
})
export class FriendsModule {}
