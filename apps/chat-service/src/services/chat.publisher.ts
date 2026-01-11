import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';

@Injectable()
export class ChatPublisher implements OnModuleInit {
  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  emit(topic: string, payload: unknown) {
    return this.kafka.emit(topic, payload);
  }
}
