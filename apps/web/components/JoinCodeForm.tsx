'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Session codes are shown in capitals; accept any case and stray spaces. */
export const normalizeSessionCode = (code: string) => code.trim().toUpperCase();

export function JoinCodeForm({ label = 'Got a code from a friend?', compact = false }: { label?: string; compact?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);
    if (normalized) router.push(`/s/${encodeURIComponent(normalized)}`);
  }

  // On the home page, joining is the secondary action: one compact row, no card (TRADEOFFS.md 23d).
  if (compact) {
    return (
      <form className="join-compact" onSubmit={submit}>
        <label className="small muted" htmlFor="join-code">
          {label}
        </label>
        <div className="row nowrap">
          <input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. K7QM3X"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
          />
          <button className="button" disabled={code.trim() === ''}>
            Join session
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field">
        <span>{label}</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. K7QM3X"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={12}
        />
      </label>
      <button className="button" disabled={code.trim() === ''}>
        Join session
      </button>
      {code.trim() === '' && <p className="muted small">Type the code from your invite to join.</p>}
    </form>
  );
}
