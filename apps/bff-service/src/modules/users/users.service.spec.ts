/**
 * @file users.service.spec.ts (BFF)
 *
 * Unit tests for BFF UsersService — verifies proxy delegations
 * to SsoClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SsoClientService } from '@app/clients';

describe('BFF UsersService', () => {
  let service: UsersService;
  let ssoClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    ssoClient = {
      getMyProfile: jest.fn(),
      updateMyProfile: jest.fn(),
      searchUsers: jest.fn(),
      getPublicProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SsoClientService, useValue: ssoClient },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    (service as unknown).ssoClient = ssoClient;
  });

  describe('getMyProfile', () => {
    it('should delegate to ssoClient.getMyProfile', async () => {
      const expected = { id: 'user-1', fullName: 'Test User' };
      ssoClient.getMyProfile.mockResolvedValue(expected);

      const result = await service.getMyProfile('token-123');

      expect(ssoClient.getMyProfile).toHaveBeenCalledWith('token-123');
      expect(result).toEqual(expected);
    });

    it('should propagate errors', async () => {
      ssoClient.getMyProfile.mockRejectedValue(new Error('Unauthorized'));

      await expect(service.getMyProfile('bad-token')).rejects.toThrow(
        'Unauthorized',
      );
    });
  });

  describe('updateMyProfile', () => {
    it('should delegate to ssoClient.updateMyProfile', async () => {
      const dto = { fullName: 'New Name' };
      const expected = { id: 'user-1', fullName: 'New Name' };
      ssoClient.updateMyProfile.mockResolvedValue(expected);

      const result = await service.updateMyProfile('token', dto as unknown);

      expect(ssoClient.updateMyProfile).toHaveBeenCalledWith('token', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('searchUsers', () => {
    it('should delegate to ssoClient.searchUsers with all params', async () => {
      const expected = { items: [], meta: { total: 0 } };
      ssoClient.searchUsers.mockResolvedValue(expected);

      const result = await service.searchUsers('token', 'Nguyen', 1, 20);

      expect(ssoClient.searchUsers).toHaveBeenCalledWith(
        'token',
        'Nguyen',
        1,
        20,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('getPublicProfile', () => {
    it('should delegate to ssoClient.getPublicProfile', async () => {
      const expected = { id: 'user-2', fullName: 'Other User' };
      ssoClient.getPublicProfile.mockResolvedValue(expected);

      const result = await service.getPublicProfile('token', 'user-2');

      expect(ssoClient.getPublicProfile).toHaveBeenCalledWith(
        'token',
        'user-2',
      );
      expect(result).toEqual(expected);
    });
  });
});
