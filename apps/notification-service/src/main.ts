import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';
import { HttpExceptionFilter, RpcAllExceptionsFilter } from '@app/interceptors';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'notification-service';

  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env.SERVICE_NAME);

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.connectMicroservice<MicroserviceOptions>(
    createKafkaMicroserviceOptions(config),
    { inheritAppConfig: true },
  );

  app.useGlobalFilters(new HttpExceptionFilter(), new RpcAllExceptionsFilter());

  await app.startAllMicroservices();

  const port = Number(process.env.PORT ?? 3004);
  await app.listen(port);

  logger.log(`Notification Service running on port ${port}`);
  logger.log(`Kafka microservice connected (group: ${config.kafkaGroupId})`);
}

void bootstrap();
