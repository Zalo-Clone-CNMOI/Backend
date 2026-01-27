import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SsoClientModule } from '@app/clients';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    SsoClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('SSO_SERVICE_URL') ||
          'http://sso-service:5001/api',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
