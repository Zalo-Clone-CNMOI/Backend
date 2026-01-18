import { NestFactory } from '@nestjs/core';
import { RelationServiceModule } from './relation-service.module';

async function bootstrap() {
  const app = await NestFactory.create(RelationServiceModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
