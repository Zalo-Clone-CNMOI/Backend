import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TransferOwnershipDto {
  @ApiProperty({ description: 'UUID of member to promote to OWNER' })
  @IsUUID()
  targetUserId: string;
}
