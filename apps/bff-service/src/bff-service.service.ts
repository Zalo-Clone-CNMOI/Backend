import { Injectable } from '@nestjs/common';

@Injectable()
export class BffServiceService {
  getHealth(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'bff-service',
      timestamp: new Date().toISOString(),
    };
  }
}
