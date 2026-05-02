import {
  GroupInviteStatus,
  UpdateMemberRoleDtoRoleEnum,
} from '@app/clients/interaction-client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
  IsBoolean,
  IsEnum,
  MinLength,
  IsInt,
  Min,
  Max,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Create group conversation DTO
 */
export class CreateGroupConversationDto {
  @ApiProperty({
    description: 'Group name',
    example: 'Team Alpha',
  })
  @IsString()
  @IsNotEmpty({ message: 'Group name is required' })
  @MaxLength(255, { message: 'Group name must not exceed 255 characters' })
  name: string;

  @ApiProperty({
    description: 'Member user IDs',
    example: ['uuid1', 'uuid2'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 member is required' })
  @ArrayMaxSize(100, { message: 'Maximum 100 members allowed' })
  @IsUUID('4', { each: true, message: 'Each member ID must be a valid UUID' })
  memberIds: string[];

  @ApiPropertyOptional({
    description: 'Group avatar object key',
    example: 'public/group/avatar.png',
  })
  @IsOptional()
  @IsString({ message: 'Invalid avatar key' })
  @Matches(/^(public|private)\/[-A-Za-z0-9._/]+$/, {
    message:
      'Avatar key must start with public/ or private/ and contain only valid key characters',
  })
  avatarUrl?: string;
}

/**
 * Create direct conversation DTO
 */
export class CreateDirectConversationDto {
  @ApiProperty({
    description: 'User ID to start conversation with',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'Invalid user ID format' })
  @IsNotEmpty({ message: 'User ID is required' })
  participantId: string;
}

/**
 * Update conversation DTO
 */
export class UpdateConversationDto {
  @ApiPropertyOptional({
    description: 'Group name',
    example: 'New Team Name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Group name must not exceed 255 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Group avatar object key',
    example: 'public/group/new-avatar.png',
  })
  @IsOptional()
  @IsString({ message: 'Invalid avatar key' })
  @Matches(/^(public|private)\/[-A-Za-z0-9._/]+$/, {
    message:
      'Avatar key must start with public/ or private/ and contain only valid key characters',
  })
  avatarUrl?: string;
}

/**
 * Add members to group DTO
 */
export class AddMembersDto {
  @ApiProperty({
    description: 'Member IDs to add',
    example: ['uuid1', 'uuid2'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 member is required' })
  @ArrayMaxSize(50, { message: 'Maximum 50 members can be added at once' })
  @IsUUID('4', { each: true, message: 'Each member ID must be a valid UUID' })
  memberIds: string[];
}

/**
 * Update member role DTO
 */
export class UpdateMemberRoleDto {
  @ApiProperty({
    description: 'New role for the member',
    example: UpdateMemberRoleDtoRoleEnum.admin,
    enum: UpdateMemberRoleDtoRoleEnum,
  })
  @IsEnum(UpdateMemberRoleDtoRoleEnum, { message: 'Invalid conversation role' })
  @IsNotEmpty()
  role: UpdateMemberRoleDtoRoleEnum;
}

/**
 * Update member settings DTO
 */
export class UpdateMemberSettingsDto {
  @ApiPropertyOptional({
    description: 'Nickname in this conversation',
    example: 'My Nickname',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Nickname must not exceed 100 characters' })
  nickname?: string;

  @ApiPropertyOptional({
    description: 'Whether to mute notifications',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;
}

/**
 * End active call DTO
 */
export class EndConversationCallDto {
  @ApiPropertyOptional({
    description: 'Optional reason for ending the call',
    example: 'user_hangup',
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Reason must not be empty' })
  @MaxLength(255, { message: 'Reason must not exceed 255 characters' })
  reason?: string;
}

/**
 * Send group invites DTO
 */
export class SendGroupInvitesDto {
  @ApiProperty({
    description: 'User IDs to invite',
    example: ['550e8400-e29b-41d4-a716-446655440001'],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least 1 user is required' })
  @ArrayMaxSize(50, { message: 'Maximum 50 users can be invited at once' })
  @IsUUID('4', { each: true, message: 'Each user ID must be a valid UUID' })
  userIds: string[];

  @ApiPropertyOptional({
    description: 'Optional invite message',
    example: 'Join our project planning group',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Message must not exceed 500 characters' })
  message?: string;

  @ApiPropertyOptional({
    description: 'Invite expiration in hours',
    example: 168,
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}

/**
 * Group invite query DTO
 */
export class GetGroupInvitesQueryDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Invite status filter',
    enum: GroupInviteStatus,
  })
  @IsOptional()
  @IsEnum(GroupInviteStatus)
  status?: GroupInviteStatus;
}

export class UpdatePermissionsDto {
  @ApiPropertyOptional({
    description: 'Permission to change conversation info',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  change_info?: boolean;
  @ApiPropertyOptional({
    description: 'Permission to pin messages',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pin_message?: boolean;
  @ApiPropertyOptional({
    description: 'Permission to create notes',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  create_note?: boolean;
  @ApiPropertyOptional({
    description: 'Permission to create polls',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  create_poll?: boolean;
  @ApiPropertyOptional({
    description: 'Permission to send messages',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  send_message?: boolean;
}

export class UpdatePoliciesDto {
  @ApiPropertyOptional({
    description: 'Whether join approval is required',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  join_approval?: boolean;
  @ApiPropertyOptional({
    description: 'Whether to allow reading chat history',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_read_history?: boolean;
  @ApiPropertyOptional({
    description: 'Whether to allow joining via link',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_join_link?: boolean;
}

export class UpdateFeaturesDto {
  @ApiPropertyOptional({
    description: 'Whether admin tagging is enabled',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  admin_tagging?: boolean;
}

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description: 'Updated permissions',
    type: () => UpdatePermissionsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePermissionsDto)
  permissions?: UpdatePermissionsDto;

  @ApiPropertyOptional({
    description: 'Updated policies',
    type: () => UpdatePoliciesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePoliciesDto)
  policies?: UpdatePoliciesDto;

  @ApiPropertyOptional({
    description: 'Updated features',
    type: () => UpdateFeaturesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateFeaturesDto)
  features?: UpdateFeaturesDto;
}
