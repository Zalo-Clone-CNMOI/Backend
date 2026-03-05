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
import {
  WsEvents,
  type WsChatJoinPayload,
  type WsChatSendPayload,
  type WsPresenceHeartbeatPayload,
  type WsChatEditPayload,
  type WsChatDeletePayload,
  type WsChatReactPayload,
  type WsChatUnreactPayload,
  type WsAiSmartReplyRequestPayload,
  type WsAiSummaryRequestPayload,
  type WsAiTranslateRequestPayload,
  type WsAiDocumentQueryRequestPayload,
  ChatMessageDeleteCommand,
  ChatMessageEditCommand,
  ChatReactionAddCommand,
  ChatReactionRemoveCommand,
  KafkaTopics,
  WsChatAckPayload,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { ChatHandler, PresenceHandler, AiHandler } from './handlers';

type SocketData = { userId?: string };
type AuthedSocket = Socket<any, any, any, SocketData>;

@WebSocketGateway({
  cors: { origin: '*' },
})
export class ChatGateway implements OnModuleInit {
  @WebSocketServer()
  private readonly server!: Server;
  membershipService: any;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly jwtService: JwtService,
    private readonly chatHandler: ChatHandler,
    private readonly presenceHandler: PresenceHandler,
    private readonly aiHandler: AiHandler,
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

      this.presenceHandler.handleConnect(socket, user.userId);
    } catch {
      socket.data.userId = undefined;
    }
  }

  handleDisconnect(socket: AuthedSocket) {
    const userId = socket.data.userId;
    if (!userId) return;

    this.presenceHandler.handleDisconnect(socket, userId);
  }

  // ── Chat Event Handlers ──────────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatJoin)
  async handleJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatJoinPayload,
  ) {
    return this.chatHandler.handleJoin(socket, body.conversation_id);
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

  // ── Presence Event Handlers ──────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.PresenceHeartbeat)
  handleHeartbeat(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsPresenceHeartbeatPayload,
  ) {
    return this.presenceHandler.handleHeartbeat(socket, body);
  }

  // ── AI Event Handlers ────────────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiSmartReplyRequest)
  handleAiSmartReply(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiSmartReplyRequestPayload,
  ) {
    return this.aiHandler.handleSmartReply(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiSummaryRequest)
  handleAiSummary(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiSummaryRequestPayload,
  ) {
    return this.aiHandler.handleSummary(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiTranslateRequest)
  handleAiTranslate(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiTranslateRequestPayload,
  ) {
    return this.aiHandler.handleTranslate(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiDocumentQueryRequest)
  handleAiDocumentQuery(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiDocumentQueryRequestPayload,
  ) {
    return this.aiHandler.handleDocumentQuery(socket, body);
  }

  // ── Broadcast Utilities ──────────────────────────────────────────────

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
   * Emit event to a specific socket by socketId (used for QR auth).
   */
  emitToSocket(socketId: string, event: string, payload: unknown) {
    this.server.to(socketId).emit(event, payload);
  }

  /**
   * Emit event to a specific user by userId.
   * Uses the `user:{userId}` room that all authenticated sockets join.
   */
  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
