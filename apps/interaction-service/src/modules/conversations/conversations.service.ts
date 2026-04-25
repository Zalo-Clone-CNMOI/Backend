import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ClientKafka } from '@nestjs/microservices';
import { RedisClientType } from 'redis';
import { KAFKA_CLIENT } from '@libs/kafka';
import { CacheService, REDIS_CLIENT } from '@libs/redis';
import {
  KafkaTopics,
  type CallEndCommand,
  type CallStateSnapshot,
  type ConversationPinnedEvent,
  type ConversationUnpinnedEvent,
} from '@libs/contracts';
import { ConversationMember } from '@libs/database/entities';
import { ErrorCode } from '@app/constant';
import {
  BusinessException,
  PaginatedResponse,
  PaginationQuery,
} from '@app/types';
import {
  CreateGroupConversationDto,
  CreateDirectConversationDto,
  UpdateConversationDto,
  AddMembersDto,
  GetGroupInvitesQueryDto,
  GroupInviteItemDto,
  SendGroupInvitesDto,
  SendGroupInvitesResponseDto,
  UpdateMemberRoleDto,
  UpdateMemberSettingsDto,
  TransferOwnershipDto,
  EndConversationCallDto,
  ConversationListItemDto,
  ConversationDetailDto,
  ConversationCallStateResponseDto,
  CreatePollDto,
  EditPollDto,
  ListPollsQueryDto,
} from './dto';
import { ConversationCoreService } from './services/conversation-core.service';
import { ConversationMemberService } from './services/conversation-member.service';
import { GroupInviteService } from './services/group-invite.service';
import {
  ConversationPollService,
  type CreatePollResult,
  type ClosePollResult,
  type AddOptionResult,
  type RemoveOptionResult,
  type EditPollResult,
  type ListPollsResult,
  type PollDetailResult,
} from './services/conversation-poll.service';
import {
  ConversationVoteService,
  type CastVoteResult,
  type RetractVoteResult,
} from './services/conversation-vote.service';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(ConversationMember)
    private readonly memberRepository: Repository<ConversationMember>,
    private readonly cacheService: CacheService,
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    private readonly coreService: ConversationCoreService,
    private readonly memberService: ConversationMemberService,
    private readonly inviteService: GroupInviteService,
    private readonly pollService: ConversationPollService,
    private readonly voteService: ConversationVoteService,
  ) {}

  getConversations(
    userId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResponse<ConversationListItemDto>> {
    return this.coreService.getConversations(userId, query);
  }

  getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationDetailDto> {
    return this.coreService.getConversationById(userId, conversationId);
  }

  createGroupConversation(
    userId: string,
    dto: CreateGroupConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.createGroupConversation(userId, dto);
  }

  createDirectConversation(
    userId: string,
    dto: CreateDirectConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.createDirectConversation(userId, dto);
  }

  updateConversation(
    userId: string,
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationDetailDto> {
    return this.coreService.updateConversation(userId, conversationId, dto);
  }

  addMembers(
    userId: string,
    conversationId: string,
    dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    return this.memberService.addMembers(userId, conversationId, dto);
  }

  removeMember(
    userId: string,
    conversationId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    return this.memberService.removeMember(userId, conversationId, memberId);
  }

  leaveConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.leaveConversation(userId, conversationId);
  }

  disbandConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.disbandConversation(userId, conversationId);
  }

  transferOwnership(
    userId: string,
    conversationId: string,
    dto: TransferOwnershipDto,
  ): Promise<{ message: string }> {
    return this.memberService.transferOwnership(userId, conversationId, dto);
  }

  sendGroupInvites(
    userId: string,
    conversationId: string,
    dto: SendGroupInvitesDto,
  ): Promise<SendGroupInvitesResponseDto> {
    return this.inviteService.sendGroupInvites(userId, conversationId, dto);
  }

  getPendingGroupInvites(
    userId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.inviteService.getPendingGroupInvites(userId, query);
  }

  getConversationInvites(
    userId: string,
    conversationId: string,
    query: GetGroupInvitesQueryDto,
  ): Promise<PaginatedResponse<GroupInviteItemDto>> {
    return this.inviteService.getConversationInvites(
      userId,
      conversationId,
      query,
    );
  }

  acceptGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.acceptGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }

  rejectGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.rejectGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }

  cancelGroupInvite(
    userId: string,
    conversationId: string,
    inviteId: string,
  ): Promise<{ message: string }> {
    return this.inviteService.cancelGroupInvite(
      userId,
      conversationId,
      inviteId,
    );
  }

  updateMemberRole(
    userId: string,
    conversationId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ message: string }> {
    return this.memberService.updateMemberRole(
      userId,
      conversationId,
      memberId,
      dto,
    );
  }

  updateMySettings(
    userId: string,
    conversationId: string,
    dto: UpdateMemberSettingsDto,
  ): Promise<{ message: string }> {
    return this.memberService.updateMySettings(userId, conversationId, dto);
  }

  markAsRead(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    return this.memberService.markAsRead(userId, conversationId);
  }

  async pinConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const pinnedAt = new Date();

    const updateResult = await this.memberRepository
      .createQueryBuilder()
      .update(ConversationMember)
      .set({ isPinned: true, pinnedAt })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('left_at IS NULL')
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    await this.cacheService.invalidateConversationList(userId);
    await this.cacheService.invalidateConversation(conversationId, [userId]);

    const event: ConversationPinnedEvent = {
      userId,
      conversationId,
      pinnedAt: pinnedAt.getTime(),
      trace_id: `interaction:${conversationId}:${userId}:pin`,
    };

    this.kafkaClient.emit(KafkaTopics.ConversationPinned, event);

    return { message: 'Conversation pinned' };
  }

  async unpinConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const unpinnedAt = new Date();

    const updateResult = await this.memberRepository
      .createQueryBuilder()
      .update(ConversationMember)
      .set({ isPinned: false, pinnedAt: null })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('user_id = :userId', { userId })
      .andWhere('left_at IS NULL')
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    await this.cacheService.invalidateConversationList(userId);
    await this.cacheService.invalidateConversation(conversationId, [userId]);

    const event: ConversationUnpinnedEvent = {
      userId,
      conversationId,
      unpinnedAt: unpinnedAt.getTime(),
    };

    this.kafkaClient.emit(KafkaTopics.ConversationUnpinned, event);

    return { message: 'Conversation unpinned' };
  }

  async getConversationCallState(
    userId: string,
    conversationId: string,
  ): Promise<ConversationCallStateResponseDto> {
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (!membership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const state = await this.getCallStateSnapshot(conversationId);

    return {
      conversation_id: conversationId,
      state,
      updated_at: Date.now(),
      reason: state ? undefined : 'no_active_call',
    };
  }

  async endConversationCall(
    userId: string,
    conversationId: string,
    callId: string,
    dto: EndConversationCallDto,
  ): Promise<{ message: string }> {
    const membership = await this.memberRepository.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (!membership) {
      throw BusinessException.notFound(ErrorCode.CONVERSATION_NOT_MEMBER);
    }

    const state = await this.getCallStateSnapshot(conversationId);
    if (!state || state.call_id !== callId || state.status === 'ended') {
      throw BusinessException.notFound('Active call');
    }

    const command: CallEndCommand = {
      call_id: callId,
      conversation_id: conversationId,
      user_id: userId,
      reason: dto.reason,
      ended_at: Date.now(),
      trace_id: `interaction:${conversationId}:${callId}:${userId}:end`,
    };

    this.kafkaClient.emit(KafkaTopics.CallEnd, command);

    return { message: 'Call end requested' };
  }

  // ─── Polls (delegates to ConversationPollService / ConversationVoteService) ───

  createPoll(
    userId: string,
    conversationId: string,
    dto: CreatePollDto,
  ): Promise<CreatePollResult> {
    return this.pollService.createPoll(userId, conversationId, dto);
  }

  listPolls(
    userId: string,
    conversationId: string,
    query: ListPollsQueryDto,
  ): Promise<ListPollsResult> {
    return this.pollService.listPolls(userId, conversationId, query);
  }

  getPollDetail(userId: string, pollId: string): Promise<PollDetailResult> {
    return this.pollService.getPollDetail(userId, pollId);
  }

  editPoll(
    userId: string,
    pollId: string,
    dto: EditPollDto,
  ): Promise<EditPollResult> {
    return this.pollService.editPoll(userId, pollId, dto);
  }

  castPollVote(
    userId: string,
    pollId: string,
    optionIds: string[],
  ): Promise<CastVoteResult> {
    return this.voteService.castVote(userId, pollId, optionIds);
  }

  retractPollVote(userId: string, pollId: string): Promise<RetractVoteResult> {
    return this.voteService.retractVote(userId, pollId);
  }

  addPollOption(
    userId: string,
    pollId: string,
    label: string,
  ): Promise<AddOptionResult> {
    return this.pollService.addOption(userId, pollId, label);
  }

  removePollOption(
    userId: string,
    pollId: string,
    optionId: string,
  ): Promise<RemoveOptionResult> {
    return this.pollService.removeOption(userId, pollId, optionId);
  }

  closePoll(userId: string, pollId: string): Promise<ClosePollResult> {
    return this.pollService.closePoll(userId, pollId);
  }

  private async getCallStateSnapshot(
    conversationId: string,
  ): Promise<CallStateSnapshot | null> {
    const key = `call:state:conversation:${conversationId}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CallStateSnapshot;
    } catch {
      this.logger.warn(
        `Invalid call-state cache payload for conversation ${conversationId}`,
      );
      await this.redis.del(key);
      return null;
    }
  }
}
