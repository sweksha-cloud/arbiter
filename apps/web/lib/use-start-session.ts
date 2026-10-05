'use client';

import type { MeetingChoice } from '@arbiter/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from './api';

/**
 * "Start a session" opens the setup page (/new), where the host chooses where
 * to meet before the session exists. `token` is unused there; it's kept so
 * callers that just made a guest can call `startWith` the same way.
 */
export function useStartSession(_token?: string) {
  const router = useRouter();
  const start = () => router.push('/new');
  return { start, startWith: (_tokenNow: string | undefined) => start(), busy: false, error: undefined as string | undefined };
}

/** Creates the session from the setup page's choice and opens it. */
export function useCreateSession(token: string | undefined) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create(meeting: MeetingChoice) {
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      const sessionId = await api.createSession(token, meeting);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return { create, busy, error };
}
