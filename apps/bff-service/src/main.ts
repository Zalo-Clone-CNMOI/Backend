import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { BffServiceModule } from './bff-service.module';
import { TransformResponseInterceptor } from '@app/interceptors/transform-response.interceptor';
import { loadConfig } from '@libs/config';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'bff-service';
  const appConfig = loadConfig(process.env.SERVICE_NAME);

  const app = await NestFactory.create(BffServiceModule);
  const logger = new Logger('BFF-Service');

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS configuration
  app.enableCors({
    origin: appConfig.allowedOrigins,
    credentials: true,
  });

  // Validation pipe
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

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('BFF Service API')
    .setDescription(
      'Backend for Frontend service that proxies requests to microservices',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      'BearerAuth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
  logger.log('Swagger documentation available at /docs');

  app.useGlobalInterceptors(new TransformResponseInterceptor());

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  logger.log(`BFF Service running on port ${port}`);
  logger.log(`Health check available at http://localhost:${port}/api/health`);
}

void bootstrap();
