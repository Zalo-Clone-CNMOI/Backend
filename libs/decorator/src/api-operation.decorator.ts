import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiUnprocessableEntityResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';

interface ApiOperatorOptions {
  type?: any;
  summary: string;
  description: string;
}
export function ApiOperationDecorator({
  type,
  summary,
  description,
}: ApiOperatorOptions) {
  return applyDecorators(
    ApiOperation({ summary }),
    ApiOkResponse({
      type,
      description,
    }),
    ApiUnauthorizedResponse({ description: 'Token is invalid' }),
    ApiForbiddenResponse({ description: 'Do not have permission' }),
    ApiBadRequestResponse({ description: 'Invalid Data' }),
    ApiUnprocessableEntityResponse({ description: 'Invalid Data' }),
    ApiInternalServerErrorResponse({
      description: 'Internal server error , please try later',
    }),
  );
}
