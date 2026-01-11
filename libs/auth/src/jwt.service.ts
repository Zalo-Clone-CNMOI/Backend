import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export interface JwtUser {
  userId: string;
}

@Injectable()
export class JwtService {
  verifyToken(token: string): JwtUser {
    const secret = process.env.JWT_SECRET ?? 'dev-secret';
    const payload = jwt.verify(token, secret) as {
      sub?: string;
      userId?: string;
    };
    const userId = payload.sub ?? payload.userId;
    if (!userId) {
      throw new Error('Invalid token: missing user id');
    }
    return { userId };
  }
}
