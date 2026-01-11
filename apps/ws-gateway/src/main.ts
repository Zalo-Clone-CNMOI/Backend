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

  app.connectMicroservice(createKafkaMicroserviceOptions(config));
  await app.startAllMicroservices();

  if (process.env.REDIS_URL) {
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    app.useWebSocketAdapter(adapter);
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
