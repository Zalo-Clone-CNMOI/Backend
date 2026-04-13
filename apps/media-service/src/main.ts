import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { HttpExceptionFilter, RpcAllExceptionsFilter } from '@app/interceptors';
import { loadConfig, assertProductionCors } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'media-service';

  const logger = new Logger('Bootstrap');
  const config = loadConfig(process.env.SERVICE_NAME);
  assertProductionCors(config);

  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>(
    createKafkaMicroserviceOptions(config),
    {
      inheritAppConfig: true,
    },
  );

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: config.allowedOrigins,
    credentials: true,
  });

  app.useGlobalFilters(new HttpExceptionFilter(), new RpcAllExceptionsFilter());

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

  await app.startAllMicroservices();

  const port = Number(process.env.PORT ?? 3003);
  await app.listen(port);

  logger.log(`Media Service running on port ${port}`);
  logger.log(`Kafka microservice connected`);
}

void bootstrap();
