import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@examplehr/contracts';
import { ROLES_KEY } from './roles.decorator';
import { ForbiddenError } from '../errors/domain.errors';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role = req.user?.role as Role | undefined;
    if (!role || !required.includes(role)) throw new ForbiddenError();
    return true;
  }
}
