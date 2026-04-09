/**
 * @file users.controller.spec.ts (BFF)
 *
 * Unit tests for BFF UsersController — verifies Bearer token extraction
 * and correct delegation to UsersService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('BFF UsersController', () => {
  let controller: UsersController;
  let usersService: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      getMyProfile: jest.fn(),
      updateMyProfile: jest.fn(),
      searchUsers: jest.fn(),
      getPublicProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('Bearer token extraction', () => {
    it('should throw UnauthorizedException when authorization header is missing', async () => {
      await expect(
        controller.getMyProfile(undefined as unknown),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when not Bearer format', async () => {
      await expect(controller.getMyProfile('Basic abc123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should extract token after "Bearer " prefix', async () => {
      usersService.getMyProfile.mockResolvedValue({ id: 'user-1' });

      await controller.getMyProfile('Bearer my-jwt-token');

      expect(usersService.getMyProfile).toHaveBeenCalledWith('my-jwt-token');
    });
  });

  describe('GET /users/me', () => {
    it('should return user profile from service', async () => {
      const expected = {
        id: 'user-1',
        fullName: 'Test',
        phone: '+84123456789',
      };
      usersService.getMyProfile.mockResolvedValue(expected);

      const result = await controller.getMyProfile('Bearer token');

      expect(result).toEqual(expected);
    });
  });

  describe('PATCH /users/me', () => {
    it('should extract token and delegate dto to service', async () => {
      const dto = { fullName: 'Updated Name' } as unknown;
      const expected = { id: 'user-1', fullName: 'Updated Name' };
      usersService.updateMyProfile.mockResolvedValue(expected);

      const result = await controller.updateMyProfile('Bearer token', dto);

      expect(usersService.updateMyProfile).toHaveBeenCalledWith('token', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /users/search', () => {
    it('should extract token and pass query params to service', async () => {
      const dto = { q: 'Nguyen', page: 1, limit: 20 } as unknown;
      usersService.searchUsers.mockResolvedValue({
        items: [],
        meta: { total: 0 },
      });

      await controller.searchUsers('Bearer token', dto);

      expect(usersService.searchUsers).toHaveBeenCalledWith(
        'token',
        'Nguyen',
        1,
        20,
      );
    });
  });

  describe('GET /users/:userId', () => {
    it('should extract token and pass userId to service', async () => {
      const expected = { id: 'user-2', fullName: 'Other User' };
      usersService.getPublicProfile.mockResolvedValue(expected);

      const result = await controller.getPublicProfile(
        'Bearer token',
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(usersService.getPublicProfile).toHaveBeenCalledWith(
        'token',
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(result).toEqual(expected);
    });
  });
});
