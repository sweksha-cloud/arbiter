'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from './api';

/** Creates a session and opens it. Where to meet is chosen inside the session. */
export function useStartSession(token: string | undefined) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** For a guest created this moment, before `token` catches up. */
  async function startWith(tokenNow: string | undefined) {
    if (!tokenNow) return;
    setBusy(true);
    setError(undefined);
    try {
      const sessionId = await api.createSession(tokenNow);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const start = () => startWith(token);

  return { start, startWith, busy, error };
}
