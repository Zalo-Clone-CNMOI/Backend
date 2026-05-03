import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { IceServerService } from '../services/ice-server.service';
import { APP_CONFIG } from '@libs/config';

describe('IceServerService', () => {
  let service: IceServerService;
  const mockConfig = {
    coturnSecret: 'test-secret-1234',
    coturnHost: 'turn.example.com',
    coturnPort: 3478,
  };

  const buildService = async (config: Record<string, unknown>) => {
    const m = await Test.createTestingModule({
      providers: [IceServerService, { provide: APP_CONFIG, useValue: config }],
    }).compile();
    return m.get<IceServerService>(IceServerService);
  };

  beforeEach(async () => {
    service = await buildService(mockConfig);
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('generates a credential with username containing the ttl timestamp', () => {
    const result = service.getIceServers('user-abc');
    const [ttl] = result.username.split(':');
    const ttlNum = parseInt(ttl, 10);
    expect(ttlNum).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('username format is "<ttl>:<userId>"', () => {
    const result = service.getIceServers('user-xyz');
    const parts = result.username.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe('user-xyz');
  });

  it('credential is a non-empty string (HMAC-SHA1 base64)', () => {
    const result = service.getIceServers('user-abc');
    expect(typeof result.credential).toBe('string');
    expect(result.credential.length).toBeGreaterThan(10);
  });

  it('returns TURN and STUN server entries', () => {
    const result = service.getIceServers('user-abc');
    const urls = result.ice_servers.map((s) => s.urls);
    expect(urls.some((u) => u.startsWith('turn:'))).toBe(true);
    expect(urls.some((u) => u.startsWith('stun:'))).toBe(true);
  });

  it('includes expires_at as unix-ms matching ttl', () => {
    const result = service.getIceServers('user-abc');
    expect(result.expires_at).toBeGreaterThan(Date.now());
    expect(result.expires_at).toBeLessThanOrEqual(
      Date.now() + result.ttl * 1000 + 1000,
    );
  });

  describe('degraded config (dev mode)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns empty ice_servers when coturnSecret is not configured', async () => {
      const svc = await buildService({
        ...mockConfig,
        coturnSecret: undefined,
      });
      const r = svc.getIceServers('u1');
      expect(r.ice_servers).toEqual([]);
      expect(r.expires_at).toBe(0);
    });

    it('returns empty ice_servers when coturnHost is not configured', async () => {
      const svc = await buildService({ ...mockConfig, coturnHost: undefined });
      const r = svc.getIceServers('u1');
      expect(r.ice_servers).toEqual([]);
    });

    it('returns empty ice_servers when coturnHost is "localhost"', async () => {
      const svc = await buildService({
        ...mockConfig,
        coturnHost: 'localhost',
      });
      const r = svc.getIceServers('u1');
      expect(r.ice_servers).toEqual([]);
    });
  });

  describe('production fail-loud', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('throws when coturnSecret is missing', async () => {
      const svc = await buildService({
        ...mockConfig,
        coturnSecret: undefined,
      });
      expect(() => svc.getIceServers('u1')).toThrow(
        InternalServerErrorException,
      );
    });

    it('throws when coturnHost is missing', async () => {
      const svc = await buildService({ ...mockConfig, coturnHost: undefined });
      expect(() => svc.getIceServers('u1')).toThrow(
        InternalServerErrorException,
      );
    });

    it('throws when coturnHost is "localhost"', async () => {
      const svc = await buildService({
        ...mockConfig,
        coturnHost: 'localhost',
      });
      expect(() => svc.getIceServers('u1')).toThrow(
        InternalServerErrorException,
      );
    });

    it('returns valid result when fully configured', async () => {
      const svc = await buildService(mockConfig);
      const r = svc.getIceServers('u1');
      expect(r.ice_servers.length).toBeGreaterThan(0);
      expect(r.expires_at).toBeGreaterThan(Date.now());
    });
  });
});
