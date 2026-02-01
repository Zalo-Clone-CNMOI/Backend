import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, OnModuleInit, UseGuards } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { ClientKafka } from '@nestjs/microservices';
import { JwtService, WsAuthGuard } from '@libs/auth';
import { canUserAccessConversation } from '@libs/mvp-access';
import {
  KafkaTopics,
  WsEvents,
  type PresenceDisconnectCommand,
  type PresenceHeartbeatCommand,
  type WsChatJoinPayload,
  type WsChatSendPayload,
  type WsChatAckPayload,
  type WsPresenceHeartbeatPayload,
  type WsChatEditPayload,
  type WsChatDeletePayload,
  type WsChatReactPayload,
  type WsChatUnreactPayload,
  type ChatMessageEditCommand,
  type ChatMessageDeleteCommand,
  type ChatReactionAddCommand,
  type ChatReactionRemoveCommand,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';

type SocketData = { userId?: string };
type AuthedSocket = Socket<any, any, any, SocketData>;

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ChatGateway implements OnModuleInit {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  handleConnection(socket: AuthedSocket) {
    console.log('[ChatGateway.handleConnection] 🔌 New connection:', socket.id);

    const authHeader =
      socket.handshake.headers['authorization'] ??
      (socket.handshake.auth?.token as string | undefined);

    if (!authHeader) {
      console.log(
        '[ChatGateway.handleConnection] ⚠️ No auth token, socket:',
        socket.id,
      );
      socket.data.userId = undefined;
      return;
    }

    try {
      const user = this.jwtService.verifyToken(
        authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader,
      );

      socket.data.userId = user.userId;
      void socket.join(`user:${user.userId}`);

      console.log(
        '[ChatGateway.handleConnection] ✅ Authenticated:',
        JSON.stringify({ socketId: socket.id, userId: user.userId }),
      );

      this.kafka.emit(KafkaTopics.PresenceConnect, {
        user_id: user.userId,
        socket_id: socket.id,
        connected_at: Date.now(),
      });
    } catch (err) {
      console.log(
        '[ChatGateway.handleConnection] ❌ Auth failed:',
        socket.id,
        err,
      );
      socket.data.userId = undefined;
    }
  }

  handleDisconnect(socket: AuthedSocket) {
    const userId = socket.data.userId;
    if (!userId) return;

    console.log('[WS DISCONNECT]', socket.id);

    const cmd: PresenceDisconnectCommand = {
      user_id: userId,
      socket_id: socket.id,
      disconnected_at: Date.now(),
    };
    void this.kafka.emit(KafkaTopics.PresenceDisconnect, cmd);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatJoin)
  handleJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatJoinPayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: '',
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }
    void socket.join(`conv:${body.conversation_id}`);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatSend)
  handleSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatSendPayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    void this.kafka.emit(KafkaTopics.ChatMessageSend, {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      body: body.body,
      sent_at: body.sent_at,
    });

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.PresenceHeartbeat)
  handleHeartbeat(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsPresenceHeartbeatPayload,
  ) {
    const userId = String(socket.data.userId);
    const cmd: PresenceHeartbeatCommand = {
      user_id: userId,
      socket_id: socket.id,
      ts: body.ts,
    };
    void this.kafka.emit(KafkaTopics.PresenceHeartbeat, cmd);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatEdit)
  handleEdit(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatEditPayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatMessageEditCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      new_body: body.new_body,
      edited_at: Date.now(),
    };
    void this.kafka.emit(KafkaTopics.ChatMessageEdit, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatDelete)
  handleDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatDeletePayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatMessageDeleteCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      sender_id: userId,
      deleted_at: Date.now(),
    };
    void this.kafka.emit(KafkaTopics.ChatMessageDelete, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatReact)
  handleReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatReactPayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatReactionAddCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      user_id: userId,
      reaction_type: body.reaction_type,
      created_at: Date.now(),
    };
    void this.kafka.emit(KafkaTopics.ChatReactionAdd, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatUnreact)
  handleUnreact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatUnreactPayload,
  ) {
    const userId = String(socket.data.userId);
    if (!canUserAccessConversation(userId, body.conversation_id)) {
      socket.emit(WsEvents.ChatAck, {
        message_id: body.message_id,
        status: 'rejected',
        reason: 'not_member',
      } satisfies WsChatAckPayload);
      return;
    }

    const cmd: ChatReactionRemoveCommand = {
      message_id: body.message_id,
      conversation_id: body.conversation_id,
      user_id: userId,
    };
    void this.kafka.emit(KafkaTopics.ChatReactionRemove, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  broadcastToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
  ) {
    this.server.to(`conv:${conversationId}`).emit(event, payload);
  }

  broadcastToAll(event: string, payload: unknown) {
    this.server.emit(event, payload);
  }

  /**
   * Emit event to a specific socket by ID
   * Used for QR login to send tokens directly to PC socket
   */
  async emitToSocket(socketId: string, event: string, payload: unknown) {
    console.log(
      '[ChatGateway.emitToSocket] 📤 Attempting to emit:',
      JSON.stringify({
        socketId,
        event,
        payloadKeys: Object.keys(payload as object),
      }),
    );

    console.log(
      '[ChatGateway.emitToSocket] 📊 Server adapter:',
      this.server.adapter?.constructor?.name,
    );

    const allSockets = await this.server.fetchSockets();
    console.log(
      '[ChatGateway.emitToSocket] 📊 Total connected sockets:',
      allSockets.length,
    );
    console.log(
      '[ChatGateway.emitToSocket] 📊 All socket IDs:',
      allSockets.map((s) => s.id),
    );

    const sockets = await this.server.in(socketId).fetchSockets();

    console.log(
      '[ChatGateway.emitToSocket] 🎯 Target socket/room:',
      socketId,
      'Event:',
      event,
      'Sockets found:',
      sockets.length,
    );

    if (sockets.length === 0) {
      console.error(
        '[ChatGateway.emitToSocket] ❌ No sockets found for id/room:',
        socketId,
      );
      console.error(
        '[ChatGateway.emitToSocket] ⚠️ This socket may be connected to a different instance (Redis adapter issue).',
      );
    } else {
      console.log(
        '[ChatGateway.emitToSocket] ✅ Found socket(s):',
        sockets.map((s) => ({ id: s.id, rooms: Array.from(s.rooms) })),
      );
    }

    const emitResult = this.server.to(socketId).emit(event, payload);
    console.log(
      '[ChatGateway.emitToSocket] 📡 Emit executed. Result:',
      typeof emitResult,
    );

    const roomEmitResult = this.server.to(`${socketId}`).emit(event, payload);
    console.log(
      '[ChatGateway.emitToSocket] 📡 Room emit executed. Result:',
      typeof roomEmitResult,
    );
  }
}
