/**
 * Unit tests for JwtAuthGuard
 *
 * Covers: TC-API-006, TC-API-007, TC-SEC-003, TC-SEC-005
 * - Public route bypass
 * - Missing Authorization header
 * - Expired access token
 * - Token signed with wrong secret
 * - Inactive/suspended user rejection
 * - User not found
 * - Valid token → request.user populated
 */
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from './jwt.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { BusinessException } from '@app/types';
import { ErrorCode, UserStatus } from '@app/constant';
import { createMockUser, createMockJwtPayload } from '../../../test/helpers';
import type { Repository } from 'typeorm';
import type { User } from '@libs/database';
import type { RedisService } from '@libs/redis';

interface MockRequest {
  headers: {
    authorization?: string;
  };
  user?: {
    id: string;
    phone: string;
    fullName: string;
    status: string;
    email?: string;
  };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: Pick<JwtService, 'verifyAccessToken'>;
  let reflector: Pick<Reflector, 'getAllAndOverride'>;
  let redisService: {
    getAuthUserCache: jest.Mock;
    setAuthUserCache: jest.Mock;
    getTokenRevokedAfter: jest.Mock;
  };
  let userRepository: { findOne: jest.Mock };

  beforeEach(() => {
    jwtService = {
      verifyAccessToken: jest.fn(),
    };

    reflector = {
      getAllAndOverride: jest.fn(),
    };

    userRepository = {
      findOne: jest.fn(),
    };

    redisService = {
      getAuthUserCache: jest.fn().mockResolvedValue(null),
      setAuthUserCache: jest.fn().mockResolvedValue(undefined),
      getTokenRevokedAfter: jest.fn().mockResolvedValue(null),
    };

    guard = new JwtAuthGuard(
      jwtService as JwtService,
      reflector as Reflector,
      redisService as unknown as RedisService,
      userRepository as unknown as Repository<User>,
    );
  });

  function createMockExecutionContext(authHeader?: string): ExecutionContext {
    const request: MockRequest = {
      headers: authHeader ? { authorization: authHeader } : {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'http',
    } as ExecutionContext;
  }

  function createMockRpcExecutionContext(): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'rpc',
    } as ExecutionContext;
  }

  // ─── Public Routes ─────────────────────────────────────────────────────────

  describe('public routes', () => {
    it('should bypass non-http contexts', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);

      const ctx = createMockRpcExecutionContext();
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(jwtService.verifyAccessToken).not.toHaveBeenCalled();
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('should allow access to @Public() routes without token', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);

      const ctx = createMockExecutionContext();
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(jwtService.verifyAccessToken).not.toHaveBeenCalled();
    });
  });

  // ─── Missing Token ────────────────────────────────────────────────────────

  describe('missing token (TC-API-006)', () => {
    it('should throw UNAUTHORIZED when no Authorization header', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);

      const ctx = createMockExecutionContext();

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);

      try {
        await guard.canActivate(ctx);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.UNAUTHORIZED,
        );
      }
    });

    it('should throw UNAUTHORIZED when Authorization header has no Bearer prefix', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);

      const ctx = createMockExecutionContext('Basic some-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);
    });
  });

  // ─── Invalid/Expired Token ─────────────────────────────────────────────────

  describe('invalid/expired token (TC-API-007, TC-SEC-003)', () => {
    it('should throw when token is expired', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new BusinessException(ErrorCode.AUTH_TOKEN_EXPIRED);
      });

      const ctx = createMockExecutionContext('Bearer expired-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);

      try {
        await guard.canActivate(ctx);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_TOKEN_EXPIRED,
        );
      }
    });

    it('should throw when token signed with wrong secret', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockImplementation(() => {
        throw new BusinessException(ErrorCode.AUTH_TOKEN_INVALID);
      });

      const ctx = createMockExecutionContext('Bearer forged-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);
    });
  });

  // ─── User Status Checks ───────────────────────────────────────────────────

  describe('user status checks (TC-API-005)', () => {
    it('should throw USER_NOT_FOUND if user does not exist in DB', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(
        createMockJwtPayload(),
      );
      userRepository.findOne.mockResolvedValue(null);

      const ctx = createMockExecutionContext('Bearer valid-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);

      try {
        await guard.canActivate(ctx);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.USER_NOT_FOUND,
        );
      }
    });

    it('should throw AUTH_ACCOUNT_INACTIVE for inactive user', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(
        createMockJwtPayload(),
      );
      userRepository.findOne.mockResolvedValue(
        createMockUser({ status: UserStatus.INACTIVE }),
      );

      const ctx = createMockExecutionContext('Bearer valid-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);

      try {
        await guard.canActivate(ctx);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_ACCOUNT_INACTIVE,
        );
      }
    });

    it('should throw AUTH_ACCOUNT_INACTIVE for suspended user', async () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(
        createMockJwtPayload(),
      );
      userRepository.findOne.mockResolvedValue(
        createMockUser({ status: UserStatus.SUSPENDED }),
      );

      const ctx = createMockExecutionContext('Bearer valid-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);
    });
  });

  // ─── Valid Token + Active User ─────────────────────────────────────────────

  describe('valid token with active user', () => {
    it('should return true and attach user to request', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      userRepository.findOne.mockResolvedValue(mockUser);

      const request: MockRequest = {
        headers: { authorization: 'Bearer valid-token' },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
        getType: () => 'http',
      } as ExecutionContext;

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(redisService.getTokenRevokedAfter).toHaveBeenCalledWith(
        mockUser.id,
      );
      expect(redisService.setAuthUserCache).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ id: mockUser.id }),
      );
      expect(request.user).toBeDefined();
      expect(request.user?.id).toBe(mockUser.id);
      expect(request.user?.phone).toBe(mockUser.phone);
      expect(request.user?.fullName).toBe(mockUser.fullName);
      expect(request.user?.status).toBe(UserStatus.ACTIVE);
    });

    it('should throw AUTH_ACCOUNT_INACTIVE when cached user has INACTIVE status — no DB consulted', async () => {
      const mockUser = createMockUser({ status: UserStatus.INACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getAuthUserCache.mockResolvedValue({
        id: mockUser.id,
        phone: mockUser.phone,
        email: mockUser.email,
        fullName: mockUser.fullName,
        avatarUrl: mockUser.avatarUrl,
        status: UserStatus.INACTIVE,
      });

      const ctx = createMockExecutionContext('Bearer valid-token');

      const error = await guard.canActivate(ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).errorCode).toBe(
        ErrorCode.AUTH_ACCOUNT_INACTIVE,
      );

      // The status check must run on the cached data — no DB round-trip.
      // A deactivated user with a warm cache must still be rejected within
      // the cache TTL window (up to 60 s) without an extra DB query.
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('should use cached auth user and skip DB lookup', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getAuthUserCache.mockResolvedValue({
        id: mockUser.id,
        phone: mockUser.phone,
        email: mockUser.email,
        fullName: mockUser.fullName,
        avatarUrl: mockUser.avatarUrl,
        status: UserStatus.ACTIVE,
      });

      const request: MockRequest = {
        headers: { authorization: 'Bearer valid-token' },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
        getType: () => 'http',
      } as ExecutionContext;

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(redisService.setAuthUserCache).not.toHaveBeenCalled();
    });

    it('should reject token when revoked-after marker is newer than token iat', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id, iat: 1000 });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getTokenRevokedAfter.mockResolvedValue(1001);

      const ctx = createMockExecutionContext('Bearer revoked-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('should reject token when iat equals revoked-after (same-second race)', async () => {
      // A token issued at the exact same Unix second as the revocation timestamp
      // must be rejected. This is the boundary case that requires `<=` (not `<`).
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id, iat: 1000 });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getTokenRevokedAfter.mockResolvedValue(1000); // same second

      const ctx = createMockExecutionContext('Bearer same-second-token');

      await expect(guard.canActivate(ctx)).rejects.toThrow(BusinessException);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('should fallback to DB when revocation lookup fails in Redis', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id, iat: 1000 });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getTokenRevokedAfter.mockRejectedValue(
        new Error('redis down'),
      );
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await guard.canActivate(
        createMockExecutionContext('Bearer valid-token'),
      );

      expect(result).toBe(true);
      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockUser.id } }),
      );
    });

    it('should fallback to DB when auth-user cache read fails in Redis', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      const mockPayload = createMockJwtPayload({ sub: mockUser.id });

      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
      (jwtService.verifyAccessToken as jest.Mock).mockReturnValue(mockPayload);
      redisService.getAuthUserCache.mockRejectedValue(new Error('redis down'));
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await guard.canActivate(
        createMockExecutionContext('Bearer valid-token'),
      );

      expect(result).toBe(true);
      expect(userRepository.findOne).toHaveBeenCalled();
      expect(redisService.setAuthUserCache).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ id: mockUser.id }),
      );
    });
  });
});
