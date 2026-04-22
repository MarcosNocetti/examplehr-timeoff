import Decimal from 'decimal.js';
import { computeAvailable } from '../../../src/modules/balances/domain/balance-calculator';
import { MovementType } from '@examplehr/contracts';

describe('computeAvailable', () => {
  it('subtracts pending and confirmed; ignores HCM_REFRESH and CANCELLED', () => {
    const total = new Decimal(20);
    const movements = [
      { delta: new Decimal(-5), type: MovementType.PENDING_RESERVATION },
      { delta: new Decimal(-2), type: MovementType.CONFIRMED },
      { delta: new Decimal(5),  type: MovementType.HCM_REFRESH },
      { delta: new Decimal(5),  type: MovementType.CANCELLED },
    ];
    expect(computeAvailable(total, movements).toString()).toBe('13');
  });

  it('returns total when no movements', () => {
    expect(computeAvailable(new Decimal(10), []).toString()).toBe('10');
  });

  it('never returns negative when input is consistent', () => {
    const total = new Decimal(3);
    const movements = [{ delta: new Decimal(-3), type: MovementType.PENDING_RESERVATION }];
    expect(computeAvailable(total, movements).toString()).toBe('0');
  });
});
