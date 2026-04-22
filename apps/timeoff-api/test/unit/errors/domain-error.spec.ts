import { InsufficientBalanceError } from '../../../src/shared/errors/domain.errors';

describe('Domain errors', () => {
  it('InsufficientBalanceError has code and detail', () => {
    const err = new InsufficientBalanceError({ available: 3, requested: 5 });
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
    expect(err.httpStatus).toBe(409);
    expect(err.detail).toContain('3');
    expect(err.detail).toContain('5');
  });
});
