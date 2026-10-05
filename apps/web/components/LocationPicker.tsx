'use client';

import type { NamedLocation } from '@arbiter/shared';
import { useState, type FormEvent } from 'react';

import { api } from '../lib/api';
import { currentLocation } from '../lib/location';

/**
 * "Use my current location" (free, from the browser) or a typed place like
 * "san francisco" (one lookup on the server). Shows the chosen place with a
 * way to change it.
 */
export function LocationPicker({
  token,
  label,
  value,
  onChoose,
  onClear
}: {
  token: string;
  /** What the place is for, e.g. "Search near" or "Where are you coming from?". */
  label: string;
  value: NamedLocation | null;
  onChoose: (location: NamedLocation) => Promise<void>;
  /** Offered as "Don't use my location" when set. */
  onClear?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'locating' | 'searching' | 'clearing'>();
  const [error, setError] = useState<string>();

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      await action();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(undefined);
    }
  }

  const useCurrent = () =>
    run('locating', async () => {
      const result = await currentLocation();
      if (!result.ok) throw new Error(result.reason);
      await onChoose({ center: result.center });
    });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('place') ?? '').trim();
    if (query.length < 2) return setError('Type a city, neighborhood or address.');
    void run('searching', async () => onChoose(await api.geocode(token, query)));
  }

  if (value && !editing) {
    return (
      <div className="stack tight">
        <span className="small muted">{label}</span>
        <div className="row spread">
          <strong>📍 {value.label ?? 'Your current location'}</strong>
          <button className="button" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
        {onClear && (
          <button className="button link small" onClick={() => run('clearing', onClear)} disabled={busy !== undefined}>
            Don&apos;t use my location
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="stack tight">
      <span className="small muted">{label}</span>
      <button className="button primary" onClick={useCurrent} disabled={busy !== undefined}>
        {busy === 'locating' ? 'Finding you…' : '📍 Use my current location'}
      </button>
      <form className="row nowrap" onSubmit={search}>
        <input
          name="place"
          className="grow"
          maxLength={120}
          placeholder="Or type a city or address"
          aria-label={`${label}: type a place`}
          autoComplete="address-level2"
        />
        <button className="button" disabled={busy !== undefined}>
          {busy === 'searching' ? 'Finding…' : 'Search'}
        </button>
      </form>
      {value && (
        <button className="button link small" onClick={() => setEditing(false)}>
          Keep {value.label ?? 'your current location'}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
