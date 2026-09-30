'use client';

import Link from 'next/link';

import { api } from '../lib/api';
import { saveIdentity } from '../lib/identity';
import { useSubmit } from '../lib/use-submit';

/** Creates a guest identity. No account needed. */
export function NameForm({ intro }: { intro?: string }) {
  const { handle, busy, error } = useSubmit();

  return (
    <form className="card stack" onSubmit={handle(async (value) => saveIdentity(await api.createGuest(value('name'))))}>
      {intro && <p className="muted">{intro}</p>}
      <label className="field">
        <span>What should your friends call you?</span>
        {/* Left to the browser, not React state, so a name typed while the page loads isn't lost (BUG-013). */}
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
        {busy ? 'One sec…' : 'Continue'}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
