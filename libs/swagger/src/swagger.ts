import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_CONFIG } from './swagger.config';

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const configSwagger = new DocumentBuilder()
    .setTitle(SWAGGER_CONFIG.title)
    .setDescription(SWAGGER_CONFIG.description)
    .setVersion(SWAGGER_CONFIG.version)
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
      },
      'X-API-KEY',
    )
    .addBearerAuth();
  for (const tag of SWAGGER_CONFIG.tags) {
    configSwagger.addTag(tag);
  }
  const options = configSwagger.build();
  return SwaggerModule.createDocument(app, options);
}
