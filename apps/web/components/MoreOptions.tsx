'use client';

import { PLACE_KINDS, type MissedMustHave, type PlaceCandidate } from '@arbiter/shared';
import { useState } from 'react';

import { describeMisses, formatDistance, formatPrice } from '../lib/format';

type Filter = { by: 'kind' | 'cuisine'; value: string } | undefined;

const kindLabel = (kind: string) => PLACE_KINDS.find((k) => k.kind === kind)?.label ?? kind;

/**
 * Other places from the same search, below the suggestions. Anyone can narrow
 * them by kind or cuisine; liking one adds it to the suggestions for the
 * whole group. Each person sees which of their own must-haves a place misses.
 */
export function MoreOptions({
  options,
  distanceFromYou,
  missesForYou,
  onLike
}: {
  options: PlaceCandidate[];
  distanceFromYou: boolean;
  missesForYou: Record<string, readonly MissedMustHave[]>;
  onLike: (placeId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>();
  const [adding, setAdding] = useState<string>();
  const [error, setError] = useState<string>();

  if (options.length === 0) return null;

  const kinds = [...new Set(options.flatMap((p) => p.kind ?? []))];
  const cuisines = [...new Set(options.flatMap((p) => p.cuisines))].filter((c) => !kinds.includes(c as never)).sort();
  const shown = options.filter(
    (p) => !filter || (filter.by === 'kind' ? p.kind === filter.value : p.cuisines.includes(filter.value))
  );
  const isOn = (by: 'kind' | 'cuisine', value: string) => filter?.by === by && filter.value === value;
  const toggle = (by: 'kind' | 'cuisine', value: string) => setFilter(isOn(by, value) ? undefined : { by, value });

  async function like(placeId: string) {
    setAdding(placeId);
    setError(undefined);
    try {
      await onLike(placeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setAdding(undefined);
    }
  }

  return (
    <details className="card stack more-options">
      <summary>
        <strong>More options ({options.length})</strong>
      </summary>
      <p className="small muted">
        Other places from the same search. Like one to add it to the list above for the whole group.
      </p>

      {kinds.length + cuisines.length > 1 && (
        <div className="chips" role="group" aria-label="Show only">
          {kinds.map((kind) => (
            <button key={`k-${kind}`} type="button" className="chip tag" aria-pressed={isOn('kind', kind)} onClick={() => toggle('kind', kind)}>
              {kindLabel(kind)}
            </button>
          ))}
          {cuisines.map((cuisine) => (
            <button
              key={`c-${cuisine}`}
              type="button"
              className="chip tag"
              aria-pressed={isOn('cuisine', cuisine)}
              onClick={() => toggle('cuisine', cuisine)}
            >
              {cuisine}
            </button>
          ))}
        </div>
      )}

      <ul className="more-list">
        {shown.map((place) => {
          const details = [
            place.openNow === undefined ? undefined : place.openNow ? 'Open now' : 'Closed now',
            `${formatDistance(place.distanceMeters)}${distanceFromYou ? ' from you' : ''}`,
            formatPrice(place.pricePerPerson, place.priceLevel),
            place.rating === undefined ? undefined : `★ ${place.rating.toFixed(1)}`
          ].filter(Boolean);
          return (
            <li key={place.id} className="row spread nowrap">
              <div className="grow">
                <strong>{place.name}</strong>
                <p className="small muted">
                  {details.join(' · ')}
                  {place.cuisines.length > 0 && <> · {place.cuisines.join(', ')}</>}
                </p>
                {missesForYou[place.id] && <p className="small misses">{describeMisses(missesForYou[place.id]!)}</p>}
              </div>
              <button
                className="button"
                onClick={() => like(place.id)}
                disabled={adding !== undefined}
                aria-label={`Like ${place.name} and add it to the list`}
              >
                {adding === place.id ? 'Adding…' : '👍 Add'}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
    </details>
  );
}
