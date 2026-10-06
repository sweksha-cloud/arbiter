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
    <main className="page stack home">
      <header className="hero">
        <h1>Where should we eat?</h1>
        <p className="hero-lead">
          Everyone sets their must-haves privately. Then swipe together until you match.
        </p>
      </header>

      {/* One main action: Start. Joining and rejoining are quieter (TRADEOFFS.md 23d). */}
      {identity === undefined ? null : identity === null ? (
        <>
          <StartSessionForm onStart={startWith} />
          <JoinCodeForm compact />
        </>
      ) : (
        <>
          <section className="card stack start-card">
            <Greeting identity={identity} />
            <button className="button primary" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Start a session'}
            </button>
            <p className="muted small">
              You&apos;ll choose where to meet in the next step. · <Link href="/preferences">Edit my preferences</Link>
            </p>
            <RejoinBanner token={identity.token} inline />
            {error && <p className="error">{error}</p>}
          </section>
          <JoinCodeForm compact />
        </>
      )}

      <section className="hero-more" aria-label="How it works">
        <HeroPreview />
        <ol className="hero-steps">
          <li>
            <span aria-hidden>🔒</span> Set your must-haves.{' '}
            <span className="muted">Your answers are never shared with your group.</span>
          </li>
          <li>
            <span aria-hidden>👉</span> Swipe on places nearby that work for everyone.
          </li>
          <li>
            <span aria-hidden>🎉</span> Everyone likes the same place? That&apos;s your match.
          </li>
        </ol>
      </section>

      <AboutArbiter />
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

/**
 * More about Arbiter, for the desktop website only (TRADEOFFS.md 23b): like a
 * product site, it explains as well as works. The installed app and phones
 * skip it and go straight to the tool.
 */
function AboutArbiter() {
  const features = [
    {
      icon: '🔒',
      title: 'Private must-haves',
      text: "Budget, distance, vegetarian or vegan, kinds of place. Nobody sees your answers, and Arbiter never says whose must-have ruled a place out."
    },
    {
      icon: '👉',
      title: 'Swipe together',
      text: 'Everyone swipes on the same places, live. When everyone likes one, it pops up as a match. Alone? It keeps your likes and helps you narrow them down.'
    },
    {
      icon: '✓',
      title: 'Honest about trade-offs',
      text: 'Every card says if it fits everyone, or exactly which of your must-haves it misses, so close matches are a choice, not a surprise.'
    },
    {
      icon: '📍',
      title: 'Meet anywhere',
      text: 'Search around one area, or find a spot between where everyone is coming from. Photos, ratings, hours and directions on every card.'
    }
  ];
  return (
    <section className="about" aria-labelledby="about-heading">
      <h2 id="about-heading">Why groups use Arbiter</h2>
      <ul className="about-grid">
        {features.map((f) => (
          <li key={f.title} className="card stack tight">
            <span className="about-icon" aria-hidden>
              {f.icon}
            </span>
            <strong>{f.title}</strong>
            <p className="muted small">{f.text}</p>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Works on any phone, and installs like an app: on iPhone, Share → Add to Home Screen.
      </p>
    </section>
  );
}

