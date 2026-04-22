import { ExecutionContext } from '@nestjs/common';
import { TrustedHeadersGuard } from '../../../src/shared/auth/trusted-headers.guard';
import { Role } from '@examplehr/contracts';

const ctxFor = (headers: Record<string, string>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  getHandler: () => null,
  getClass: () => null,
} as any);

describe('TrustedHeadersGuard', () => {
  const guard = new TrustedHeadersGuard();

  it('rejects when x-employee-id missing', () => {
    expect(() => guard.canActivate(ctxFor({}))).toThrow(/x-employee-id/);
  });

  it('rejects when x-role invalid', () => {
    expect(() => guard.canActivate(ctxFor({ 'x-employee-id': 'e1', 'x-role': 'pirate' }))).toThrow(/x-role/);
  });

  it('accepts when both present and valid', () => {
    expect(guard.canActivate(ctxFor({ 'x-employee-id': 'e1', 'x-role': Role.EMPLOYEE }))).toBe(true);
  });
});
