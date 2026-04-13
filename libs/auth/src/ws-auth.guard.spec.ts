/**
 * Unit tests for WsAuthGuard
 *
 * Covers: TC-WS-001, TC-WS-002
 * - Valid JWT in handshake.headers.authorization
 * - Valid JWT in handshake.auth.token
 * - Missing token
 * - Invalid token
 * - userId stored in socket.data
 */
import { WsAuthGuard } from './ws-auth.guard';
import { JwtService } from './jwt.service';
import { ExecutionContext } from '@nestjs/common';

interface MockSocket {
  data: { userId?: string };
  emit: jest.Mock;
  handshake: {
    headers: { authorization?: string };
    auth: { token?: string };
  };
}

describe('WsAuthGuard', () => {
  let guard: WsAuthGuard;
  let jwtService: { verifyToken: jest.Mock };

  beforeEach(() => {
    jwtService = {
      verifyToken: jest.fn(),
    };

    guard = new WsAuthGuard(jwtService as unknown as JwtService);
  });

  function createWsContext(socket: MockSocket): ExecutionContext {
    return {
      switchToWs: () => ({
        getClient: () => socket,
      }),
    } as ExecutionContext;
  }

  // ─── Valid Token in Authorization Header ────────────────────────────────────

  describe('valid token in Authorization header', () => {
    it('should return true and set socket.data.userId', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: { authorization: 'Bearer valid-jwt-token' },
          auth: {},
        },
      };

      jwtService.verifyToken.mockReturnValue({
        userId: 'user-123',
        phone: '+84901234567',
      });

      const result = guard.canActivate(createWsContext(socket));

      expect(result).toBe(true);
      expect(socket.data.userId).toBe('user-123');
      expect(jwtService.verifyToken).toHaveBeenCalledWith('valid-jwt-token');
    });
  });

  // ─── Valid Token in handshake.auth.token ────────────────────────────────────

  describe('valid token in auth.token', () => {
    it('should extract token from handshake.auth.token when no header', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: {},
          auth: { token: 'raw-jwt-token' },
        },
      };

      jwtService.verifyToken.mockReturnValue({
        userId: 'user-456',
        phone: '+84909999999',
      });

      const result = guard.canActivate(createWsContext(socket));

      expect(result).toBe(true);
      expect(socket.data.userId).toBe('user-456');
      expect(jwtService.verifyToken).toHaveBeenCalledWith('raw-jwt-token');
    });
  });

  // ─── Missing Token ────────────────────────────────────────────────────────

  describe('missing token (TC-WS-002)', () => {
    it('should return false when no authorization and no auth.token', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: {},
          auth: {},
        },
      };

      const result = guard.canActivate(createWsContext(socket));

      expect(result).toBe(false);
      expect(jwtService.verifyToken).not.toHaveBeenCalled();
    });

    it('should return false when authorization header is undefined', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: { authorization: undefined },
          auth: { token: undefined },
        },
      };

      const result = guard.canActivate(createWsContext(socket));

      expect(result).toBe(false);
    });
  });

  // ─── Invalid Token ────────────────────────────────────────────────────────

  describe('invalid token', () => {
    it('should throw (or return false) when verifyToken throws', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: { authorization: 'Bearer invalid-token' },
          auth: {},
        },
      };

      jwtService.verifyToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(guard.canActivate(createWsContext(socket))).toBe(false);
    });
  });

  // ─── Bearer Prefix Stripping ───────────────────────────────────────────────

  describe('Bearer prefix handling', () => {
    it('should strip "Bearer " prefix from authorization header', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: { authorization: 'Bearer my-token-123' },
          auth: {},
        },
      };

      jwtService.verifyToken.mockReturnValue({
        userId: 'user-789',
        phone: '+84900000000',
      });

      guard.canActivate(createWsContext(socket));

      expect(jwtService.verifyToken).toHaveBeenCalledWith('my-token-123');
    });

    it('should use raw token from auth.token without stripping', () => {
      const socket: MockSocket = {
        data: {},
        emit: jest.fn(),
        handshake: {
          headers: {},
          auth: { token: 'raw-no-bearer-prefix' },
        },
      };

      jwtService.verifyToken.mockReturnValue({
        userId: 'user-000',
        phone: '+84900000000',
      });

      guard.canActivate(createWsContext(socket));

      expect(jwtService.verifyToken).toHaveBeenCalledWith(
        'raw-no-bearer-prefix',
      );
    });
  });
});
