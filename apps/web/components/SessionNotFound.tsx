'use client';

import type { PastSession } from '@arbiter/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { hasAccount, useIdentity } from '../lib/identity';
import { useStartSession } from '../lib/use-start-session';
import { JoinCodeForm } from './JoinCodeForm';
import { PastSessionCard } from './PastSessionCard';

/**
 * Shown for old or mistyped links, and for sessions lost when the server
 * restarted. If you were in it and have an account, shows how it went instead.
 */
export function SessionNotFound({ code, token }: { code: string; token: string }) {
  const { start, busy, error } = useStartSession(token);
  const identity = useIdentity();
  const loggedIn = hasAccount(identity);
  const [past, setPast] = useState<PastSession | null>();

  useEffect(() => {
    if (!loggedIn) return;
    api.pastSession(token, code).then(setPast, () => setPast(null));
  }, [loggedIn, token, code]);

  if (loggedIn && past === undefined) return null;
  if (past) {
    return (
      <>
        <p className="notice small">This session has finished. Here&apos;s how it went.</p>
        <PastSessionCard session={past} headingLevel={1} />
        <button className="button primary" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start a new session'}
        </button>
        {error && <p className="error">{error}</p>}
      </>
    );
  }

  return (
    <>
      <section className="card stack">
        <h1>
          We can&apos;t find session <span className="code">{code}</span>
        </h1>
        <p className="muted">
          The link may be old or the code mistyped. Sessions also disappear when Arbiter restarts, so an invite from
          earlier may no longer work.
        </p>
        <p className="muted">Ask whoever invited you for a fresh link, or start your own.</p>
        {!loggedIn && (
          <p className="muted small">
            Were you in this session? <Link href="/login">Log in</Link> to see how it went.
          </p>
        )}
        <button className="button primary" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start a new session'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <JoinCodeForm label="Or enter a different code" />
    </>
  );
}
