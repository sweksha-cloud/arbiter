'use client';

import type { Preferences } from '@arbiter/shared';
import { useState, type FormEvent } from 'react';

import { MAX_MILES, MILE_OPTIONS, MIN_MILES, metersToMiles, milesToMeters } from '../lib/format';

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

/** "Don't care", one of the preset distances, or a typed-in one. */
type DistanceChoice = { kind: 'any' } | { kind: 'preset'; miles: number } | { kind: 'custom'; text: string };

function initialDistance(preferences: Preferences): DistanceChoice {
  const meters = preferences.hard.maxDistanceMeters;
  if (meters === undefined) return { kind: 'any' };
  const preset = MILE_OPTIONS.find((miles) => milesToMeters(miles) === meters);
  if (preset !== undefined) return { kind: 'preset', miles: preset };
  return { kind: 'custom', text: String(Math.round(metersToMiles(meters) * 10) / 10) };
}

/** Meters for the chosen distance, or an error message for a bad custom one. */
function distanceMeters(choice: DistanceChoice): { meters?: number; error?: string } {
  if (choice.kind === 'any') return {};
  if (choice.kind === 'preset') return { meters: milesToMeters(choice.miles) };
  const miles = Number(choice.text);
  if (choice.text.trim() === '' || !Number.isFinite(miles) || miles < MIN_MILES || miles > MAX_MILES) {
    return { error: `Enter a distance between ${MIN_MILES} and ${MAX_MILES} miles.` };
  }
  return { meters: milesToMeters(miles) };
}

const nextFeeling = (current: CuisineFeeling | undefined): CuisineFeeling | undefined =>
  current === undefined ? 'like' : current === 'like' ? 'dislike' : undefined;

export function PreferencesForm({
  initial,
  submitLabel,
  onSubmit
}: {
  initial: Preferences | null;
  submitLabel: string;
  /** Sends the preferences somewhere (a session, or saved settings). Rejects with a user-facing message. */
  onSubmit: (preferences: Preferences) => Promise<void>;
}) {
  const start = initial ?? EMPTY;
  const [vegetarian, setVegetarian] = useState(start.hard.vegetarian ?? false);
  const [noFastFood, setNoFastFood] = useState(start.hard.noFastFood ?? false);
  const [maxPriceLevel, setMaxPriceLevel] = useState<number | undefined>(start.hard.maxPriceLevel);
  const [distance, setDistance] = useState<DistanceChoice>(() => initialDistance(start));
  const [feelings, setFeelings] = useState(() => initialFeelings(start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { meters, error: distanceError } = distanceMeters(distance);
    if (distanceError) {
      setError(distanceError);
      return;
    }
    const entries = Object.entries(feelings);
    const preferences: Preferences = {
      hard: {
        vegetarian: vegetarian || undefined,
        noFastFood: noFastFood || undefined,
        maxPriceLevel,
        maxDistanceMeters: meters
      },
      soft: {
        likedCuisines: entries.filter(([, f]) => f === 'like').map(([c]) => c),
        dislikedCuisines: entries.filter(([, f]) => f === 'dislike').map(([c]) => c)
      }
    };
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(preferences);
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
          <div className="segmented grid">
            <button type="button" aria-pressed={distance.kind === 'any'} onClick={() => setDistance({ kind: 'any' })}>
              Don&apos;t care
            </button>
            {MILE_OPTIONS.map((miles) => (
              <button
                key={miles}
                type="button"
                aria-pressed={distance.kind === 'preset' && distance.miles === miles}
                onClick={() => setDistance({ kind: 'preset', miles })}
              >
                {miles} mi
              </button>
            ))}
            <button
              type="button"
              aria-pressed={distance.kind === 'custom'}
              onClick={() => distance.kind !== 'custom' && setDistance({ kind: 'custom', text: '' })}
            >
              Custom
            </button>
          </div>
          {distance.kind === 'custom' && (
            <label className="field">
              <span className="small">Miles (up to {MAX_MILES})</span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_MILES}
                max={MAX_MILES}
                step="any"
                placeholder="e.g. 3.5"
                value={distance.text}
                onChange={(e) => setDistance({ kind: 'custom', text: e.target.value })}
                autoFocus
              />
            </label>
          )}
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
