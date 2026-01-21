import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Decorator to extract the access token from the request headers
 * @example
 * @Get('friends')
 * getFriends(@AccessToken() token: string) {
 *   return this.friendsService.getFriends(token);
 * }
 */
export const AccessToken = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>();
    const authorization = request.headers?.authorization;

    if (!authorization || typeof authorization !== 'string') {
      return null;
    }

    // Remove 'Bearer ' prefix
    if (authorization.startsWith('Bearer ')) {
      return authorization.substring(7);
    }

    return authorization;
  },
);
