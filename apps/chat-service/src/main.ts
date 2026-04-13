import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';
import { RpcAllExceptionsFilter } from '@app/interceptors';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'chat-service';

  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env.SERVICE_NAME);

  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>(
    createKafkaMicroserviceOptions(config),
    {
      inheritAppConfig: true,
    },
  );

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new RpcAllExceptionsFilter());

  await app.startAllMicroservices();

  const port = Number(process.env.PORT ?? 5002);
  await app.listen(port);

  logger.log(`Chat Service running on port ${port}`);
  logger.log(`Kafka microservice connected`);
}

void bootstrap();
