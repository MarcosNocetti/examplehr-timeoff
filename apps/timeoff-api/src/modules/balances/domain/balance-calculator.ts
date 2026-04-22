import Decimal from 'decimal.js';
import { MovementType } from '@examplehr/contracts';

export interface MovementForBalance { delta: Decimal; type: MovementType; }

const RESERVATION_TYPES: ReadonlySet<MovementType> = new Set([
  MovementType.PENDING_RESERVATION,
  MovementType.CONFIRMED,
]);

export function computeAvailable(total: Decimal, movements: readonly MovementForBalance[]): Decimal {
  const reserved = movements
    .filter((m) => RESERVATION_TYPES.has(m.type))
    .reduce((acc, m) => acc.plus(m.delta), new Decimal(0));
  return total.plus(reserved); // delta is already negative for reservations
}
