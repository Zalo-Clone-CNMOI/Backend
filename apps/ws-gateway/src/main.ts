import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './socket/redis-io.adapter';
import { loadConfig, assertProductionCors } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';

async function bootstrap() {
  const logger = new Logger('WsGatewayBootstrap');
  process.env.SERVICE_NAME ??= 'ws-gateway';
  process.env.KAFKA_GROUP_ID ??= 'ws-gateway-fanout';

  const config = loadConfig(process.env.SERVICE_NAME);
  assertProductionCors(config);

  logger.log('[Bootstrap] Creating Nest application for ws-gateway...');
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: config.allowedOrigins,
    credentials: true,
  });

  const redisUrl = process.env.REDIS_URL;
  const adapter = new RedisIoAdapter(app, config.allowedOrigins);

  if (redisUrl) {
    logger.log('[Bootstrap] Initializing Redis adapter...');
    await adapter.connectToRedis();
  } else {
    logger.warn('[Bootstrap] REDIS_URL not set. Using in-memory adapter.');
  }

  app.useWebSocketAdapter(adapter);

  logger.log('[Bootstrap] Connecting Kafka microservice(s)...');
  app.connectMicroservice(createKafkaMicroserviceOptions(config), {
    inheritAppConfig: true,
  });
  await app.startAllMicroservices();
  logger.log('[Bootstrap] Kafka microservices started.');

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  logger.log(
    `[Bootstrap] HTTP & WebSocket server listening on 0.0.0.0:${port}`,
  );
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`WebSocket server running on port ${port}`);
}

void bootstrap();
