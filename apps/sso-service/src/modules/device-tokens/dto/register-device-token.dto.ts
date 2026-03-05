import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM device token',
    example: 'dXxVmq7ZRaK...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'Device platform',
    enum: ['ios', 'android', 'web'],
    example: 'android',
  })
  @IsEnum(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  @ApiProperty({
    description: 'Unique device identifier (optional)',
    example: 'device-uuid-123',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
