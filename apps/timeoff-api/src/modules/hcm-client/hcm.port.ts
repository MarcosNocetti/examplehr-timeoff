import { HcmReserveRequest, HcmConfirmRequest, HcmReleaseRequest } from '@examplehr/contracts';

export interface HcmBalance { employeeId: string; locationId: string; totalDays: string; hcmTimestamp: string; }

export const HCM_PORT = Symbol('HcmPort');

export interface HcmPort {
  getBalance(employeeId: string, locationId: string): Promise<HcmBalance>;
  reserve(req: HcmReserveRequest): Promise<{ reservationId: string }>;
  confirm(req: HcmConfirmRequest): Promise<void>;
  release(req: HcmReleaseRequest): Promise<void>;
}
