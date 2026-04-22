import { Injectable, Optional, Inject } from '@nestjs/common';
import { HcmBalance, HcmPort } from './hcm.port';
import { HcmReserveRequest, HcmConfirmRequest, HcmReleaseRequest } from '@examplehr/contracts';
import { HcmUnavailableError } from '../../shared/errors/domain.errors';

export const HCM_BASE_URL = 'HCM_BASE_URL';

@Injectable()
export class HcmHttpAdapter implements HcmPort {
  private readonly baseUrl: string;

  constructor(@Optional() @Inject(HCM_BASE_URL) baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.HCM_BASE_URL ?? 'http://localhost:4000';
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new HcmUnavailableError(`fetch failed: ${e.message}`);
    }
    return this.parse<T>(res);
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`);
    } catch (e: any) {
      throw new HcmUnavailableError(`fetch failed: ${e.message}`);
    }
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status >= 500) throw new HcmUnavailableError(`HCM ${res.status}`);
    if (res.status >= 400) {
      const j: any = await res.json().catch(() => ({}));
      const err: any = new Error(j.title ?? `HCM ${res.status}`);
      err.code = j.code ?? 'HCM_ERROR';
      err.httpStatus = res.status;
      throw err;
    }
    return (res.status === 204 ? (undefined as unknown as T) : ((await res.json()) as T));
  }

  getBalance(e: string, l: string): Promise<HcmBalance> { return this.get(`/hcm/balances/${e}/${l}`); }
  reserve(req: HcmReserveRequest) { return this.post<{ reservationId: string }>('/hcm/reservations', req); }
  confirm(req: HcmConfirmRequest) { return this.post<void>('/hcm/reservations/confirm', req); }
  release(req: HcmReleaseRequest) { return this.post<void>('/hcm/reservations/release', req); }
}
