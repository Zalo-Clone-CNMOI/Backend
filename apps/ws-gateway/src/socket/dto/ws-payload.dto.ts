import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WsAttachmentTypes,
  WsPayloadLimits,
  WsReactionTypes,
} from '@libs/contracts';

export class WsChatJoinPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;
}

export class WsMessageAttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.attachmentKeyMaxLength)
  key!: string;

  @IsIn(WsAttachmentTypes)
  type!: (typeof WsAttachmentTypes)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.attachmentNameMaxLength)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WsPayloadLimits.attachmentMaxBytes)
  size!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.attachmentContentTypeMaxLength)
  content_type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.attachmentKeyMaxLength)
  thumbnail_key?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}

export class WsChatSendPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  body!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sent_at!: number;

  @IsOptional()
  @ArrayMaxSize(WsPayloadLimits.attachmentsMaxItems)
  @ValidateNested({ each: true })
  @Type(() => WsMessageAttachmentDto)
  attachments?: WsMessageAttachmentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.idMaxLength)
  reply_to_message_id?: string;
}

export class WsChatEditPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  new_body!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  created_at!: number;
}

export class WsChatDeletePayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  created_at!: number;
}

export class WsChatReactPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsIn(WsReactionTypes)
  reaction_type!: (typeof WsReactionTypes)[number];
}

export class WsChatUnreactPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;
}

export class WsChatTypingPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.usernameMaxLength)
  username!: string;
}

export class WsPresenceHeartbeatPayloadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ts!: number;
}

export class WsAiSmartReplyRequestPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  last_message_id!: string;

  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  last_message_body!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(WsPayloadLimits.aiContextCountMin)
  @Max(WsPayloadLimits.aiContextCountMax)
  context_count?: number;
}

export class WsAiSummaryRequestPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(WsPayloadLimits.aiSummaryMessageCountMin)
  @Max(WsPayloadLimits.aiSummaryMessageCountMax)
  message_count?: number;
}

export class WsAiTranslateRequestPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  message_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.aiLanguageCodeMaxLength)
  source_language?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.aiLanguageCodeMaxLength)
  target_language!: string;
}

export class WsAiDocumentQueryRequestPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  document_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.aiQueryMaxLength)
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(WsPayloadLimits.aiDocumentTopKMin)
  @Max(WsPayloadLimits.aiDocumentTopKMax)
  top_k?: number;
}
