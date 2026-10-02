'use client';

import Link from 'next/link';

import { JoinCodeForm } from '../components/JoinCodeForm';
import { RejoinBanner } from '../components/RejoinBanner';
import { SaveProgress } from '../components/SaveProgress';
import { StartSessionForm } from '../components/StartSessionForm';
import { useIdentity } from '../lib/identity';
import { useStartSession } from '../lib/use-start-session';

export default function HomePage() {
  const identity = useIdentity();
  const { start, startWith, busy, error } = useStartSession(identity?.token);

  return (
    <main className="page stack">
      <header className="hero">
        <h1>Arbiter</h1>
        <p className="muted">Where should we eat? Everyone&apos;s must-haves are respected automatically, then the group reacts live.</p>
      </header>

      {identity === undefined ? null : identity === null ? (
        <>
          <StartSessionForm onStart={startWith} />
          <JoinCodeForm />
        </>
      ) : (
        <>
          <RejoinBanner token={identity.token} />
          <section className="card stack">
            <p>
              Hi <strong>{identity.guest.displayName}</strong>.
            </p>
            <button className="button primary" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Start a session'}
            </button>
            <p className="muted small">Uses your location as the meeting spot, if you allow it.</p>
            {error && <p className="error">{error}</p>}
          </section>

          <JoinCodeForm />

          <SaveProgress />

          <p className="center">
            <Link href="/preferences">Edit my preferences</Link>
          </p>
        </>
      )}
    </main>
  );
}
