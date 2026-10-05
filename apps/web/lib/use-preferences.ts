'use client';

import type { Preferences } from '@arbiter/shared';
import { useEffect, useState } from 'react';

import { api, ApiError } from './api';

/** Longest pause between attempts while the server can't be reached. */
const MAX_RETRY_MS = 10_000;

/**
 * The signed-in guest's preferences: `undefined` while loading, `null` if
 * never set. If the server can't be reached (e.g. mid-deploy), it keeps
 * trying with growing pauses, so the form appears by itself once it's back
 * (BUG-025); `error` says what's wrong meanwhile.
 */
export function usePreferences(token: string | undefined) {
  const [loaded, setLoaded] = useState<{ token: string; preferences: Preferences | null }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (delayMs: number) => {
      api.getPreferences(token).then(
        (preferences) => {
          if (cancelled) return;
          setError(undefined);
          setLoaded({ token, preferences });
        },
        (e: unknown) => {
          if (cancelled) return;
          // Worth retrying: no answer at all, or the proxy saying the server is
          // restarting (502–504 in production). Anything else won't fix itself.
          const unreachable = e instanceof ApiError && (e.status === 0 || (e.status >= 502 && e.status <= 504));
          setError(
            unreachable
              ? "Can't reach the Arbiter server. Trying again…"
              : e instanceof Error
                ? e.message
                : 'Something went wrong'
          );
          if (unreachable) timer = setTimeout(() => attempt(Math.min(delayMs * 2, MAX_RETRY_MS)), delayMs);
        }
      );
    };
    attempt(1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);

  return {
    // Ignore results that belong to a previous identity.
    preferences: loaded && loaded.token === token ? loaded.preferences : undefined,
    setPreferences: (preferences: Preferences) => token && setLoaded({ token, preferences }),
    error
  };
}
