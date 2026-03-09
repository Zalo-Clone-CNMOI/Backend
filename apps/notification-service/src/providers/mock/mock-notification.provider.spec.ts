/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * @file mock-notification.provider.spec.ts
 *
 * Unit tests for MockNotificationProvider — stores sent
 * notifications in SentNotificationStore and returns { ok: true }.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { MockNotificationProvider } from './mock-notification.provider';
import { SentNotificationStore } from './sent-notification.store';

describe('MockNotificationProvider', () => {
  let provider: MockNotificationProvider;
  let store: SentNotificationStore;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockNotificationProvider, SentNotificationStore],
    }).compile();

    provider = module.get<MockNotificationProvider>(MockNotificationProvider);
    store = module.get<SentNotificationStore>(SentNotificationStore);
  });

  describe('send', () => {
    it('should push notification to store', async () => {
      await provider.send({
        userId: 'user-1',
        title: 'Hello',
        body: 'World',
      });

      const items = store.list();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          title: 'Hello',
          body: 'World',
        }),
      );
    });

    it('should return { ok: true }', async () => {
      const result = await provider.send({
        userId: 'u1',
        title: 'T',
        body: 'B',
      });

      expect(result).toEqual({ ok: true });
    });

    it('should include sentAt timestamp in stored notification', async () => {
      const before = Date.now();
      await provider.send({
        userId: 'u1',
        title: 'T',
        body: 'B',
      });
      const after = Date.now();

      const items = store.list();
      expect(items[0].sentAt).toBeGreaterThanOrEqual(before);
      expect(items[0].sentAt).toBeLessThanOrEqual(after);
    });

    it('should handle data field without storing it (data not in store schema)', async () => {
      await provider.send({
        userId: 'u1',
        title: 'T',
        body: 'B',
        data: { key: 'value' },
      });

      const items = store.list();
      expect(items).toHaveLength(1);
      // data is not part of SentNotification, so it should not be present
      expect((items[0] as any).data).toBeUndefined();
    });

    it('should store multiple notifications in order', async () => {
      await provider.send({ userId: 'u1', title: 'First', body: 'B1' });
      await provider.send({ userId: 'u2', title: 'Second', body: 'B2' });
      await provider.send({ userId: 'u3', title: 'Third', body: 'B3' });

      const items = store.list();
      expect(items).toHaveLength(3);
      expect(items[0].title).toBe('First');
      expect(items[1].title).toBe('Second');
      expect(items[2].title).toBe('Third');
    });

    it('should resolve as a Promise (async compatibility)', async () => {
      const result = provider.send({
        userId: 'u1',
        title: 'T',
        body: 'B',
      });

      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toEqual({ ok: true });
    });
  });
});
