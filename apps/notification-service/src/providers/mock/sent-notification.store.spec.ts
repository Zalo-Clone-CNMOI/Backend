/**
 * @file sent-notification.store.spec.ts
 *
 * Unit tests for SentNotificationStore — in-memory notification log
 * used by MockNotificationProvider in tests.
 */
import { SentNotificationStore } from './sent-notification.store';
import type { SentNotification } from './sent-notification.store';

describe('SentNotificationStore', () => {
  let store: SentNotificationStore;

  beforeEach(() => {
    store = new SentNotificationStore();
  });

  describe('list', () => {
    it('should return empty array initially', () => {
      expect(store.list()).toEqual([]);
    });

    it('should return a copy (mutations do not affect internal state)', () => {
      const notification: SentNotification = {
        userId: 'u1',
        title: 'T',
        body: 'B',
        sentAt: 1000,
      };
      store.push(notification);

      const list = store.list();
      list.push({ userId: 'u2', title: 'T2', body: 'B2', sentAt: 2000 });

      expect(store.list()).toHaveLength(1);
    });
  });

  describe('push', () => {
    it('should add a notification to the list', () => {
      const notification: SentNotification = {
        userId: 'user-1',
        title: 'Hello',
        body: 'World',
        sentAt: Date.now(),
      };

      store.push(notification);

      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]).toEqual(notification);
    });

    it('should maintain insertion order', () => {
      store.push({ userId: 'u1', title: 'First', body: 'B1', sentAt: 1 });
      store.push({ userId: 'u2', title: 'Second', body: 'B2', sentAt: 2 });
      store.push({ userId: 'u3', title: 'Third', body: 'B3', sentAt: 3 });

      const list = store.list();
      expect(list[0].title).toBe('First');
      expect(list[1].title).toBe('Second');
      expect(list[2].title).toBe('Third');
    });

    it('should accumulate multiple notifications', () => {
      for (let i = 0; i < 5; i++) {
        store.push({ userId: `u${i}`, title: `T${i}`, body: 'B', sentAt: i });
      }
      expect(store.list()).toHaveLength(5);
    });
  });

  describe('clear', () => {
    it('should empty the list', () => {
      store.push({ userId: 'u1', title: 'T', body: 'B', sentAt: 1 });
      store.push({ userId: 'u2', title: 'T', body: 'B', sentAt: 2 });

      store.clear();

      expect(store.list()).toHaveLength(0);
    });

    it('should allow pushing after clear', () => {
      store.push({ userId: 'u1', title: 'T', body: 'B', sentAt: 1 });
      store.clear();
      store.push({ userId: 'u2', title: 'T2', body: 'B2', sentAt: 2 });

      const list = store.list();
      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe('u2');
    });
  });
});
