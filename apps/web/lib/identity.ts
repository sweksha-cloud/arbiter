'use client';

import { CreateGuestResponseSchema } from '@arbiter/shared';
import { useMemo, useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * Who is signed in on this device. `email` is null for a guest, and missing
 * for identities saved before accounts existed (AccountSync fills it in).
 */
const IdentitySchema = CreateGuestResponseSchema.extend({ email: z.string().nullable().optional() });
export type Identity = z.infer<typeof IdentitySchema>;

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

/** The identity saved right now, read directly (outside React rendering). */
export function loadIdentity(): Identity | null {
  return parse(localStorage.getItem(KEY));
}

function parse(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    return IdentitySchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** True if this device is signed in to an account (not just a guest). */
export const hasAccount = (identity: Identity | null | undefined): identity is Identity & { email: string } =>
  typeof identity?.email === 'string';

/**
 * The identity saved on this device.
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
