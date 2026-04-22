import { Injectable } from '@nestjs/common';
import { HcmStore } from './hcm.store';
import { HcmReserveRequest, HcmConfirmRequest, HcmReleaseRequest } from '@examplehr/contracts';

@Injectable()
export class HcmService {
  constructor(private readonly store: HcmStore) {}

  getBalance(employeeId: string, locationId: string) {
    const f = this.store.popFailure('getBalance');
    if (f?.kind === 'unavailable') {
      const err: any = new Error('HCM unavailable'); err.code = 'HCM_UNAVAILABLE'; throw err;
    }
    const snap = this.store.getBalance(employeeId, locationId);
    if (!snap) {
      const err: any = new Error('Not found'); err.code = 'NOT_FOUND'; throw err;
    }
    return snap;
  }

  reserve(req: HcmReserveRequest) {
    const f = this.store.popFailure('reserve');
    if (f?.kind === 'unavailable') {
      const err: any = new Error('HCM unavailable'); err.code = 'HCM_UNAVAILABLE'; throw err;
    }
    if (f?.kind === 'invalid') {
      const err: any = new Error('Invalid dimension'); err.code = 'INVALID_DIMENSION'; throw err;
    }
    if (f?.kind === 'silent_accept') {
      return this.store.silentAccept(req);
    }
    if (f?.kind === 'insufficient') {
      const err: any = new Error('Insufficient'); err.code = 'INSUFFICIENT_BALANCE'; throw err;
    }
    return this.store.reserveOrThrow(req);
  }

  confirm(req: HcmConfirmRequest) {
    const f = this.store.popFailure('confirm');
    if (f?.kind === 'unavailable') {
      const err: any = new Error('HCM unavailable'); err.code = 'HCM_UNAVAILABLE'; throw err;
    }
    this.store.confirm(req.reservationId);
  }

  release(req: HcmReleaseRequest) {
    const f = this.store.popFailure('release');
    if (f?.kind === 'unavailable') {
      const err: any = new Error('HCM unavailable'); err.code = 'HCM_UNAVAILABLE'; throw err;
    }
    this.store.release(req.reservationId);
  }
}
