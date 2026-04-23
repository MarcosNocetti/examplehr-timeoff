import Decimal from 'decimal.js';
import { MovementType } from '@examplehr/contracts';

export interface MovementForBalance { delta: Decimal; type: MovementType; }

// Movement types that contribute to the "currently held" sum.
// PENDING_RESERVATION reserves balance while a saga is in flight.
// CONFIRMED (positive delta after the recent refactor) releases the pending
//   reservation while HCM has already decremented the total.
// CANCELLED (positive delta) releases the pending reservation when the saga
//   ends without consuming (reject / cancel / force-fail).
// HCM_REFRESH is excluded — it's already absorbed into Balance.totalDays.
const RESERVATION_TYPES: ReadonlySet<MovementType> = new Set([
  MovementType.PENDING_RESERVATION,
  MovementType.CONFIRMED,
  MovementType.CANCELLED,
]);

/** Raw (unclamped) available days — use only for defensive guard checks. */
export function computeRawAvailable(total: Decimal, movements: readonly MovementForBalance[]): Decimal {
  const reserved = movements
    .filter((m) => RESERVATION_TYPES.has(m.type))
    .reduce((acc, m) => acc.plus(m.delta), new Decimal(0));
  return total.plus(reserved);
}

/**
 * Available days for display and gate-keeping.
 * Clamped to 0: when HCM sends a lower total than existing reservations the
 * value must not go negative — the pending saga will settle later.
 */
export function computeAvailable(total: Decimal, movements: readonly MovementForBalance[]): Decimal {
  return Decimal.max(computeRawAvailable(total, movements), new Decimal(0));
}
