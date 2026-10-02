'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { api } from '../lib/api';
import { saveIdentity } from '../lib/identity';

/**
 * The home page for first-time visitors: their name and "Start a session" in
 * one step. The name is required; the session itself is started by `onStart`.
 */
export function StartSessionForm({ onStart }: { onStart: (token: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read from the form, not React state, so a name typed while the page loads isn't lost (BUG-013).
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return setError('Enter your name to start a session');
    setBusy(true);
    setError(undefined);
    try {
      const identity = await api.createGuest(name);
      // Both in the same tick: the page switches to the signed-in view already "Starting…".
      saveIdentity(identity);
      onStart(identity.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field">
        <span>What should your friends call you?</span>
        <input
          name="name"
          maxLength={30}
          autoComplete="nickname"
          placeholder="Your name"
          pattern=".*\S.*"
          title="Enter a name"
          required
        />
      </label>
      <button className="button primary" disabled={busy}>
        {busy ? 'Starting…' : 'Start a session'}
      </button>
      <p className="muted small">Uses your location as the meeting spot, if you allow it.</p>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
