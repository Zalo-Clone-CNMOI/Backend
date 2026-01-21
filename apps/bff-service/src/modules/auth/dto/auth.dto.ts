import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsEmail,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { RegisterDtoGenderEnum } from '@app/clients';

/**
 * Register request DTO
 */
export class RegisterDto {
  @ApiProperty({
    description: 'Firebase ID Token after phone verification',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlM...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Firebase ID token is required' })
  firebaseIdToken: string;

  @ApiProperty({
    description:
      'Password (min 8 chars, must contain uppercase, lowercase, number)',
    example: 'SecurePass123!',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(50, { message: 'Password must not exceed 50 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'Password must contain at least one uppercase, one lowercase, and one number',
  })
  password: string;

  @ApiProperty({
    description: 'Full name',
    example: 'Nguyễn Văn A',
  })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(255, { message: 'Full name must not exceed 255 characters' })
  fullName: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Date of birth (ISO format)',
    example: '1995-06-15',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Invalid date format' })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Gender',
    enum: RegisterDtoGenderEnum,
    example: RegisterDtoGenderEnum.male,
  })
  @IsOptional()
  @IsEnum(RegisterDtoGenderEnum, { message: 'Invalid gender value' })
  gender?: RegisterDtoGenderEnum;
}

/**
 * Login request DTO
 */
export class LoginDto {
  @ApiProperty({
    description: 'Phone number',
    example: '+84901234567',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone: string;

  @ApiProperty({
    description: 'Password',
    example: 'SecurePass123!',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;
}

/**
 * Refresh token request DTO
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken: string;
}

/**
 * Logout request DTO
 */
export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Device ID to remove from notifications',
    example: 'device-uuid-xyz',
  })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

/**
 * Forgot password request DTO
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Phone number',
    example: '+84901234567',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^(\+84|0)[3-9][0-9]{8}$/, {
    message: 'Phone number must be a valid Vietnam phone number',
  })
  phone: string;
}

/**
 * Reset password request DTO
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'Phone number',
    example: '+84901234567',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone: string;

  @ApiProperty({
    description: 'OTP code',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty({ message: 'OTP is required' })
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePass123!',
  })
  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'Password must contain at least one uppercase, one lowercase, and one number',
  })
  newPassword: string;
}
