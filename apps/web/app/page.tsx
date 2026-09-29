'use client';

import type { LatLng } from '@arbiter/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { NameForm } from '../components/NameForm';
import { api } from '../lib/api';
import { FALLBACK_CENTER } from '../lib/config';
import { useIdentity } from '../lib/identity';

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

export default function HomePage() {
  const identity = useIdentity();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function startSession() {
    if (!identity) return;
    setBusy(true);
    setError(undefined);
    try {
      // How the scan center is chosen is still open (docs/DESIGN.md section 4);
      // the host's location is the simplest option for now.
      const center = (await currentLocation()) ?? FALLBACK_CENTER;
      const sessionId = await api.createSession(identity.token, center);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  function joinSession(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/s/${encodeURIComponent(trimmed)}`);
  }

  return (
    <main className="page stack">
      <header className="hero">
        <h1>Arbiter</h1>
        <p className="muted">Where should we eat? Everyone&apos;s must-haves are respected automatically, then the group reacts live.</p>
      </header>

      {identity === undefined ? null : identity === null ? (
        <NameForm />
      ) : (
        <>
          <section className="card stack">
            <p>
              Hi <strong>{identity.guest.displayName}</strong>.
            </p>
            <button className="button primary" onClick={startSession} disabled={busy}>
              {busy ? 'Starting…' : 'Start a session'}
            </button>
            <p className="muted small">Uses your location as the meeting spot, if you allow it.</p>
            {error && <p className="error">{error}</p>}
          </section>

          <form className="card stack" onSubmit={joinSession}>
            <label className="field">
              <span>Got a code from a friend?</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. K7QM3X"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={12}
              />
            </label>
            <button className="button" disabled={code.trim() === ''}>
              Join session
            </button>
          </form>

          <p className="center">
            <Link href="/preferences">Edit my preferences</Link>
          </p>
        </>
      )}
    </main>
  );
}
