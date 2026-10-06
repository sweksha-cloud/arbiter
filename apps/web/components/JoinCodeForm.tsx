'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Session codes are shown in capitals; accept any case and stray spaces. */
export const normalizeSessionCode = (code: string) => code.trim().toUpperCase();

export function JoinCodeForm({ label = 'Got a code from a friend?' }: { label?: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);
    if (normalized) router.push(`/s/${encodeURIComponent(normalized)}`);
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
