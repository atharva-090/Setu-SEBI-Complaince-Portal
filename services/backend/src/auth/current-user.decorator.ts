import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtUser {
  userId: string;
  email: string;
  role: string;
  tenantId: string | null;
}

/** Injects the authenticated user (set by JwtStrategy.validate) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
