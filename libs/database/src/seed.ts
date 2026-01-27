import { AppDataSource } from './data-source';
import { User } from './entities/user.entity';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Friendship } from './entities/friendship.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { MediaFile } from './entities/media-file.entity';
import { Post } from './entities/post.entity';
import { PostMedia } from './entities/post-media.entity';
import { PostLike } from './entities/post-like.entity';
import { PostComment } from './entities/post-comment.entity';
import { CommentLike } from './entities/comment-like.entity';
import { NotificationLog } from './entities/notification-log.entity';

import {
  UserStatus,
  Gender,
  FriendshipStatus,
  ConversationType,
  ConversationRole,
  PostVisibility,
  ReactionType,
  NotificationChannel,
  NotificationProvider,
  NotificationStatus,
} from '@app/constant/enum';
import * as bcrypt from 'bcrypt';

async function bootstrap() {
  const queryRunner = AppDataSource.createQueryRunner();

  try {
    console.log('Initializing Data Source...');
    await AppDataSource.initialize();
    console.log('Data Source initialized!');

    console.log('Starting transaction...');
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const manager = queryRunner.manager;

    // --- Users ---
    console.log('Seeding Users...');
    // We want to ensure specific users exist to reference them later by index
    const passwordHash = await bcrypt.hash('123456', 10);
    const userPayloads = [
          {
            phone: '0901234567',
            email: 'admin@example.com',
            fullName: 'Admin User',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'System Administrator',
            dateOfBirth: new Date('1990-01-01'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/1',
          },
          {
            phone: '0901111111',
            email: 'user1@example.com',
            fullName: 'John Doe',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Loves technology',
            dateOfBirth: new Date('1995-05-15'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/2',
          },
          {
            phone: '0902222222',
            email: 'user2@example.com',
            fullName: 'Jane Smith',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Travel enthusiast',
            dateOfBirth: new Date('1998-08-20'),
            gender: Gender.FEMALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/3',
          },
          {
            phone: '0903333333',
            email: 'user3@example.com',
            fullName: 'Alice Johnson',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Foodie',
            dateOfBirth: new Date('2000-12-10'),
            gender: Gender.FEMALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/4',
          },
          {
            phone: '0904444444',
            email: 'user4@example.com',
            fullName: 'Bob Brown',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Gamer',
            dateOfBirth: new Date('1992-03-25'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/5',
          },
          {
            phone: '0905555555',
            email: 'user5@example.com',
            fullName: 'Charlie Davis',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Musician in the making',
            dateOfBirth: new Date('1996-07-04'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/6',
          },
          {
            phone: '0906666666',
            email: 'user6@example.com',
            fullName: 'Diana Evans',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Artist & Designer',
            dateOfBirth: new Date('1993-11-30'),
            gender: Gender.FEMALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/7',
          },
          {
            phone: '0907777777',
            email: 'user7@example.com',
            fullName: 'Ethan Hunt',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Adventure seeker',
            dateOfBirth: new Date('1988-02-14'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/8',
          },
          {
            phone: '0908888888',
            email: 'user8@example.com',
            fullName: 'Fiona Green',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Nature lover',
            dateOfBirth: new Date('1999-09-09'),
            gender: Gender.FEMALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/9',
          },
          {
            phone: '0909999999',
            email: 'user9@example.com',
            fullName: 'George White',
            passwordHash,
            status: UserStatus.ACTIVE,
            bio: 'Photography hobbyist',
            dateOfBirth: new Date('1991-06-21'),
            gender: Gender.MALE,
            avatarUrl: 'https://avatar.iran.liara.run/public/10',
          },
      ];

      let users: User[] = [];
      for (const payload of userPayloads) {
        let user = await manager.findOne(User, { where: { email: payload.email } });
        if (!user) {
          user = manager.create(User, payload);
          user = await manager.save(user);
          console.log(`Created user: ${user.fullName}`);
        } else {
             console.log(`User exists: ${user.fullName}`);
        }
        users.push(user);
      }
      console.log(`Total users available for seeding: ${users.length}`);

    // --- Notification Preferences ---
    console.log('Seeding Notification Preferences...');
    for (const user of users) {
       const existingPref = await manager.findOne(NotificationPreference, { where: { userId: user.id } });
       if (!existingPref) {
         await manager.save(manager.create(NotificationPreference, {
           userId: user.id,
           pushEnabled: true,
           soundEnabled: true,
           vibrateEnabled: true,
           showPreview: true
         }));
       }
    }

    // --- Device Tokens ---
    console.log('Seeding Device Tokens...');
    if ((await manager.count(DeviceToken)) === 0 && users.length > 0) {
      await manager.save(manager.create(DeviceToken, {
        userId: users[0].id,
        token: 'device_token_admin_ios',
        platform: 'ios',
        isActive: true,
      }));
       await manager.save(manager.create(DeviceToken, {
        userId: users[1].id,
        token: 'device_token_user1_android',
        platform: 'android',
        isActive: true,
      }));
       await manager.save(manager.create(DeviceToken, {
        userId: users[5].id, // Charlie
        token: 'device_token_user5_ios',
        platform: 'ios',
        isActive: true,
      }));
    }

    // --- Friendships ---
    console.log('Seeding Friendships...');
    if ((await manager.count(Friendship)) === 0 && users.length >= 8) {
      // User 1 <-> User 2 (Accepted)
      await manager.save(manager.create(Friendship, {
        requesterId: users[1].id,
        addresseeId: users[2].id,
        status: FriendshipStatus.ACCEPTED,
      }));
      // User 1 -> User 3 (Pending)
      await manager.save(manager.create(Friendship, {
        requesterId: users[1].id,
        addresseeId: users[3].id,
        status: FriendshipStatus.PENDING,
      }));
      // User 2 <-> User 5 (Accepted)
      await manager.save(manager.create(Friendship, {
        requesterId: users[2].id,
        addresseeId: users[5].id,
        status: FriendshipStatus.ACCEPTED,
      }));
      // User 6 -> User 1 (Blocked)
      await manager.save(manager.create(Friendship, {
        requesterId: users[6].id,
        addresseeId: users[1].id,
        status: FriendshipStatus.BLOCKED,
      }));
      // User 7 <-> User 4 (Accepted)
      await manager.save(manager.create(Friendship, {
        requesterId: users[7].id,
        addresseeId: users[4].id,
        status: FriendshipStatus.ACCEPTED,
      }));
    }

    // --- Conversations & Members ---
    console.log('Seeding Conversations...');
    if ((await manager.count(Conversation)) === 0 && users.length >= 6) {
      // Direct Chat: User 1 & User 2
      const directConv = await manager.save(manager.create(Conversation, {
        type: ConversationType.DIRECT,
        createdById: users[1].id,
      }));
      await manager.save(ConversationMember, [
        manager.create(ConversationMember, { conversationId: directConv.id, userId: users[1].id, role: ConversationRole.ADMIN }),
        manager.create(ConversationMember, { conversationId: directConv.id, userId: users[2].id, role: ConversationRole.MEMBER }),
      ]);

      // Direct Chat: User 2 & User 5
      const directConv2 = await manager.save(manager.create(Conversation, {
        type: ConversationType.DIRECT,
        createdById: users[2].id,
      }));
      await manager.save(ConversationMember, [
        manager.create(ConversationMember, { conversationId: directConv2.id, userId: users[2].id, role: ConversationRole.ADMIN }),
        manager.create(ConversationMember, { conversationId: directConv2.id, userId: users[5].id, role: ConversationRole.MEMBER }),
      ]);

      // Group Chat: Tech Talk
      const groupConv = await manager.save(manager.create(Conversation, {
        type: ConversationType.GROUP,
        name: 'Tech Talk',
        createdById: users[1].id,
        avatarUrl: 'https://ui-avatars.com/api/?name=Tech+Talk&background=random',
      }));
      await manager.save(ConversationMember, [
        manager.create(ConversationMember, { conversationId: groupConv.id, userId: users[1].id, role: ConversationRole.OWNER }),
        manager.create(ConversationMember, { conversationId: groupConv.id, userId: users[2].id, role: ConversationRole.ADMIN }),
        manager.create(ConversationMember, { conversationId: groupConv.id, userId: users[3].id, role: ConversationRole.MEMBER }),
        manager.create(ConversationMember, { conversationId: groupConv.id, userId: users[5].id, role: ConversationRole.MEMBER }),
      ]);

       // Group Chat: Weekend Plans
      const weekendConv = await manager.save(manager.create(Conversation, {
        type: ConversationType.GROUP,
        name: 'Weekend Plans',
        createdById: users[4].id,
        avatarUrl: 'https://ui-avatars.com/api/?name=Weekend+Plans&background=random',
      }));
      await manager.save(ConversationMember, [
        manager.create(ConversationMember, { conversationId: weekendConv.id, userId: users[4].id, role: ConversationRole.OWNER }),
        manager.create(ConversationMember, { conversationId: weekendConv.id, userId: users[7].id, role: ConversationRole.MEMBER }),
        manager.create(ConversationMember, { conversationId: weekendConv.id, userId: users[8].id, role: ConversationRole.MEMBER }),
      ]);
    }

    // --- Media Files ---
    console.log('Seeding Media Files...');
    if ((await manager.count(MediaFile)) === 0 && users.length > 0) {
      // Image
      await manager.save(manager.create(MediaFile, {
        key: 'seed/sample-image-1.jpg',
        bucket: 'zalo-clone-bucket',
        contentType: 'image/jpeg',
        sizeBytes: 1024 * 500,
        uploadedById: users[1].id,
        status: 'uploaded',
      }));
      
      // Video
      await manager.save(manager.create(MediaFile, {
         key: 'seed/sample-video-1.mp4',
        bucket: 'zalo-clone-bucket',
        contentType: 'video/mp4',
        sizeBytes: 1024 * 1024 * 5, // 5MB
        uploadedById: users[1].id,
        status: 'uploaded',
      }));
    }

    // --- Posts ---
    console.log('Seeding Posts...');
    if ((await manager.count(Post)) === 0 && users.length >= 9) {
      const p1 = await manager.save(manager.create(Post, {
        userId: users[1].id,
        content: 'Hello world! This is my first post.',
        visibility: PostVisibility.PUBLIC,
        likeCount: 2,
        commentCount: 1,
      }));
      
       const p2 = await manager.save(manager.create(Post, {
        userId: users[1].id,
        content: 'Enjoying the weekend!',
        visibility: PostVisibility.FRIENDS,
      }));
      
      const p3 = await manager.save(manager.create(Post, {
        userId: users[2].id,
        content: 'Does anyone know a good React tutorial?',
        visibility: PostVisibility.PUBLIC,
        commentCount: 2,
      }));

       const p4 = await manager.save(manager.create(Post, {
        userId: users[5].id, // Charlie
        content: 'Just finished recording a new song! 🎸',
        visibility: PostVisibility.PUBLIC,
        likeCount: 5,
      }));

      const p5 = await manager.save(manager.create(Post, {
        userId: users[9].id, // George
        content: 'Check out this sunset view.',
        visibility: PostVisibility.PUBLIC,
        likeCount: 0,
        commentCount: 0,
      }));

      // --- Post Media ---
      console.log('Seeding Post Media...');
      
      // Post 2 has an image
      await manager.save(manager.create(PostMedia, {
        postId: p2.id,
        mediaUrl: 'https://picsum.photos/seed/picsum/600/400',
        mediaType: 'image',
        displayOrder: 0,
        width: 600,
        height: 400
      }));

      // Post 4 has a video (simulated media)
      await manager.save(manager.create(PostMedia, {
         postId: p4.id,
         mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
         mediaType: 'video',
         displayOrder: 0,
         durationSeconds: 10, 
      }));

       // Post 5 has multiple images
       await manager.save(manager.create(PostMedia, {
         postId: p5.id,
         mediaUrl: 'https://picsum.photos/id/101/400/300',
         mediaType: 'image',
         displayOrder: 0,
       }));
        await manager.save(manager.create(PostMedia, {
         postId: p5.id,
         mediaUrl: 'https://picsum.photos/id/102/400/300',
         mediaType: 'image',
         displayOrder: 1,
       }));

      // --- Post Likes ---
      console.log('Seeding Post Likes...');
      await manager.save(manager.create(PostLike, {
        postId: p1.id,
        userId: users[2].id,
        reactionType: ReactionType.LIKE,
      }));
      await manager.save(manager.create(PostLike, {
        postId: p1.id,
        userId: users[5].id,
        reactionType: ReactionType.LOVE,
      }));

       await manager.save(manager.create(PostLike, {
        postId: p4.id,
        userId: users[1].id,
        reactionType: ReactionType.WOW,
      }));
       await manager.save(manager.create(PostLike, {
        postId: p4.id,
        userId: users[2].id,
        reactionType: ReactionType.LIKE,
      }));
       await manager.save(manager.create(PostLike, {
        postId: p4.id,
        userId: users[3].id,
        reactionType: ReactionType.LOVE,
      }));
       await manager.save(manager.create(PostLike, {
        postId: p4.id,
        userId: users[6].id,
        reactionType: ReactionType.LIKE,
      }));
       await manager.save(manager.create(PostLike, {
        postId: p4.id,
        userId: users[8].id,
        reactionType: ReactionType.HAHA,
      }));


       // --- Post Comments ---
      console.log('Seeding Post Comments...');
      const comment1 = await manager.save(manager.create(PostComment, {
        postId: p1.id,
        userId: users[3].id,
        content: 'Welcome to the platform!',
      }));

      const comment2 = await manager.save(manager.create(PostComment, {
         postId: p3.id,
         userId: users[1].id,
         content: 'Check out the official docs website.',
      }));
      
      // Reply to comment2
      const comment3 = await manager.save(manager.create(PostComment, {
         postId: p3.id,
         userId: users[2].id,
         parentCommentId: comment2.id,
         content: 'Thanks, will do!',
      }));

      // --- Comment Likes ---
      console.log('Seeding Comment Likes...');
      await manager.save(manager.create(CommentLike, {
        commentId: comment1.id,
        userId: users[1].id,
      }));
       await manager.save(manager.create(CommentLike, {
        commentId: comment2.id,
        userId: users[2].id,
      }));
    }

     // --- Notification Logs ---
    console.log('Seeding Notification Logs...');
    if ((await manager.count(NotificationLog)) === 0 && users.length > 0) {
      await manager.save(manager.create(NotificationLog, {
        userId: users[0].id,
        channel: NotificationChannel.PUSH,
        provider: NotificationProvider.FCM,
        title: 'System Update',
        body: 'Maintenance scheduled for tonight.',
        status: NotificationStatus.SENT,
      }));
       await manager.save(manager.create(NotificationLog, {
        userId: users[1].id,
        channel: NotificationChannel.EMAIL,
        provider: NotificationProvider.MOCK,
        title: 'Welcome!',
        body: 'Welcome to Zalo Clone!',
        status: NotificationStatus.SENT,
      }));
    }

    await queryRunner.commitTransaction();
    console.log('Seeding completed successfully!');
    
  } catch (error) {
    console.error('Error during seeding, rolling back...', error);
    await queryRunner.rollbackTransaction();
  } finally {
    await queryRunner.release();
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

bootstrap();
