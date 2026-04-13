import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT, publishKafkaWithRetry } from '@libs/kafka';

@Injectable()
export class AiPublisher implements OnModuleInit {
  private readonly logger = new Logger(AiPublisher.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  async emit(topic: string, payload: unknown): Promise<void> {
    await publishKafkaWithRetry({
      kafka: this.kafka,
      logger: this.logger,
      topic,
      payload,
      producer: AiPublisher.name,
    });
  }
}
