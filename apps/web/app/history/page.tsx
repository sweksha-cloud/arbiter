'use client';

import type { PastSession } from '@arbiter/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PastSessionCard } from '../../components/PastSessionCard';
import { api } from '../../lib/api';
import { hasAccount, useIdentity } from '../../lib/identity';

export default function HistoryPage() {
  const identity = useIdentity();
  const token = hasAccount(identity) ? identity.token : undefined;
  const [sessions, setSessions] = useState<PastSession[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    api.pastSessions(token).then(setSessions, (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong'));
  }, [token]);

  if (identity === undefined) return null;
  if (!token) {
    return (
      <main className="page stack">
        <h1>Past sessions</h1>
        <p>
          <Link href="/login">Log in</Link> or <Link href="/signup">make an account</Link> to keep a record of every
          session you join: who came, what was suggested, and how everyone reacted.
        </p>
      </main>
    );
  }

  return (
    <main className="page stack">
      <h1>Past sessions</h1>
      {error && <p className="error">{error}</p>}
      {sessions === undefined && !error && <p className="muted">Loading…</p>}
      {sessions?.length === 0 && (
        <p className="muted">
          No sessions yet. <Link href="/">Start one</Link> and it&apos;ll show up here.
        </p>
      )}
      {sessions && sessions.length > 0 && (
        <>
          <p className="muted small">
            Places are links to Google Maps: Google&apos;s rules don&apos;t let Arbiter keep their names after a session.
          </p>
          {sessions.map((session) => (
            <PastSessionCard key={session.sessionId} session={session} />
          ))}
        </>
      )}
    </main>
  );
}
