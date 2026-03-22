import { Module, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import { Client } from 'cassandra-driver';
import { SCYLLA_CLIENT } from './scylla.tokens';
import { MessageRepository } from './repositories/message.repository';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

@Module({
  providers: [
    {
      provide: SCYLLA_CLIENT,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        const logger = new Logger('ScyllaModule');
        const client = new Client({
          contactPoints: config.scyllaContactPoints,
          localDataCenter: config.scyllaLocalDatacenter,
          keyspace: config.scyllaKeyspace,
          pooling: {
            coreConnectionsPerHost: {
              '0': 2,
              '1': 2,
            },
          },
          socketOptions: {
            readTimeout: 5000,
          },
        });

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            await client.connect();
            logger.log('Connected to ScyllaDB');
            return client;
          } catch (error) {
            logger.warn(
              `ScyllaDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`,
            );
            if (attempt === MAX_RETRIES) throw error;
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }

        return client;
      },
    },
    MessageRepository,
  ],
  exports: [SCYLLA_CLIENT, MessageRepository],
})
export class ScyllaModule {}
