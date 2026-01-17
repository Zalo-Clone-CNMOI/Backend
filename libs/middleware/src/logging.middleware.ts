import { dateFormatter } from '@app/helper';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger: Logger;
  constructor() {
    this.logger = new Logger(LoggingMiddleware.name);
  }
  use(req: Request, res: Response, next: () => void) {
    const { method, originalUrl } = req;

    const formattedDate = dateFormatter(new Date());
    this.logger.log(`Request: ${method} ${originalUrl} at ${formattedDate}`);
    next();
  }
}
