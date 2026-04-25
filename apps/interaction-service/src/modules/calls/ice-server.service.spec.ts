import { Test } from '@nestjs/testing';
import { IceServerService } from './ice-server.service';
import { APP_CONFIG } from '@libs/config';

describe('IceServerService', () => {
  let service: IceServerService;
  const mockConfig = {
    coturnSecret: 'test-secret-1234',
    coturnHost: 'turn.example.com',
    coturnPort: 3478,
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        IceServerService,
        { provide: APP_CONFIG, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(IceServerService);
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

  it('returns empty ice_servers when coturnSecret is not configured', async () => {
    const m = await Test.createTestingModule({
      providers: [
        IceServerService,
        { provide: APP_CONFIG, useValue: { ...mockConfig, coturnSecret: undefined } },
      ],
    }).compile();
    const svc = m.get(IceServerService);
    const r = svc.getIceServers('u1');
    expect(r.ice_servers).toEqual([]);
  });
});
