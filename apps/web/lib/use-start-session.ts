'use client';

import type { LatLng } from '@arbiter/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from './api';
import { FALLBACK_CENTER } from './config';

function currentLocation(): Promise<LatLng | undefined> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(undefined),
      { timeout: 8000, maximumAge: 5 * 60_000 }
    );
  });
}

/** Creates a session at the host's location and opens it. */
export function useStartSession(token: string | undefined) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      // How the scan center is chosen is still open (docs/DESIGN.md section 4);
      // the host's location is the simplest option for now.
      const center = (await currentLocation()) ?? FALLBACK_CENTER;
      const sessionId = await api.createSession(token, center);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return { start, busy, error };
}
