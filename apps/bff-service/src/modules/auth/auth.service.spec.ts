/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
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
    ssoClient.register.mockResolvedValue(expected as any);

    const result = await service.register(dto as any);

    expect(ssoClient.register).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate login() to ssoClient', async () => {
    const dto = { phone: '123', password: 'p' };
    const expected = { user: {}, tokens: {} };
    ssoClient.login.mockResolvedValue(expected as any);

    const result = await service.login(dto as any);

    expect(ssoClient.login).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate refreshToken() to ssoClient', async () => {
    const dto = { refreshToken: 'old' };
    ssoClient.refreshToken.mockResolvedValue({ accessToken: 'new' } as any);

    await service.refreshToken(dto as any);

    expect(ssoClient.refreshToken).toHaveBeenCalledWith(dto);
  });

  it('should delegate logout() with accessToken to ssoClient', async () => {
    ssoClient.logout.mockResolvedValue({ message: 'ok' } as any);

    await service.logout('access-token', { refreshToken: 'rt' } as any);

    expect(ssoClient.logout).toHaveBeenCalledWith('access-token', {
      refreshToken: 'rt',
    });
  });

  it('should delegate resetPassword() to ssoClient', async () => {
    ssoClient.resetPassword.mockResolvedValue({ message: 'done' } as any);

    await service.resetPassword({
      firebaseToken: 't',
      newPassword: 'p',
    } as any);

    expect(ssoClient.resetPassword).toHaveBeenCalled();
  });

  it('should delegate qrGenerate() to ssoClient', async () => {
    ssoClient.qrGenerate.mockResolvedValue({
      sessionId: 's',
      qrToken: 'q',
      expiresAt: 'e',
    } as any);

    await service.qrGenerate({ socketId: 'sock' } as any);

    expect(ssoClient.qrGenerate).toHaveBeenCalledWith({ socketId: 'sock' });
  });

  it('should delegate qrStatus() to ssoClient', async () => {
    ssoClient.qrStatus.mockResolvedValue({ status: 'pending' } as any);

    const result = await service.qrStatus('session-id');

    expect(ssoClient.qrStatus).toHaveBeenCalledWith('session-id');
    expect(result).toEqual({ status: 'pending' });
  });

  it('should delegate qrConfirm() with accessToken', async () => {
    ssoClient.qrConfirm.mockResolvedValue({ message: 'confirmed' } as any);

    await service.qrConfirm('token', { sessionId: 's' } as any);

    expect(ssoClient.qrConfirm).toHaveBeenCalledWith('token', {
      sessionId: 's',
    });
  });

  it('should delegate qrReject() with accessToken', async () => {
    ssoClient.qrReject.mockResolvedValue({ message: 'rejected' } as any);

    await service.qrReject('token', { sessionId: 's' } as any);

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
      } as any),
    ).rejects.toThrow('SSO unavailable');
  });

  it('should propagate errors from ssoClient on login', async () => {
    ssoClient.login.mockRejectedValue(new Error('Invalid credentials'));

    await expect(
      service.login({ phone: '123', password: 'wrong' } as any),
    ).rejects.toThrow('Invalid credentials');
  });
});
