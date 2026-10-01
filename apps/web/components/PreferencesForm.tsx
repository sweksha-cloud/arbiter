'use client';

import { ALLERGENS, type Allergen, type NutritionGoals, type Preferences, type Range } from '@arbiter/shared';
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

/** The number typed into a field, or undefined if it's blank ("don't care"). */
function parseAmount(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Math.round(Number(trimmed));
}

type NutritionText = { calMin: string; calMax: string; protein: string; carbsMin: string; carbsMax: string };

const asText = (n: number | undefined) => (n === undefined ? '' : String(n));

function initialNutrition(goals: NutritionGoals | undefined): NutritionText {
  return {
    calMin: asText(goals?.calories?.min),
    calMax: asText(goals?.calories?.max),
    protein: asText(goals?.proteinMinGrams),
    carbsMin: asText(goals?.carbs?.min),
    carbsMax: asText(goals?.carbs?.max)
  };
}

/** Builds the goals from what was filled in; blank fields are left out entirely. */
function nutritionGoals(text: NutritionText): { goals?: NutritionGoals; error?: string } {
  const amounts = Object.values(text).map(parseAmount);
  if (amounts.some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) {
    return { error: 'Nutrition amounts must be positive numbers.' };
  }
  const range = (min: string, max: string, what: string, limit: number): { range?: Range; error?: string } => {
    const lo = parseAmount(min);
    const hi = parseAmount(max);
    if ((lo ?? 0) > limit || (hi ?? 0) > limit) return { error: `${what} can be at most ${limit}.` };
    if (lo !== undefined && hi !== undefined && lo > hi) return { error: `${what}: the minimum is more than the maximum.` };
    if (lo === undefined && hi === undefined) return {};
    return { range: { ...(lo !== undefined && { min: lo }), ...(hi !== undefined && { max: hi }) } };
  };
  const calories = range(text.calMin, text.calMax, 'Calories', 4000);
  const carbs = range(text.carbsMin, text.carbsMax, 'Carbs', 600);
  const protein = parseAmount(text.protein);
  const error = calories.error ?? carbs.error ?? (protein !== undefined && (protein < 1 || protein > 300) ? 'Protein must be between 1 and 300 g.' : undefined);
  if (error) return { error };
  const goals: NutritionGoals = {
    ...(calories.range && { calories: calories.range }),
    ...(protein !== undefined && { proteinMinGrams: protein }),
    ...(carbs.range && { carbs: carbs.range })
  };
  return { goals: Object.keys(goals).length > 0 ? goals : undefined };
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
  const [noFastFood, setNoFastFood] = useState(start.soft.noFastFood ?? false);
  const [maxPriceLevel, setMaxPriceLevel] = useState<number | undefined>(start.hard.maxPriceLevel);
  const [distance, setDistance] = useState<DistanceChoice>(() => initialDistance(start));
  const [feelings, setFeelings] = useState(() => initialFeelings(start));
  const [veganOptions, setVeganOptions] = useState(start.soft.veganOptions ?? false);
  const [nutrition, setNutrition] = useState<NutritionText>(() => initialNutrition(start.soft.nutrition));
  const [allergies, setAllergies] = useState<Allergen[]>(() => (start.allergies ?? []) as Allergen[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { meters, error: distanceError } = distanceMeters(distance);
    if (distanceError) {
      setError(distanceError);
      return;
    }
    const { goals, error: nutritionError } = nutritionGoals(nutrition);
    if (nutritionError) {
      setError(nutritionError);
      return;
    }
    const entries = Object.entries(feelings);
    const preferences: Preferences = {
      hard: {
        vegetarian: vegetarian || undefined,
        maxPriceLevel,
        maxDistanceMeters: meters
      },
      soft: {
        noFastFood: noFastFood || undefined,
        likedCuisines: entries.filter(([, f]) => f === 'like').map(([c]) => c),
        dislikedCuisines: entries.filter(([, f]) => f === 'dislike').map(([c]) => c),
        veganOptions: veganOptions || undefined,
        nutrition: goals
      },
      allergies: allergies.length > 0 ? allergies : undefined
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
        <p className="muted small">These only change the order of suggestions, never remove a place.</p>
        <label className="check">
          <input type="checkbox" checked={noFastFood} onChange={(e) => setNoFastFood(e.target.checked)} />
          <span>Rather not do fast food</span>
        </label>
        <p className="muted small">Cuisines: tap once for 👍 love it, twice for 👎 rather not, three times to clear.</p>
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

        <label className="check">
          <input type="checkbox" checked={veganOptions} onChange={(e) => setVeganOptions(e.target.checked)} />
          <span>I&apos;d like vegan options</span>
        </label>

        <fieldset className="field">
          <legend>Nutrition per meal (optional)</legend>
          <p className="muted small">
            Leave blank if you don&apos;t mind. Only chains publish nutrition, so this raises chains with a dish that
            fits; it never removes a place.
          </p>
          <div className="number-pair">
            <NumberField label="Calories at least" value={nutrition.calMin} onChange={(calMin) => setNutrition({ ...nutrition, calMin })} />
            <NumberField label="Calories at most" value={nutrition.calMax} onChange={(calMax) => setNutrition({ ...nutrition, calMax })} />
          </div>
          <NumberField label="Protein at least (g)" value={nutrition.protein} onChange={(protein) => setNutrition({ ...nutrition, protein })} />
          <div className="number-pair">
            <NumberField label="Carbs at least (g)" value={nutrition.carbsMin} onChange={(carbsMin) => setNutrition({ ...nutrition, carbsMin })} />
            <NumberField label="Carbs at most (g)" value={nutrition.carbsMax} onChange={(carbsMax) => setNutrition({ ...nutrition, carbsMax })} />
          </div>
        </fieldset>
      </section>

      <section className="card stack">
        <h2>Allergies (private)</h2>
        <p className="muted small">
          Never shared, and never used to pick places: restaurants don&apos;t publish reliable allergen information.
          The group only sees that someone has a food allergy, never who or what.
        </p>
        <div className="check-grid">
          {ALLERGENS.map(({ id, label }) => (
            <label key={id} className="check">
              <input
                type="checkbox"
                checked={allergies.includes(id)}
                onChange={(e) =>
                  setAllergies((all) => (e.target.checked ? [...all, id] : all.filter((a) => a !== id)))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      <button className="button primary" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="small">{label}</span>
      <input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
