/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
/**
 * Unit tests for SSO AuthService
 *
 * Covers: TC-API-001 to TC-API-005, TC-API-008, TC-API-009,
 *         TC-SVC-010, TC-EXT-001, TC-EXT-002
 * - Registration (valid Firebase token, duplicate phone, duplicate email)
 * - Login (valid, invalid password, suspended/inactive user)
 * - Token refresh (valid, wrong type, expired)
 * - Logout
 * - Password reset
 * - QR session flow (generate, status, confirm, reject)
 */
import { AuthService } from './auth.service';
import { BusinessException } from '@app/types';
import { ErrorCode, UserStatus } from '@app/constant';
import {
  createMockUser,
  createMockQrSession,
} from '../../../../../test/helpers';
import * as bcrypt from 'bcrypt';
import type { Repository, DataSource } from 'typeorm';
import type { User } from '@libs/database/entities';
import type { JwtService as JwtServiceType } from '@libs/auth';
import type { RedisService as RedisServiceType } from '@libs/redis';
import type { ClientKafka } from '@nestjs/microservices';
import type { FirebaseService as FirebaseServiceType } from '@libs/firebase';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let jwtService: {
    generateTokenPair: jest.Mock;
    generateAccessToken: jest.Mock;
    verifyRefreshToken: jest.Mock;
  };
  let redisService: {
    setQrSession: jest.Mock;
    getQrSession: jest.Mock;
    confirmQrSession: jest.Mock;
    rejectQrSession: jest.Mock;
    consumeQrSocketBinding: jest.Mock;
  };
  let kafkaClient: { emit: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let firebaseService: { verifyIdToken: jest.Mock };

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    jwtService = {
      generateTokenPair: jest.fn().mockReturnValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 900,
      }),
      generateAccessToken: jest.fn().mockReturnValue({
        accessToken: 'new-access-token',
        expiresIn: 900,
      }),
      verifyRefreshToken: jest.fn(),
    };

    redisService = {
      setQrSession: jest.fn(),
      getQrSession: jest.fn(),
      confirmQrSession: jest.fn(),
      rejectQrSession: jest.fn(),
      consumeQrSocketBinding: jest.fn(),
    };

    kafkaClient = { emit: jest.fn() };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb({
          findOne: userRepository.findOne,
        });
      }),
    };

    firebaseService = {
      verifyIdToken: jest.fn(),
    };

    service = new AuthService(
      userRepository as unknown as Repository<User>,
      jwtService as unknown as JwtServiceType,
      redisService as unknown as RedisServiceType,
      kafkaClient as unknown as ClientKafka,
      dataSource as unknown as DataSource,
      firebaseService as unknown as FirebaseServiceType,
    );
  });

  // ─── Registration ─────────────────────────────────────────────────────────

  describe('register (TC-API-001, TC-API-002, TC-API-003)', () => {
    it('should register a new user with valid Firebase token', async () => {
      const mockUser = createMockUser({
        phone: '+84901000001',
        fullName: 'New User',
      });

      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        phone_number: '+84901000001',
        email: null,
        name: null,
        picture: null,
      });

      userRepository.findOne.mockResolvedValue(null); // no existing user
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);

      const result = await service.register({
        firebaseIdToken: 'valid-firebase-token',
        password: 'SecurePass123!',
        fullName: 'New User',
      });

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(firebaseService.verifyIdToken).toHaveBeenCalledWith(
        'valid-firebase-token',
      );
      expect(userRepository.save).toHaveBeenCalled();
    });

    it('should throw conflict when phone already exists (TC-API-003)', async () => {
      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid-2',
        phone_number: '+84901000001',
      });

      userRepository.findOne.mockResolvedValue(
        createMockUser({ phone: '+84901000001' }),
      );

      await expect(
        service.register({
          firebaseIdToken: 'valid-firebase-token',
          password: 'SecurePass123!',
          fullName: 'Dup User',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw conflict when email already exists', async () => {
      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid-3',
        phone_number: '+84901000002',
        email: 'dup@test.com',
      });

      // First findOne: phone check → null
      // Second findOne: email check → found
      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createMockUser({ email: 'dup@test.com' }));

      await expect(
        service.register({
          firebaseIdToken: 'valid-firebase-token',
          password: 'SecurePass123!',
          fullName: 'User',
          email: 'dup@test.com',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when Firebase token has no phone_number', async () => {
      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid-4',
        // no phone_number
      });

      await expect(
        service.register({
          firebaseIdToken: 'no-phone-token',
          password: 'SecurePass123!',
          fullName: 'User',
        }),
      ).rejects.toThrow();
    });
  });

  // ─── Login ─────────────────────────────────────────────────────────────────

  describe('login (TC-API-004, TC-API-005)', () => {
    it('should login with valid phone and password (TC-API-004)', async () => {
      const hashedPassword = await bcrypt.hash('SecurePass123!', 12);
      const mockUser = createMockUser({
        phone: '+84901234567',
        passwordHash: hashedPassword,
        status: UserStatus.ACTIVE,
      });

      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.login({
        phone: '+84901234567',
        password: 'SecurePass123!',
      });

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(userRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      );
    });

    it('should throw UNAUTHORIZED for non-existent phone', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.login({ phone: '+84999999999', password: 'any' }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw FORBIDDEN for inactive user (TC-API-005)', async () => {
      const mockUser = createMockUser({ status: UserStatus.INACTIVE });
      userRepository.findOne.mockResolvedValue(mockUser);

      try {
        await service.login({ phone: mockUser.phone, password: 'any' });
        fail('Expected BusinessException');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
      }
    });

    it('should throw FORBIDDEN for suspended user', async () => {
      const mockUser = createMockUser({ status: UserStatus.SUSPENDED });
      userRepository.findOne.mockResolvedValue(mockUser);

      try {
        await service.login({ phone: mockUser.phone, password: 'any' });
        fail('Expected BusinessException');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
      }
    });

    it('should throw UNAUTHORIZED for wrong password', async () => {
      const hashedPassword = await bcrypt.hash('CorrectPass123!', 12);
      const mockUser = createMockUser({
        passwordHash: hashedPassword,
        status: UserStatus.ACTIVE,
      });
      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.login({ phone: mockUser.phone, password: 'WrongPass123!' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── Token Refresh ─────────────────────────────────────────────────────────

  describe('refreshToken (TC-API-008, TC-API-009)', () => {
    it('should return new access token for valid refresh token', async () => {
      const mockUser = createMockUser({ status: UserStatus.ACTIVE });
      jwtService.verifyRefreshToken.mockReturnValue({
        sub: mockUser.id,
        phone: mockUser.phone,
        type: 'refresh',
      });
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.refreshToken({
        refreshToken: 'valid-refresh-token',
      });

      expect(result.accessToken).toBe('new-access-token');
      expect(result.expiresIn).toBe(900);
    });

    it('should throw when refresh token is invalid', async () => {
      jwtService.verifyRefreshToken.mockImplementation(() => {
        throw new BusinessException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID);
      });

      await expect(
        service.refreshToken({ refreshToken: 'bad-refresh-token' }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when user not found for refresh token', async () => {
      jwtService.verifyRefreshToken.mockReturnValue({
        sub: 'deleted-user-id',
        phone: '+84900000000',
        type: 'refresh',
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: 'valid-but-user-deleted' }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw when user is not active', async () => {
      const mockUser = createMockUser({ status: UserStatus.SUSPENDED });
      jwtService.verifyRefreshToken.mockReturnValue({
        sub: mockUser.id,
        phone: mockUser.phone,
        type: 'refresh',
      });
      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.refreshToken({ refreshToken: 'refresh-for-suspended' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── Logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should update lastSeenAt on logout', async () => {
      await service.logout('user-123', {});
      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      );
    });

    it('should handle logout with deviceId', async () => {
      await service.logout('user-123', { deviceId: 'device-xyz' });
      expect(userRepository.update).toHaveBeenCalled();
    });
  });

  // ─── Password Reset ───────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('should reset password with valid Firebase token', async () => {
      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid',
        phone_number: '+84901234567',
      });

      const mockUser = createMockUser({ phone: '+84901234567' });
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetPassword({
        firebaseIdToken: 'valid-firebase-token',
        newPassword: 'NewSecurePass123!',
      });

      expect(result.message).toBeDefined();
      expect(userRepository.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          passwordHash: expect.any(String),
        }),
      );
    });

    it('should throw when user not found for phone from Firebase token', async () => {
      firebaseService.verifyIdToken.mockResolvedValue({
        uid: 'firebase-uid',
        phone_number: '+84900000000',
      });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          firebaseIdToken: 'valid-token',
          newPassword: 'NewPass123!',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── QR Session Flow ──────────────────────────────────────────────────────

  describe('generateQrSession', () => {
    it('should create a QR session in Redis bound to the verified socket', async () => {
      redisService.consumeQrSocketBinding.mockResolvedValue('socket-abc');
      redisService.setQrSession.mockResolvedValue(undefined);

      const result = await service.generateQrSession({
        socketBindingToken: '6e1b4a96-f6d2-4e8a-b3e5-d88d8b99f8cb',
      });

      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('qrToken');
      expect(result).toHaveProperty('expiresAt');
      expect(result.expiresInSeconds).toBe(300);
      expect(redisService.setQrSession).toHaveBeenCalledWith(
        expect.objectContaining({
          socketId: 'socket-abc',
          status: 'PENDING',
        }),
      );
    });

    it('should reject when socket binding token is missing or already consumed', async () => {
      redisService.consumeQrSocketBinding.mockResolvedValue(null);

      await expect(
        service.generateQrSession({
          socketBindingToken: '6e1b4a96-f6d2-4e8a-b3e5-d88d8b99f8cb',
        }),
      ).rejects.toThrow(BusinessException);

      expect(redisService.setQrSession).not.toHaveBeenCalled();
    });
  });

  describe('getQrStatus', () => {
    it('should return session status for pending session', async () => {
      const session = createMockQrSession();
      redisService.getQrSession.mockResolvedValue(session);

      const result = await service.getQrStatus(session.sessionId);

      expect(result.sessionId).toBe(session.sessionId);
      expect(result.status).toBe('PENDING');
    });

    it('should throw NOT_FOUND for non-existent session', async () => {
      redisService.getQrSession.mockResolvedValue(null);

      await expect(service.getQrStatus('non-existent-session')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw GONE for expired session', async () => {
      const session = createMockQrSession({
        expiresAt: Date.now() - 10_000, // expired 10s ago
      });
      redisService.getQrSession.mockResolvedValue(session);

      await expect(service.getQrStatus(session.sessionId)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe('confirmQrSession (TC-SVC-010)', () => {
    it('should confirm session and emit Kafka event', async () => {
      const session = createMockQrSession();
      const mockUser = createMockUser();

      redisService.confirmQrSession.mockResolvedValue({
        success: true,
        session,
      });

      // dataSource.transaction callback receives a manager
      dataSource.transaction.mockImplementation(
        async (cb: (manager: { findOne: jest.Mock }) => Promise<unknown>) => {
          return cb({
            findOne: jest.fn().mockResolvedValue(mockUser),
          });
        },
      );

      const result = await service.confirmQrSession(mockUser.id, {
        sessionId: session.sessionId,
      });

      expect(result.message).toContain('confirmed');
      expect(kafkaClient.emit).toHaveBeenCalled();
    });

    it('should throw CONFLICT for already confirmed session', async () => {
      redisService.confirmQrSession.mockResolvedValue({
        success: false,
        alreadyConfirmed: true,
      });

      await expect(
        service.confirmQrSession('user-id', {
          sessionId: 'already-confirmed',
        }),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw NOT_FOUND when session does not exist', async () => {
      redisService.confirmQrSession.mockResolvedValue({
        success: false,
        alreadyConfirmed: false,
      });

      await expect(
        service.confirmQrSession('user-id', {
          sessionId: 'non-existent',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('rejectQrSession', () => {
    it('should reject session and emit Kafka event', async () => {
      const session = createMockQrSession();
      redisService.rejectQrSession.mockResolvedValue(session);

      const result = await service.rejectQrSession('user-id', {
        sessionId: session.sessionId,
      });

      expect(result.message).toContain('rejected');
      expect(kafkaClient.emit).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND when session does not exist', async () => {
      redisService.rejectQrSession.mockResolvedValue(null);

      await expect(
        service.rejectQrSession('user-id', {
          sessionId: 'non-existent',
        }),
      ).rejects.toThrow(BusinessException);
    });
  });
});
