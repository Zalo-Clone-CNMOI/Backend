import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { BffServiceModule } from './bff-service.module';

async function bootstrap() {
  const app = await NestFactory.create(BffServiceModule);
  const logger = new Logger('BFF-Service');

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS configuration
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
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
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
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
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger documentation available at /docs');
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  logger.log(`BFF Service running on port ${port}`);
  logger.log(`Health check available at http://localhost:${port}/api/health`);
}

bootstrap();
