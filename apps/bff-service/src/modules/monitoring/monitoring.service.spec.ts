import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { MonitoringService } from './monitoring.service';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('BFF MonitoringService', () => {
  let service: MonitoringService;

  beforeEach(async () => {
    global.fetch = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MonitoringService,
        {
          provide: APP_CONFIG,
          useValue: {
            aiCoreServiceUrl: 'http://ai-core-service:5005/api',
            internalMonitoringToken: 'secret',
          },
        },
      ],
    }).compile();
    service = moduleRef.get(MonitoringService);
  });

  afterEach(() => jest.resetAllMocks());

  it('getContainers calls ai-core with X-Internal-Token header', async () => {
    mockFetchOnce([{ service: 'bff-service' }]);
    const res = await service.getContainers();
    expect(res).toEqual([{ service: 'bff-service' }]);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { headers: Record<string, string>; method?: string; body?: string },
    ];
    expect(url).toBe('http://ai-core-service:5005/api/monitoring/containers');
    expect(opts.headers['X-Internal-Token']).toBe('secret');
  });

  it('aiAnalyze POSTs userId + question', async () => {
    mockFetchOnce({ answer: 'ok', model: 'm', provider: 'p' });
    const res = await service.aiAnalyze<{ answer: string }>('u1', 'q');
    expect(res.answer).toBe('ok');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { headers: Record<string, string>; method?: string; body?: string },
    ];
    expect(url).toBe('http://ai-core-service:5005/api/monitoring/ai-analyze');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body ?? '{}')).toEqual({
      userId: 'u1',
      question: 'q',
    });
  });

  it('throws BusinessException when ai-core returns non-ok', async () => {
    const { BusinessException } = await import('@app/types');
    mockFetchOnce({}, false, 502);
    await expect(service.getStackHealth()).rejects.toThrow(BusinessException);
  });
});
