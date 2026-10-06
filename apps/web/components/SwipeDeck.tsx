'use client';

import type { PlaceCandidate, PlaceFeature, Reaction, SessionView } from '@arbiter/shared';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import { SERVER_URL } from '../lib/config';
import { describeMisses, formatDistance, formatPrice } from '../lib/format';
import { directionsUrl } from './SuggestionCard';

/** How far (px) a card has to be dragged before letting go counts as a swipe. */
const SWIPE_DISTANCE = 90;
/** How long the card takes to fly off (ms); keep in step with .swipe-card's transition. */
const FLY_MS = 220;

type Swipe = (placeId: string, reaction: Reaction | null) => Promise<void>;

/** Every place from the search, best first: the main list, then more options. */
function allPlaces(view: SessionView): PlaceCandidate[] {
  return [...view.suggestions.map((s) => s.place), ...view.moreOptions];
}

/** A big emoji for the card's header, from the place's cuisines or kind. */
const EMOJI: [RegExp, string][] = [
  [/sushi|japanese|ramen/, '🍣'],
  [/mexican|taco/, '🌮'],
  [/burger/, '🍔'],
  [/pizza/, '🍕'],
  [/italian|pasta/, '🍝'],
  [/chinese|dim sum|cantonese|dumpling|noodle/, '🥟'],
  [/thai|vietnamese|pho/, '🍜'],
  [/indian|biryani|curry/, '🍛'],
  [/korean|bbq|barbecue/, '🍖'],
  [/steak/, '🥩'],
  [/salad|vegetarian|vegan|healthy/, '🥗'],
  [/seafood|fish/, '🦞'],
  [/breakfast|brunch/, '🥞'],
  [/sandwich|deli/, '🥪'],
  [/chicken/, '🍗'],
  [/dessert|ice cream|bakery|donut/, '🍰'],
  [/cafe|coffee/, '☕'],
  [/bar|pub/, '🍹']
];
function emojiFor(place: PlaceCandidate): string {
  const words = [...place.cuisines, place.kind ?? ''].join(' ').toLowerCase();
  return EMOJI.find(([pattern]) => pattern.test(words))?.[1] ?? '🍽️';
}

const FEATURE_LABELS: Record<PlaceFeature, string> = {
  dine_in: '🍽️ Dine-in',
  takeout: '🥡 Takeout',
  delivery: '🛵 Delivery',
  outdoor_seating: '🌤️ Outdoor seating',
  reservations: '📅 Reservations',
  good_for_groups: '👥 Good for groups',
  beer_wine: '🍷 Beer & wine',
  kid_friendly: '🧒 Kid-friendly'
};

/** The card's top: the place's photo (with the photographer's credit Google requires), or a big emoji. */
function Hero({ place }: { place: PlaceCandidate }) {
  const [failed, setFailed] = useState(false);
  const photo = place.photo?.url && !failed ? place.photo : undefined;
  return (
    <div className={`swipe-hero ${photo ? 'has-photo' : ''}`}>
      {photo ? (
        <>
          {/* A plain img: the photo comes from Google through our server, not Next's image optimizer. */}
          <img src={`${SERVER_URL}${photo.url}`} alt="" draggable={false} onError={() => setFailed(true)} />
          {photo.author && (
            <span className="photo-credit">
              ©{' '}
              {photo.authorUri ? (
                <a href={photo.authorUri} target="_blank" rel="noreferrer">
                  {photo.author}
                </a>
              ) : (
                photo.author
              )}
            </span>
          )}
        </>
      ) : (
        <span aria-hidden>{emojiFor(place)}</span>
      )}
    </div>
  );
}

/** A header color per card, from the app's palette, so cards don't all look the same. */
const TINTS = ['tint-coral', 'tint-gold', 'tint-lilac', 'tint-teal'];
const tintFor = (id: string) => TINTS[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];

/**
 * Tinder-style voting (TRADEOFFS.md 22): one place at a time; drag right to
 * like, left to pass, or tap ♥ / ✕ (arrow keys work too). A card flies off
 * at once and the vote saves in the background, so swiping never waits on
 * the network. Swipes are the same 👍/👎 the list uses, so the views agree.
 */
export function SwipeDeck({ view, onSwipe }: { view: SessionView; onSwipe: Swipe }) {
  const places = allPlaces(view);
  // Swiped here but not yet confirmed by the server: hidden straight away.
  const [pending, setPending] = useState<Record<string, Reaction>>({});
  const decided = (id: string) => view.myReactions[id] !== undefined || pending[id] !== undefined;
  const left = places.filter((p) => !decided(p.id));
  const [current, next] = left;
  const [history, setHistory] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  // A copy of the card just swiped, animating off on top while the next one is
  // already live underneath: fast swipes never wait for the animation.
  const [leaving, setLeaving] = useState<{ place: PlaceCandidate; direction: 'left' | 'right'; from: number }>();
  const [error, setError] = useState<string>();
  const start = useRef<number | null>(null);
  const card = useRef<HTMLElement>(null);

  // A new card is ready for the keyboard straight away.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [current?.id]);

  // Once the server has the swipe, it no longer needs hiding here.
  useEffect(() => {
    setPending((all) => {
      const still = Object.fromEntries(Object.entries(all).filter(([id]) => view.myReactions[id] === undefined));
      return Object.keys(still).length === Object.keys(all).length ? all : still;
    });
  }, [view.myReactions]);

  function swipe(reaction: Reaction) {
    if (!current) return;
    const place = current;
    setLeaving({ place, direction: reaction === 'like' ? 'right' : 'left', from: drag });
    window.setTimeout(() => setLeaving((l) => (l?.place.id === place.id ? undefined : l)), FLY_MS);
    setPending((all) => ({ ...all, [place.id]: reaction }));
    setHistory((h) => [...h, place.id]);
    setDrag(0);
    setError(undefined);
    onSwipe(place.id, reaction).catch((e: unknown) => {
      // Put the card back so the vote isn't silently lost.
      setPending((all) => {
        const { [place.id]: _dropped, ...rest } = all;
        return rest;
      });
      setHistory((h) => h.filter((id) => id !== place.id));
      setError(e instanceof Error ? e.message : 'Something went wrong');
    });
  }

  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    setError(undefined);
    setHistory((h) => h.slice(0, -1));
    setPending((all) => {
      const { [last]: _dropped, ...rest } = all;
      return rest;
    });
    try {
      await onSwipe(last, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    // Links and buttons on the card still work as taps.
    if ((event.target as HTMLElement).closest('a, button, summary')) return;
    start.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (start.current !== null) setDrag(event.clientX - start.current);
  }
  function onPointerUp() {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (drag > SWIPE_DISTANCE) swipe('like');
    else if (drag < -SWIPE_DISTANCE) swipe('dislike');
    else setDrag(0);
  }

  const done = places.length - left.length;
  const lean = Math.max(-1, Math.min(1, drag / SWIPE_DISTANCE));

  if (!current) {
    return (
      <section className="swipe" aria-label="Swipe through the places">
        <div className="card stack center swipe-done">
          <p className="swipe-done-emoji" aria-hidden>
            🎉
          </p>
          <p>
            <strong>That&apos;s every place.</strong>
          </p>
          <p className="muted small">
            {view.members.length > 1 ? 'Matches show up above as the others swipe.' : 'Everything you liked is above.'}
          </p>
          {history.length > 0 && (
            <button className="button link" onClick={() => void undo()}>
              Undo last swipe
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="swipe" aria-label="Swipe through the places">
      <div className="swipe-meta">
        <div className="swipe-progress" aria-hidden>
          <div style={{ width: `${(done / places.length) * 100}%` }} />
        </div>
        <p className="muted small swipe-count">
          {done + 1} of {places.length}
        </p>
        <MatchCount view={view} />
      </div>

      <div className="swipe-stack">
        {next && (
          <div className={`swipe-card behind ${tintFor(next.id)}`} aria-hidden>
            <Hero place={next} />
          </div>
        )}
        <article
          ref={card}
          key={current.id}
          tabIndex={0}
          className={`swipe-card ${tintFor(current.id)} ${dragging ? 'dragging' : ''}`}
          style={{ transform: `translateX(${drag}px) rotate(${drag / 18}deg)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') swipe('like');
            if (e.key === 'ArrowLeft') swipe('dislike');
          }}
          aria-label={`${current.name}. Right arrow to like, left arrow to pass.`}
        >
          <span className="swipe-stamp like" style={{ opacity: Math.max(0, lean) }}>
            LIKE
          </span>
          <span className="swipe-stamp pass" style={{ opacity: Math.max(0, -lean) }}>
            NOPE
          </span>
          <Hero place={current} />
          <PlaceDetails place={current} view={view} />
        </article>
        {leaving && (
          <div
            key={`leaving-${leaving.place.id}`}
            className={`swipe-card leaving ${leaving.direction} ${tintFor(leaving.place.id)}`}
            style={{ '--from': `${leaving.from}px`, '--tilt': `${leaving.from / 18}deg` } as CSSProperties}
            aria-hidden
          >
            <span className={`swipe-stamp ${leaving.direction === 'right' ? 'like' : 'pass'}`}>
              {leaving.direction === 'right' ? 'LIKE' : 'NOPE'}
            </span>
            <Hero place={leaving.place} />
            <PlaceDetails place={leaving.place} view={view} />
          </div>
        )}
      </div>

      <div className="swipe-buttons">
        <button className="swipe-button pass" onClick={() => swipe('dislike')} aria-label={`Pass on ${current.name}`}>
          ✕
        </button>
        <button className="swipe-button undo" onClick={() => void undo()} disabled={history.length === 0} aria-label="Undo">
          ↺
        </button>
        <button className="swipe-button like" onClick={() => swipe('like')} aria-label={`Like ${current.name}`}>
          ♥
        </button>
      </div>
      {done === 0 && <p className="muted small center">Swipe right to like, left to pass.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function PlaceDetails({ place, view }: { place: PlaceCandidate; view: SessionView }) {
  const fromYou = view.suggestions[0]?.distanceFromYou ?? false;
  const facts = [
    place.openNow === undefined ? undefined : place.openNow ? '🟢 Open' : 'Closed',
    `📍 ${formatDistance(place.distanceMeters)}${fromYou ? ' from you' : ''}`,
    formatPrice(place.pricePerPerson, place.priceLevel),
    place.rating === undefined
      ? undefined
      : `★ ${place.rating.toFixed(1)}${place.userRatingCount ? ` (${place.userRatingCount.toLocaleString()})` : ''}`
  ].filter(Boolean);
  const missed = view.missesForYou[place.id];
  const fits = view.suggestions.find((s) => s.place.id === place.id)?.menuNutrition?.fitsYou;
  return (
    <div className="swipe-body stack tight">
      <h3>{place.name}</h3>
      <div className="swipe-facts">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
      {place.cuisines.length > 0 && <p className="swipe-cuisines">{place.cuisines.slice(0, 4).join(' · ')}</p>}
      {place.summary && <p className="small swipe-summary">{place.summary}</p>}
      {place.features && place.features.length > 0 && (
        <p className="muted swipe-features">{place.features.map((f) => FEATURE_LABELS[f]).join('  ·  ')}</p>
      )}
      {view.noLongerFits.includes(place.id) && <p className="small misses">Doesn&apos;t fit the changed requirements</p>}
      {missed && <p className="small misses">{describeMisses(missed)}</p>}
      {fits && (
        <p className="small">
          <strong>Fits your nutrition settings:</strong> {fits.name}
        </p>
      )}
      <p className="small swipe-links">
        <a href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
          Directions ↗
        </a>
        {place.website && (
          <a href={place.website} target="_blank" rel="noreferrer">
            Website ↗
          </a>
        )}
      </p>
    </div>
  );
}

/** "♥ 2" (alone: places you liked) or "🎉 1" (matches), linking to the list below the deck. */
function MatchCount({ view }: { view: SessionView }) {
  const count = view.matches.length;
  if (count === 0) return null;
  const solo = view.members.length === 1;
  return (
    <a className="match-count" href="#matches" aria-label={solo ? `${count} liked` : `${count} ${count === 1 ? 'match' : 'matches'}`}>
      {solo ? '♥' : '🎉'} {count}
    </a>
  );
}

/**
 * A group's new match pops up over the page (nothing below it moves while
 * people swipe), until closed. Alone, likes just count up.
 */
export function MatchToast({ view }: { view: SessionView }) {
  const seen = useRef<Set<string> | null>(null);
  const [showing, setShowing] = useState<string>();
  useEffect(() => {
    // Matches already there when the page opened aren't news.
    if (seen.current === null) {
      seen.current = new Set(view.matches);
      return;
    }
    const fresh = view.matches.find((id) => !seen.current!.has(id));
    for (const id of view.matches) seen.current.add(id);
    if (fresh && view.members.length > 1) setShowing(fresh);
  }, [view.matches, view.members.length]);
  const place = showing ? allPlaces(view).find((p) => p.id === showing) : undefined;
  if (!place) return null;
  return (
    <div className="match-toast" role="status">
      <span className="match-toast-emoji" aria-hidden>
        {emojiFor(place)}
      </span>
      <div className="grow">
        <strong>It&apos;s a match!</strong>
        <p className="small">Everyone liked {place.name}.</p>
      </div>
      <a className="button" href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
        Go ↗
      </a>
      <button className="button link" onClick={() => setShowing(undefined)} aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/**
 * The payoff, below the deck: places everyone liked ("It's a match!"), or with one
 * person, every place you liked. Before any match, the most-liked so far
 * (counts only, never who).
 */
export function Matches({ view }: { view: SessionView }) {
  const byId = new Map(allPlaces(view).map((p) => [p.id, p]));
  const solo = view.members.length === 1;
  const ids = view.matches;
  if (ids.length > 0) {
    const title = solo ? `Places you liked (${ids.length})` : ids.length === 1 ? "🎉 It's a match!" : `🎉 ${ids.length} matches!`;
    return (
      <section id="matches" className="card matches" aria-label={solo ? 'Places you liked' : 'Matches'}>
        {/* Alone, a tap-to-open bar so it never pushes the deck down; a group's match shows open. */}
        <details open={!solo}>
          <summary>
            <h2>{title}</h2>
          </summary>
          {!solo && <p className="muted small">Everyone liked {ids.length === 1 ? 'this place' : 'these places'}.</p>}
          <ul className="match-list">
          {ids.map((id) => {
            const place = byId.get(id);
            if (!place) return null;
            return (
              <li key={id}>
                <span aria-hidden>{emojiFor(place)}</span>
                <strong>{place.name}</strong>
                <a href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
                  Directions ↗
                </a>
              </li>
            );
          })}
          </ul>
        </details>
      </section>
    );
  }
  if (solo || view.mostLiked.length === 0) return null;
  return (
    <section className="card stack tight most-liked" aria-label="Most liked so far">
      <p>
        <strong>No match yet.</strong> <span className="muted small">Most liked so far:</span>
      </p>
      <ul className="small">
        {view.mostLiked.map(({ placeId, likes }) => (
          <li key={placeId}>
            {byId.get(placeId)?.name} · {likes} of {view.members.length} liked
          </li>
        ))}
      </ul>
    </section>
  );
}
