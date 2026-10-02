'use client';

import type { LatLng } from '@arbiter/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from './api';
import { FALLBACK_CENTER } from './config';

// Chrome only starts getCurrentPosition's own timeout once permission is
// granted, so a location prompt nobody answers would otherwise wait forever.
const LOCATION_WAIT_MS = 10_000;

function currentLocation(): Promise<LatLng | undefined> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(undefined);
    const giveUp = setTimeout(() => resolve(undefined), LOCATION_WAIT_MS);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        clearTimeout(giveUp);
        resolve({ lat: coords.latitude, lng: coords.longitude });
      },
      () => {
        clearTimeout(giveUp);
        resolve(undefined);
      },
      { timeout: 8000, maximumAge: 5 * 60_000 }
    );
  });
}

/** Creates a session at the host's location and opens it. */
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
      // How the scan center is chosen is still open (.claude/docs/DESIGN.md section 4);
      // the host's location is the simplest option for now.
      const center = (await currentLocation()) ?? FALLBACK_CENTER;
      const sessionId = await api.createSession(tokenNow, center);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  const start = () => startWith(token);

  return { start, startWith, busy, error };
}
