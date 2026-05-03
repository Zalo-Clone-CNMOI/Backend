export const WsPayloadLimits = {
  idMaxLength: 128,
  usernameMaxLength: 80,
  messageBodyMaxLength: 4000,
  aiQueryMaxLength: 2000,
  aiLanguageCodeMaxLength: 16,
  aiContextCountMin: 1,
  aiContextCountMax: 50,
  aiSummaryMessageCountMin: 1,
  aiSummaryMessageCountMax: 200,
  aiDocumentTopKMin: 1,
  aiDocumentTopKMax: 20,
  attachmentsMaxItems: 10,
  attachmentKeyMaxLength: 512,
  attachmentNameMaxLength: 255,
  attachmentContentTypeMaxLength: 128,
  attachmentMaxBytes: 50 * 1024 * 1024,
  callParticipantsMaxItems: 50,
  callSignalTextMaxLength: 12000,
  mentionsMaxItems: 50,
  mentionOffsetMax: 5000,
  mentionLengthMax: 100,
} as const;

export const WsReactionTypes = [
  'like',
  'love',
  'haha',
  'wow',
  'sad',
  'angry',
] as const;

export const WsAttachmentTypes = [
  'image',
  'video',
  'audio',
  'document',
] as const;

export const WsCallTypes = ['audio', 'video'] as const;

export const WsCallSignalTypes = [
  'offer',
  'answer',
  'ice-candidate',
  'renegotiate',
] as const;
