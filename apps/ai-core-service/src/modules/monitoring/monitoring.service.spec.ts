import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '@libs/config';
import { AiGatewayService } from '../ai-gateway/services/ai-gateway.service';
import { MonitoringService } from './monitoring.service';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('MonitoringService', () => {
  let service: MonitoringService;
  let gateway: jest.Mocked<AiGatewayService>;

  beforeEach(async () => {
    global.fetch = jest.fn();
    gateway = {
      complete: jest.fn(),
    } as unknown as jest.Mocked<AiGatewayService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: AiGatewayService, useValue: gateway },
        {
          provide: APP_CONFIG,
          useValue: {
            prometheusUrl: 'http://prometheus:9090',
            lokiUrl: 'http://loki:3100',
            grafanaHealthUrl: 'http://grafana:3000/api/health',
          },
        },
      ],
    }).compile();

    service = moduleRef.get(MonitoringService);
  });

  afterEach(() => jest.resetAllMocks());

  it('getStackHealth returns healthy when all up', async () => {
    mockFetchOnce({ status: 'success' }); // prometheus /-/healthy
    mockFetchOnce({ status: 'success' }); // loki /ready
    mockFetchOnce({ database: 'ok' }); // grafana /api/health
    const res = await service.getStackHealth();
    expect(res.status).toBe('healthy');
    expect(res.services).toEqual({
      prometheus: 'ok',
      loki: 'ok',
      grafana: 'ok',
    });
  });

  it('getStackHealth returns degraded when one down', async () => {
    mockFetchOnce({}, false, 503); // prometheus down
    mockFetchOnce({ status: 'success' }); // loki
    mockFetchOnce({ database: 'ok' }); // grafana
    const res = await service.getStackHealth();
    expect(res.status).toBe('degraded');
    expect(res.services.prometheus).toBe('down');
  });

  it('getContainerLogs maps Loki streams to lines, filters by level', async () => {
    mockFetchOnce({
      status: 'success',
      data: {
        resultType: 'streams',
        result: [
          { stream: {}, values: [['1700000000000000000', '... ERROR boom']] },
        ],
      },
    });
    const logs = await service.getContainerLogs('zalo_ws_gateway', 'ERROR', 100);
    expect(logs).toHaveLength(1);
    expect(logs[0].line).toContain('ERROR boom');
  });

  it('aiAnalyze calls gateway.complete with snapshot context', async () => {
    mockFetchOnce({ status: 'success', data: { result: [] } }); // up
    mockFetchOnce({ status: 'success', data: { result: [] } }); // restarts
    mockFetchOnce({ status: 'success', data: { result: [] } }); // uptime
    mockFetchOnce({ status: 'success', data: { result: [] } }); // probeSuccess
    mockFetchOnce({ status: 'success' }); // stackHealth prometheus
    mockFetchOnce({ status: 'success' }); // stackHealth loki
    mockFetchOnce({ database: 'ok' }); // stackHealth grafana
    gateway.complete.mockResolvedValue({
      content: 'All healthy.',
      tokensIn: 10,
      tokensOut: 5,
      model: 'm',
      provider: 'p',
      latencyMs: 1,
    } as never);
    const res = await service.aiAnalyze('user-1', 'có gì lỗi không?');
    expect(res.answer).toBe('All healthy.');
    expect(gateway.complete).toHaveBeenCalled();
  });
});
