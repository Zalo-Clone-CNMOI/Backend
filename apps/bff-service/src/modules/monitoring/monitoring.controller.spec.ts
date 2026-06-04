import { Test } from '@nestjs/testing';
import { BusinessException } from '@app/types';
import { JwtService } from '@libs/auth';
import { APP_CONFIG } from '@libs/config';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

describe('BFF MonitoringController', () => {
  let controller: MonitoringController;
  let service: jest.Mocked<MonitoringService>;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(async () => {
    service = {
      getContainers: jest.fn().mockResolvedValue([]),
      getContainerLogs: jest.fn().mockResolvedValue([]),
      getStackHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
      aiAnalyze: jest.fn().mockResolvedValue({ answer: 'ok' }),
    } as unknown as jest.Mocked<MonitoringService>;
    jwt = {
      verifyAccessToken: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [
        { provide: MonitoringService, useValue: service },
        { provide: JwtService, useValue: jwt },
        {
          provide: APP_CONFIG,
          useValue: { adminUserIds: ['admin-1'], monitorToken: 'mon' },
        },
      ],
    }).compile();
    controller = moduleRef.get(MonitoringController);
  });

  it('rejects when no token', () => {
    expect(() => controller.containers(null)).toThrow(BusinessException);
  });

  it('rejects when user not in admin allowlist', () => {
    jwt.verifyAccessToken.mockReturnValue({ sub: 'someone-else' } as never);
    expect(() => controller.containers('tok')).toThrow(BusinessException);
  });

  it('allows admin and returns containers', async () => {
    jwt.verifyAccessToken.mockReturnValue({ sub: 'admin-1' } as never);
    const res = await controller.containers('tok');
    expect(res).toEqual([]);
    expect(service.getContainers).toHaveBeenCalled();
  });

  it('ai-analyze passes verified userId', async () => {
    jwt.verifyAccessToken.mockReturnValue({ sub: 'admin-1' } as never);
    await controller.aiAnalyze('tok', { question: 'q' });
    expect(service.aiAnalyze).toHaveBeenCalledWith('admin-1', 'q');
  });

  it('stackHealth allows correct X-Monitor-Token (no JWT)', async () => {
    const res = await controller.stackHealth('mon');
    expect(res).toEqual({ status: 'healthy' });
  });

  it('stackHealth rejects wrong X-Monitor-Token', () => {
    expect(() => controller.stackHealth('wrong')).toThrow(BusinessException);
  });
});
