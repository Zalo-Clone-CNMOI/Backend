import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createSwaggerDocument } from '@app/swagger/swagger';
import {
  HttpExceptionFilter,
  RpcAllExceptionsFilter,
  TransformResponseInterceptor,
} from '@app/interceptors';
import { JwtAuthGuard } from '@libs/auth';
import { createKafkaMicroserviceOptions } from '@libs/kafka/kafka.util';
import { loadConfig, assertProductionCors } from '@libs/config';
import { MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'interaction-service';
  process.env.KAFKA_GROUP_ID ??= 'interaction-service-consumers';

  const config = loadConfig(process.env.SERVICE_NAME);
  assertProductionCors(config);

  const app = await NestFactory.create(AppModule);

  const logger = new Logger('Bootstrap');
  app.setGlobalPrefix('api');

  app.connectMicroservice<MicroserviceOptions>(
    createKafkaMicroserviceOptions(config),
    {
      inheritAppConfig: true,
    },
  );

  app.enableCors({
    origin: config.allowedOrigins,
    credentials: true,
  });

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

  app.useGlobalFilters(new HttpExceptionFilter(), new RpcAllExceptionsFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  const jwtAuthGuard = app.get(JwtAuthGuard);
  app.useGlobalGuards(jwtAuthGuard);

  if (process.env.NODE_ENV !== 'production') {
    const document = createSwaggerDocument(app);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger documentation available at /docs');
  }

  await app.startAllMicroservices();

  const port = Number(process.env.PORT ?? 5004);
  await app.listen(port);
  logger.log(`Interaction Service running on port ${port}`);
}

void bootstrap();
