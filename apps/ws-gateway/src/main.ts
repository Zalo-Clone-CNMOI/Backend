import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './socket/redis-io.adapter';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';


async function bootstrap() {
  process.env.SERVICE_NAME ??= 'ws-gateway';
  process.env.KAFKA_GROUP_ID ??= 'ws-gateway-fanout';

  const config = loadConfig(process.env.SERVICE_NAME);

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  if (process.env.REDIS_URL) {
    console.log('🔧 Setting up Redis Adapter...');
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    app.useWebSocketAdapter(adapter);
    console.log(
      `✅ Redis Adapter initialized with URL: ${process.env.REDIS_URL}`,
    );
  } else {
    console.warn(
      '⚠️ NO REDIS URL FOUND - Socket will run in Memory mode (Not reliable for Cluster)',
    );
  }

  app.connectMicroservice(createKafkaMicroserviceOptions(config));
  await app.startAllMicroservices();
  console.log('✅ Kafka microservices started');

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on: ${await app.getUrl()}`);
  console.log(`📡 WebSocket server running on port ${port}`);
}

void bootstrap();
