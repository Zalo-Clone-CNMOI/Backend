import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '@libs/config';
import { Client } from 'cassandra-driver';
import { SCYLLA_CLIENT } from './scylla.tokens';
import { MessageRepository } from './repositories/message.repository';

@Module({
  providers: [
    {
      provide: SCYLLA_CLIENT,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
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
        await client.connect();
        return client;
      },
    },
    MessageRepository,
  ],
  exports: [SCYLLA_CLIENT, MessageRepository],
})
export class ScyllaModule {}
