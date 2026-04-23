import Decimal from 'decimal.js';
import { InsufficientBalanceError } from '../../../shared/errors/domain.errors';

export function computeDays(startDate: Date, endDate: Date): Decimal {
  if (endDate < startDate) throw new Error('endDate before startDate');
  const startUtc = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const endUtc = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const days = Math.round((endUtc - startUtc) / 86400000) + 1; // inclusive
  return new Decimal(days);
}

export function assertSufficient(available: Decimal, requested: Decimal): void {
  if (requested.greaterThan(available)) {
    throw new InsufficientBalanceError({
      available: available.toString(),
      requested: requested.toString(),
    });
  }
}
