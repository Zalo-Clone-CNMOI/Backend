/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * @file presence.handler.spec.ts
 * @covers PresenceHandler – WS Gateway presence event handler
 * @maps TC-WS-007 (presence connect/disconnect), TC-WS-008 (heartbeat emission),
 *       TC-KAFKA-001 (presence command emission)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PresenceHandler } from './presence.handler';
import { KAFKA_CLIENT } from '@libs/kafka';
import { KafkaTopics } from '@libs/contracts';

// ────── Mock Socket ──────────────────────────────────────────────────────

function createMockSocket(userId = 'user-abc') {
  return {
    id: 'socket-id-456',
    data: { userId },
    handshake: { headers: {}, auth: {} },
  } as any;
}

// ────── Test Suite ───────────────────────────────────────────────────────

describe('PresenceHandler', () => {
  let handler: PresenceHandler;
  let kafka: { emit: jest.Mock };

  beforeEach(async () => {
    kafka = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PresenceHandler, { provide: KAFKA_CLIENT, useValue: kafka }],
    }).compile();

    handler = module.get(PresenceHandler);
  });

  // ── handleConnect ──────────────────────────────────────────────────────

  describe('handleConnect', () => {
    it('should emit PresenceConnect command to Kafka', () => {
      const socket = createMockSocket();

      handler.handleConnect(socket, 'user-abc');

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceConnect,
        expect.objectContaining({
          user_id: 'user-abc',
          socket_id: 'socket-id-456',
          event_id: expect.any(String),
          emitted_at: expect.any(Number),
          connected_at: expect.any(Number),
          trace_id: 'socket-id-456',
        }),
      );
    });

    it('should generate a UUID event_id', () => {
      const socket = createMockSocket();

      handler.handleConnect(socket, 'user-abc');

      const emittedPayload = kafka.emit.mock.calls[0][1];
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(emittedPayload.event_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should use socket.id as trace_id', () => {
      const socket = createMockSocket();

      handler.handleConnect(socket, 'user-abc');

      const emittedPayload = kafka.emit.mock.calls[0][1];
      expect(emittedPayload.trace_id).toBe(socket.id);
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('should emit PresenceDisconnect command to Kafka', () => {
      const socket = createMockSocket();

      handler.handleDisconnect(socket, 'user-abc');

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceDisconnect,
        expect.objectContaining({
          user_id: 'user-abc',
          socket_id: 'socket-id-456',
          disconnected_at: expect.any(Number),
          event_id: expect.any(String),
          emitted_at: expect.any(Number),
          trace_id: 'socket-id-456',
        }),
      );
    });
  });

  // ── handleHeartbeat ────────────────────────────────────────────────────

  describe('handleHeartbeat', () => {
    it('should emit PresenceHeartbeat command with client ts', () => {
      const socket = createMockSocket('user-xyz');
      const clientTs = Date.now();

      handler.handleHeartbeat(socket, { ts: clientTs });

      expect(kafka.emit).toHaveBeenCalledWith(
        KafkaTopics.PresenceHeartbeat,
        expect.objectContaining({
          user_id: 'user-xyz',
          socket_id: 'socket-id-456',
          ts: clientTs,
          event_id: expect.any(String),
          emitted_at: expect.any(Number),
        }),
      );
    });

    it('should use socket.data.userId for heartbeat (server-side)', () => {
      const socket = createMockSocket('real-user-id');

      handler.handleHeartbeat(socket, { ts: 123 });

      const emittedPayload = kafka.emit.mock.calls[0][1];
      expect(emittedPayload.user_id).toBe('real-user-id');
    });
  });
});
