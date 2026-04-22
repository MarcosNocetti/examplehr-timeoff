import Decimal from 'decimal.js';
import { computeDays, assertSufficient } from '../../../src/modules/requests/domain/request-validator';

describe('request-validator', () => {
  it('computeDays inclusive: same day = 1', () => {
    expect(computeDays(new Date('2026-05-01'), new Date('2026-05-01')).toString()).toBe('1');
  });

  it('computeDays inclusive: 3 days', () => {
    expect(computeDays(new Date('2026-05-01'), new Date('2026-05-03')).toString()).toBe('3');
  });

  it('computeDays throws when endDate before startDate', () => {
    expect(() => computeDays(new Date('2026-05-05'), new Date('2026-05-01'))).toThrow();
  });

  it('assertSufficient passes when available >= requested', () => {
    expect(() => assertSufficient(new Decimal(5), new Decimal(3))).not.toThrow();
  });

  it('assertSufficient throws InsufficientBalanceError when not enough', () => {
    expect(() => assertSufficient(new Decimal(2), new Decimal(5)))
      .toThrow(/Insufficient balance/);
  });
});
