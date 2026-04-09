import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SsoClientModule } from '@app/clients';
import { MediaClientModule } from '@app/clients/media-client/media-client.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [
    MediaClientModule.registerAsync({
      useFactory: (...args: unknown[]) => {
        const [configService] = args as [ConfigService];
        return {
          baseUrl:
            configService.get<string>('MEDIA_SERVICE_URL') ||
            'http://media-service:3003/api',
        };
      },
      inject: [ConfigService],
    }),
    SsoClientModule.registerAsync({
      useFactory: (...args: unknown[]) => {
        const [configService] = args as [ConfigService];
        return {
          baseUrl:
            configService.get<string>('SSO_SERVICE_URL') ||
            'http://sso-service:5001/api',
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
