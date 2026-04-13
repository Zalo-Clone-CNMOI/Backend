import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ErrorCode } from '@app/constant';
import { BusinessException, JwtPayload, TokenPair } from '@app/types';

export interface JwtUser {
  userId: string;
  phone?: string;
}

/**
 * JWT Service for token generation and verification
 */
@Injectable()
export class JwtService {
  // Secrets cached at construction — eliminates per-request process.env reads
  // and provides a single throw-site for misconfiguration.
  private readonly _accessSecret: string;
  private readonly _refreshSecret: string;
  private readonly _accessExpiresIn: string;
  private readonly _refreshExpiresIn: string;

  constructor() {
    this._accessSecret = process.env.JWT_SECRET?.trim() ?? '';
    this._refreshSecret = process.env.JWT_REFRESH_SECRET?.trim() ?? '';
    this._accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
    this._refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  }

  private get accessSecret(): string {
    if (!this._accessSecret) {
      throw new Error(
        'JWT_SECRET environment variable is required. ' +
          'Set JWT_SECRET for production use.',
      );
    }
    return this._accessSecret;
  }

  private get refreshSecret(): string {
    if (!this._refreshSecret) {
      throw new Error(
        'JWT_REFRESH_SECRET environment variable is required. ' +
          'Generate a secure secret for production use.',
      );
    }
    return this._refreshSecret;
  }

  private get accessExpiresIn(): string {
    return this._accessExpiresIn;
  }

  private get refreshExpiresIn(): string {
    return this._refreshExpiresIn;
  }

  /**
   * Generate access and refresh token pair
   */
  generateTokenPair(userId: string, phone: string): TokenPair {
    const accessPayload: JwtPayload = {
      sub: userId,
      phone,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      sub: userId,
      phone,
      type: 'refresh',
    };

    const accessExpiresInSeconds = this.parseExpiresIn(this.accessExpiresIn);
    const refreshExpiresInSeconds = this.parseExpiresIn(this.refreshExpiresIn);

    const accessToken = jwt.sign(accessPayload, this.accessSecret, {
      expiresIn: accessExpiresInSeconds,
    });

    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, {
      expiresIn: refreshExpiresInSeconds,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresInSeconds,
    };
  }

  /**
   * Generate only access token (for refresh)
   */
  generateAccessToken(
    userId: string,
    phone: string,
  ): { accessToken: string; expiresIn: number } {
    const payload: JwtPayload = {
      sub: userId,
      phone,
      type: 'access',
    };

    const expiresIn = this.parseExpiresIn(this.accessExpiresIn);
    const accessToken = jwt.sign(payload, this.accessSecret, {
      expiresIn,
    });

    return {
      accessToken,
      expiresIn,
    };
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.accessSecret) as JwtPayload;

      if (payload.type !== 'access') {
        throw new BusinessException(ErrorCode.AUTH_TOKEN_INVALID);
      }

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new BusinessException(ErrorCode.AUTH_TOKEN_EXPIRED);
      }
      if (error instanceof BusinessException) {
        throw error;
      }
      throw new BusinessException(ErrorCode.AUTH_TOKEN_INVALID);
    }
  }

  /**
   * Verify refresh token
   */
  verifyRefreshToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, this.refreshSecret) as JwtPayload;

      if (payload.type !== 'refresh') {
        throw new BusinessException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
      }

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new BusinessException(ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED);
      }
      if (error instanceof BusinessException) {
        throw error;
      }
      throw new BusinessException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
    }
  }

  /**
   * Legacy method for backward compatibility (WS gateway)
   */
  verifyToken(token: string): JwtUser {
    const payload = this.verifyAccessToken(token);
    return {
      userId: payload.sub,
      phone: payload.phone,
    };
  }

  /**
   * Parse expires in string to seconds
   */
  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 900; // Default 15 minutes
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        return 900;
    }
  }
}
