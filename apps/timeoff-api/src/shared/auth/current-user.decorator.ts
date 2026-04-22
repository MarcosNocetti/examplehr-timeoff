import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface CurrentUserPayload { employeeId: string; role: string; }
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUserPayload => ctx.switchToHttp().getRequest().user,
);
