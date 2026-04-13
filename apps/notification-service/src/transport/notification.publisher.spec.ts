/**
 * @file notification.publisher.spec.ts
 *
 * Unit tests for NotificationPublisher — thin Kafka emit wrapper.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPublisher } from './notification.publisher';
import { KAFKA_CLIENT } from '@libs/kafka';
import { of } from 'rxjs';

describe('NotificationPublisher', () => {
  let publisher: NotificationPublisher;
  let kafka: Record<string, jest.Mock>;

  beforeEach(async () => {
    kafka = {
      connect: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockReturnValue(of(undefined)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPublisher,
        { provide: KAFKA_CLIENT, useValue: kafka },
      ],
    }).compile();

    publisher = module.get<NotificationPublisher>(NotificationPublisher);
  });

  describe('onModuleInit', () => {
    it('should call kafka.connect on init', async () => {
      await publisher.onModuleInit();

      expect(kafka.connect).toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('should delegate to kafka.emit with topic and payload', async () => {
      const payload = { user_id: 'u1', message: 'hello' };
      await publisher.emit('test.topic', payload);

      expect(kafka.emit).toHaveBeenCalledWith('test.topic', payload);
    });

    it('should forward arbitrary payloads without mutation', async () => {
      const complex = { nested: { deep: [1, 2, 3] }, flag: true };
      await publisher.emit('topic.complex', complex);

      expect(kafka.emit).toHaveBeenCalledWith('topic.complex', complex);
    });

    it('should handle null payload', async () => {
      await publisher.emit('topic.null', null);

      expect(kafka.emit).toHaveBeenCalledWith('topic.null', null);
    });
  });
});
