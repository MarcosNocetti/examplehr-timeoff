import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@examplehr/contracts';
import { IS_PUBLIC } from './public.decorator';

@Injectable()
export class TrustedHeadersGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const employeeId = req.headers['x-employee-id'] as string | undefined;
    const role = req.headers['x-role'] as string | undefined;
    if (!employeeId) throw new UnauthorizedException('Missing x-employee-id header');
    if (!role || !Object.values(Role).includes(role as Role)) {
      throw new UnauthorizedException('Missing or invalid x-role header');
    }
    req.user = { employeeId, role };
    return true;
  }
}
