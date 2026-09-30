import type { PastSession } from '@arbiter/shared';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One past session. Google's terms don't let us keep place names, so each
 * place is a Google Maps link built from its stored ID (TRADEOFFS.md 4b).
 */
export function PastSessionCard({ session, headingLevel = 2 }: { session: PastSession; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <article className="card stack past-session">
      <div className="row spread">
        <Heading>
          Session <span className="code">{session.sessionId}</span>
        </Heading>
        <time className="muted small" dateTime={session.createdAt}>
          {dateFormat.format(new Date(session.createdAt))}
        </time>
      </div>
      <p className="small">
        <span className="muted">Who came: </span>
        {session.members.map((m) => m.displayName).join(', ')}
      </p>
      {session.places.length === 0 ? (
        <p className="muted small">No suggestions were made in this session.</p>
      ) : (
        <ol className="stack tight">
          {session.places.map((place, index) => (
            <li key={place.placeId}>
              {place.mapsUrl ? (
                <a href={place.mapsUrl} target="_blank" rel="noreferrer">
                  Suggestion {index + 1} on Google Maps
                </a>
              ) : (
                <span>Suggestion {index + 1} (sample place)</span>
              )}{' '}
              <span className="muted small">
                👍 {place.likes} · 👎 {place.dislikes}
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
