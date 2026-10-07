'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '../lib/api';
import { Icon } from './Icon';
import { saveIdentity, type Identity } from '../lib/identity';

/**
 * "Try a demo" (TRADEOFFS.md 24): anyone can see the whole flow alone, with
 * two simulated friends who swipe on their own and free sample places. A
 * first-time visitor gets a guest named "Guest" (they can rename later).
 */
export function DemoButton({ identity }: { identity: Identity | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      let token = identity?.token;
      if (!token) {
        const created = await api.createGuest('Guest');
        saveIdentity(created);
        token = created.token;
      }
      const sessionId = await api.createDemoSession(token);
      router.push(`/s/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div className="demo-cta">
      <button type="button" className="button demo-button" onClick={() => void start()} disabled={busy}>
        {busy ? (
          'Setting up a demo…'
        ) : (
          <>
            <Icon name="play" size={16} /> Try a demo with sample friends
          </>
        )}
      </button>
      <p className="muted small">No friends needed: two simulated friends swipe along with you.</p>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
