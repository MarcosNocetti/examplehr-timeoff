import { AsyncLocalStorage } from 'async_hooks';
export interface RequestCtx { correlationId: string; employeeId?: string; role?: string; }
export const als = new AsyncLocalStorage<RequestCtx>();
export const currentCtx = (): RequestCtx | undefined => als.getStore();
