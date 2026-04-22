import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { HcmBalance, HcmPort } from './hcm.port';
import { HcmReserveRequest, HcmConfirmRequest, HcmReleaseRequest } from '@examplehr/contracts';
import { HcmUnavailableError } from '../../shared/errors/domain.errors';

interface ReservationRow { employeeId: string; locationId: string; days: Decimal; confirmed: boolean; }
interface FailureSpec { op: 'reserve' | 'confirm' | 'release' | 'getBalance'; kind: 'unavailable' | 'insufficient' | 'invalid' | 'silent_accept'; }

@Injectable()
export class HcmInMemoryAdapter implements HcmPort {
  private balances = new Map<string, { total: Decimal; ts: Date }>();
  private reservations = new Map<string, ReservationRow>();
  private failures: FailureSpec[] = [];

  private key(e: string, l: string) { return `${e}::${l}`; }

  seed(employeeId: string, locationId: string, totalDays: string, ts: Date = new Date()) {
    this.balances.set(this.key(employeeId, locationId), { total: new Decimal(totalDays), ts });
  }
  reset() { this.balances.clear(); this.reservations.clear(); this.failures = []; }
  injectFailure(spec: FailureSpec) { this.failures.push(spec); }

  private popFailure(op: FailureSpec['op']): FailureSpec | undefined {
    const idx = this.failures.findIndex((f) => f.op === op);
    return idx >= 0 ? this.failures.splice(idx, 1)[0] : undefined;
  }

  async getBalance(employeeId: string, locationId: string): Promise<HcmBalance> {
    const f = this.popFailure('getBalance');
    if (f?.kind === 'unavailable') throw new HcmUnavailableError();
    const row = this.balances.get(this.key(employeeId, locationId));
    if (!row) throw Object.assign(new Error('HCM 404'), { code: 'NOT_FOUND' });
    return { employeeId, locationId, totalDays: row.total.toString(), hcmTimestamp: row.ts.toISOString() };
  }

  async reserve(req: HcmReserveRequest) {
    const f = this.popFailure('reserve');
    if (f?.kind === 'unavailable') throw new HcmUnavailableError();
    if (f?.kind === 'invalid') throw Object.assign(new Error('Invalid dimension'), { code: 'INVALID_DIMENSION' });
    const row = this.balances.get(this.key(req.employeeId, req.locationId));
    if (!row) throw Object.assign(new Error('Unknown'), { code: 'INVALID_DIMENSION' });
    const days = new Decimal(req.days);
    const reserved = [...this.reservations.values()]
      .filter((r) => !r.confirmed && r.employeeId === req.employeeId && r.locationId === req.locationId)
      .reduce((acc, r) => acc.plus(r.days), new Decimal(0));
    const available = row.total.minus(reserved);
    if (f?.kind === 'silent_accept') {
      // intentionally accept even when insufficient (for the defensive-HCM test)
      this.reservations.set(req.reservationId, { employeeId: req.employeeId, locationId: req.locationId, days, confirmed: false });
      return { reservationId: req.reservationId };
    }
    if (days.greaterThan(available) || f?.kind === 'insufficient') {
      throw Object.assign(new Error('Insufficient'), { code: 'INSUFFICIENT_BALANCE' });
    }
    this.reservations.set(req.reservationId, { employeeId: req.employeeId, locationId: req.locationId, days, confirmed: false });
    return { reservationId: req.reservationId };
  }

  async confirm(req: HcmConfirmRequest) {
    const f = this.popFailure('confirm');
    if (f?.kind === 'unavailable') throw new HcmUnavailableError();
    const r = this.reservations.get(req.reservationId);
    if (!r) throw Object.assign(new Error('No such reservation'), { code: 'NOT_FOUND' });
    r.confirmed = true;
    const balKey = this.key(r.employeeId, r.locationId);
    const bal = this.balances.get(balKey)!;
    this.balances.set(balKey, { total: bal.total.minus(r.days), ts: new Date() });
  }

  async release(req: HcmReleaseRequest) {
    const f = this.popFailure('release');
    if (f?.kind === 'unavailable') throw new HcmUnavailableError();
    this.reservations.delete(req.reservationId);
  }
}
