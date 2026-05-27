import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT, publishKafkaWithRetry } from '@libs/kafka';

@Injectable()
export class AiPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiPublisher.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async onModuleDestroy() {
    try {
      await this.kafka.close();
    } catch (err) {
      this.logger.warn(
        `Kafka close error during shutdown: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * @param key Optional Kafka partition key. Pass it for events that must
   *   stay ordered per-entity under a multi-instance consumer (e.g. AI
   *   stream chunks keyed by stream_id). Omit for fire-and-forget events.
   */
  async emit(topic: string, payload: unknown, key?: string): Promise<void> {
    await publishKafkaWithRetry({
      kafka: this.kafka,
      logger: this.logger,
      topic,
      payload,
      key,
      producer: AiPublisher.name,
    });
  }
}
