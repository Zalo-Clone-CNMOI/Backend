import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT, publishKafkaWithRetry } from '@libs/kafka';
import { APP_CONFIG, AppConfig } from '@libs/config';
import {
  KafkaTopics,
  type ChatAiMessageCommand,
  type AiMessageMetadata,
  type MessageAttachment,
  type MessageBodyFormat,
} from '@libs/contracts';

export interface AiChatSendInput {
  message_id: string;
  conversation_id: string;
  body: string;
  trace_id: string;
  /** Default 'text'. Set 'markdown' only when frontend is known to render markdown. */
  body_format?: MessageBodyFormat;
  attachments?: MessageAttachment[];
  metadata?: AiMessageMetadata;
  /** Override created_at; defaults to Date.now() */
  created_at?: number;
}

/**
 * Publishes a Zai-authored message into a conversation. The chat-service
 * AiMessageConsumer validates sender_id == config.zaiBotUserId before persisting.
 */
@Injectable()
export class AiChatPublisher {
  private readonly logger = new Logger(AiChatPublisher.name);

  /**
   * NOTE: The shared KAFKA_CLIENT is connected/closed by AiPublisher.
   * Do NOT add OnModuleInit/OnModuleDestroy here — duplicate lifecycle
   * hooks would double-connect or race-close the same client instance.
   */
  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send(input: AiChatSendInput): Promise<void> {
    const payload: ChatAiMessageCommand = {
      message_id: input.message_id,
      conversation_id: input.conversation_id,
      sender_id: this.config.zaiBotUserId,
      body: input.body,
      body_format: input.body_format,
      attachments: input.attachments,
      metadata: input.metadata,
      created_at: input.created_at ?? Date.now(),
      trace_id: input.trace_id,
    };

    await publishKafkaWithRetry({
      kafka: this.kafka,
      logger: this.logger,
      topic: KafkaTopics.ChatAiMessage,
      payload,
      producer: AiChatPublisher.name,
    });
  }
}
