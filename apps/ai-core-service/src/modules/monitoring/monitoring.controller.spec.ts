import { Test } from '@nestjs/testing';
import { InternalTokenGuard } from '@libs/auth';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

describe('MonitoringController', () => {
  let controller: MonitoringController;
  let service: jest.Mocked<MonitoringService>;

  beforeEach(async () => {
    service = {
      getContainers: jest.fn().mockResolvedValue([]),
      getContainerLogs: jest.fn().mockResolvedValue([]),
      getStackHealth: jest
        .fn()
        .mockResolvedValue({ status: 'healthy', services: {}, timestamp: 'x' }),
      aiAnalyze: jest
        .fn()
        .mockResolvedValue({ answer: 'ok', model: 'm', provider: 'p' }),
    } as unknown as jest.Mocked<MonitoringService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [{ provide: MonitoringService, useValue: service }],
    })
      .overrideGuard(InternalTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(MonitoringController);
  });

  it('GET containers delegates to service', async () => {
    await controller.containers();
    expect(service.getContainers).toHaveBeenCalled();
  });

  it('GET logs passes level + limit', async () => {
    await controller.logs('zalo_ws_gateway', 'ERROR', '50');
    expect(service.getContainerLogs).toHaveBeenCalledWith(
      'zalo_ws_gateway',
      'ERROR',
      50,
    );
  });

  it('logs defaults limit to 100 when absent', async () => {
    await controller.logs('zalo_ws_gateway', undefined, undefined);
    expect(service.getContainerLogs).toHaveBeenCalledWith(
      'zalo_ws_gateway',
      undefined,
      100,
    );
  });

  it('POST ai-analyze passes userId + question', async () => {
    await controller.aiAnalyze({ userId: 'u1', question: 'q' });
    expect(service.aiAnalyze).toHaveBeenCalledWith('u1', 'q');
  });

  it('GET stack-health delegates', async () => {
    await controller.stackHealth();
    expect(service.getStackHealth).toHaveBeenCalled();
  });
});
