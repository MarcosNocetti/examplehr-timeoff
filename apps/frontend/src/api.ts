import { Identity } from './auth';

// Default to the host's IPv4 — Docker Desktop on Windows binds only to IPv4
// and `localhost` resolves to `::1` (IPv6) in browsers, which would hang.
// Override with VITE_API_URL at build time if your host differs.
const BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://127.0.0.1:3000';

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
