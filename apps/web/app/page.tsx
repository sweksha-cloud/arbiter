'use client';

import Link from 'next/link';

import { Greeting } from '../components/Greeting';
import { JoinCodeForm } from '../components/JoinCodeForm';
import { RejoinBanner } from '../components/RejoinBanner';
import { StartSessionForm } from '../components/StartSessionForm';
import { useIdentity } from '../lib/identity';
import { useStartSession } from '../lib/use-start-session';

export default function HomePage() {
  const identity = useIdentity();
  const { start, startWith, busy, error } = useStartSession(identity?.token);

  return (
    <main className="page stack">
      <header className="hero">
        <h1>Where should we eat?</h1>
        <p className="hero-lead">
          Everyone sets their must-haves privately. Then swipe together until you match.
        </p>
        <HeroPreview />
        <ol className="hero-steps">
          <li>
            <span aria-hidden>🔒</span> Set your must-haves. <span className="muted">Nobody sees them.</span>
          </li>
          <li>
            <span aria-hidden>👉</span> Swipe on places nearby that work for everyone.
          </li>
          <li>
            <span aria-hidden>🎉</span> Everyone likes the same place? That&apos;s your match.
          </li>
        </ol>
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
            <Greeting identity={identity} />
            <button className="button primary" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Start a session'}
            </button>
            <p className="muted small">You&apos;ll choose where to meet in the next step.</p>
            {error && <p className="error">{error}</p>}
          </section>

          <JoinCodeForm />

          <p className="center">
            <Link href="/preferences">Edit my preferences</Link>
          </p>
        </>
      )}
    </main>
  );
}

/** A small, decorative preview of a swipe card and a match (TRADEOFFS.md 23). */
function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden>
      <div className="hero-card back">
        <div className="hero-card-top tint-gold">🍣</div>
      </div>
      <div className="hero-card">
        <div className="hero-card-top tint-lilac">🍜</div>
        <div className="hero-card-body">
          <strong>Thai Orchid</strong>
          <span className="muted small">★ 4.6 · $20–30 · 0.4 mi</span>
          <span className="fits small">✓ Fits everyone</span>
        </div>
      </div>
      <span className="hero-match">🎉 It&apos;s a match!</span>
    </div>
  );
}

