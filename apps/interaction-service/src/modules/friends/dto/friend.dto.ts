import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Send friend request DTO
 */
export class SendFriendRequestDto {
  @ApiProperty({
    description: 'User ID to send friend request to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'Invalid user ID format' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId: string;

  @ApiPropertyOptional({
    description: 'Optional message with the request',
    example: 'Hi, I would like to add you as a friend!',
  })
  @IsOptional()
  @IsString()
  message?: string;
}

/**
 * Respond to friend request DTO
 */
export class RespondFriendRequestDto {
  @ApiProperty({
    description: 'Accept or reject the friend request',
    example: 'accept',
    enum: ['accept', 'reject'],
  })
  @IsNotEmpty()
  @IsString()
  action: 'accept' | 'reject';
}
