'use client';

import { useState, type FormEvent } from 'react';

import { api } from '../lib/api';
import { saveIdentity } from '../lib/identity';

/** Creates a guest identity. No account needed. */
export function NameForm({ intro }: { intro?: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      saveIdentity(await api.createGuest(name));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      {intro && <p className="muted">{intro}</p>}
      <label className="field">
        <span>What should your friends call you?</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          autoComplete="nickname"
          placeholder="Your name"
          required
        />
      </label>
      <button className="button primary" disabled={busy || name.trim() === ''}>
        {busy ? 'One sec…' : 'Continue'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
