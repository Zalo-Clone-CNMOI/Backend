import { Injectable, Logger } from '@nestjs/common';
import { ConversationMembershipService } from '@libs/mvp-access';

@Injectable()
export class CallMembershipAccessService {
  private readonly logger = new Logger(CallMembershipAccessService.name);

  constructor(
    private readonly membershipService: ConversationMembershipService,
  ) {}

  async ensureMember(userId: string, conversationId: string): Promise<boolean> {
    try {
      return await this.membershipService.canUserAccessConversation(
        userId,
        conversationId,
      );
    } catch (error) {
      this.logger.error(
        `Failed membership check for user=${userId}, conversation=${conversationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
