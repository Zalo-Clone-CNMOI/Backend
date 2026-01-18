import { Injectable } from '@nestjs/common';

@Injectable()
export class RelationServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
