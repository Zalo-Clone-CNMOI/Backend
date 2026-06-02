import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiEntityDetectionLog } from '@libs/database/entities';
import { MessageRepository } from '@libs/scylla';
import type { DetectedEntity, EntityType } from '@libs/contracts';

const MIN_CONFIDENCE = 0.75; // mirrors EntityHighlightText CONFIDENCE_THRESHOLD
const FETCH_CAP = 500; // mirrors catch-up FETCH_CAP for body lookup

export interface MessageEntities {
  message_id: string;
  entities: DetectedEntity[];
}

/**
 * Restores historical entity highlights for a conversation. The DB log
 * (`m_ai_entity_detection_logs`) stores only {text, type, confidence} — NOT
 * char offsets — so we re-derive start_index/end_index against the live message
 * body from ScyllaDB, identical to EntityDetectionEngine.normalizeEntity. This
 * keeps offsets authoritative and avoids a schema migration.
 */
@Injectable()
export class EntityDetectionHistoryService {
  constructor(
    @InjectRepository(AiEntityDetectionLog)
    private readonly logRepo: Repository<AiEntityDetectionLog>,
    private readonly messageRepo: MessageRepository,
  ) {}

  async getForConversation(conversationId: string): Promise<MessageEntities[]> {
    const logs = await this.logRepo.find({
      where: { conversationId },
    });
    if (logs.length === 0) return [];

    const messages = await this.messageRepo.getAllMessages(
      conversationId,
      FETCH_CAP,
    );
    const bodyById = new Map<string, string>(
      messages.map((m) => [m.message_id, m.body ?? '']),
    );

    return logs.map((log) => {
      const body = bodyById.get(log.messageId) ?? '';
      const entities: DetectedEntity[] = [];
      for (const e of log.entities ?? []) {
        if (typeof e.confidence === 'number' && e.confidence < MIN_CONFIDENCE) {
          continue;
        }
        const start_index = body.toLowerCase().indexOf(e.text.toLowerCase());
        if (start_index < 0) continue;
        entities.push({
          text: e.text,
          type: e.type as EntityType,
          confidence: e.confidence,
          start_index,
          end_index: start_index + e.text.length,
        });
      }
      return { message_id: log.messageId, entities };
    });
  }
}
