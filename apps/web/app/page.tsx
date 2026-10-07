'use client';

import Link from 'next/link';

import { Greeting } from '../components/Greeting';
import { DemoButton } from '../components/DemoButton';
import { Icon } from '../components/Icon';
import { JoinCodeForm } from '../components/JoinCodeForm';
import { RejoinBanner } from '../components/RejoinBanner';
import { StartSessionForm } from '../components/StartSessionForm';
import { hasAccount, useIdentity } from '../lib/identity';
import { useStartSession } from '../lib/use-start-session';

export default function HomePage() {
  const identity = useIdentity();
  const { start, startWith, busy, error } = useStartSession(identity?.token);

  return (
    <main className="page stack home">
      <div className="home-hero">
        <header className="hero">
          <p className="live-pill">
            <span className="live-dot" aria-hidden /> Real-time restaurant matching, solo or in a group
          </p>
          <h1>Where should we eat?</h1>
          <p className="hero-lead">
            Everyone sets their must-haves privately. Then swipe together until you match, or go solo and narrow your
            likes down to one pick.
          </p>
        </header>

        {/* One main action: Start. Joining (inside the same card) and rejoining are quieter (TRADEOFFS.md 23d). */}
        {identity === undefined ? null : (
          <div className="card stack start-card home-actions">
            {identity === null ? (
              <StartSessionForm onStart={startWith} bare />
            ) : (
              <>
                <Greeting identity={identity} />
                <button className="button primary" onClick={start} disabled={busy}>
                  {busy ? 'Starting…' : 'Start a session'}
                </button>
                <p className="muted small">
                  You&apos;ll choose where to meet in the next step.
                  {/* Signed-in people only: guests fill these in during the session (owner, 2026-10-06). */}
                  {hasAccount(identity) && (
                    <>
                      {' · '}
                      <Link href="/preferences">Edit my preferences</Link>
                    </>
                  )}
                </p>
                <RejoinBanner token={identity.token} inline />
                {error && <p className="error">{error}</p>}
              </>
            )}
            <p className="or" aria-hidden>
              or
            </p>
            <JoinCodeForm compact />
            <DemoButton identity={identity} />
          </div>
        )}

        <section className="hero-more" aria-label="How it works">
          <HeroPreview />
          <ol className="hero-steps">
            <li>
              <Icon name="lock" />
              <span>
                Set your must-haves. <span className="muted">Your answers are never shared with your group.</span>
              </span>
            </li>
            <li>
              <Icon name="heart" />
              <span>Swipe on places nearby that work for everyone.</span>
            </li>
            <li>
              <Icon name="sparkles" />
              <span>Everyone likes the same place? That&apos;s your match.</span>
            </li>
          </ol>
        </section>
      </div>

      <HowItWorks />
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
/** The workflow in three steps, right under the hero. */
function HowItWorks() {
  const steps = [
    { title: 'Set private preferences', text: 'Budget, distance, diet and kinds of place. Nobody else in the group sees them.' },
    {
      title: 'Go solo or bring your group',
      text: 'Swipe on your own, or share a link or six-letter code so friends join from their own phones.'
    },
    {
      title: 'Swipe until you have a pick',
      text: "Like or pass, live. In a group, a place everyone likes is a match; alone, your likes narrow down to one top pick."
    }
  ];
  return (
    <section id="how-it-works" className="how-it-works" aria-labelledby="how-heading">
      <h2 id="how-heading">How it works</h2>
      <ol className="how-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="how-number" aria-hidden>
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="stack tight">
              <strong>{step.title}</strong>
              <p className="muted small">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AboutArbiter() {
  const features = [
    {
      icon: 'lock' as const,
      title: 'Private must-haves',
      text: "Budget, distance, vegetarian or vegan, kinds of place. Nobody sees your answers, and Arbiter never says whose must-have ruled a place out."
    },
    {
      icon: 'heart' as const,
      title: 'Swipe together',
      text: 'Everyone swipes on the same places, live. When everyone likes one, it pops up as a match. Alone? It keeps your likes and helps you narrow them down.'
    },
    {
      icon: 'check' as const,
      title: 'Honest about trade-offs',
      text: 'Every card says if it fits everyone, or exactly which of your must-haves it misses, so close matches are a choice, not a surprise.'
    },
    {
      icon: 'pin' as const,
      title: 'Meet anywhere',
      text: 'Search around one area, or find a spot between where everyone is coming from. Photos, ratings, hours and directions on every card.'
    }
  ];
  return (
    <section className="about" aria-labelledby="about-heading">
      <h2 id="about-heading">Why use Arbiter</h2>
      <ul className="about-grid">
        {features.map((f) => (
          <li key={f.title} className="card stack tight">
            <span className="about-icon">
              <Icon name={f.icon} />
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

