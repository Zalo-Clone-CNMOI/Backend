import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Friend info response
 */
export class FriendResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Full name' })
  fullName: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Phone number' })
  phone: string;

  @ApiPropertyOptional({ description: 'Last seen timestamp' })
  lastSeenAt: Date | null;

  @ApiProperty({ description: 'Friendship created at' })
  friendsSince: Date;
}

/**
 * Friend request response
 */
export class FriendRequestResponseDto {
  @ApiProperty({ description: 'Friend request ID' })
  id: string;

  @ApiProperty({ description: 'User info of the requester' })
  user: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    phone: string;
  };

  @ApiPropertyOptional({ description: 'Request message' })
  message: string | null;

  @ApiProperty({ description: 'Request created at' })
  createdAt: Date;
}

/**
 * Sent friend request response
 */
export class SentFriendRequestResponseDto {
  @ApiProperty({ description: 'Friend request ID' })
  id: string;

  @ApiProperty({ description: 'User info of the addressee' })
  user: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  };

  @ApiProperty({ description: 'Request created at' })
  createdAt: Date;
}
