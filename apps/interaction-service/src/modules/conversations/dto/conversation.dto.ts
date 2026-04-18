import { UpdateMemberRoleDtoRoleEnum } from '@app/constant';
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
  IsUrl,
  IsBoolean,
  IsEnum,
  MinLength,
} from 'class-validator';

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
    description: 'Group avatar URL',
    example: 'https://example.com/avatar.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid avatar URL' })
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
    description: 'Group avatar URL',
    example: 'https://example.com/new-avatar.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid avatar URL' })
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
    example: UpdateMemberRoleDtoRoleEnum.ADMIN,
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
