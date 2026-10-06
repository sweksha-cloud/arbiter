'use client';

import type { SessionSummary } from '@arbiter/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { forgetActiveSession, useActiveSession } from '../lib/active-session';
import { api } from '../lib/api';

/** "Rejoin your session" on the home page, if the last session you joined is still going. */
export function RejoinBanner({ token, inline = false }: { token: string; inline?: boolean }) {
  const sessionId = useActiveSession();
  const [summary, setSummary] = useState<SessionSummary>();

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api.getSessionSummary(token, sessionId).then(
      (result) => {
        if (cancelled) return;
        if (!result || result.status === 'ended') forgetActiveSession(sessionId);
        else setSummary(result);
      },
      () => {} // Server unreachable: just don't offer it.
    );
    return () => {
      cancelled = true;
    };
  }, [token, sessionId]);

  if (!sessionId || summary?.sessionId !== sessionId) return null;

  // Inside the start card on the home page: one quiet line, so Start stays the
  // single main action (TRADEOFFS.md 23d).
  if (inline) {
    return (
      <p className="small rejoin-inline" aria-live="polite">
        You&apos;re in session <span className="code">{summary.sessionId}</span> ·{' '}
        <Link href={`/s/${summary.sessionId}`}>Rejoin</Link>
        <button className="pill-button" aria-label="Dismiss" onClick={() => forgetActiveSession(sessionId)}>
          ✕
        </button>
      </p>
    );
  }

  return (
    <section className="card rejoin row spread" aria-live="polite">
      <div>
        <strong>
          You&apos;re in session <span className="code">{summary.sessionId}</span>
        </strong>
        <p className="muted small">{summary.isHost ? 'You started it. Your friends may be waiting.' : 'It’s still going.'}</p>
      </div>
      <div className="row nowrap">
        <Link className="button" href={`/s/${summary.sessionId}`}>
          Rejoin
        </Link>
        <button className="button icon" aria-label="Dismiss" onClick={() => forgetActiveSession(sessionId)}>
          ✕
        </button>
      </div>
    </section>
  );
}
