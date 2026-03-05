import { ApiProperty } from '@nestjs/swagger';

export class DeviceTokenResponseDto {
  @ApiProperty({ example: 'uuid-123' })
  id: string;

  @ApiProperty({ example: 'dXxVmq7ZRaK...' })
  token: string;

  @ApiProperty({ example: 'android' })
  platform: 'ios' | 'android' | 'web';

  @ApiProperty({ example: 'device-uuid-123', nullable: true })
  deviceId: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-02-09T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-02-09T12:00:00.000Z' })
  updatedAt: Date;
}
