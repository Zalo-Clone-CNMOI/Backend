/**
 * @file mock-kafka.helper.ts
 *
 * Mock for ClientKafka injected via KAFKA_CLIENT.
 * Captures all emitted events for assertion.
 */

export interface EmittedEvent {
  topic: string;
  payload: unknown;
}

export function createMockKafkaClient() {
  const emitted: EmittedEvent[] = [];

  const client = {
    connect: jest.fn().mockResolvedValue(undefined),

    emit: jest.fn((topic: string, payload: unknown) => {
      emitted.push({ topic, payload });
      return { subscribe: jest.fn() };
    }),

    subscribeToResponseOf: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    client: client as unknown as Record<string, jest.Mock>,
    emitted,

    /** Get events emitted to a specific topic */
    getEmittedEvents(topic?: string): EmittedEvent[] {
      if (!topic) return [...emitted];
      return emitted.filter((e) => e.topic === topic);
    },

    /** Get the last event emitted to a topic */
    getLastEvent(topic: string): EmittedEvent | undefined {
      const events = emitted.filter((e) => e.topic === topic);
      return events[events.length - 1];
    },

    /** Check if any event was emitted to a topic */
    wasEmitted(topic: string): boolean {
      return emitted.some((e) => e.topic === topic);
    },

    /** Reset all recorded events and mocks */
    reset() {
      emitted.length = 0;
      client.connect.mockClear();
      client.emit.mockClear();
    },
  };
}
