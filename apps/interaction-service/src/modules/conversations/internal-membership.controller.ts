import { Body, Controller, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@app/decorator';
import { MembershipQueryService } from './services/membership-query.service';
import {
  MembershipBatchRequestDto,
  MembershipBatchResponseDto,
  SendPermissionRequestDto,
  SendPermissionResponseDto,
  ActiveMembersRequestDto,
  ActiveMembersResponseDto,
} from './dto';

/**
 * Internal, service-to-service endpoints for ws-gateway membership checks.
 *
 * ws-gateway used to run these queries in-process via @libs/mvp-access (which
 * required a TypeORM DataSource). It is now a stateless transport layer and
 * calls these endpoints on a local-cache miss instead.
 *
 * - @Public bypasses the global JwtAuthGuard (callers are internal services on
 *   the isolated docker network; no end-user token is forwarded here).
 * - @ApiExcludeEndpoint hides them from the public Swagger surface.
 *
 * Reachable at /api/v1/internal/membership/* (interaction-service sets the
 * 'api' global prefix).
 */
@Controller('v1/internal/membership')
export class InternalMembershipController {
  constructor(private readonly membership: MembershipQueryService) {}

  @Post('batch')
  @Public()
  @ApiExcludeEndpoint()
  async getMembershipBatch(
    @Body() body: MembershipBatchRequestDto,
  ): Promise<MembershipBatchResponseDto> {
    const entries = await this.membership.getMembershipBatch(
      body.user_id,
      body.conversation_ids,
    );
    return { entries };
  }

  @Post('send-permission')
  @Public()
  @ApiExcludeEndpoint()
  async getSendPermission(
    @Body() body: SendPermissionRequestDto,
  ): Promise<SendPermissionResponseDto> {
    return this.membership.getSendPermission(
      body.user_id,
      body.conversation_id,
    );
  }

  @Post('active-members')
  @Public()
  @ApiExcludeEndpoint()
  async listActiveMembers(
    @Body() body: ActiveMembersRequestDto,
  ): Promise<ActiveMembersResponseDto> {
    const member_ids = await this.membership.listActiveMemberIds(
      body.conversation_id,
    );
    return { member_ids };
  }
}
