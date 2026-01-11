import { Transport, type KafkaOptions } from '@nestjs/microservices';
import type { AppConfig } from '@libs/config';

export function createKafkaMicroserviceOptions(
  config: AppConfig,
): KafkaOptions {
  return {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: config.kafkaClientId,
        brokers: config.kafkaBrokers,
      },
      consumer: {
        groupId: config.kafkaGroupId ?? `${config.serviceName}-group`,
      },
      subscribe: {
        fromBeginning: false,
      },
    },
  };
}
