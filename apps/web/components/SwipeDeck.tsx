'use client';

import type { PlaceCandidate, Reaction, SessionView } from '@arbiter/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { describeMisses, formatDistance, formatPrice } from '../lib/format';
import { directionsUrl, openLabel } from './SuggestionCard';

/** How far (px) a card has to be dragged before letting go counts as a swipe. */
const SWIPE_DISTANCE = 100;

type Swipe = (placeId: string, reaction: Reaction | null) => Promise<void>;

/** Every place from the search, best first: the main list, then more options. */
function allPlaces(view: SessionView): PlaceCandidate[] {
  return [...view.suggestions.map((s) => s.place), ...view.moreOptions];
}

/**
 * Tinder-style voting (TRADEOFFS.md 22): one place at a time, swipe right to
 * like and left to pass (or tap ♥ / ✕, or use the arrow keys). Swipes are the
 * same 👍/👎 the list uses, so the two views always agree.
 */
export function SwipeDeck({ view, onSwipe }: { view: SessionView; onSwipe: Swipe }) {
  const places = allPlaces(view);
  const left = places.filter((p) => !view.myReactions[p.id]);
  const current = left[0];
  const [history, setHistory] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const [leaving, setLeaving] = useState<'left' | 'right'>();
  const [error, setError] = useState<string>();
  const start = useRef<number | null>(null);
  const card = useRef<HTMLElement>(null);

  // A new card is ready for the keyboard straight away.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [current?.id]);

  async function swipe(reaction: Reaction) {
    if (!current || leaving) return;
    setLeaving(reaction === 'like' ? 'right' : 'left');
    setError(undefined);
    try {
      await onSwipe(current.id, reaction);
      setHistory((h) => [...h, current.id]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLeaving(undefined);
      setDrag(0);
    }
  }

  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    setError(undefined);
    try {
      await onSwipe(last, null);
      setHistory((h) => h.slice(0, -1));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    // Links and buttons on the card still work as taps.
    if ((event.target as HTMLElement).closest('a, button, summary')) return;
    start.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (start.current !== null) setDrag(event.clientX - start.current);
  }
  function onPointerUp() {
    if (start.current === null) return;
    start.current = null;
    if (drag > SWIPE_DISTANCE) void swipe('like');
    else if (drag < -SWIPE_DISTANCE) void swipe('dislike');
    else setDrag(0);
  }

  const done = places.length - left.length;
  const offset = leaving === 'right' ? 600 : leaving === 'left' ? -600 : drag;

  return (
    <section className="stack swipe" aria-label="Swipe through the places">
      {current ? (
        <>
          <p className="muted small center">
            {done + 1} of {places.length} · swipe right to like, left to pass
          </p>
          <article
            ref={card}
            tabIndex={0}
            className="card stack swipe-card"
            style={{ transform: `translateX(${offset}px) rotate(${offset / 20}deg)` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') void swipe('like');
              if (e.key === 'ArrowLeft') void swipe('dislike');
            }}
            aria-label={`${current.name}. Right arrow to like, left arrow to pass.`}
          >
            {drag > 40 && <span className="swipe-stamp like">LIKE</span>}
            {drag < -40 && <span className="swipe-stamp pass">PASS</span>}
            <PlaceDetails place={current} view={view} />
          </article>
          <div className="row swipe-buttons">
            <button className="button swipe-button pass" onClick={() => void swipe('dislike')} aria-label={`Pass on ${current.name}`}>
              ✕
            </button>
            <button className="button link" onClick={() => void undo()} disabled={history.length === 0}>
              Undo
            </button>
            <button className="button swipe-button like" onClick={() => void swipe('like')} aria-label={`Like ${current.name}`}>
              ♥
            </button>
          </div>
        </>
      ) : (
        <div className="card stack center">
          <p>
            <strong>You&apos;ve seen every place.</strong>
          </p>
          <p className="muted small">
            {view.members.length > 1 ? 'Matches appear above as the others swipe.' : 'Everything you liked is above.'}
          </p>
          {history.length > 0 && (
            <button className="button link" onClick={() => void undo()}>
              Undo last swipe
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function PlaceDetails({ place, view }: { place: PlaceCandidate; view: SessionView }) {
  const fromYou = view.suggestions[0]?.distanceFromYou ?? false;
  const details = [
    openLabel(place.openNow),
    `${formatDistance(place.distanceMeters)}${fromYou ? ' from you' : ''}`,
    formatPrice(place.pricePerPerson, place.priceLevel),
    place.rating === undefined ? undefined : `★ ${place.rating.toFixed(1)}`
  ].filter(Boolean);
  const missed = view.missesForYou[place.id];
  const fits = view.suggestions.find((s) => s.place.id === place.id)?.menuNutrition?.fitsYou;
  return (
    <>
      <h3>{place.name}</h3>
      <p className="muted small">
        {details.join(' · ')}
        {place.cuisines.length > 0 && <> · {place.cuisines.join(', ')}</>}
      </p>
      {view.noLongerFits.includes(place.id) && <p className="small misses">Doesn&apos;t fit the changed requirements</p>}
      {missed && <p className="small misses">{describeMisses(missed)}</p>}
      {fits && (
        <p className="small">
          <strong>Fits your nutrition settings:</strong> {fits.name}
        </p>
      )}
      <a className="button" href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
        Directions
      </a>
    </>
  );
}

/**
 * The payoff at the top: places everyone liked ("It's a match!"), or with one
 * person, every place you liked. Before any match, the most-liked so far
 * (counts only, never who).
 */
export function Matches({ view }: { view: SessionView }) {
  const byId = new Map(allPlaces(view).map((p) => [p.id, p]));
  const solo = view.members.length === 1;
  const ids = view.matches;
  if (ids.length > 0) {
    return (
      <section className="card stack matches" aria-label={solo ? 'Places you liked' : 'Matches'}>
        <h2>{solo ? `Places you liked (${ids.length})` : ids.length === 1 ? "🎉 It's a match!" : `🎉 ${ids.length} matches!`}</h2>
        {!solo && <p className="muted small">Everyone liked {ids.length === 1 ? 'this place' : 'these places'}.</p>}
        <ul className="stack tight">
          {ids.map((id) => {
            const place = byId.get(id);
            if (!place) return null;
            return (
              <li key={id} className="row spread nowrap">
                <strong>{place.name}</strong>
                <a href={directionsUrl(place, view.placesSource)} target="_blank" rel="noreferrer">
                  Directions
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  if (solo || view.mostLiked.length === 0) return null;
  return (
    <section className="card stack tight" aria-label="Most liked so far">
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
