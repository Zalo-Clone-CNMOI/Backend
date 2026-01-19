import { Controller, Get } from '@nestjs/common';
import { RelationServiceService } from './relation-service.service';

@Controller()
export class RelationServiceController {
  constructor(
    private readonly relationServiceService: RelationServiceService,
  ) {}

  @Get()
  getHello(): string {
    return this.relationServiceService.getHello();
  }
}
