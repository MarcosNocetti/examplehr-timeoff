import { Identity } from './auth';

const BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.title ?? body?.message ?? `HTTP ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}, id: Identity): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-employee-id': id.employeeId,
      'x-role': id.role,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
