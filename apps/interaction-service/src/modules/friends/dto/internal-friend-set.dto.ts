import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString, ArrayMaxSize } from 'class-validator';

/**
 * Internal (service-to-service) DTOs for ws-gateway friend-set checks.
 * Backs the @Public internal endpoint /v1/internal/friends/friend-set used by
 * the forwarded-message fanout to decide which recipients may see the original
 * sender's identity. Not part of the public API.
 */

export class FriendSetRequestDto {
  @ApiProperty({ description: 'User the candidates are checked against' })
  @IsString()
  @IsNotEmpty()
  reference_user_id!: string;

  @ApiProperty({
    description: 'Candidate user IDs to test for friendship',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  candidate_ids!: string[];
}

export class FriendSetResponseDto {
  @ApiProperty({
    description: 'Subset of candidate_ids that are friends with the reference',
    type: [String],
  })
  friend_ids!: string[];
}
