import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  ArrayMaxSize,
} from 'class-validator';
import { ConversationType } from '@app/constant';

/**
 * Internal (service-to-service) DTOs for ws-gateway membership checks.
 * These back the @Public internal endpoints under /v1/internal/membership.
 * ws-gateway calls them on a local-cache miss; the responses are then cached
 * in ws-gateway with the same TTLs the old in-process ConversationMembership-
 * Service used. Not part of the public API (controllers use @ApiExcludeEndpoint).
 */

export class MembershipBatchRequestDto {
  @ApiProperty({ description: 'User whose membership is being checked' })
  @IsString()
  @IsNotEmpty()
  user_id!: string;

  @ApiProperty({
    description: 'Conversation IDs to check membership/type for',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  conversation_ids!: string[];
}

export class MembershipEntryDto {
  @ApiProperty()
  conversation_id!: string;

  @ApiProperty({ description: 'True if user is an active member' })
  allowed!: boolean;

  @ApiProperty({
    description: 'Conversation type, or null if no access / not found',
    enum: ConversationType,
    nullable: true,
  })
  conversation_type!: ConversationType | null;
}

export class MembershipBatchResponseDto {
  @ApiProperty({ type: [MembershipEntryDto] })
  entries!: MembershipEntryDto[];
}

export class SendPermissionRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  user_id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  conversation_id!: string;
}

export class SendPermissionResponseDto {
  @ApiProperty()
  allowed!: boolean;

  @ApiProperty({ required: false, nullable: true })
  reason?: string;
}

export class ActiveMembersRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  conversation_id!: string;
}

export class ActiveMembersResponseDto {
  @ApiProperty({ type: [String] })
  member_ids!: string[];
}
