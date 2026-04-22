import Decimal from 'decimal.js';

export interface IncomingHcmRow {
  employeeId: string;
  locationId: string;
  totalDays: string;
  hcmTimestamp: string;
}

export interface MergeDecision {
  shouldUpdate: boolean;
  deltaDays: Decimal;
  reason: 'NEW' | 'UPDATED' | 'SKIPPED_STALE';
}

export function decideMerge(
  incoming: IncomingHcmRow,
  current: { totalDays: Decimal; hcmLastSeenAt: Date } | null,
): MergeDecision {
  const incomingTs = new Date(incoming.hcmTimestamp);
  const incomingTotal = new Decimal(incoming.totalDays);
  if (!current) return { shouldUpdate: true, deltaDays: incomingTotal, reason: 'NEW' };
  if (incomingTs <= current.hcmLastSeenAt) return { shouldUpdate: false, deltaDays: new Decimal(0), reason: 'SKIPPED_STALE' };
  return { shouldUpdate: true, deltaDays: incomingTotal.minus(current.totalDays), reason: 'UPDATED' };
}
