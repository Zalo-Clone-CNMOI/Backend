import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MaxLength,
  IsEmail,
  IsDateString,
  IsEnum,
  MinLength,
  IsUrl,
  IsNotEmpty,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateProfileDtoGenderEnum } from '@app/clients';

/**
 * Update current user profile DTO
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Full name',
    example: 'Nguyễn Văn A',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(255, { message: 'Full name must not exceed 255 characters' })
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Bio/About me',
    example: 'Hello, I am a software developer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Bio must not exceed 500 characters' })
  bio?: string;

  @ApiPropertyOptional({
    description: 'Avatar URL',
    example: 'https://example.com/avatar.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Invalid avatar URL' })
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Date of birth (ISO format)',
    example: '1995-06-15',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Invalid date format' })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Gender',
    enum: UpdateProfileDtoGenderEnum,
    example: UpdateProfileDtoGenderEnum.male,
  })
  @IsOptional()
  @IsEnum(UpdateProfileDtoGenderEnum, { message: 'Invalid gender value' })
  gender?: UpdateProfileDtoGenderEnum;
}

/**
 * Search users query DTO
 */
export class SearchUsersDto {
  @ApiProperty({
    description: 'Search query (phone or name)',
    example: 'Nguyen',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  @MaxLength(50, { message: 'Search query must not exceed 50 characters' })
  q: string;

  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
