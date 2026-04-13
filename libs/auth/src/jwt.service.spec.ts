/**
 * Unit tests for JwtService
 *
 * Covers: TC-API-004, TC-API-007, TC-API-008, TC-API-009, TC-SEC-003
 * - Token generation (access + refresh pair)
 * - Access token verification (valid, expired, wrong type)
 * - Refresh token verification (valid, expired, wrong type)
 * - parseExpiresIn helper
 * - Environment variable handling
 */
import { JwtService } from './jwt.service';
import * as jwt from 'jsonwebtoken';
import { BusinessException } from '@app/types';
import { ErrorCode } from '@app/constant';

describe('JwtService', () => {
  let service: JwtService;

  const ACCESS_SECRET = 'test-access-secret-key-for-unit-tests';
  const REFRESH_SECRET = 'test-refresh-secret-key-for-unit-tests';

  beforeAll(() => {
    process.env.JWT_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  });

  beforeEach(() => {
    service = new JwtService();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ACCESS_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_IN;
  });

  // ─── Token Generation ─────────────────────────────────────────────────────

  describe('generateTokenPair', () => {
    it('should return accessToken, refreshToken, and expiresIn', () => {
      const result = service.generateTokenPair('user-123', '+84901234567');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresIn');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.expiresIn).toBe(900); // 15m = 900s
    });

    it('should produce valid JWT tokens decodable by jsonwebtoken', () => {
      const result = service.generateTokenPair('user-123', '+84901234567');

      const accessPayload = jwt.verify(
        result.accessToken,
        ACCESS_SECRET,
      ) as jwt.JwtPayload;
      expect(accessPayload.sub).toBe('user-123');
      expect(accessPayload.phone).toBe('+84901234567');
      expect(accessPayload.type).toBe('access');

      const refreshPayload = jwt.verify(
        result.refreshToken,
        REFRESH_SECRET,
      ) as jwt.JwtPayload;
      expect(refreshPayload.sub).toBe('user-123');
      expect(refreshPayload.phone).toBe('+84901234567');
      expect(refreshPayload.type).toBe('refresh');
    });

    it('should sign access and refresh tokens with different secrets', () => {
      const result = service.generateTokenPair('user-123', '+84901234567');

      // Access token should NOT verify with refresh secret
      expect(() => jwt.verify(result.accessToken, REFRESH_SECRET)).toThrow();

      // Refresh token should NOT verify with access secret
      expect(() => jwt.verify(result.refreshToken, ACCESS_SECRET)).toThrow();
    });
  });

  // ─── generateAccessToken ──────────────────────────────────────────────────

  describe('generateAccessToken', () => {
    it('should return only accessToken and expiresIn', () => {
      const result = service.generateAccessToken('user-123', '+84901234567');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('expiresIn');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result.expiresIn).toBe(900);
    });

    it('should produce a token with type=access', () => {
      const { accessToken } = service.generateAccessToken(
        'user-123',
        '+84901234567',
      );

      const payload = jwt.verify(accessToken, ACCESS_SECRET) as jwt.JwtPayload;
      expect(payload.type).toBe('access');
    });
  });

  // ─── verifyAccessToken ─────────────────────────────────────────────────────

  describe('verifyAccessToken', () => {
    it('should return decoded payload for a valid access token', () => {
      const { accessToken } = service.generateTokenPair(
        'user-123',
        '+84901234567',
      );

      const payload = service.verifyAccessToken(accessToken);
      expect(payload.sub).toBe('user-123');
      expect(payload.phone).toBe('+84901234567');
      expect(payload.type).toBe('access');
    });

    it('should throw AUTH_TOKEN_EXPIRED for an expired access token', () => {
      const token = jwt.sign(
        { sub: 'user-123', phone: '+84901234567', type: 'access' },
        ACCESS_SECRET,
        { expiresIn: -10 }, // already expired
      );

      expect(() => service.verifyAccessToken(token)).toThrow(BusinessException);

      try {
        service.verifyAccessToken(token);
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_TOKEN_EXPIRED,
        );
      }
    });

    it('should throw AUTH_TOKEN_INVALID for a token signed with wrong secret (TC-SEC-003)', () => {
      const token = jwt.sign(
        { sub: 'user-123', phone: '+84901234567', type: 'access' },
        'wrong-secret',
        { expiresIn: 900 },
      );

      expect(() => service.verifyAccessToken(token)).toThrow(BusinessException);

      try {
        service.verifyAccessToken(token);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_TOKEN_INVALID,
        );
      }
    });

    it('should throw AUTH_TOKEN_INVALID for a refresh token passed as access', () => {
      const { refreshToken } = service.generateTokenPair(
        'user-123',
        '+84901234567',
      );

      expect(() => service.verifyAccessToken(refreshToken)).toThrow(
        BusinessException,
      );

      try {
        service.verifyAccessToken(refreshToken);
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_TOKEN_INVALID,
        );
      }
    });

    it('should throw AUTH_TOKEN_INVALID for malformed token', () => {
      expect(() => service.verifyAccessToken('not.a.valid.jwt')).toThrow(
        BusinessException,
      );
    });
  });

  // ─── verifyRefreshToken ────────────────────────────────────────────────────

  describe('verifyRefreshToken', () => {
    it('should return decoded payload for a valid refresh token', () => {
      const { refreshToken } = service.generateTokenPair(
        'user-456',
        '+84909999999',
      );

      const payload = service.verifyRefreshToken(refreshToken);
      expect(payload.sub).toBe('user-456');
      expect(payload.phone).toBe('+84909999999');
      expect(payload.type).toBe('refresh');
    });

    it('should throw AUTH_REFRESH_TOKEN_EXPIRED for an expired refresh token', () => {
      const token = jwt.sign(
        { sub: 'user-456', phone: '+84909999999', type: 'refresh' },
        REFRESH_SECRET,
        { expiresIn: -10 },
      );

      try {
        service.verifyRefreshToken(token);
        fail('Expected BusinessException');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED,
        );
      }
    });

    it('should throw AUTH_REFRESH_TOKEN_INVALID for access token passed as refresh (TC-API-009)', () => {
      const { accessToken } = service.generateTokenPair(
        'user-456',
        '+84909999999',
      );

      try {
        service.verifyRefreshToken(accessToken);
        fail('Expected BusinessException');
      } catch (error) {
        expect(error).toBeInstanceOf(BusinessException);
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        );
      }
    });

    it('should throw AUTH_REFRESH_TOKEN_INVALID for tampered token', () => {
      const { refreshToken } = service.generateTokenPair(
        'user-456',
        '+84909999999',
      );

      // Tamper with the token by changing a character
      const tampered = refreshToken.slice(0, -2) + 'XX';

      try {
        service.verifyRefreshToken(tampered);
        fail('Expected BusinessException');
      } catch (error) {
        expect((error as BusinessException).errorCode).toBe(
          ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
        );
      }
    });
  });

  // ─── verifyToken (legacy WS method) ───────────────────────────────────────

  describe('verifyToken (WS legacy)', () => {
    it('should return userId and phone from a valid access token', () => {
      const { accessToken } = service.generateTokenPair(
        'user-789',
        '+84900000000',
      );

      const result = service.verifyToken(accessToken);
      expect(result.userId).toBe('user-789');
      expect(result.phone).toBe('+84900000000');
    });

    it('should throw for invalid token', () => {
      expect(() => service.verifyToken('garbage')).toThrow(BusinessException);
    });
  });

  // ─── parseExpiresIn ────────────────────────────────────────────────────────

  describe('parseExpiresIn (via token expiry)', () => {
    it('should parse seconds correctly', () => {
      process.env.JWT_ACCESS_EXPIRES_IN = '30s';
      const svc = new JwtService();
      const { expiresIn } = svc.generateAccessToken('u', '+84900000000');
      expect(expiresIn).toBe(30);
    });

    it('should parse minutes correctly', () => {
      process.env.JWT_ACCESS_EXPIRES_IN = '5m';
      const svc = new JwtService();
      const { expiresIn } = svc.generateAccessToken('u', '+84900000000');
      expect(expiresIn).toBe(300);
    });

    it('should parse hours correctly', () => {
      process.env.JWT_ACCESS_EXPIRES_IN = '2h';
      const svc = new JwtService();
      const { expiresIn } = svc.generateAccessToken('u', '+84900000000');
      expect(expiresIn).toBe(7200);
    });

    it('should parse days correctly', () => {
      process.env.JWT_ACCESS_EXPIRES_IN = '1d';
      const svc = new JwtService();
      const { expiresIn } = svc.generateAccessToken('u', '+84900000000');
      expect(expiresIn).toBe(86400);
    });

    it('should default to 900s (15m) for unrecognized format', () => {
      process.env.JWT_ACCESS_EXPIRES_IN = 'invalid';
      const svc = new JwtService();
      const { expiresIn } = svc.generateAccessToken('u', '+84900000000');
      expect(expiresIn).toBe(900);
    });

    afterAll(() => {
      process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    });
  });

  // ─── Missing environment variables ─────────────────────────────────────────

  describe('environment variable validation', () => {
    it('should throw if JWT_SECRET is missing', () => {
      const origAccess = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const svc = new JwtService();
      expect(() => svc.generateTokenPair('user-123', '+84901234567')).toThrow(
        'JWT_SECRET',
      );

      if (origAccess) {
        process.env.JWT_SECRET = origAccess;
      }
    });

    it('should throw if JWT_REFRESH_SECRET is missing', () => {
      const orig = process.env.JWT_REFRESH_SECRET;
      delete process.env.JWT_REFRESH_SECRET;

      const svc = new JwtService();
      expect(() => svc.generateTokenPair('user-123', '+84901234567')).toThrow(
        'JWT_REFRESH_SECRET',
      );

      process.env.JWT_REFRESH_SECRET = orig;
    });

    it('should throw if JWT_SECRET is empty', () => {
      const origAccess = process.env.JWT_SECRET;
      process.env.JWT_SECRET = '';

      const svc = new JwtService();
      expect(() => svc.generateTokenPair('user-123', '+84901234567')).toThrow(
        'JWT_SECRET',
      );

      if (origAccess) {
        process.env.JWT_SECRET = origAccess;
      }
    });
  });
});
