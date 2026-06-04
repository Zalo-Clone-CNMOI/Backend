import { Module } from '@nestjs/common';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

// AiGatewayModule is @Global → AiGatewayService is available.
// APP_CONFIG is @Global. InternalTokenGuard only needs APP_CONFIG.
@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
