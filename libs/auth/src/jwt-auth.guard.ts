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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
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

      // Fetch user from database
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'phone', 'email', 'fullName', 'avatarUrl', 'status'],
      });

      if (!user) {
        throw new BusinessException(ErrorCode.USER_NOT_FOUND);
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
