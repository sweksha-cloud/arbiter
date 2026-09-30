'use client';

import type { Preferences } from '@arbiter/shared';
import { useEffect, useState } from 'react';

import { api } from './api';

/** The signed-in guest's preferences: `undefined` while loading, `null` if never set. */
export function usePreferences(token: string | undefined) {
  const [loaded, setLoaded] = useState<{ token: string; preferences: Preferences | null }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.getPreferences(token).then(
      (preferences) => !cancelled && setLoaded({ token, preferences }),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Something went wrong')
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  return {
    // Ignore results that belong to a previous identity.
    preferences: loaded && loaded.token === token ? loaded.preferences : undefined,
    setPreferences: (preferences: Preferences) => token && setLoaded({ token, preferences }),
    error
  };
}
