import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WsPayloadLimits } from '@libs/contracts';
import {
  WsAiDocumentQueryRequestPayloadDto,
  WsAiTranslateRequestPayloadDto,
  WsChatSendPayloadDto,
} from './ws-payload.dto';

describe('Ws payload DTO validation', () => {
  describe('WsChatSendPayloadDto', () => {
    it('should reject body larger than configured message limit', async () => {
      const payload = plainToInstance(WsChatSendPayloadDto, {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        body: 'x'.repeat(WsPayloadLimits.messageBodyMaxLength + 1),
        sent_at: Date.now(),
      });

      const errors = await validate(payload);

      expect(errors.some((error) => error.property === 'body')).toBe(true);
    });

    it('should reject too many attachments', async () => {
      const attachments = Array.from(
        { length: WsPayloadLimits.attachmentsMaxItems + 1 },
        (_, index) => ({
          key: `k-${index}`,
          type: 'image',
          name: `n-${index}`,
          size: 10,
          content_type: 'image/png',
        }),
      );

      const payload = plainToInstance(WsChatSendPayloadDto, {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        body: 'ok',
        sent_at: Date.now(),
        attachments,
      });

      const errors = await validate(payload);

      expect(errors.some((error) => error.property === 'attachments')).toBe(
        true,
      );
    });
  });

  describe('WsAiTranslateRequestPayloadDto', () => {
    it('should reject target language over limit', async () => {
      const payload = plainToInstance(WsAiTranslateRequestPayloadDto, {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        body: 'xin chao',
        target_language: 'x'.repeat(
          WsPayloadLimits.aiLanguageCodeMaxLength + 1,
        ),
      });

      const errors = await validate(payload);

      expect(errors.some((error) => error.property === 'target_language')).toBe(
        true,
      );
    });
  });

  describe('WsAiDocumentQueryRequestPayloadDto', () => {
    it('should reject top_k larger than limit', async () => {
      const payload = plainToInstance(WsAiDocumentQueryRequestPayloadDto, {
        document_id: 'doc-1',
        conversation_id: 'conv-1',
        query: 'where is this mentioned?',
        top_k: WsPayloadLimits.aiDocumentTopKMax + 1,
      });

      const errors = await validate(payload);

      expect(errors.some((error) => error.property === 'top_k')).toBe(true);
    });
  });
});
