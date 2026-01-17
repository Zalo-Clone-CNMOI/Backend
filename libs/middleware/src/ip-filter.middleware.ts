import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class IpFilterMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const clientIp = req.ip || req.socket.remoteAddress || '';
    const origin = req.headers.origin || '';

    // Normalize IP và Origin
    const normalizeIp = (ip: string) => ip.replace(/^::ffff:/, '');
    const normalizeOrigin = (url: string) =>
      url?.replace(/\/$/, '').toLowerCase();

    const cleanedIp = normalizeIp(clientIp);
    const cleanedOrigin = normalizeOrigin(origin);

    // const allowedIps = ['127.0.0.1', '103.15.50.145'];
    const allowedOrigins =
      process.env.ALLOWED_ORIGINS?.split(',').map((o) => normalizeOrigin(o)) ||
      [];

    // Check IP (nếu cần)
    // const isIpAllowed = allowedIps.includes(cleanedIp);

    // Check Origin
    const isOriginAllowed =
      !origin ||
      allowedOrigins.some((allowed) => cleanedOrigin.startsWith(allowed));

    console.log(`🌍 IP: ${cleanedIp} | 🏷 Origin: ${cleanedOrigin}`);

    if (isOriginAllowed) {
      next();
    } else {
      res.status(403).json({
        statusCode: 403,
        message: 'Access denied. Your origin is not allowed.',
      });
    }
  }
}
