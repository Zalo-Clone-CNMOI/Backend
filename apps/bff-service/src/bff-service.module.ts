import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BffServiceController } from './bff-service.controller';
import { BffServiceService } from './bff-service.service';
import { AuthModule } from './modules/auth';
import { UsersModule } from './modules/users';
import { SsoClientModule } from '@app/clients';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SsoClientModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseUrl:
          configService.get<string>('SSO_API_URL') ||
          'http://localhost:5001/api',
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
  ],
  controllers: [BffServiceController],
  providers: [BffServiceService],
})
export class BffServiceModule {}
