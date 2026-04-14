/**
 * @file users.service.spec.ts (BFF)
 *
 * Unit tests for BFF UsersService — verifies proxy delegations
 * to SsoClientService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SsoClientService, MediaClientService } from '@app/clients';

describe('BFF UsersService', () => {
  let service: UsersService;
  let ssoClient: Record<string, jest.Mock>;
  let mediaClient: Record<string, jest.Mock>;

  beforeEach(async () => {
    ssoClient = {
      getMyProfile: jest.fn(),
      updateMyProfile: jest.fn(),
      searchUsers: jest.fn(),
      getPublicProfile: jest.fn(),
    };

    mediaClient = {
      presignDownload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SsoClientService, useValue: ssoClient },
        { provide: MediaClientService, useValue: mediaClient },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getMyProfile', () => {
    it('should resolve avatar URL from media key', async () => {
      ssoClient.getMyProfile.mockResolvedValue({
        id: 'user-1',
        fullName: 'Test User',
        avatarUrl: 'public/avatar.jpg',
      });
      mediaClient.presignDownload.mockResolvedValue({
        downloadUrl: 'https://signed.example.com/avatar.jpg',
      });

      const result = await service.getMyProfile('token-123');

      expect(ssoClient.getMyProfile).toHaveBeenCalledWith('token-123');
      expect(mediaClient.presignDownload).toHaveBeenCalledWith(
        { key: 'public/avatar.jpg' },
        'user-1',
      );
      expect(result.avatarResolvedUrl).toBe(
        'https://signed.example.com/avatar.jpg',
      );
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
      ssoClient.updateMyProfile.mockResolvedValue({
        id: 'user-1',
        fullName: 'New Name',
        avatarUrl: 'public/new-avatar.jpg',
      });
      mediaClient.presignDownload.mockResolvedValue({
        downloadUrl: 'https://signed.example.com/new-avatar.jpg',
      });

      const result = await service.updateMyProfile('token', dto);

      expect(ssoClient.updateMyProfile).toHaveBeenCalledWith('token', dto);
      expect(result.avatarResolvedUrl).toBe(
        'https://signed.example.com/new-avatar.jpg',
      );
    });

    it('should keep legacy URL as resolved URL without signing', async () => {
      ssoClient.updateMyProfile.mockResolvedValue({
        id: 'user-1',
        avatarUrl: 'https://cdn.example.com/avatar.jpg',
      });

      const result = await service.updateMyProfile('token', {
        avatarUrl: 'https://cdn.example.com/avatar.jpg',
      });

      expect(mediaClient.presignDownload).not.toHaveBeenCalled();
      expect(result.avatarResolvedUrl).toBe(
        'https://cdn.example.com/avatar.jpg',
      );
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
