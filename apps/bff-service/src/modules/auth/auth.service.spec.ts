/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file auth.service.spec.ts (BFF)
 * @covers BFF AuthService – proxy to SSO client SDK
 * @maps TC-API-011 (BFF proxy correctness), TC-EXT-002 (client SDK delegation)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SsoClientService } from '@app/clients';

// ────── Test Suite ───────────────────────────────────────────────────────

describe('BFF AuthService', () => {
  let service: AuthService;
  let ssoClient: jest.Mocked<SsoClientService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SsoClientService,
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

    service = module.get(AuthService);
    ssoClient = module.get(SsoClientService);
  });

  // ── Proxy delegation tests ────────────────────────────────────────────

  it('should delegate register() to ssoClient', async () => {
    const dto = {
      firebaseToken: 'token',
      phone: '123',
      name: 'A',
      password: 'p',
    };
    const expected = { user: {}, tokens: {} };
    ssoClient.register.mockResolvedValue(expected as unknown);

    const result = await service.register(dto as unknown);

    expect(ssoClient.register).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate login() to ssoClient', async () => {
    const dto = { phone: '123', password: 'p' };
    const expected = { user: {}, tokens: {} };
    ssoClient.login.mockResolvedValue(expected as unknown);

    const result = await service.login(dto as unknown);

    expect(ssoClient.login).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate refreshToken() to ssoClient', async () => {
    const dto = { refreshToken: 'old' };
    ssoClient.refreshToken.mockResolvedValue({ accessToken: 'new' } as unknown);

    await service.refreshToken(dto as unknown);

    expect(ssoClient.refreshToken).toHaveBeenCalledWith(dto);
  });

  it('should delegate logout() with accessToken to ssoClient', async () => {
    ssoClient.logout.mockResolvedValue({ message: 'ok' } as unknown);

    await service.logout('access-token', { refreshToken: 'rt' } as unknown);

    expect(ssoClient.logout).toHaveBeenCalledWith('access-token', {
      refreshToken: 'rt',
    });
  });

  it('should delegate resetPassword() to ssoClient', async () => {
    ssoClient.resetPassword.mockResolvedValue({ message: 'done' } as unknown);

    await service.resetPassword({
      firebaseToken: 't',
      newPassword: 'p',
    } as unknown);

    expect(ssoClient.resetPassword).toHaveBeenCalled();
  });

  it('should delegate qrGenerate() to ssoClient', async () => {
    ssoClient.qrGenerate.mockResolvedValue({
      sessionId: 's',
      qrToken: 'q',
      expiresAt: 'e',
    } as unknown);

    await service.qrGenerate({ socketId: 'sock' } as unknown);

    expect(ssoClient.qrGenerate).toHaveBeenCalledWith({ socketId: 'sock' });
  });

  it('should delegate qrStatus() to ssoClient', async () => {
    ssoClient.qrStatus.mockResolvedValue({ status: 'pending' } as unknown);

    const result = await service.qrStatus('session-id');

    expect(ssoClient.qrStatus).toHaveBeenCalledWith('session-id');
    expect(result).toEqual({ status: 'pending' });
  });

  it('should delegate qrConfirm() with accessToken', async () => {
    ssoClient.qrConfirm.mockResolvedValue({ message: 'confirmed' } as unknown);

    await service.qrConfirm('token', { sessionId: 's' } as unknown);

    expect(ssoClient.qrConfirm).toHaveBeenCalledWith('token', {
      sessionId: 's',
    });
  });

  it('should delegate qrReject() with accessToken', async () => {
    ssoClient.qrReject.mockResolvedValue({ message: 'rejected' } as unknown);

    await service.qrReject('token', { sessionId: 's' } as unknown);

    expect(ssoClient.qrReject).toHaveBeenCalledWith('token', {
      sessionId: 's',
    });
  });

  // ── Error propagation ────────────────────────────────────────────────

  it('should propagate errors from ssoClient on register', async () => {
    ssoClient.register.mockRejectedValue(new Error('SSO unavailable'));

    await expect(
      service.register({
        firebaseToken: 't',
        phone: 'p',
        name: 'n',
        password: 'pw',
      } as unknown),
    ).rejects.toThrow('SSO unavailable');
  });

  it('should propagate errors from ssoClient on login', async () => {
    ssoClient.login.mockRejectedValue(new Error('Invalid credentials'));

    await expect(
      service.login({ phone: '123', password: 'wrong' } as unknown),
    ).rejects.toThrow('Invalid credentials');
  });
});
