import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AuthenticatedUser } from '@app/types';

/**
 * Decorator to extract the authenticated user from the request
 * @example
 * @Get('me')
 * getProfile(@CurrentUser() user: AuthenticatedUser) {
 *   return user;
 * }
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | null | string | number | Date | boolean => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = ctx.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as AuthenticatedUser;

    if (!user) {
      return null;
    }

    return data ? (user[data] ?? null) : user;
  },
);

/**
 * @deprecated Use CurrentUser instead
 */
export const UserReq = createParamDecorator(
  (_, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const req = ctx.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return req.user as AuthenticatedUser;
  },
);
