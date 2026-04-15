/* eslint-disable @typescript-eslint/unbound-method */
/**
 * @file auth.service.spec.ts (BFF)
 * @covers BFF AuthService – proxy to SSO client SDK
 * @maps TC-API-011 (BFF proxy correctness), TC-EXT-002 (client SDK delegation)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SsoClientService } from '@app/clients';
import { QrStatusResponseDtoStatusEnum } from '@app/clients';

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
      firebaseIdToken: 'token',
      fullName: 'A',
      password: 'p',
    };
    const expected = { user: {}, tokens: {} };
    ssoClient.register.mockResolvedValue(expected);

    const result = await service.register(dto);

    expect(ssoClient.register).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate login() to ssoClient', async () => {
    const dto = { phone: '123', password: 'p' };
    const expected = { user: {}, tokens: {} };
    ssoClient.login.mockResolvedValue(expected);

    const result = await service.login(dto);

    expect(ssoClient.login).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('should delegate refreshToken() to ssoClient', async () => {
    const dto = { refreshToken: 'old' };
    ssoClient.refreshToken.mockResolvedValue({ accessToken: 'new' });

    await service.refreshToken(dto);

    expect(ssoClient.refreshToken).toHaveBeenCalledWith(dto);
  });

  it('should delegate logout() with accessToken to ssoClient', async () => {
    ssoClient.logout.mockResolvedValue({ message: 'ok' });

    await service.logout('access-token', { deviceId: 'rt' });

    expect(ssoClient.logout).toHaveBeenCalledWith('access-token', {
      deviceId: 'rt',
    });
  });

  it('should delegate resetPassword() to ssoClient', async () => {
    ssoClient.resetPassword.mockResolvedValue({ message: 'done' });

    await service.resetPassword({
      firebaseIdToken: 't',
      newPassword: 'p',
    });

    expect(ssoClient.resetPassword).toHaveBeenCalled();
  });

  it('should delegate qrGenerate() to ssoClient', async () => {
    ssoClient.qrGenerate.mockResolvedValue({
      sessionId: 's',
      qrToken: 'q',
      expiresAt: 'e',
    });

    await service.qrGenerate({
      socketBindingToken: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(ssoClient.qrGenerate).toHaveBeenCalledWith({
      socketBindingToken: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('should delegate qrStatus() to ssoClient', async () => {
    ssoClient.qrStatus.mockResolvedValue({
      status: QrStatusResponseDtoStatusEnum.PENDING,
    });

    const result = await service.qrStatus('session-id');

    expect(ssoClient.qrStatus).toHaveBeenCalledWith('session-id');
    expect(result).toEqual({ status: QrStatusResponseDtoStatusEnum.PENDING });
  });

  it('should delegate qrConfirm() with accessToken', async () => {
    ssoClient.qrConfirm.mockResolvedValue({ message: 'confirmed' });

    await service.qrConfirm('token', { sessionId: 's' });

    expect(ssoClient.qrConfirm).toHaveBeenCalledWith('token', {
      sessionId: 's',
    });
  });

  it('should delegate qrReject() with accessToken', async () => {
    ssoClient.qrReject.mockResolvedValue({ message: 'rejected' });

    await service.qrReject('token', { sessionId: 's' });

    expect(ssoClient.qrReject).toHaveBeenCalledWith('token', {
      sessionId: 's',
    });
  });

  // ── Error propagation ────────────────────────────────────────────────

  it('should propagate errors from ssoClient on register', async () => {
    ssoClient.register.mockRejectedValue(new Error('SSO unavailable'));

    await expect(
      service.register({
        firebaseIdToken: 't',
        fullName: 'n',
        password: 'pw',
      }),
    ).rejects.toThrow('SSO unavailable');
  });

  it('should propagate errors from ssoClient on login', async () => {
    ssoClient.login.mockRejectedValue(new Error('Invalid credentials'));

    await expect(
      service.login({ phone: '123', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
  });
});
