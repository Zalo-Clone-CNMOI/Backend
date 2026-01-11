import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'media-service';

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3003);
  await app.listen(port);
}

void bootstrap();
