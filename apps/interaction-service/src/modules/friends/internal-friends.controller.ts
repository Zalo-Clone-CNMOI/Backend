import { Body, Controller, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@app/decorator';
import { FriendsService } from './friends.service';
import { FriendSetRequestDto, FriendSetResponseDto } from './dto';

/**
 * Internal, service-to-service endpoint for ws-gateway friend-set checks.
 * Used by the forwarded-message fanout to decide which recipients may see the
 * original sender's identity. @Public bypasses the global JwtAuthGuard (internal
 * network only); @ApiExcludeEndpoint hides it from public Swagger.
 *
 * Reachable at /api/v1/internal/friends/friend-set.
 */
@Controller('v1/internal/friends')
export class InternalFriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Post('friend-set')
  @Public()
  @ApiExcludeEndpoint()
  async getFriendSet(
    @Body() body: FriendSetRequestDto,
  ): Promise<FriendSetResponseDto> {
    const friend_ids = await this.friends.getFriendSet(
      body.reference_user_id,
      body.candidate_ids,
    );
    return { friend_ids };
  }
}
