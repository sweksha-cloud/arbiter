'use client';

import {
  NUTRITION_TAGS,
  type MenuItem,
  type MissedMustHave,
  type PlaceKind,
  type NutritionTag,
  type Reaction,
  type SessionView,
  type SuggestionView
} from '@arbiter/shared';

import { describeMisses, formatDistance, formatPrice } from '../lib/format';

export function directionsUrl(place: { id: string; location: { lat: number; lng: number } }, source: SessionView['placesSource']): string {
  const params = new URLSearchParams({ api: '1', destination: `${place.location.lat},${place.location.lng}` });
  // Sample places have made-up IDs; only real Google place IDs go in the link.
  if (source === 'google') params.set('destination_place_id', place.id);
  return `https://www.google.com/maps/dir/?${params}`;
}

export const openLabel = (openNow: boolean | undefined) => (openNow === undefined ? undefined : openNow ? 'Open now' : 'Closed now');

/** A place's week, one line per day, behind a tap (the group may go another day). */
function Hours({ hours }: { hours: string[] }) {
  return (
    <details className="small">
      <summary>Hours</summary>
      <ul className="hours">
        {hours.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

export function SuggestionCard({
  suggestion,
  source,
  canReact,
  onReact,
  onTag,
  missed = [],
  noLongerFits = false,
  fitsAll = false,
  myKinds = []
}: {
  /** The viewer's own "only show me" kinds, for wording a kind miss. */
  myKinds?: readonly PlaceKind[];
  /** Meets every member's must-haves. */
  fitsAll?: boolean;
  suggestion: SuggestionView;
  /** Voted on, but no longer fits after someone changed their preferences. */
  noLongerFits?: boolean;
  /** Which of the viewer's own must-haves this place misses (closest matches). */
  missed?: readonly MissedMustHave[];
  source: SessionView['placesSource'];
  canReact: boolean;
  onReact: (reaction: Reaction | null) => void;
  onTag: (tag: NutritionTag, on: boolean) => void;
}) {
  const { place, likes, dislikes, myReaction, tags, menuNutrition, distanceFromYou } = suggestion;
  const distance = (meters: number) => `${formatDistance(meters)}${distanceFromYou ? ' from you' : ''}`;
  const anyMarks = tags.some((t) => t.count > 0);
  const total = likes + dislikes;
  const likeShare = total === 0 ? 50 : (likes / total) * 100;
  const details = [
    openLabel(place.openNow),
    distance(place.distanceMeters),
    formatPrice(place.pricePerPerson, place.priceLevel),
    place.rating === undefined ? undefined : `★ ${place.rating.toFixed(1)}`
  ].filter(Boolean);

  // Tapping your current reaction again clears it.
  const toggle = (reaction: Reaction) => onReact(myReaction === reaction ? null : reaction);

  return (
    <article className="card stack suggestion">
      <header>
        <h3>{place.name}</h3>
        <p className="muted small">
          {details.join(' · ')}
          {place.cuisines.length > 0 && <> · {place.cuisines.join(', ')}</>}
        </p>
        {fitsAll && !noLongerFits && <p className="small fits">✓ Fits everyone&apos;s must-haves</p>}
        {noLongerFits && <p className="small misses">Doesn&apos;t fit the changed requirements</p>}
        {missed.length > 0 && <p className="small misses">{describeMisses(missed, { placeKind: place.kind, myKinds })}</p>}
      </header>

      <div
        className={`bar ${total === 0 ? 'empty' : ''}`}
        role="img"
        aria-label={`${likes} likes, ${dislikes} dislikes`}
      >
        <div className="bar-likes" style={{ width: `${likeShare}%` }} />
      </div>

      <div className="row">
        <button
          className="button reaction like"
          aria-pressed={myReaction === 'like'}
          disabled={!canReact}
          onClick={() => toggle('like')}
        >
          👍 {likes}
        </button>
        <button
          className="button reaction dislike"
          aria-pressed={myReaction === 'dislike'}
          disabled={!canReact}
          onClick={() => toggle('dislike')}
        >
          👎 {dislikes}
        </button>
        <a className="button" href={directionsUrl(place, source)} target="_blank" rel="noreferrer">
          Directions
        </a>
      </div>

      {place.hours && place.hours.length > 0 && <Hours hours={place.hours} />}

      {place.otherLocations && place.otherLocations.length > 0 && (
        <details className="small">
          <summary>
            {place.otherLocations.length + 1} locations available
          </summary>
          <ul className="stack tight other-locations">
            {place.otherLocations.map((branch) => (
              <li key={branch.id} className="stack tight">
                <span>
                  {[distance(branch.distanceMeters), openLabel(branch.openNow), branch.rating === undefined ? undefined : `★ ${branch.rating.toFixed(1)}`]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  · <a href={directionsUrl(branch, source)} target="_blank" rel="noreferrer">Directions</a>
                </span>
                {branch.hours && branch.hours.length > 0 && <Hours hours={branch.hours} />}
              </li>
            ))}
          </ul>
        </details>
      )}

      {menuNutrition && <ChainNutrition {...menuNutrition} />}

      <section className="stack tight" aria-label={`What the group says ${place.name} has`}>
        <p className="small">
          <strong>Options the group says it has</strong>
          {/* Only when there's nothing at all: a chain's published menu above already counts. */}
          {!anyMarks && !menuNutrition && <span className="muted"> · No nutrition info for this place yet</span>}
        </p>
        <div className="chips">
          {NUTRITION_TAGS.map(({ tag, label }) => {
            const { count, mine } = tags.find((t) => t.tag === tag) ?? { count: 0, mine: false };
            return (
              <button
                key={tag}
                type="button"
                className="chip tag"
                aria-pressed={mine}
                disabled={!canReact}
                onClick={() => onTag(tag, !mine)}
              >
                {label}
                {count > 0 && <span aria-label={`, ${count} ${count === 1 ? 'person' : 'people'}`}> · {count}</span>}
              </button>
            );
          })}
        </div>
      </section>
    </article>
  );
}

/** "620 cal · 42 g protein · 60 g carbs", leaving out anything unknown. */
function describeItem(item: MenuItem): string {
  return [
    item.calories === undefined ? undefined : `${Math.round(item.calories)} cal`,
    item.proteinGrams === undefined ? undefined : `${Math.round(item.proteinGrams)} g protein`,
    item.carbsGrams === undefined ? undefined : `${Math.round(item.carbsGrams)} g carbs`
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The menu item that fits your nutrition settings, kept visually separate from
 * Google's place data (Google's attribution rules). Shown only when one fits:
 * fatsecret's credit and the "not advice" note are in the footer of every page.
 */
function ChainNutrition({ fitsYou, source }: { fitsYou: MenuItem | null; source: 'fatsecret' | 'sample' }) {
  if (!fitsYou) return null;
  return (
    <section className="nutrition-box stack tight" aria-label="Published nutrition">
      <p className="small">
        <strong>Fits your nutrition settings:</strong> {fitsYou.name}
        <br />
        <span className="muted">{describeItem(fitsYou)}</span>
      </p>
      {source === 'sample' && <p className="muted small">Sample nutrition for testing, not a real menu</p>}
    </section>
  );
}
