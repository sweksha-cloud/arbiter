'use client';

import {
  NUTRITION_TAGS,
  type MenuItem,
  type NutritionTag,
  type Reaction,
  type SessionView,
  type SuggestionView
} from '@arbiter/shared';

import { formatDistance, formatPrice } from '../lib/format';

function directionsUrl({ place }: SuggestionView, source: SessionView['placesSource']): string {
  const params = new URLSearchParams({ api: '1', destination: `${place.location.lat},${place.location.lng}` });
  // Sample places have made-up IDs; only real Google place IDs go in the link.
  if (source === 'google') params.set('destination_place_id', place.id);
  return `https://www.google.com/maps/dir/?${params}`;
}

export function SuggestionCard({
  suggestion,
  source,
  canReact,
  onReact,
  onTag
}: {
  suggestion: SuggestionView;
  source: SessionView['placesSource'];
  canReact: boolean;
  onReact: (reaction: Reaction | null) => void;
  onTag: (tag: NutritionTag, on: boolean) => void;
}) {
  const { place, likes, dislikes, myReaction, tags, menuNutrition } = suggestion;
  const anyMarks = tags.some((t) => t.count > 0);
  const total = likes + dislikes;
  const likeShare = total === 0 ? 50 : (likes / total) * 100;
  const details = [
    formatDistance(place.distanceMeters),
    formatPrice(place.priceLevel),
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
        <a className="button" href={directionsUrl(suggestion, source)} target="_blank" rel="noreferrer">
          Directions
        </a>
      </div>

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
 * Published chain nutrition, kept visually separate from Google's place data
 * (Google's attribution rules) and credited to fatsecret (their terms), with
 * no advice implied (also their terms).
 */
function ChainNutrition({ fitsYou, source }: { fitsYou: MenuItem | null; source: 'fatsecret' | 'sample' }) {
  return (
    <section className="nutrition-box stack tight" aria-label="Published nutrition">
      {fitsYou ? (
        <p className="small">
          <strong>Fits your nutrition settings:</strong> {fitsYou.name}
          <br />
          <span className="muted">{describeItem(fitsYou)}</span>
        </p>
      ) : (
        <p className="small">This chain publishes nutrition for its menu.</p>
      )}
      <p className="muted small">
        {source === 'fatsecret' ? (
          <a href="https://platform.fatsecret.com" target="_blank" rel="noreferrer">
            Powered by fatsecret Platform API
          </a>
        ) : (
          'Sample nutrition for testing, not a real menu'
        )}{' '}
        · Not nutrition or medical advice.
      </p>
    </section>
  );
}
