import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Friendship } from '@libs/database/entities';
import { FriendshipStatus } from '@app/constant/enum';
import { CacheService } from '@libs/redis';

@Injectable()
export class FriendshipAccessService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendshipRepo: Repository<Friendship>,
    private readonly cacheService: CacheService,
  ) {}

  async areFriends(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) return true;
    const key = this.pairKey(userA, userB);
    const cached = await this.cacheService.get<boolean>(key);
    if (cached !== null) return cached;

    const exists = await this.friendshipRepo.exists({
      where: [
        {
          requesterId: userA,
          addresseeId: userB,
          status: FriendshipStatus.ACCEPTED,
        },
        {
          requesterId: userB,
          addresseeId: userA,
          status: FriendshipStatus.ACCEPTED,
        },
      ],
    });

    await this.cacheService.set(key, exists, 120);
    return exists;
  }

  /**
   * Returns candidate IDs that are friends with referenceUserId.
   */
  async getFriendSet(
    referenceUserId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (!candidateIds.length) return new Set();

    const result = new Set<string>();
    const uncached: string[] = [];

    for (const id of candidateIds) {
      if (id === referenceUserId) {
        result.add(id);
        continue;
      }
      const key = this.pairKey(referenceUserId, id);
      const cached = await this.cacheService.get<boolean>(key);
      if (cached === true) result.add(id);
      else if (cached === null) uncached.push(id);
    }

    if (uncached.length === 0) return result;

    const rows = await this.friendshipRepo.find({
      where: [
        {
          requesterId: referenceUserId,
          addresseeId: In(uncached),
          status: FriendshipStatus.ACCEPTED,
        },
        {
          requesterId: In(uncached),
          addresseeId: referenceUserId,
          status: FriendshipStatus.ACCEPTED,
        },
      ],
      select: { requesterId: true, addresseeId: true },
    });

    const dbFriendIds = new Set(
      rows.map((r) =>
        r.requesterId === referenceUserId ? r.addresseeId : r.requesterId,
      ),
    );

    const cacheWrites: Array<Promise<unknown>> = [];
    for (const id of uncached) {
      const isFriend = dbFriendIds.has(id);
      cacheWrites.push(
        this.cacheService.set(this.pairKey(referenceUserId, id), isFriend, 120),
      );
      if (isFriend) result.add(id);
    }

    await Promise.all(cacheWrites);

    return result;
  }

  private pairKey(a: string, b: string): string {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `friendship:pair:${lo}:${hi}`;
  }
}
