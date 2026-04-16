import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ForwardTargetDto {
  @IsUUID()
  @IsNotEmpty()
  message_id!: string;

  @IsUUID()
  @IsNotEmpty()
  conversation_id!: string;
}

export class ForwardMessageDto {
  @IsUUID()
  @IsNotEmpty()
  forward_id!: string;

  @IsUUID()
  @IsNotEmpty()
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
