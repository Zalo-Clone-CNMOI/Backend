import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ForwardTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversation_id!: string;
}

export class ForwardMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  forward_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  source_message_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ForwardTargetDto)
  targets!: ForwardTargetDto[];
}

export class ForwardTargetResultDto {
  message_id!: string;
  conversation_id!: string;
  status!: 'accepted' | 'rejected';
  reason?: string;
}

export class ForwardMessageResultDto {
  forward_id!: string;
  results!: ForwardTargetResultDto[];
}
