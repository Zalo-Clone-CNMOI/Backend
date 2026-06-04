import { Module } from '@nestjs/common';
import { JwtService } from '@libs/auth';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService, JwtService],
})
export class MonitoringModule {}
