/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file auth.controller.spec.ts
 * @covers BFF AuthController – REST API proxy to SSO service
 * @maps TC-API-001 (register), TC-API-002 (login), TC-API-003 (refresh),
 *       TC-API-004 (logout), TC-API-005 (reset password),
 *       TC-API-010 (QR generate/status/confirm/reject),
 *       TC-SEC-001 (auth header validation)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { QrStatusResponseDtoStatusEnum } from '@app/clients';

// ────── DTO Factories ────────────────────────────────────────────────────

const makeRegisterDto = () => ({
  firebaseIdToken: 'firebase-token-abc',
  fullName: 'John Doe',
  password: 'StrongP@ss123',
  email: 'john@example.com',
});

const makeLoginDto = () => ({
  phone: '+84901234567',
  password: 'StrongP@ss123',
});

const makeAuthResponse = () => ({
  user: {
    id: 'user-123',
    phone: '+84901234567',
    name: 'John Doe',
    email: 'john@example.com',
    status: 'active',
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  tokens: {
    accessToken: 'access.jwt.token',
    refreshToken: 'refresh.jwt.token',
  },
});

const makeRefreshResponse = () => ({
  accessToken: 'new.access.jwt.token',
  refreshToken: 'new.refresh.jwt.token',
});

// ────── Test Suite ───────────────────────────────────────────────────────

describe('BFF AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            refreshToken: jest.fn(),
            logout: jest.fn(),
            resetPassword: jest.fn(),
            qrGenerate: jest.fn(),
            qrStatus: jest.fn(),
            qrConfirm: jest.fn(),
            qrReject: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
    authService = module.get(AuthService);
  });

  // ── POST /auth/register ───────────────────────────────────────────────

  describe('register', () => {
    it('should delegate to authService.register and return result', async () => {
      const dto = makeRegisterDto();
      const response = makeAuthResponse();
      authService.register.mockResolvedValue(response);

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });

    it('should propagate errors from service', async () => {
      authService.register.mockRejectedValue(new Error('Phone already exists'));

      await expect(controller.register(makeRegisterDto())).rejects.toThrow(
        'Phone already exists',
      );
    });
  });

  // ── POST /auth/login ──────────────────────────────────────────────────

  describe('login', () => {
    it('should delegate to authService.login and return tokens', async () => {
      const dto = makeLoginDto();
      const response = makeAuthResponse();
      authService.login.mockResolvedValue(response);

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });

  // ── POST /auth/refresh ────────────────────────────────────────────────

  describe('refreshToken', () => {
    it('should delegate to authService.refreshToken', async () => {
      const dto = { refreshToken: 'old-refresh-token' };
      const response = makeRefreshResponse();
      authService.refreshToken.mockResolvedValue(response);

      const result = await controller.refreshToken(dto);

      expect(authService.refreshToken).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────

  describe('logout', () => {
    it('should extract Bearer token and delegate to authService', async () => {
      authService.logout.mockResolvedValue({ message: 'Logged out' });

      const result = await controller.logout('Bearer my-access-token', {
        deviceId: 'device-abc',
      });

      expect(authService.logout).toHaveBeenCalledWith('my-access-token', {
        deviceId: 'device-abc',
      });
      expect(result).toEqual({ message: 'Logged out' });
    });

    it('should throw UnauthorizedException when no authorization header', async () => {
      await expect(
        controller.logout('', { deviceId: 'token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when header lacks Bearer prefix', async () => {
      await expect(
        controller.logout('Basic some-token', {
          deviceId: 'tok',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when authorization is undefined', async () => {
      await expect(
        controller.logout(undefined as unknown as string, { deviceId: 'tok' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── POST /auth/reset-password ─────────────────────────────────────────

  describe('resetPassword', () => {
    it('should delegate to authService.resetPassword', async () => {
      authService.resetPassword.mockResolvedValue({
        message: 'Password reset successful',
      });

      const dto = { firebaseIdToken: 'token', newPassword: 'NewP@ss456' };
      const result = await controller.resetPassword(dto);

      expect(authService.resetPassword).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Password reset successful' });
    });
  });

  // ── QR Code Endpoints ─────────────────────────────────────────────────

  describe('QR endpoints', () => {
    describe('POST /auth/qr/generate', () => {
      it('should delegate to authService.qrGenerate', async () => {
        const dto = { socketId: 'socket-abc' };
        const response = {
          sessionId: 'session-uuid',
          qrToken: 'qr-token',
          expiresAt: new Date().toISOString(),
        };
        authService.qrGenerate.mockResolvedValue(response);

        const result = await controller.qrGenerate(dto);

        expect(authService.qrGenerate).toHaveBeenCalledWith(dto);
        expect(result).toEqual(response);
      });
    });

    describe('GET /auth/qr/status/:sessionId', () => {
      it('should delegate to authService.qrStatus', async () => {
        const sessionId = 'e2f3a1b4-5678-4abc-9def-0123456789ab';
        authService.qrStatus.mockResolvedValue({
          status: QrStatusResponseDtoStatusEnum.PENDING,
        });

        const result = await controller.qrStatus(sessionId);

        expect(authService.qrStatus).toHaveBeenCalledWith(sessionId);
        expect(result).toEqual({
          status: QrStatusResponseDtoStatusEnum.PENDING,
        });
      });
    });

    describe('POST /auth/qr/confirm', () => {
      it('should extract token and delegate to authService.qrConfirm', async () => {
        authService.qrConfirm.mockResolvedValue({
          message: 'QR login confirmed',
        });

        const result = await controller.qrConfirm('Bearer mobile-token', {
          sessionId: 'session-uuid',
        });

        expect(authService.qrConfirm).toHaveBeenCalledWith('mobile-token', {
          sessionId: 'session-uuid',
        });
        expect(result).toEqual({ message: 'QR login confirmed' });
      });

      it('should throw UnauthorizedException without Bearer token', async () => {
        await expect(
          controller.qrConfirm('', { sessionId: 's' }),
        ).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('POST /auth/qr/reject', () => {
      it('should extract token and delegate to authService.qrReject', async () => {
        authService.qrReject.mockResolvedValue({
          message: 'QR login rejected',
        });

        await controller.qrReject('Bearer mobile-token', {
          sessionId: 'session-uuid',
        });

        expect(authService.qrReject).toHaveBeenCalledWith('mobile-token', {
          sessionId: 'session-uuid',
        });
      });

      it('should throw UnauthorizedException without Bearer token', async () => {
        await expect(
          controller.qrReject('', { sessionId: 's' }),
        ).rejects.toThrow(UnauthorizedException);
      });
    });
  });
});
