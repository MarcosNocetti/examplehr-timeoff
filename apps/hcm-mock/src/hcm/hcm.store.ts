import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

interface ReservationRow { employeeId: string; locationId: string; days: Decimal; confirmed: boolean; }
export interface FailureSpec { op: 'reserve' | 'confirm' | 'release' | 'getBalance'; kind: 'unavailable' | 'insufficient' | 'invalid' | 'silent_accept'; }
export interface BalanceSnapshot { employeeId: string; locationId: string; totalDays: string; hcmTimestamp: string; }

@Injectable()
export class HcmStore {
  private balances = new Map<string, { total: Decimal; ts: Date }>();
  private reservations = new Map<string, ReservationRow>();
  private failures: FailureSpec[] = [];

  private key(e: string, l: string) { return `${e}::${l}`; }

  seed(employeeId: string, locationId: string, totalDays: string, ts: Date = new Date()) {
    this.balances.set(this.key(employeeId, locationId), { total: new Decimal(totalDays), ts });
  }
  reset() { this.balances.clear(); this.reservations.clear(); this.failures = []; }
  injectFailure(spec: FailureSpec) { this.failures.push(spec); }

  popFailure(op: FailureSpec['op']): FailureSpec | undefined {
    const idx = this.failures.findIndex((f) => f.op === op);
    return idx >= 0 ? this.failures.splice(idx, 1)[0] : undefined;
  }

  hasBalance(e: string, l: string) { return this.balances.has(this.key(e, l)); }

  getBalance(e: string, l: string): BalanceSnapshot | null {
    const row = this.balances.get(this.key(e, l));
    if (!row) return null;
    return { employeeId: e, locationId: l, totalDays: row.total.toString(), hcmTimestamp: row.ts.toISOString() };
  }

  reserveOrThrow(input: { employeeId: string; locationId: string; days: string; reservationId: string }) {
    const row = this.balances.get(this.key(input.employeeId, input.locationId));
    if (!row) {
      const err: any = new Error('Invalid dimension'); err.code = 'INVALID_DIMENSION'; throw err;
    }
    const days = new Decimal(input.days);
    const reserved = [...this.reservations.values()]
      .filter((r) => !r.confirmed && r.employeeId === input.employeeId && r.locationId === input.locationId)
      .reduce((acc, r) => acc.plus(r.days), new Decimal(0));
    const available = row.total.minus(reserved);
    if (days.greaterThan(available)) {
      const err: any = new Error('Insufficient'); err.code = 'INSUFFICIENT_BALANCE'; throw err;
    }
    this.reservations.set(input.reservationId, {
      employeeId: input.employeeId, locationId: input.locationId, days, confirmed: false,
    });
    return { reservationId: input.reservationId };
  }

  silentAccept(input: { employeeId: string; locationId: string; days: string; reservationId: string }) {
    this.reservations.set(input.reservationId, {
      employeeId: input.employeeId, locationId: input.locationId,
      days: new Decimal(input.days), confirmed: false,
    });
    return { reservationId: input.reservationId };
  }

  confirm(reservationId: string) {
    const r = this.reservations.get(reservationId);
    if (!r) {
      const err: any = new Error('No such reservation'); err.code = 'NOT_FOUND'; throw err;
    }
    r.confirmed = true;
    const balKey = this.key(r.employeeId, r.locationId);
    const bal = this.balances.get(balKey)!;
    this.balances.set(balKey, { total: bal.total.minus(r.days), ts: new Date() });
  }

  release(reservationId: string) { this.reservations.delete(reservationId); }
}
