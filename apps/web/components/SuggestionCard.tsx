'use client';

import type { Reaction, SessionView, SuggestionView } from '@arbiter/shared';

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
  onReact
}: {
  suggestion: SuggestionView;
  source: SessionView['placesSource'];
  canReact: boolean;
  onReact: (reaction: Reaction | null) => void;
}) {
  const { place, likes, dislikes, myReaction } = suggestion;
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
    </article>
  );
}
