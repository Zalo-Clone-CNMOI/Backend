import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  WsAttachmentTypes,
  WsCallSignalTypes,
  WsCallTypes,
  WsPayloadLimits,
  WsReactionTypes,
  type CallConversationType,
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

export class WsMentionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  user_id!: string;

  @IsIn(['user', 'all'])
  mention_type!: 'user' | 'all';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(WsPayloadLimits.mentionOffsetMax)
  offset!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WsPayloadLimits.mentionLengthMax)
  length!: number;
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
  @IsNotEmpty()
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

  @IsOptional()
  @ArrayMaxSize(WsPayloadLimits.mentionsMaxItems)
  @ValidateNested({ each: true })
  @Type(() => WsMentionDto)
  mentions?: WsMentionDto[];
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

export class WsCallStartPayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @IsIn(['direct', 'group'])
  conversation_type!: CallConversationType;

  @IsIn(WsCallTypes)
  call_type!: (typeof WsCallTypes)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WsPayloadLimits.callParticipantsMaxItems)
  @IsString({ each: true })
  @MaxLength(WsPayloadLimits.idMaxLength, { each: true })
  participant_ids?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  started_at!: number;
}

export class WsCallSignalPayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @IsOptional()
  @IsUUID()
  target_user_id?: string;

  @IsIn(WsCallSignalTypes)
  signal_type!: (typeof WsCallSignalTypes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.callSignalTextMaxLength)
  sdp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.callSignalTextMaxLength)
  candidate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.idMaxLength)
  sdp_mid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sdp_mline_index?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sent_at!: number;
}

export class WsCallAcceptPayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  accepted_at!: number;
}

export class WsCallRejectPayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  reason?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  rejected_at!: number;
}

export class WsCallEndPayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  reason?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ended_at!: number;
}

export class WsCallLeavePayloadDto {
  @IsUUID()
  call_id!: string;

  @IsUUID()
  conversation_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WsPayloadLimits.messageBodyMaxLength)
  reason?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  left_at!: number;
}

export class WsCallStateRequestPayloadDto {
  @IsUUID()
  conversation_id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  requested_at!: number;
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
  @IsNotEmpty()
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

export class WsAiStreamCancelPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(WsPayloadLimits.idMaxLength)
  conversation_id!: string;
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
  @IsNotEmpty()
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
