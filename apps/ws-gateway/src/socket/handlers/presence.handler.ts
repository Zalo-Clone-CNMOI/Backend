import { Injectable, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  KafkaTopics,
  type PresenceConnectCommand,
  type PresenceDisconnectCommand,
  type PresenceHeartbeatCommand,
  type WsPresenceHeartbeatPayload,
} from '@libs/contracts';
import { v4 as uuidv4 } from 'uuid';
import type { Socket } from 'socket.io';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

@Injectable()
export class PresenceHandler {
  constructor(@Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka) {}

  handleConnect(socket: AuthedSocket, userId: string) {
    const cmd: PresenceConnectCommand = {
      event_id: uuidv4(),
      emitted_at: Date.now(),
      user_id: userId,
      socket_id: socket.id,
      connected_at: Date.now(),
      trace_id: socket.id,
    };
    this.kafka.emit(KafkaTopics.PresenceConnect, cmd);
  }

  handleDisconnect(socket: AuthedSocket, userId: string) {
    const cmd: PresenceDisconnectCommand = {
      event_id: uuidv4(),
      emitted_at: Date.now(),
      user_id: userId,
      socket_id: socket.id,
      disconnected_at: Date.now(),
      trace_id: socket.id,
    };
    void this.kafka.emit(KafkaTopics.PresenceDisconnect, cmd);
  }

  handleHeartbeat(socket: AuthedSocket, body: WsPresenceHeartbeatPayload) {
    const userId = String(socket.data.userId);
    const cmd: PresenceHeartbeatCommand = {
      event_id: uuidv4(),
      emitted_at: Date.now(),
      user_id: userId,
      socket_id: socket.id,
      ts: body.ts,
      trace_id: socket.id,
    };
    void this.kafka.emit(KafkaTopics.PresenceHeartbeat, cmd);
  }
}
