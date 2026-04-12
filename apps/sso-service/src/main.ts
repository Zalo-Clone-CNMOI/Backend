import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createSwaggerDocument } from '@app/swagger/swagger';
import {
  HttpExceptionFilter,
  TransformResponseInterceptor,
} from '@app/interceptors';
import { JwtAuthGuard } from '@libs/auth';
import { loadConfig, assertProductionCors } from '@libs/config';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'sso-service';
  const config = loadConfig(process.env.SERVICE_NAME);
  assertProductionCors(config);

  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  app.setGlobalPrefix('api');

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

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  const jwtAuthGuard = app.get(JwtAuthGuard);
  app.useGlobalGuards(jwtAuthGuard);

  if (process.env.NODE_ENV !== 'production') {
    const document = createSwaggerDocument(app);
    SwaggerModule.setup('docs', app, document);
    logger.log('Swagger documentation available at /docs');
  }

  const port = Number(process.env.PORT ?? 5001);
  await app.listen(port);
  logger.log(`SSO Service running on port ${port}`);
}

void bootstrap();
