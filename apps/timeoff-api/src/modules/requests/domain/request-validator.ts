import Decimal from 'decimal.js';
import { InsufficientBalanceError } from '../../../shared/errors/domain.errors';

export function computeDays(startDate: Date, endDate: Date): Decimal {
  if (endDate < startDate) throw new Error('endDate before startDate');
  const ms = endDate.getTime() - startDate.getTime();
  return new Decimal(Math.ceil(ms / 86400000) + 1); // inclusive
}

export function assertSufficient(available: Decimal, requested: Decimal): void {
  if (requested.greaterThan(available)) {
    throw new InsufficientBalanceError({
      available: available.toString(),
      requested: requested.toString(),
    });
  }
}
