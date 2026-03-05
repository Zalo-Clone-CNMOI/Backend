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
import { ConversationMembershipService } from '@libs/mvp-access';
import {
  KafkaTopics,
  WsEvents,
  type PresenceConnectCommand,
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
import { v4 as uuidv4 } from 'uuid';

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
    private readonly membershipService: ConversationMembershipService,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
  }

  handleConnection(socket: AuthedSocket) {
    const authHeader =
      socket.handshake.headers['authorization'] ??
      (socket.handshake.auth?.token as string | undefined);

    if (!authHeader) {
      socket.data.userId = undefined;
      return;
    }

    try {
      const user = this.jwtService.verifyToken(
        authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader,
      );

      socket.data.userId = user.userId;
      void socket.join(`user:${user.userId}`);

      const cmd: PresenceConnectCommand = {
        event_id: uuidv4(),
        emitted_at: Date.now(),
        user_id: user.userId,
        socket_id: socket.id,
        connected_at: Date.now(),
        trace_id: socket.id,
      };
      this.kafka.emit(KafkaTopics.PresenceConnect, cmd);
    } catch {
      socket.data.userId = undefined;
    }
  }

  handleDisconnect(socket: AuthedSocket) {
    const userId = socket.data.userId;
    if (!userId) return;

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

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatJoin)
  async handleJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatJoinPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
  async handleSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatSendPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
      attachments: body.attachments,
      reply_to_message_id: body.reply_to_message_id,
      trace_id: `ws:${socket.id}:${body.message_id}`,
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
      event_id: uuidv4(),
      emitted_at: Date.now(),
      user_id: userId,
      socket_id: socket.id,
      ts: body.ts,
      trace_id: socket.id,
    };
    void this.kafka.emit(KafkaTopics.PresenceHeartbeat, cmd);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatEdit)
  async handleEdit(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatEditPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatMessageEdit, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatDelete)
  async handleDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatDeletePayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatMessageDelete, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatReact)
  async handleReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatReactPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
      trace_id: `ws:${socket.id}:${body.message_id}`,
    };
    void this.kafka.emit(KafkaTopics.ChatReactionAdd, cmd);

    socket.emit(WsEvents.ChatAck, {
      message_id: body.message_id,
      status: 'accepted',
    } satisfies WsChatAckPayload);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatUnreact)
  async handleUnreact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatUnreactPayload,
  ) {
    const userId = String(socket.data.userId);
    const canAccess = await this.membershipService.canUserAccessConversation(
      userId,
      body.conversation_id,
    );
    if (!canAccess) {
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
      trace_id: `ws:${socket.id}:${body.message_id}`,
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
    const sockets = await this.server.in(socketId).fetchSockets();

    if (sockets.length === 0) {
      console.warn('[ChatGateway.emitToSocket] Socket not found:', socketId);
    }

    this.server.to(socketId).emit(event, payload);
  }
}
