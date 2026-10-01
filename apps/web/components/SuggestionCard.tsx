'use client';

import { NUTRITION_TAGS, type NutritionTag, type Reaction, type SessionView, type SuggestionView } from '@arbiter/shared';

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
  const { place, likes, dislikes, myReaction, tags } = suggestion;
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

      <section className="stack tight" aria-label={`What the group says ${place.name} has`}>
        <p className="small">
          <strong>Options the group says it has</strong>
          {!anyMarks && <span className="muted"> · No nutrition info for this place yet</span>}
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
