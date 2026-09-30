'use client';

import { useStartSession } from '../lib/use-start-session';
import { JoinCodeForm } from './JoinCodeForm';

/** Shown for old or mistyped links, and for sessions lost when the server restarted. */
export function SessionNotFound({ code, token }: { code: string; token: string }) {
  const { start, busy, error } = useStartSession(token);

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
        <button className="button primary" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : 'Start a new session'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <JoinCodeForm label="Or enter a different code" />
    </>
  );
}
