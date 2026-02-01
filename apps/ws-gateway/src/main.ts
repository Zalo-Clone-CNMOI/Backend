import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './socket/redis-io.adapter';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'ws-gateway';
  process.env.KAFKA_GROUP_ID ??= 'ws-gateway-fanout';

  const config = loadConfig(process.env.SERVICE_NAME);

  console.log('[Bootstrap] Creating Nest application for ws-gateway...');
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const redisUrl = process.env.REDIS_URL;
  const adapter = new RedisIoAdapter(app);

  if (redisUrl) {
    console.log('[Bootstrap] Initializing Redis adapter...');
    await adapter.connectToRedis();
  } else {
    console.warn('[Bootstrap] REDIS_URL not set. Using in-memory adapter.');
  }

  app.useWebSocketAdapter(adapter);

  console.log('[Bootstrap] Connecting Kafka microservice(s)...');
  app.connectMicroservice(createKafkaMicroserviceOptions(config));
  await app.startAllMicroservices();
  console.log('[Bootstrap] Kafka microservices started.');

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  console.log(
    `[Bootstrap] HTTP & WebSocket server listening on 0.0.0.0:${port}`,
  );
  console.log(`🚀 Application is running on: ${await app.getUrl()}`);
  console.log(`📡 WebSocket server running on port ${port}`);
}

void bootstrap();
