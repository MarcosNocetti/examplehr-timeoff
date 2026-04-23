import { useSyncExternalStore } from 'react';

export type Role = 'employee' | 'manager' | 'admin';

export interface Identity {
  id: string;
  name: string;
  role: Role;
}

const KEY = 'examplehr-identity-v2';  // bump key so old single-string identities are flushed

let listeners: Array<() => void> = [];
let cachedRaw: string | null = null;
let cachedIdentity: Identity | null = null;

function read(): Identity | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (raw === null) {
    cachedRaw = null; cachedIdentity = null; return null;
  }
  if (raw === cachedRaw) return cachedIdentity;
  try {
    cachedIdentity = JSON.parse(raw) as Identity;
    cachedRaw = raw;
  } catch {
    cachedIdentity = null; cachedRaw = null;
  }
  return cachedIdentity;
}

function write(id: Identity | null) {
  if (id === null) {
    try { localStorage.removeItem(KEY); } catch {}
    cachedRaw = null; cachedIdentity = null;
  } else {
    const raw = JSON.stringify(id);
    try { localStorage.setItem(KEY, raw); } catch {}
    cachedRaw = raw; cachedIdentity = id;
  }
  listeners.forEach((l) => l());
}

export function setIdentity(id: Identity) { write(id); }
export function logout() { write(null); }

const subscribe = (cb: () => void) => {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
};

export function useIdentity(): Identity | null {
  return useSyncExternalStore(subscribe, read);
}
