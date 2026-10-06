'use client';

import type { MeetingMode, NamedLocation } from '@arbiter/shared';
import Link from 'next/link';
import { useState } from 'react';

import { LocationPicker } from '../../components/LocationPicker';
import { MODES, NOTES } from '../../components/MeetingCard';
import { NameForm } from '../../components/NameForm';
import { useIdentity } from '../../lib/identity';
import { useCreateSession } from '../../lib/use-start-session';

/**
 * Setting up a session before it exists: where to meet, then "Create
 * session". The session (and its invite link) only exists once a location is
 * chosen, so it can never search somewhere nobody picked.
 */
export default function NewSessionPage() {
  const identity = useIdentity();

  return (
    <main className="page stack">
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>New session</h1>
      {identity === null && <NameForm intro="First, your name." />}
      {identity && <SetupForm token={identity.token} />}
    </main>
  );
}

function SetupForm({ token }: { token: string }) {
  const [mode, setMode] = useState<MeetingMode>();
  const [location, setLocation] = useState<NamedLocation | null>(null);
  const { create, busy, error } = useCreateSession(token);

  function choose(next: MeetingMode) {
    // An area to search and where you're coming from mean different things, so
    // switching starts the location over.
    if (next !== mode) setLocation(null);
    setMode(next);
  }

  function submit() {
    if (!mode || !location) return;
    void create(mode === 'area' ? { mode, area: location } : { mode, origin: location });
  }

  return (
    <section className="card stack" aria-labelledby="setup-heading">
      <h2 id="setup-heading">Where to meet</h2>
      <fieldset className="field">
        <legend className="small muted">How should Arbiter pick the area?</legend>
        <div className="segmented rows">
          {MODES.map(({ mode: option, label }) => (
            <button key={option} type="button" aria-pressed={mode === option} onClick={() => choose(option)}>
              {label}
            </button>
          ))}
        </div>
        {mode && <p className="small muted">{NOTES[mode].host}</p>}
      </fieldset>

      {mode && (
        <LocationPicker
          key={mode}
          token={token}
          label={mode === 'area' ? 'Search near' : 'Where are you coming from?'}
          value={location}
          onChoose={async (chosen) => setLocation(chosen)}
        />
      )}

      <button className="button primary" onClick={submit} disabled={!mode || !location || busy}>
        {busy ? 'Creating…' : 'Create session'}
      </button>
      {!busy && mode && !location && <p className="small muted center">Choose a location to create the session.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
