import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from './jwt.service';
import { IS_PUBLIC_KEY } from '@app/decorator/public.decorator';
import { ErrorCode, UserStatus } from '@app/constant';
import { BusinessException, AuthenticatedUser } from '@app/types';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@libs/database';
import { RedisService } from '@libs/redis';

interface AuthGuardCachedUser {
  id: string;
  phone: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  status: UserStatus;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'No token provided');
    }

    try {
      const payload = this.jwtService.verifyAccessToken(token);
      await this.assertTokenNotRevoked(payload.sub, payload.iat);

      const cachedUser = await this.safeGetAuthUserCache(payload.sub);

      let user = cachedUser;

      if (!user) {
        // Fetch user from database only when cache misses.
        const dbUser = await this.userRepository.findOne({
          where: { id: payload.sub },
          select: ['id', 'phone', 'email', 'fullName', 'avatarUrl', 'status'],
        });

        if (!dbUser) {
          throw new BusinessException(ErrorCode.USER_NOT_FOUND);
        }

        user = {
          id: dbUser.id,
          phone: dbUser.phone,
          email: dbUser.email,
          fullName: dbUser.fullName,
          avatarUrl: dbUser.avatarUrl,
          status: dbUser.status,
        };

        await this.safeSetAuthUserCache(payload.sub, user);
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new BusinessException(ErrorCode.AUTH_ACCOUNT_INACTIVE);
      }

      // Attach user to request
      const authenticatedUser: AuthenticatedUser = {
        id: user.id,
        phone: user.phone,
        email: user.email ?? undefined,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl ?? undefined,
        status: user.status,
      };

      (request as Request & { user: AuthenticatedUser }).user =
        authenticatedUser;

      return true;
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }
      this.logger.error('JWT verification failed', error);
      throw new BusinessException(ErrorCode.AUTH_TOKEN_INVALID);
    }
  }

  private async assertTokenNotRevoked(
    userId: string,
    tokenIat?: number,
  ): Promise<void> {
    const revokedAfter = await this.safeGetTokenRevokedAfter(userId);
    if (revokedAfter === null) {
      return;
    }

    if (!tokenIat || tokenIat <= revokedAfter) {
      throw new BusinessException(ErrorCode.AUTH_TOKEN_INVALID);
    }
  }

  private async safeGetAuthUserCache(
    userId: string,
  ): Promise<AuthGuardCachedUser | null> {
    try {
      return await this.redisService.getAuthUserCache<AuthGuardCachedUser>(
        userId,
      );
    } catch (error) {
      this.logger.warn(
        `Auth cache read failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async safeSetAuthUserCache(
    userId: string,
    payload: AuthGuardCachedUser,
  ): Promise<void> {
    try {
      await this.redisService.setAuthUserCache(userId, payload);
    } catch (error) {
      this.logger.warn(
        `Auth cache write failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async safeGetTokenRevokedAfter(
    userId: string,
  ): Promise<number | null> {
    try {
      return await this.redisService.getTokenRevokedAfter(userId);
    } catch (error) {
      this.logger.warn(
        `Token revocation lookup failed for user ${userId} — revocation check bypassed (fail-open): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
