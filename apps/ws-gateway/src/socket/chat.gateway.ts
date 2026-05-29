import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  Inject,
  Logger,
  OnModuleInit,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { WsExceptionFilter } from '@app/interceptors';
import type { Server, Socket } from 'socket.io';
import { ClientKafka } from '@nestjs/microservices';
import { WsException } from '@nestjs/websockets';
import { JwtService, WsAuthGuard } from '@libs/auth';
import { RedisService } from '@libs/redis';
import { randomUUID } from 'crypto';
import {
  KafkaTopics,
  WsEvents,
  type AiStreamAbortEvent,
  type WsQrBindIssuedPayload,
} from '@libs/contracts';
import { KAFKA_CLIENT } from '@libs/kafka';
import { ActiveStreamTracker } from './active-stream.tracker';
import {
  ChatHandler,
  CallHandler,
  PresenceHandler,
  AiHandler,
  TypingHandler,
} from './handlers';
import {
  WsAiDocumentQueryRequestPayloadDto,
  WsAiSmartReplyRequestPayloadDto,
  WsAiStreamCancelPayloadDto,
  WsAiSummaryRequestPayloadDto,
  WsAiTranslateRequestPayloadDto,
  WsCallAcceptPayloadDto,
  WsCallEndPayloadDto,
  WsCallLeavePayloadDto,
  WsCallRejectPayloadDto,
  WsCallSignalPayloadDto,
  WsCallStartPayloadDto,
  WsCallStateRequestPayloadDto,
  WsChatDeletePayloadDto,
  WsChatEditPayloadDto,
  WsChatJoinPayloadDto,
  WsChatReactPayloadDto,
  WsChatSendPayloadDto,
  WsChatTypingPayloadDto,
  WsChatUnreactPayloadDto,
  WsPresenceHeartbeatPayloadDto,
} from './dto/ws-payload.dto';
import type { DefaultEventsMap } from 'socket.io/dist/typed-events';

type SocketData = { userId?: string };
type AuthedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

const AUTHENTICATED_CLIENTS_ROOM = 'auth:clients';

@UseFilters(WsExceptionFilter)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }),
)
@WebSocketGateway()
export class ChatGateway implements OnModuleInit {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: ClientKafka,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly chatHandler: ChatHandler,
    private readonly callHandler: CallHandler,
    private readonly presenceHandler: PresenceHandler,
    private readonly aiHandler: AiHandler,
    private readonly typingHandler: TypingHandler,
    private readonly streamTracker: ActiveStreamTracker,
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
      void socket.join(AUTHENTICATED_CLIENTS_ROOM);
      void socket.join(`user:${user.userId}`);

      // 'disconnecting' fires while socket.rooms is still populated, so we can
      // see which conversations this socket was in and abort their Zai streams
      // if no other recipient remains (Phase 6 C12). handleDisconnect runs
      // after rooms are cleared, so the check must happen here.
      socket.on('disconnecting', () => {
        void this.abortStreamsForDepartingSocket(socket);
      });

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

  /**
   * On the `disconnecting` event, abort any active Zai stream in a conversation
   * this socket is leaving — but ONLY when it is the last recipient remaining
   * in that conversation room. Other group members watching the same stream
   * must keep receiving it. Publishes AiStreamAbort keyed by stream_id so it
   * lands on the same partition as the stream's chunks (Phase 6 C12).
   */
  private async abortStreamsForDepartingSocket(
    socket: AuthedSocket,
  ): Promise<void> {
    const convRooms = [...socket.rooms].filter((room) =>
      room.startsWith('conv:'),
    );

    for (const room of convRooms) {
      const conversationId = room.slice('conv:'.length);
      const activeStreams = this.streamTracker.getActiveStreams(conversationId);
      if (activeStreams.length === 0) continue;

      // fetchSockets() (Redis adapter) returns recipients across all instances
      // and still includes THIS socket (it has not left the room yet). Abort
      // only if no other recipient remains.
      let remaining = 0;
      try {
        const sockets = await this.server.in(room).fetchSockets();
        remaining = sockets.filter((s) => s.id !== socket.id).length;
      } catch (err) {
        // Be conservative: if occupancy is unknown, do NOT abort (avoid cutting
        // off other members). The stream will end naturally on completion.
        this.logger.warn(
          `Failed to resolve room occupancy for ${room}; skipping stream abort: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (remaining > 0) continue;

      for (const streamId of activeStreams) {
        this.streamTracker.complete(streamId);
        const abortEvent: AiStreamAbortEvent = {
          stream_id: streamId,
          conversation_id: conversationId,
          reason: 'client_disconnect',
          aborted_at: Date.now(),
        };
        void this.kafka.emit(KafkaTopics.AiStreamAbort, {
          key: streamId,
          value: abortEvent,
        });
        this.logger.log(
          `Published AiStreamAbort for stream ${streamId} (conversation ${conversationId}) — last recipient left`,
        );
      }
    }
  }

  // ── Chat Event Handlers ──────────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatJoin)
  async handleJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatJoinPayloadDto,
  ) {
    return this.chatHandler.handleJoin(socket, body.conversation_id);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatSend)
  async handleSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatSendPayloadDto,
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
    @MessageBody() body: WsChatEditPayloadDto,
  ) {
    return this.chatHandler.handleEdit(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatDelete)
  async handleDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatDeletePayloadDto,
  ) {
    return this.chatHandler.handleDelete(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatReact)
  async handleReact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatReactPayloadDto,
  ) {
    return this.chatHandler.handleReact(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatUnreact)
  async handleUnreact(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatUnreactPayloadDto,
  ) {
    return this.chatHandler.handleUnreact(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.ChatTyping)
  handleTyping(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsChatTypingPayloadDto,
  ) {
    return this.typingHandler.handleTyping(socket, body);
  }

  // ── Call Signaling & State Handlers ───────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallStart)
  handleCallStart(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallStartPayloadDto,
  ) {
    return this.callHandler.handleStart(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallSignal)
  handleCallSignal(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallSignalPayloadDto,
  ) {
    return this.callHandler.handleSignal(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallAccept)
  handleCallAccept(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallAcceptPayloadDto,
  ) {
    return this.callHandler.handleAccept(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallReject)
  handleCallReject(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallRejectPayloadDto,
  ) {
    return this.callHandler.handleReject(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallEnd)
  handleCallEnd(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallEndPayloadDto,
  ) {
    return this.callHandler.handleEnd(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallLeave)
  async handleCallLeave(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallLeavePayloadDto,
  ) {
    await this.callHandler.handleLeave(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.CallStateRequest)
  handleCallStateRequest(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsCallStateRequestPayloadDto,
  ) {
    return this.callHandler.handleStateRequest(socket, body);
  }

  // ── Presence Event Handlers ──────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.PresenceHeartbeat)
  handleHeartbeat(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsPresenceHeartbeatPayloadDto,
  ) {
    return this.presenceHandler.handleHeartbeat(socket, body);
  }

  // ── AI Event Handlers ────────────────────────────────────────────────

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiSmartReplyRequest)
  handleAiSmartReply(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiSmartReplyRequestPayloadDto,
  ) {
    return this.aiHandler.handleSmartReply(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiSummaryRequest)
  handleAiSummary(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiSummaryRequestPayloadDto,
  ) {
    return this.aiHandler.handleSummary(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiTranslateRequest)
  handleAiTranslate(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiTranslateRequestPayloadDto,
  ) {
    return this.aiHandler.handleTranslate(socket, body);
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiDocumentQueryRequest)
  handleAiDocumentQuery(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiDocumentQueryRequestPayloadDto,
  ) {
    return this.aiHandler.handleDocumentQuery(socket, body);
  }

  /**
   * Client "Stop" button: abort the in-flight Zai stream for a conversation.
   * Resolves the conversation's active stream(s) and publishes AiStreamAbort
   * (Kafka, reason 'user_cancel') keyed by stream_id — same path the
   * disconnect handler uses (Phase 6 C12). Auth gate: the socket must have
   * joined the `conv:{id}` room, so only a participant viewing the chat can
   * cancel its stream.
   */
  @UseGuards(WsAuthGuard)
  @SubscribeMessage(WsEvents.AiStreamCancel)
  handleAiStreamCancel(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: WsAiStreamCancelPayloadDto,
  ): void {
    const conversationId = body.conversation_id;
    const room = `conv:${conversationId}`;
    if (!socket.rooms.has(room)) {
      this.logger.debug(
        `Ignoring ai:stream:cancel for ${conversationId}: socket ${socket.id} has not joined ${room}`,
      );
      return;
    }

    // Invariant: Zai runs at most ONE stream per conversation at a time
    // (ActiveStreamTracker is keyed per conversation), so aborting every active
    // stream for this conversation is equivalent to "stop this conversation's
    // Zai reply". If concurrent per-user streams are ever introduced, filter by
    // the originating user (socket.data.userId) before aborting.
    const activeStreams = this.streamTracker.getActiveStreams(conversationId);
    if (activeStreams.length === 0) return;

    for (const streamId of activeStreams) {
      this.streamTracker.complete(streamId);
      const abortEvent: AiStreamAbortEvent = {
        stream_id: streamId,
        conversation_id: conversationId,
        reason: 'user_cancel',
        aborted_at: Date.now(),
      };
      void this.kafka.emit(KafkaTopics.AiStreamAbort, {
        key: streamId,
        value: abortEvent,
      });
      this.logger.log(
        `Published AiStreamAbort for stream ${streamId} (conversation ${conversationId}) — user cancel`,
      );
    }
  }

  @SubscribeMessage(WsEvents.QrBindRequest)
  async handleQrBindRequest(
    @ConnectedSocket() socket: AuthedSocket,
  ): Promise<void> {
    const isLimited = await this.isQrBindRateLimited(socket.id);
    if (isLimited) {
      throw new WsException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many QR bind requests. Try again later.',
      });
    }

    const socketBindingToken = randomUUID();
    const expiresInSeconds = 90;

    await this.redisService.setQrSocketBinding(
      socketBindingToken,
      socket.id,
      expiresInSeconds,
    );

    const payload: WsQrBindIssuedPayload = {
      socketId: socket.id,
      socketBindingToken,
      expiresInSeconds,
    };

    socket.emit(WsEvents.QrBindIssued, payload);
  }

  private async isQrBindRateLimited(socketId: string): Promise<boolean> {
    const key = `rate:qr-bind:${socketId}`;
    const count = await this.redisService.incrBy(key, 1);
    if (count === 1) {
      await this.redisService.expire(key, 60);
    }
    return count > 5;
  }

  // ── Broadcast Utilities ──────────────────────────────────────────────

  broadcastToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
  ) {
    this.server.to(`conv:${conversationId}`).emit(event, payload);
  }

  broadcastToConversationExceptUsers(
    conversationId: string,
    event: string,
    payload: unknown,
    excludedUserIds: string[],
  ) {
    let operator = this.server.to(`conv:${conversationId}`);
    for (const userId of excludedUserIds) {
      operator = operator.except(`user:${userId}`);
    }
    operator.emit(event, payload);
  }

  broadcastToAll(event: string, payload: unknown) {
    this.server.emit(event, payload);
  }

  broadcastToAuthenticated(event: string, payload: unknown) {
    this.server.to(AUTHENTICATED_CLIENTS_ROOM).emit(event, payload);
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
