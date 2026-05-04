import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationLog, NotificationPreference } from '@libs/database';
import {
  NotificationType,
  type NotificationRequestedEvent,
} from '@libs/contracts';
import { NOTIFICATION_PROVIDER } from '../providers/notification.provider';
import { NotificationPublisher } from '../transport/notification.publisher';
import { NotificationMetrics } from './notification.metrics';
import { NotificationService } from './notification.service';

describe('NotificationService — preference handling', () => {
  let service: NotificationService;
  const provider = {
    send: jest.fn().mockResolvedValue({
      ok: true,
      successCount: 1,
      failureCount: 0,
    }),
  };
  const publisher = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const metrics = {
    recordSuppressed: jest.fn(),
    recordFailed: jest.fn(),
  };
  const preferenceRepo = {
    findOne: jest.fn(),
  };
  const logRepo = {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: NOTIFICATION_PROVIDER, useValue: provider },
        { provide: NotificationPublisher, useValue: publisher },
        { provide: NotificationMetrics, useValue: metrics },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferenceRepo,
        },
        {
          provide: getRepositoryToken(NotificationLog),
          useValue: logRepo,
        },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  const inQuietHoursPrefs = () => {
    const now = new Date();
    const start = `${String(now.getHours()).padStart(2, '0')}:00`;
    const next = new Date(now.getTime() + 60 * 60 * 1000);
    const end = `${String(next.getHours()).padStart(2, '0')}:00`;
    return {
      userId: 'user-1',
      pushEnabled: true,
      quietHoursStart: start,
      quietHoursEnd: end,
    };
  };

  const baseRequest = (
    overrides: Partial<NotificationRequestedEvent> = {},
  ): NotificationRequestedEvent => ({
    channel: 'push',
    user_id: 'user-1',
    title: 'Hello',
    body: 'World',
    requested_at: Date.now(),
    ...overrides,
  });

  it('suppresses normal notifications during quiet hours', async () => {
    preferenceRepo.findOne.mockResolvedValue(inQuietHoursPrefs());

    await service.processNotification(
      baseRequest({ type: NotificationType.ChatMessage }),
    );

    expect(provider.send).not.toHaveBeenCalled();
    expect(metrics.recordSuppressed).toHaveBeenCalled();
  });

  it('bypasses quiet hours when rich.bypass_quiet_hours = true (incoming call)', async () => {
    preferenceRepo.findOne.mockResolvedValue(inQuietHoursPrefs());

    await service.processNotification(
      baseRequest({
        type: NotificationType.IncomingCall,
        rich: { bypass_quiet_hours: true, priority: 'high' },
      }),
    );

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(metrics.recordSuppressed).not.toHaveBeenCalled();
  });

  it('still respects pushEnabled=false even with bypass_quiet_hours', async () => {
    preferenceRepo.findOne.mockResolvedValue({
      ...inQuietHoursPrefs(),
      pushEnabled: false,
    });

    await service.processNotification(
      baseRequest({
        type: NotificationType.IncomingCall,
        rich: { bypass_quiet_hours: true, priority: 'high' },
      }),
    );

    expect(provider.send).not.toHaveBeenCalled();
    expect(metrics.recordSuppressed).toHaveBeenCalled();
  });
});
