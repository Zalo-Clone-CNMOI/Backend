/**
 * Shared test harness for SendMessageHandler specs.
 *
 * Splits jest mock setup out of the spec files so the main spec stays under
 * the per-file `max-lines` lint cap while keeping a single source of truth
 * for handler wiring.
 */
import { SendMessageHandler } from '../send-message.handler';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import type { MessageRepository } from '@libs/scylla';
import type { ChatPublisher } from '../../services/chat.publisher';
import type { CacheService } from '@libs/redis';
import type { ConversationMembershipService } from '@libs/mvp-access';
import type { NotificationOutboxPublisher } from '@libs/kafka';
import type { Repository } from 'typeorm';
import type { User, ConversationMember } from '@libs/database';
import type { PreSendModerationService } from '../../services/pre-send-moderation.service';

export const ZAI_BOT_ID = 'zai-bot-uuid';

export type RepoMock = {
  tryBeginMessageProcessing: jest.Mock;
  getMessageProcessingState: jest.Mock;
  tryClaimPendingReplay: jest.Mock;
  restoreMessageProcessingToPending: jest.Mock;
  insertMessage: jest.Mock;
  insertMentions: jest.Mock;
  markMessageStored: jest.Mock;
  clearMessageProcessing: jest.Mock;
  getMessage: jest.Mock;
};

export type PublisherMock = { emit: jest.Mock };
export type CacheServiceMock = {
  invalidateRecentMessages: jest.Mock;
  getAiConversationContext: jest.Mock;
  acquireZaiMentionCooldown: jest.Mock;
};
export type MembershipServiceMock = {
  canUserAccessConversation: jest.Mock;
  getCachedConversationType: jest.Mock;
};
export type PreSendMock = { checkOrAllow: jest.Mock };
export type NotificationPublisherMock = { publish: jest.Mock };
export type UserRepoMock = { findOne: jest.Mock; find: jest.Mock };
export type ConversationMemberRepoMock = {
  findOne: jest.Mock;
  find: jest.Mock;
};

export interface Harness {
  handler: SendMessageHandler;
  shared: MessageConsumerSharedService;
  repo: RepoMock;
  publisher: PublisherMock;
  cacheService: CacheServiceMock;
  membershipService: MembershipServiceMock;
  preSendModerationService: PreSendMock;
  notificationPublisher: NotificationPublisherMock;
  userRepo: UserRepoMock;
  conversationMemberRepo: ConversationMemberRepoMock;
}

export function createHandlerHarness(): Harness {
  const repo: RepoMock = {
    tryBeginMessageProcessing: jest.fn(),
    getMessageProcessingState: jest.fn(),
    tryClaimPendingReplay: jest.fn(),
    restoreMessageProcessingToPending: jest.fn(),
    insertMessage: jest.fn(),
    insertMentions: jest.fn().mockResolvedValue(undefined),
    markMessageStored: jest.fn(),
    clearMessageProcessing: jest.fn().mockResolvedValue(undefined),
    getMessage: jest.fn(),
  };

  const publisher: PublisherMock = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const cacheService: CacheServiceMock = {
    invalidateRecentMessages: jest.fn().mockResolvedValue(undefined),
    getAiConversationContext: jest.fn().mockResolvedValue(null),
    acquireZaiMentionCooldown: jest.fn().mockResolvedValue(true),
  };

  const membershipService: MembershipServiceMock = {
    canUserAccessConversation: jest.fn(),
    // Default: pre-send gate sees a non-skip type so test paths that
    // don't explicitly mock it still run the gate; individual tests
    // override per scenario.
    getCachedConversationType: jest.fn().mockResolvedValue('group'),
  };

  const preSendModerationService: PreSendMock = {
    // Default: gate allows. Tests that need to block override per case.
    checkOrAllow: jest.fn().mockResolvedValue(null),
  };

  const notificationPublisher: NotificationPublisherMock = {
    publish: jest.fn().mockResolvedValue('ok'),
  };

  const userRepo: UserRepoMock = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const conversationMemberRepo: ConversationMemberRepoMock = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };

  const shared = new MessageConsumerSharedService(
    notificationPublisher as unknown as NotificationOutboxPublisher,
    publisher as unknown as ChatPublisher,
    userRepo as unknown as Repository<User>,
    conversationMemberRepo as unknown as Repository<ConversationMember>,
    repo as unknown as MessageRepository,
  );
  jest.spyOn(shared.logger, 'debug').mockImplementation(() => undefined);
  jest.spyOn(shared.logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(shared.logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(shared.logger, 'error').mockImplementation(() => undefined);

  const handler = new SendMessageHandler(
    repo as unknown as MessageRepository,
    publisher as unknown as ChatPublisher,
    cacheService as unknown as CacheService,
    membershipService as unknown as ConversationMembershipService,
    shared,
    preSendModerationService as unknown as PreSendModerationService,
    { zaiBotUserId: ZAI_BOT_ID } as never,
  );

  return {
    handler,
    shared,
    repo,
    publisher,
    cacheService,
    membershipService,
    preSendModerationService,
    notificationPublisher,
    userRepo,
    conversationMemberRepo,
  };
}
