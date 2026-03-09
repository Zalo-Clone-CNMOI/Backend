/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
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

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let reflector: Reflector;
  let userRepository: { findOne: jest.Mock };

  beforeEach(() => {
    jwtService = {
      verifyAccessToken: jest.fn(),
    } as unknown as JwtService;

    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;

    userRepository = {
      findOne: jest.fn(),
    };

    guard = new JwtAuthGuard(jwtService, reflector, userRepository as any);
  });

  function createMockExecutionContext(authHeader?: string): ExecutionContext {
    const request: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  // ─── Public Routes ─────────────────────────────────────────────────────────

  describe('public routes', () => {
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

      const request: any = {
        headers: { authorization: 'Bearer valid-token' },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.user).toBeDefined();
      expect(request.user.id).toBe(mockUser.id);
      expect(request.user.phone).toBe(mockUser.phone);
      expect(request.user.fullName).toBe(mockUser.fullName);
      expect(request.user.status).toBe(UserStatus.ACTIVE);
    });
  });
});
