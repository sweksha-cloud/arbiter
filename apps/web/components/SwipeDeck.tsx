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
/** Places dealt per round; "see more" deals the next round (TRADEOFFS.md 22c). */
const BATCH = 7;

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
export function SwipeDeck({ view, onSwipe, onMore }: { view: SessionView; onSwipe: Swipe; onMore: () => Promise<void> }) {
  const places = allPlaces(view);
  const byId = new Map(places.map((p) => [p.id, p]));
  // Swiped here but not yet confirmed by the server: hidden straight away.
  const [pending, setPending] = useState<Record<string, Reaction>>({});
  const reactionOf = (id: string) => (id in pending ? pending[id] : view.myReactions[id]);
  // Rounds of BATCH places (TRADEOFFS.md 22c); "see more" deals the next round.
  const [batchEnd, setBatchEnd] = useState(BATCH);
  // A narrowing round: only the places you liked; right keeps, left drops.
  const [narrow, setNarrow] = useState<{ ids: string[]; decided: Record<string, 'keep' | 'drop'> } | null>(null);
  const left = narrow
    ? narrow.ids.filter((id) => !narrow.decided[id] && byId.has(id)).map((id) => byId.get(id)!)
    : places.slice(0, batchEnd).filter((p) => reactionOf(p.id) === undefined);
  const total = narrow ? narrow.ids.length : Math.min(batchEnd, places.length);
  const [current, next] = left;
  const [history, setHistory] = useState<{ id: string; reaction: Reaction; narrowing: boolean }[]>([]);
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
      const still = Object.fromEntries(Object.entries(all).filter(([id, r]) => view.myReactions[id] !== r));
      return Object.keys(still).length === Object.keys(all).length ? all : still;
    });
  }, [view.myReactions]);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong');

  function swipe(reaction: Reaction) {
    if (!current) return;
    const place = current;
    setLeaving({ place, direction: reaction === 'like' ? 'right' : 'left', from: drag });
    window.setTimeout(() => setLeaving((l) => (l?.place.id === place.id ? undefined : l)), FLY_MS);
    setHistory((h) => [...h, { id: place.id, reaction, narrowing: narrow !== null }]);
    setDrag(0);
    setError(undefined);
    if (narrow) {
      // Keeping a like changes nothing on the server; dropping it is a 👎.
      setNarrow({ ...narrow, decided: { ...narrow.decided, [place.id]: reaction === 'like' ? 'keep' : 'drop' } });
      if (reaction === 'dislike') {
        setPending((all) => ({ ...all, [place.id]: 'dislike' }));
        onSwipe(place.id, 'dislike').catch(fail);
      }
      return;
    }
    setPending((all) => ({ ...all, [place.id]: reaction }));
    onSwipe(place.id, reaction).catch((e: unknown) => {
      // Put the card back so the vote isn't silently lost.
      setPending((all) => {
        const { [place.id]: _dropped, ...rest } = all;
        return rest;
      });
      setHistory((h) => h.filter((entry) => entry.id !== place.id));
      fail(e);
    });
  }

  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    setError(undefined);
    setHistory((h) => h.slice(0, -1));
    if (last.narrowing) {
      setNarrow((n) => {
        if (!n) return n;
        const { [last.id]: _undone, ...decided } = n.decided;
        return { ...n, decided };
      });
      if (last.reaction === 'dislike') {
        setPending((all) => ({ ...all, [last.id]: 'like' }));
        await onSwipe(last.id, 'like').catch(fail);
      }
      return;
    }
    setPending((all) => {
      const { [last.id]: _dropped, ...rest } = all;
      return rest;
    });
    await onSwipe(last.id, null).catch(fail);
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

  const done = total - left.length;
  const lean = Math.max(-1, Math.min(1, drag / SWIPE_DISTANCE));

  if (!current) {
    const liked = places.filter((p) => reactionOf(p.id) === 'like');
    return (
      <section className="swipe" aria-label="Swipe through the places">
        <RoundEnd
          view={view}
          liked={liked}
          narrowing={narrow !== null}
          unseen={places.filter((p, i) => i >= batchEnd && reactionOf(p.id) === undefined).length}
          onSeeMore={() => {
            setNarrow(null);
            setBatchEnd((end) => end + BATCH);
          }}
          onSearchMore={async () => {
            await onMore();
            setNarrow(null);
            setBatchEnd(Math.max(batchEnd, places.length) + BATCH);
          }}
          onNarrow={() => setNarrow({ ids: liked.map((p) => p.id), decided: {} })}
          onDone={() => setNarrow(null)}
        />
        {history.length > 0 && (
          <button className="button link center" onClick={() => void undo()}>
            Undo last swipe
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="swipe" aria-label="Swipe through the places">
      <div className="swipe-meta">
        <div className="swipe-progress" aria-hidden>
          <div style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <p className="muted small swipe-count">
          {narrow ? 'Narrowing down · ' : ''}
          {done + 1} of {total}
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

      {/* Labelled, so the next action is obvious (TRADEOFFS.md 23f). */}
      <div className="swipe-buttons">
        <span className="swipe-action">
          <button className="swipe-button pass" onClick={() => swipe('dislike')} aria-label={`Pass on ${current.name}`}>
            ✕
          </button>
          <span className="swipe-label" aria-hidden>
            Pass
          </span>
        </span>
        <span className="swipe-action">
          <button className="swipe-button undo" onClick={() => void undo()} disabled={history.length === 0} aria-label="Undo">
            ↺
          </button>
          <span className="swipe-label" aria-hidden>
            Undo
          </span>
        </span>
        <span className="swipe-action">
          <button className="swipe-button like" onClick={() => swipe('like')} aria-label={`Like ${current.name}`}>
            ♥
          </button>
          <span className="swipe-label" aria-hidden>
            Like
          </span>
        </span>
      </div>
      {done === 0 && <p className="muted small center">Swipe right to like, left to pass.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/**
 * The end of a round (TRADEOFFS.md 22c): deal 10 more (or search further out
 * when the search has run out), or go back through your likes to narrow
 * them down until one is left.
 */
function RoundEnd({
  view,
  liked,
  narrowing,
  unseen,
  onSeeMore,
  onSearchMore,
  onNarrow,
  onDone
}: {
  view: SessionView;
  liked: PlaceCandidate[];
  narrowing: boolean;
  unseen: number;
  onSeeMore: () => void;
  onSearchMore: () => Promise<void>;
  onNarrow: () => void;
  onDone: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const pick = liked.length === 1 ? liked[0] : undefined;

  async function searchMore() {
    setSearching(true);
    setSearchError(undefined);
    try {
      await onSearchMore();
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="card stack center swipe-done">
      <p className="swipe-done-emoji" aria-hidden>
        {pick ? '🏆' : narrowing ? '✂️' : '🎉'}
      </p>
      {pick ? (
        <>
          <p>
            <strong>Your top pick: {pick.name}</strong>
          </p>
          <a className="swipe-link" href={directionsUrl(pick, view.placesSource)} target="_blank" rel="noreferrer">
            Directions ↗
          </a>
        </>
      ) : (
        <p>
          <strong>
            {narrowing
              ? liked.length === 0
                ? 'You passed on all of them.'
                : `${liked.length} still in the running.`
              : liked.length === 0
                ? 'End of this round. No likes yet.'
                : 'End of this round. Here are your likes:'}
          </strong>
        </p>
      )}
      {/* Your choices so far, so the next step is an informed one. */}
      {!pick && liked.length > 0 && <LikedList places={liked} view={view} />}
      <div className="stack tight round-actions">
        {liked.length >= 2 && (
          <button className="button primary" onClick={onNarrow}>
            {narrowing ? `Narrow down again (${liked.length} left)` : `Go through my ${liked.length} likes again`}
          </button>
        )}
        {unseen > 0 ? (
          <button className="button" onClick={onSeeMore}>
            See {Math.min(unseen, BATCH)} more {Math.min(unseen, BATCH) === 1 ? 'place' : 'places'}
          </button>
        ) : (
          <button className="button" onClick={() => void searchMore()} disabled={searching}>
            {searching ? 'Searching…' : 'Search for more places'}
          </button>
        )}
        {narrowing && (
          <button className="button link" onClick={onDone}>
            Back to all places
          </button>
        )}
      </div>
      {searchError && <p className="error small">{searchError}</p>}
      {!narrowing && view.members.length > 1 && <p className="muted small">Matches show up as the others swipe.</p>}
    </div>
  );
}

/** The places you've liked, compact: photo or emoji, name, key facts, directions. */
export function LikedList({ places, view }: { places: PlaceCandidate[]; view: SessionView }) {
  return (
    <ul className="liked-list" aria-label="Places you liked">
      {places.map((place) => {
        const facts = [
          place.rating === undefined ? undefined : `★ ${place.rating.toFixed(1)}`,
          formatPrice(place.pricePerPerson, place.priceLevel),
          formatDistance(place.distanceMeters)
        ].filter(Boolean);
        return (
          <li key={place.id}>
            <span className={`liked-thumb ${tintFor(place.id)}`} aria-hidden>
              {place.photo?.url ? <img src={`${SERVER_URL}${place.photo.url}`} alt="" /> : emojiFor(place)}
            </span>
            <span className="liked-text">
              <strong>{place.name}</strong>
              <span className="muted small">{facts.join(' · ')}</span>
            </span>
            <a href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer" aria-label={`Directions to ${place.name}`}>
              ↗
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Whether this place fits: "✓ Fits …" when it meets every must-have, else
 * which of your own it misses, or that it misses someone else's (never whose).
 */
export function FitLine({ place, view }: { place: PlaceCandidate; view: SessionView }) {
  const missed = view.missesForYou[place.id];
  if (view.noLongerFits.includes(place.id)) return <p className="small misses">Doesn&apos;t fit the changed requirements</p>;
  if (view.fitsAll.includes(place.id)) {
    return <p className="small fits">✓ {view.members.length === 1 ? 'Fits all your must-haves' : "Fits everyone's must-haves"}</p>;
  }
  if (missed) {
    return (
      <p className="small misses">
        {describeMisses(missed, {
          placeKind: place.kind,
          myKinds: view.myKinds,
          placeCuisines: place.cuisines,
          myRuledOut: view.myRuledOut
        })}
      </p>
    );
  }
  return <p className="small misses">Close match: doesn&apos;t fit someone else&apos;s must-haves</p>;
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
  const fits = view.suggestions.find((s) => s.place.id === place.id)?.menuNutrition?.fitsYou;
  return (
    <div className="swipe-body">
      <h3>{place.name}</h3>
      <div className="swipe-facts">
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </div>
      {place.cuisines.length > 0 && <p className="swipe-cuisines">{place.cuisines.slice(0, 4).join(' · ')}</p>}
      {place.summary && <p className="small swipe-summary">{place.summary}</p>}
      {place.features && place.features.length > 0 && (
        <ul className="swipe-features" aria-label="Features">
          {place.features.map((f) => (
            <li key={f}>{FEATURE_LABELS[f]}</li>
          ))}
        </ul>
      )}
      <FitLine place={place} view={view} />
      {fits && (
        <p className="small">
          <strong>Fits your nutrition settings:</strong> {fits.name}
        </p>
      )}
      <p className="swipe-links">
        <a className="swipe-link" href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
          Directions ↗
        </a>
        {place.website && (
          <a className="swipe-link" href={place.website} target="_blank" rel="noreferrer">
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

/**
 * Desktop side panel (TRADEOFFS.md 23f): the places you've liked so far, so
 * the right side holds decision information instead of empty space.
 */
export function YourLikes({ view }: { view: SessionView }) {
  const liked = allPlaces(view).filter((p) => view.myReactions[p.id] === 'like');
  return (
    <section className="card stack tight your-likes" aria-label="Your likes so far">
      <h2>Your likes {liked.length > 0 && <span className="muted">({liked.length})</span>}</h2>
      {liked.length > 0 ? (
        <LikedList places={liked} view={view} />
      ) : (
        <p className="muted small">Swipe right on a place and it shows up here.</p>
      )}
    </section>
  );
}

