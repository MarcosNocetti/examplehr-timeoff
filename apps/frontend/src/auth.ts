import { useSyncExternalStore } from 'react';

export type Identity = { employeeId: string; role: 'employee' | 'manager' | 'admin' };

const KEY = 'examplehr-identity';

const DEFAULT: Identity = { employeeId: 'e1', role: 'employee' };

let listeners: Array<() => void> = [];

// Cache the last parsed Identity + the raw JSON it came from.
// useSyncExternalStore's getSnapshot MUST return a stable reference when
// nothing has changed (it uses Object.is to detect change). Parsing JSON
// on every render returns a new object each time, which makes React think
// the state changed and triggers an infinite re-render loop (error #185).
let cachedRaw: string | null = null;
let cachedIdentity: Identity = DEFAULT;

function read(): Identity {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return DEFAULT;
  }
  if (raw === null) {
    cachedRaw = null;
    cachedIdentity = DEFAULT;
    return DEFAULT;
  }
  if (raw === cachedRaw) return cachedIdentity;
  try {
    cachedIdentity = JSON.parse(raw) as Identity;
    cachedRaw = raw;
  } catch {
    cachedIdentity = DEFAULT;
    cachedRaw = null;
  }
  return cachedIdentity;
}

function write(id: Identity) {
  const raw = JSON.stringify(id);
  localStorage.setItem(KEY, raw);
  cachedRaw = raw;
  cachedIdentity = id;
  listeners.forEach((l) => l());
}

export function setIdentity(id: Identity) {
  write(id);
}

const subscribe = (cb: () => void) => {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
};

export function useIdentity(): Identity {
  return useSyncExternalStore(subscribe, read);
}
