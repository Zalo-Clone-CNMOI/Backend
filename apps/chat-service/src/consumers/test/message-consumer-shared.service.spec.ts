import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationOutboxPublisher } from '@libs/kafka';
import { NotificationType } from '@libs/contracts';
import { User, ConversationMember } from '@libs/database';

type NotifyArg = {
  user_id: string;
  type: NotificationType;
  rich?: { priority: string };
  title?: string;
};
import { MessageRepository } from '@libs/scylla';
import { MessageConsumerSharedService } from '../message-consumer-shared.service';
import { ChatPublisher } from '../../services/chat.publisher';

describe('MessageConsumerSharedService - emitMessageNotification mention branching', () => {
  let service: MessageConsumerSharedService;
  let notificationPublisher: { publish: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let conversationMemberRepo: { find: jest.Mock };
  let messageRepo: { incrementUnreadMentionCount: jest.Mock };

  beforeEach(async () => {
    notificationPublisher = {
      publish: jest.fn().mockResolvedValue('ok'),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ fullName: 'Sender Name' }),
    };
    conversationMemberRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 'sender-1' },
          { userId: 'user-mentioned' },
          { userId: 'user-other' },
        ]),
    };
    messageRepo = {
      incrementUnreadMentionCount: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageConsumerSharedService,
        {
          provide: NotificationOutboxPublisher,
          useValue: notificationPublisher,
        },
        { provide: ChatPublisher, useValue: { emit: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ConversationMember),
          useValue: conversationMemberRepo,
        },
        { provide: MessageRepository, useValue: messageRepo },
      ],
    }).compile();

    service = module.get(MessageConsumerSharedService);
  });

  it('should send Mention notification to mentioned user and ChatMessage to others', async () => {
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      'Hi @user-mentioned',
      'msg-1',
      'trace-1',
      [
        {
          user_id: 'user-mentioned',
          mention_type: 'user',
          offset: 3,
          length: 14,
        },
      ],
    );

    const calls = notificationPublisher.publish.mock.calls as [NotifyArg][];
    expect(calls).toHaveLength(2);

    const mentionCall = calls.find((c) => c[0].user_id === 'user-mentioned')!;
    expect(mentionCall[0].type).toBe(NotificationType.Mention);
    expect(mentionCall[0].rich?.priority).toBe('high');
    expect(mentionCall[0].title).toContain('đã nhắc bạn');

    const otherCall = calls.find((c) => c[0].user_id === 'user-other')!;
    expect(otherCall[0].type).toBe(NotificationType.ChatMessage);
  });

  it('should treat all non-sender members as mentioned when @all is present', async () => {
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      '@all heads up',
      'msg-2',
      'trace-2',
      [{ user_id: '__ALL__', mention_type: 'all', offset: 0, length: 4 }],
    );

    const calls = notificationPublisher.publish.mock.calls as [NotifyArg][];
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c[0].type === NotificationType.Mention)).toBe(
      true,
    );
  });

  it('should increment unread mention counter for mentioned users', async () => {
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      'Hi @user-mentioned',
      'msg-3',
      'trace-3',
      [
        {
          user_id: 'user-mentioned',
          mention_type: 'user',
          offset: 3,
          length: 14,
        },
      ],
    );

    expect(messageRepo.incrementUnreadMentionCount).toHaveBeenCalledWith(
      ['user-mentioned'],
      'conv-1',
    );
  });

  it('should fall back to ChatMessage type when no mentions provided (existing behavior)', async () => {
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      'plain message',
      'msg-4',
      'trace-4',
    );

    const calls = notificationPublisher.publish.mock.calls as [NotifyArg][];
    expect(calls.every((c) => c[0].type === NotificationType.ChatMessage)).toBe(
      true,
    );
    expect(messageRepo.incrementUnreadMentionCount).not.toHaveBeenCalled();
  });

  it('should set priority=normal for non-mentioned recipients (spec compliance)', async () => {
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      'Hi @user-mentioned',
      'msg-priority',
      'trace-priority',
      [
        {
          user_id: 'user-mentioned',
          mention_type: 'user',
          offset: 3,
          length: 14,
        },
      ],
    );

    const calls = notificationPublisher.publish.mock.calls as [NotifyArg][];
    const mentionCall = calls.find((c) => c[0].user_id === 'user-mentioned')!;
    const otherCall = calls.find((c) => c[0].user_id === 'user-other')!;
    expect(mentionCall[0].rich?.priority).toBe('high');
    expect(otherCall[0].rich?.priority).toBe('normal');
  });

  it('should NOT increment counter for mentioned users who are not active members', async () => {
    // Active members: sender-1, user-mentioned, user-other (per beforeEach mock)
    // Mention `user-ghost` who is NOT in the conversation
    await service.emitMessageNotification(
      'conv-1',
      'sender-1',
      'Hi @ghost',
      'msg-ghost',
      'trace-ghost',
      [{ user_id: 'user-ghost', mention_type: 'user', offset: 3, length: 9 }],
    );

    // Counter should NOT be called because user-ghost isn't a recipient
    expect(messageRepo.incrementUnreadMentionCount).not.toHaveBeenCalled();
  });
});
