import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@libs/config';
import { createKafkaMicroserviceOptions } from '@libs/kafka';
import { RpcAllExceptionsFilter } from '@app/interceptors';

async function bootstrap() {
  process.env.SERVICE_NAME ??= 'presence-service';

  const config = loadConfig(process.env.SERVICE_NAME);
  const app = await NestFactory.createMicroservice(
    AppModule,
    createKafkaMicroserviceOptions(config),
  );
  app.useGlobalFilters(new RpcAllExceptionsFilter());
  await app.listen();
}

void bootstrap();
