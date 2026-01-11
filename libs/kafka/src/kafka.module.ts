import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import { KAFKA_CLIENT } from './kafka.tokens';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: KAFKA_CLIENT,
        inject: [APP_CONFIG],
        useFactory: (config: AppConfig) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: config.kafkaClientId,
              brokers: config.kafkaBrokers,
            },
            consumer: {
              groupId: config.kafkaGroupId ?? `${config.serviceName}-group`,
            },
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class KafkaModule {}
