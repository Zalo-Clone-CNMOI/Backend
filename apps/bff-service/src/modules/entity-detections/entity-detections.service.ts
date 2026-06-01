import { Injectable } from '@nestjs/common';
import { AiCoreClientService } from '@app/clients';

@Injectable()
export class EntityDetectionsService {
  constructor(private readonly aiCoreClient: AiCoreClientService) {}

  async getEntityDetections(params: {
    conversationId: string;
    userId: string;
  }) {
    return this.aiCoreClient.getEntityDetections(params);
  }
}
