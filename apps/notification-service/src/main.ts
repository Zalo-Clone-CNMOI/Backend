import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'notification-service';
  process.env.KAFKA_GROUP_ID ??= 'notification-service';

  const config = loadConfig(process.env.SERVICE_NAME);
  const app = await NestFactory.createMicroservice(
    AppModule,
    createKafkaMicroserviceOptions(config),
  );
  await app.listen();
}

void bootstrap();
