'use client';

import { CreateGuestResponseSchema, type CreateGuestResponse } from '@arbiter/shared';
import { useMemo, useSyncExternalStore } from 'react';

export type Identity = CreateGuestResponse;

const KEY = 'arbiter.identity';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function saveIdentity(identity: Identity) {
  localStorage.setItem(KEY, JSON.stringify(identity));
  notify();
}

export function clearIdentity() {
  localStorage.removeItem(KEY);
  notify();
}

function parse(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    return CreateGuestResponseSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The guest identity saved on this device.
 * `undefined` while rendering on the server (not known yet), `null` if there is none.
 */
export function useIdentity(): Identity | null | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY),
    () => undefined
  );
  return useMemo(() => (raw === undefined ? undefined : parse(raw)), [raw]);
}
