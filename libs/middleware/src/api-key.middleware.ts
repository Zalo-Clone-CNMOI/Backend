import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const headerValue = req.headers['x-api-key'];
    const apiKey =
      typeof headerValue === 'string'
        ? headerValue
        : Array.isArray(headerValue)
          ? headerValue[0]
          : '';
    const expected = process.env.PUBLIC_API_KEY ?? '';

    const actualBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(expected);

    const isValid =
      expectedBuffer.length > 0 &&
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer);

    if (!isValid) {
      throw new UnauthorizedException('Invalid API Key');
    }

    next();
  }
}
