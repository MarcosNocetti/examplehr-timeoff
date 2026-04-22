import { Injectable } from '@nestjs/common';
import { HcmPort, HcmBalance } from './hcm.port';

// STUB — Task 14 implements the real HTTP client.
@Injectable()
export class HcmHttpAdapter implements HcmPort {
  async getBalance(): Promise<HcmBalance> { throw new Error('HcmHttpAdapter not implemented (Task 14)'); }
  async reserve() { throw new Error('HcmHttpAdapter not implemented (Task 14)'); return { reservationId: '' }; }
  async confirm() { throw new Error('HcmHttpAdapter not implemented (Task 14)'); }
  async release() { throw new Error('HcmHttpAdapter not implemented (Task 14)'); }
}
