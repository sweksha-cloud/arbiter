'use client';

import { useSyncExternalStore } from 'react';

// The session this browser most recently joined, so the home page can offer
// "Rejoin". The server is always asked whether it still exists before showing it.
const KEY = 'arbiter.activeSession';
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

export function rememberActiveSession(sessionId: string) {
  if (localStorage.getItem(KEY) === sessionId) return;
  localStorage.setItem(KEY, sessionId);
  notify();
}

/** Forgets the remembered session; with `sessionId`, only if it's that one. */
export function forgetActiveSession(sessionId?: string) {
  if (sessionId && localStorage.getItem(KEY) !== sessionId) return;
  localStorage.removeItem(KEY);
  notify();
}

/** `undefined` while rendering on the server, `null` if none. */
export function useActiveSession(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY),
    () => undefined
  );
}
