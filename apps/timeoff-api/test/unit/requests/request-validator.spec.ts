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

  it('handles dates with non-UTC offsets without off-by-one', () => {
    // These two ISO strings represent the SAME day (May 1 UTC)
    expect(computeDays(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-01T23:59:59Z')).toString()).toBe('1');
    // Ranged dates with timezone offsets
    expect(computeDays(new Date('2026-05-01T03:00:00-03:00'), new Date('2026-05-03T03:00:00-03:00')).toString()).toBe('3');
  });

  it('assertSufficient passes when available >= requested', () => {
    expect(() => assertSufficient(new Decimal(5), new Decimal(3))).not.toThrow();
  });

  it('assertSufficient throws InsufficientBalanceError when not enough', () => {
    expect(() => assertSufficient(new Decimal(2), new Decimal(5)))
      .toThrow(/Insufficient balance/);
  });
});
