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
  type WsChatTypingPayload,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import {
  ChatHandler,
  PresenceHandler,
  AiHandler,
  TypingHandler,
} from './handlers';

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
    private readonly chatHandler: ChatHandler,
    private readonly presenceHandler: PresenceHandler,
    private readonly aiHandler: AiHandler,
    private readonly typingHandler: TypingHandler,
  ) {}

  async onModuleInit() {
    await this.kafka.connect();
    this.typingHandler.setServer(this.server);
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
    const result = this.chatHandler.handleSend(socket, body);
    const userId = socket.data.userId;
    if (userId) {
      void this.typingHandler.clearTyping(userId, body.conversation_id);
    }
    return result;
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatEdit)
  async handleEdit(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatEditPayload,
  ) {
    return this.chatHandler.handleEdit(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatDelete)
  async handleDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatDeletePayload,
  ) {
    return this.chatHandler.handleDelete(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatReact)
  async handleReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatReactPayload,
  ) {
    return this.chatHandler.handleReact(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatUnreact)
  async handleUnreact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatUnreactPayload,
  ) {
    return this.chatHandler.handleUnreact(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatTyping)
  handleTyping(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatTypingPayload,
  ) {
    return this.typingHandler.handleTyping(socket, body);
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
