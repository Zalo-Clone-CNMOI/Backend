import { Injectable } from '@nestjs/common';
import {
  InteractionClientService,
  SendFriendRequestDto,
  RespondFriendRequestDto,
} from '@app/clients/interaction-client';

@Injectable()
export class FriendsService {
  constructor(private readonly interactionClient: InteractionClientService) {}

  async getFriends(accessToken: string, page?: number, limit?: number) {
    return this.interactionClient.getFriends(accessToken, page, limit);
  }

  async getPendingRequests(accessToken: string, page?: number, limit?: number) {
    return this.interactionClient.getPendingRequests(accessToken, page, limit);
  }

  async getSentRequests(accessToken: string, page?: number, limit?: number) {
    return this.interactionClient.getSentRequests(accessToken, page, limit);
  }

  async sendFriendRequest(accessToken: string, dto: SendFriendRequestDto) {
    return this.interactionClient.sendFriendRequest(accessToken, dto);
  }

  async respondToRequest(
    accessToken: string,
    requestId: string,
    dto: RespondFriendRequestDto,
  ) {
    return this.interactionClient.respondToRequest(accessToken, requestId, dto);
  }

  async cancelRequest(accessToken: string, requestId: string) {
    return this.interactionClient.cancelRequest(accessToken, requestId);
  }

  async removeFriend(accessToken: string, friendId: string) {
    return this.interactionClient.removeFriend(accessToken, friendId);
  }

  async blockUser(accessToken: string, userId: string) {
    return this.interactionClient.blockUser(accessToken, userId);
  }

  async unblockUser(accessToken: string, userId: string) {
    return this.interactionClient.unblockUser(accessToken, userId);
  }
}
