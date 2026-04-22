import { useSyncExternalStore } from 'react';

export type Identity = { employeeId: string; role: 'employee' | 'manager' | 'admin' };

const KEY = 'examplehr-identity';

const DEFAULT: Identity = { employeeId: 'e1', role: 'employee' };

let listeners: Array<() => void> = [];

function read(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT;
}

function write(id: Identity) {
  localStorage.setItem(KEY, JSON.stringify(id));
  listeners.forEach((l) => l());
}

export function setIdentity(id: Identity) { write(id); }

export function useIdentity(): Identity {
  return useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb); }; },
    read,
  );
}
