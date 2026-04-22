import Decimal from 'decimal.js';
import { decideMerge } from '../../../src/modules/reconciliation/domain/reconciliation-merger';

describe('decideMerge', () => {
  it('treats absence of current row as NEW with full incoming as delta', () => {
    const d = decideMerge(
      { employeeId: 'e', locationId: 'l', totalDays: '15', hcmTimestamp: '2026-01-01T00:00:00Z' },
      null,
    );
    expect(d.shouldUpdate).toBe(true);
    expect(d.reason).toBe('NEW');
    expect(d.deltaDays.toString()).toBe('15');
  });

  it('SKIPPED_STALE when incoming timestamp older than current', () => {
    const d = decideMerge(
      { employeeId: 'e', locationId: 'l', totalDays: '15', hcmTimestamp: '2026-01-01T00:00:00Z' },
      { totalDays: new Decimal(10), hcmLastSeenAt: new Date('2026-04-01T00:00:00Z') },
    );
    expect(d.shouldUpdate).toBe(false);
    expect(d.reason).toBe('SKIPPED_STALE');
  });

  it('UPDATED yields signed delta when incoming is newer', () => {
    const d = decideMerge(
      { employeeId: 'e', locationId: 'l', totalDays: '15', hcmTimestamp: '2026-04-22T00:00:00Z' },
      { totalDays: new Decimal(10), hcmLastSeenAt: new Date('2026-01-01T00:00:00Z') },
    );
    expect(d.shouldUpdate).toBe(true);
    expect(d.reason).toBe('UPDATED');
    expect(d.deltaDays.toString()).toBe('5');
  });
});
