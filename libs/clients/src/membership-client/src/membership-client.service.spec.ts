/**
 * @file membership-client.service.spec.ts
 * @covers MembershipClientService — verifies it unwraps interaction-service's
 *         TransformResponseInterceptor envelope ({ success, data, timestamp })
 *         AND tolerates a raw (unwrapped) payload. This is the regression guard
 *         for the "entries is not iterable" production bug.
 */

import { MembershipClientService } from './membership-client.service';
import type { HttpService } from '@nestjs/axios';

describe('MembershipClientService', () => {
  let service: MembershipClientService;
  let post: jest.Mock;

  const wrap = <T>(data: T) => ({
    data: { success: true, data, timestamp: 'ts' },
  });
  const raw = <T>(data: T) => ({ data });

  beforeEach(() => {
    post = jest.fn();
    const httpService = { axiosRef: { post } } as unknown as HttpService;
    service = new MembershipClientService(
      { baseUrl: 'http://interaction:5004/api' },
      httpService,
    );
  });

  describe('getMembershipBatch', () => {
    it('unwraps the interceptor envelope', async () => {
      post.mockResolvedValue(
        wrap({
          entries: [
            { conversation_id: 'c1', allowed: true, conversation_type: null },
          ],
        }),
      );

      const result = await service.getMembershipBatch('u1', ['c1']);

      expect(result).toEqual([
        { conversation_id: 'c1', allowed: true, conversation_type: null },
      ]);
    });

    it('also accepts a raw (unwrapped) payload', async () => {
      post.mockResolvedValue(
        raw({
          entries: [
            { conversation_id: 'c1', allowed: false, conversation_type: null },
          ],
        }),
      );

      const result = await service.getMembershipBatch('u1', ['c1']);
      expect(result[0].allowed).toBe(false);
    });

    it('returns [] for empty input without an HTTP call', async () => {
      const result = await service.getMembershipBatch('u1', []);
      expect(result).toEqual([]);
      expect(post).not.toHaveBeenCalled();
    });

    it('returns [] when the envelope data has no entries field', async () => {
      post.mockResolvedValue(wrap({}));
      const result = await service.getMembershipBatch('u1', ['c1']);
      expect(result).toEqual([]);
    });
  });

  describe('getSendPermission', () => {
    it('unwraps the envelope', async () => {
      post.mockResolvedValue(wrap({ allowed: true }));
      expect(await service.getSendPermission('u1', 'c1')).toEqual({
        allowed: true,
      });
    });
  });

  describe('listActiveMemberIds', () => {
    it('unwraps member_ids from the envelope', async () => {
      post.mockResolvedValue(wrap({ member_ids: ['a', 'b'] }));
      expect(await service.listActiveMemberIds('c1')).toEqual(['a', 'b']);
    });
  });

  describe('getFriendSet', () => {
    it('unwraps friend_ids from the envelope', async () => {
      post.mockResolvedValue(wrap({ friend_ids: ['f1'] }));
      expect(await service.getFriendSet('u1', ['f1', 'f2'])).toEqual(['f1']);
    });

    it('returns [] for empty candidates without an HTTP call', async () => {
      expect(await service.getFriendSet('u1', [])).toEqual([]);
      expect(post).not.toHaveBeenCalled();
    });
  });
});
