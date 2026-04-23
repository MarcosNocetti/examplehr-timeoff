import Decimal from 'decimal.js';
import { computeAvailable } from '../../../src/modules/balances/domain/balance-calculator';
import { MovementType } from '@examplehr/contracts';

describe('computeAvailable', () => {
  it('sums pending + confirmed + cancelled; ignores HCM_REFRESH', () => {
    // PENDING(-5) holds the reservation; CONFIRMED(+2) and CANCELLED(+5)
    // both release it (CONFIRMED after a successful approve where HCM also
    // dropped totalDays; CANCELLED after a reject/cancel/force-fail where
    // totalDays is unchanged). HCM_REFRESH(+5) is excluded — already absorbed
    // into Balance.totalDays by the reconciliation path.
    const total = new Decimal(20);
    const movements = [
      { delta: new Decimal(-5), type: MovementType.PENDING_RESERVATION },
      { delta: new Decimal(2),  type: MovementType.CONFIRMED },
      { delta: new Decimal(5),  type: MovementType.HCM_REFRESH },
      { delta: new Decimal(5),  type: MovementType.CANCELLED },
    ];
    // sum = -5 + 2 + 5 = 2; total + sum = 22
    expect(computeAvailable(total, movements).toString()).toBe('22');
  });

  it('reject path restores balance: PENDING(-3) + CANCELLED(+3) → available unchanged', () => {
    const total = new Decimal(10);
    const movements = [
      { delta: new Decimal(-3), type: MovementType.PENDING_RESERVATION },
      { delta: new Decimal(3),  type: MovementType.CANCELLED },
    ];
    expect(computeAvailable(total, movements).toString()).toBe('10');
  });

  it('returns total when no movements', () => {
    expect(computeAvailable(new Decimal(10), []).toString()).toBe('10');
  });

  it('never returns negative when input is consistent', () => {
    const total = new Decimal(3);
    const movements = [{ delta: new Decimal(-3), type: MovementType.PENDING_RESERVATION }];
    expect(computeAvailable(total, movements).toString()).toBe('0');
  });

  it('clamps to 0 when HCM sends a total lower than existing reservations', () => {
    // Scenario: 1-day reservation pending, then HCM refreshes total to 0.
    // available = 0 + (-1) = -1 → must be clamped to 0.
    const total = new Decimal(0);
    const movements = [{ delta: new Decimal(-1), type: MovementType.PENDING_RESERVATION }];
    expect(computeAvailable(total, movements).toString()).toBe('0');
  });
});
