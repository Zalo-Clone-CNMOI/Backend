import { KAFKA_CLIENT, publishKafkaWithRetry } from '@libs/kafka';
import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';

@Injectable()
export class MediaPublisher implements OnModuleInit {
  private readonly logger = new Logger(MediaPublisher.name);

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
      producer: MediaPublisher.name,
    });
  }
}
