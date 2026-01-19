import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BffServiceService } from './bff-service.service';

@ApiTags('Health')
@Controller()
export class BffServiceController {
  constructor(private readonly bffServiceService: BffServiceService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth(): { status: string; service: string; timestamp: string } {
    return this.bffServiceService.getHealth();
  }
}
