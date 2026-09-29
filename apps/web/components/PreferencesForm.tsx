'use client';

import type { Preferences } from '@arbiter/shared';
import { useState, type FormEvent } from 'react';

import { api } from '../lib/api';
import { MILE_OPTIONS, metersToMiles, milesToMeters } from '../lib/format';

const CUISINES = [
  'american',
  'burgers',
  'chinese',
  'french',
  'indian',
  'italian',
  'japanese',
  'mexican',
  'pizza',
  'thai',
  'vietnamese',
  'cafe'
];

type CuisineFeeling = 'like' | 'dislike';

const EMPTY: Preferences = { hard: {}, soft: {} };

function initialFeelings(preferences: Preferences): Record<string, CuisineFeeling> {
  const feelings: Record<string, CuisineFeeling> = {};
  for (const c of preferences.soft.likedCuisines ?? []) feelings[c] = 'like';
  for (const c of preferences.soft.dislikedCuisines ?? []) feelings[c] = 'dislike';
  return feelings;
}

const nextFeeling = (current: CuisineFeeling | undefined): CuisineFeeling | undefined =>
  current === undefined ? 'like' : current === 'like' ? 'dislike' : undefined;

export function PreferencesForm({
  token,
  initial,
  submitLabel,
  onSaved
}: {
  token: string;
  initial: Preferences | null;
  submitLabel: string;
  onSaved: (preferences: Preferences) => void;
}) {
  const start = initial ?? EMPTY;
  const [vegetarian, setVegetarian] = useState(start.hard.vegetarian ?? false);
  const [noFastFood, setNoFastFood] = useState(start.hard.noFastFood ?? false);
  const [maxPriceLevel, setMaxPriceLevel] = useState<number | undefined>(start.hard.maxPriceLevel);
  const [maxMiles, setMaxMiles] = useState<number | undefined>(
    start.hard.maxDistanceMeters === undefined ? undefined : metersToMiles(start.hard.maxDistanceMeters)
  );
  const [feelings, setFeelings] = useState(() => initialFeelings(start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const entries = Object.entries(feelings);
    const preferences: Preferences = {
      hard: {
        vegetarian: vegetarian || undefined,
        noFastFood: noFastFood || undefined,
        maxPriceLevel,
        maxDistanceMeters: maxMiles === undefined ? undefined : milesToMeters(maxMiles)
      },
      soft: {
        likedCuisines: entries.filter(([, f]) => f === 'like').map(([c]) => c),
        dislikedCuisines: entries.filter(([, f]) => f === 'dislike').map(([c]) => c)
      }
    };
    setBusy(true);
    setError(undefined);
    try {
      await api.savePreferences(token, preferences);
      onSaved(preferences);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <section className="card stack">
        <h2>Must-haves</h2>
        <p className="muted small">Places that break any of these are removed for the whole group. Nobody sees your answers.</p>

        <label className="check">
          <input type="checkbox" checked={vegetarian} onChange={(e) => setVegetarian(e.target.checked)} />
          <span>I need vegetarian options</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={noFastFood} onChange={(e) => setNoFastFood(e.target.checked)} />
          <span>No fast food</span>
        </label>

        <fieldset className="field">
          <legend>Most I want to spend</legend>
          <div className="segmented">
            {[undefined, 1, 2, 3, 4].map((level) => (
              <button
                key={level ?? 'any'}
                type="button"
                aria-pressed={maxPriceLevel === level}
                onClick={() => setMaxPriceLevel(level)}
              >
                {level === undefined ? 'Any' : '$'.repeat(level)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Farthest I&apos;ll go</legend>
          <div className="segmented">
            {[undefined, ...MILE_OPTIONS].map((miles) => (
              <button
                key={miles ?? 'any'}
                type="button"
                aria-pressed={maxMiles === miles}
                onClick={() => setMaxMiles(miles)}
              >
                {miles === undefined ? 'Any' : `${miles} mi`}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card stack">
        <h2>Nice-to-haves</h2>
        <p className="muted small">Tap once for 👍 love it, twice for 👎 rather not, three times to clear. These only change the order of suggestions.</p>
        <div className="chips">
          {CUISINES.map((cuisine) => {
            const feeling = feelings[cuisine];
            return (
              <button
                key={cuisine}
                type="button"
                className={`chip ${feeling ?? ''}`}
                onClick={() =>
                  setFeelings((all) => {
                    const { [cuisine]: current, ...rest } = all;
                    const next = nextFeeling(current);
                    return next ? { ...rest, [cuisine]: next } : rest;
                  })
                }
              >
                {feeling === 'like' ? '👍 ' : feeling === 'dislike' ? '👎 ' : ''}
                {cuisine}
              </button>
            );
          })}
        </div>
      </section>

      <button className="button primary" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
