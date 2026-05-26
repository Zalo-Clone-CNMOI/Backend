import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  AiModerationRequestEvent,
  ModerationDecisionSourceType,
  ModerationLabelType,
} from '@libs/contracts';
import { ModerationEngine } from './moderation.engine';
import { PreSendModerationCheckDto } from './dto/pre-send-moderation-check.dto';

/**
 * Pre-send moderation check response. Returned verbatim from the engine —
 * the controller does NOT interpret thresholds. Callers (chat-service
 * PreSendModerationService) apply their own threshold to decide allow/block.
 */
export interface PreSendModerationCheckResponse {
  is_flagged: boolean;
  labels: ModerationLabelType[];
  /**
   * Model's confidence in the assigned labels, [0,1]. Interpretation:
   * high is_flagged + high confidence = "the model is very sure this is toxic".
   * The chat-service caller applies its own threshold (default 0.85) to
   * decide allow vs block — see PreSendModerationService.checkOrAllow().
   */
  confidence: number;
  decision_source: ModerationDecisionSourceType;
}

/**
 * Internal-only HTTP endpoint — ai-core's port must be firewalled from the
 * public internet (k8s NetworkPolicy + ingress excludes /moderation/*).
 *
 * NO @Throttle: traffic is service-to-service from a single internal IP;
 * any nestjs/throttler rate limit would group every chat-service instance
 * into one quota and blow up during group-chat spikes. Rate limiting
 * belongs at the user edge (ws-gateway / BFF), not here.
 */
@ApiTags('Moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly engine: ModerationEngine) {}

  @Post('check')
  @ApiOperation({
    summary: 'Synchronous pre-send moderation check',
    description:
      'Returns the engine verdict verbatim. The caller applies its own threshold.',
  })
  @ApiResponse({ status: 201, description: 'Moderation verdict' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async checkPreSend(
    @Body() dto: PreSendModerationCheckDto,
  ): Promise<PreSendModerationCheckResponse> {
    const now = Date.now();
    const event: AiModerationRequestEvent = {
      message_id: 'pre-send',
      conversation_id: dto.conversation_id ?? 'pre-send',
      sender_id: dto.sender_id,
      created_at: now,
      body: dto.body,
      requested_at: now,
    };

    const result = await this.engine.moderate(event);

    return {
      is_flagged: result.is_flagged,
      labels: result.labels,
      confidence: result.confidence,
      decision_source: result.decision_source,
    };
  }
}
