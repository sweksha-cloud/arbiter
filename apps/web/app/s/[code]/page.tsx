'use client';

import {
  newerView,
  type Ack,
  type ClientToServerEvents,
  type Preferences,
  type Reaction,
  type ServerToClientEvents,
  type SessionView
} from '@arbiter/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { normalizeSessionCode } from '../../../components/JoinCodeForm';
import { ConnectionBanner } from '../../../components/ConnectionBanner';
import { NameForm } from '../../../components/NameForm';
import { PreferencesForm } from '../../../components/PreferencesForm';
import { SessionNotFound } from '../../../components/SessionNotFound';
import { SuggestionCard } from '../../../components/SuggestionCard';
import { forgetActiveSession, rememberActiveSession } from '../../../lib/active-session';
import { SERVER_URL } from '../../../lib/config';
import { clearIdentity, useIdentity, type Identity } from '../../../lib/identity';
import { useDelayedFlag } from '../../../lib/use-delayed-flag';
import { usePreferences } from '../../../lib/use-preferences';
import { useStartSession } from '../../../lib/use-start-session';

type ArbiterSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export default function SessionPage() {
  const code = normalizeSessionCode(useParams<{ code: string }>().code);
  const identity = useIdentity();

  return (
    <main className="page stack">
      <p>
        <Link href="/">← Home</Link>
      </p>
      {identity === null && <NameForm intro="You've been invited to pick a place to eat." />}
      {identity && <LiveSession code={code} identity={identity} />}
    </main>
  );
}

function LiveSession({ code, identity }: { code: string; identity: Identity }) {
  const socketRef = useRef<ArbiterSocket | null>(null);
  const [view, setView] = useState<SessionView>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const socket: ArbiterSocket = io(SERVER_URL, {
      auth: { token: identity.token },
      // Give up on a connection attempt that gets no answer after 5 s and try
      // again, rather than the default 20 s (BUG-015).
      timeout: 5_000,
      reconnectionDelayMax: 3_000
    });
    socketRef.current = socket;

    // Joining on every connect also covers reconnects after a dropped connection.
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('session:join', { sessionId: code }, (ack) => {
        if (ack.ok) {
          setNotFound(false);
          rememberActiveSession(code);
        } else if (ack.code === 'not_found') {
          setNotFound(true);
          forgetActiveSession(code);
        } else setError(ack.error);
      });
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      // Socket.IO only retries on its own after network drops. When the server
      // closes the connection itself (a restart or deploy), reconnect manually.
      if (reason === 'io server disconnect') socket.connect();
    });
    // Other connection failures show the connection banner and retry on their own.
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') clearIdentity();
    });
    socket.on('session:state', (next) => {
      setView((current) => newerView(current, next));
      setError(undefined);
      if (next.status === 'ended') forgetActiveSession(next.sessionId);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, identity.token]);

  const handleAck = (ack: Ack) => {
    if (!ack.ok) setError(ack.error);
  };
  const socket = () => socketRef.current;

  async function submitPreferences(preferences: Preferences) {
    const s = socket();
    if (!s) throw new Error('Not connected yet. Try again in a moment.');
    const ack = await s.emitWithAck('session:submit', { preferences });
    if (!ack.ok) throw new Error(ack.error);
  }

  // Also covers a session that vanished while open (e.g. the server restarted).
  if (notFound) return <SessionNotFound code={code} token={identity.token} />;

  if (!view) {
    return (
      <>
        <ConnectionBanner connected={connected} />
        {error ? <p className="error">{error}</p> : <p className="muted">Joining session {code}…</p>}
      </>
    );
  }

  const isHost = view.hostId === identity.guest.id;
  const me = view.members.find((m) => m.id === identity.guest.id);

  return (
    <>
      <ConnectionBanner connected={connected} />
      <HostLeftNotice view={view} isHost={isHost} />
      <header className="stack tight">
        <p className="muted small">Session</p>
        <h1 className="code">{view.sessionId}</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {view.status === 'lobby' && (
        <>
          <SubmissionStatus view={view} myId={identity.guest.id} />
          <InviteCard sessionId={view.sessionId} />
          <MyPreferences token={identity.token} submitted={me?.submitted ?? false} onSubmit={submitPreferences} />
          {isHost && <ShowResultsNow view={view} onStart={() => socket()?.emit('session:start', handleAck)} />}
        </>
      )}

      {view.status === 'scanning' && <p className="card">Everyone&apos;s in. Finding places…</p>}

      {(view.status === 'voting' || view.status === 'ended') && (
        <section className="stack">
          {view.placesSource === 'sample' && (
            <p className="notice small">Sample places for testing. These aren&apos;t real restaurants yet.</p>
          )}
          <p className="muted small">
            Looked at {view.scannedCount} places · {view.eliminatedCount} didn&apos;t work for someone in the group
          </p>

          {view.status === 'ended' && <SessionEnded token={identity.token} />}

          {view.allergyReminder && (
            <p className="notice small" role="note">
              Someone in your group has a food allergy. Check with the restaurant before ordering.
            </p>
          )}

          {view.suggestions.length === 0 ? (
            <div className="card stack">
              <h2>Nothing fits everyone</h2>
              <p className="muted">No nearby place meets every must-have in the group.</p>
            </div>
          ) : (
            view.suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.place.id}
                suggestion={suggestion}
                source={view.placesSource}
                canReact={view.status === 'voting'}
                onReact={(reaction: Reaction | null) =>
                  socket()?.emit('session:react', { placeId: suggestion.place.id, reaction }, handleAck)
                }
                onTag={(tag, on) => socket()?.emit('session:tag', { placeId: suggestion.place.id, tag, on }, handleAck)}
              />
            ))
          )}

          {view.suggestions.length > 0 && (
            <p className="muted small">
              Tap what you know a place has (like high-protein or vegan options). It&apos;s what people in this group say,
              not nutrition advice, and it&apos;s only kept for this session.
            </p>
          )}

          {view.placesSource === 'google' && <p className="muted small center">Place data © Google Maps</p>}

          {isHost && view.status === 'voting' && (
            <button className="button" onClick={() => socket()?.emit('session:end', handleAck)}>
              End session
            </button>
          )}

          <Members view={view} myId={identity.guest.id} />
        </section>
      )}
    </>
  );
}

/** "1 of 2 submitted" with a bar, and who is still choosing. Never shows what anyone chose. */
function SubmissionStatus({ view, myId }: { view: SessionView; myId: string }) {
  const submitted = view.members.filter((m) => m.submitted).length;
  const total = view.members.length;
  const alone = total < 2;

  return (
    <section className="card stack" aria-live="polite">
      <div className="row spread">
        <strong>
          {submitted} of {total} submitted
        </strong>
        <span className="muted small">{alone ? 'Waiting for friends to join' : 'Results appear when everyone submits'}</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Preferences submitted"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={submitted}
        aria-valuetext={`${submitted} of ${total} submitted`}
      >
        <div className="progress-fill" style={{ width: `${total === 0 ? 0 : (submitted / total) * 100}%` }} />
      </div>
      <ul className="members">
        {view.members.map((m) => (
          <li key={m.id} className={m.online ? undefined : 'offline'} title={m.online ? undefined : 'Not here right now'}>
            {m.displayName}
            {m.id === myId && ' (you)'}
            {m.id === view.hostId && <span className="badge">host</span>}
            <span className={`badge ${m.submitted ? 'ready' : 'waiting'}`}>{m.submitted ? '✓' : 'choosing…'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteCard({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/s/${sessionId}`;
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card stack">
      <h2>Invite your friends</h2>
      <p className="muted small">Send them this link, or have them enter the code on the home page.</p>
      <input className="invite-url" value={url} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
      <div className="row">
        <button className="button grow" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        {canShare && (
          <button
            className="button grow"
            onClick={() => navigator.share({ title: 'Arbiter', text: 'Help pick where we eat', url }).catch(() => {})}
          >
            Share
          </button>
        )}
      </div>
    </section>
  );
}

/** Everyone, host included, submits preferences here, for this session. */
function MyPreferences({
  token,
  submitted,
  onSubmit
}: {
  token: string;
  submitted: boolean;
  onSubmit: (preferences: Preferences) => Promise<void>;
}) {
  // Last time's answers, to prefill the form. They don't count until submitted here.
  const { preferences, setPreferences, error } = usePreferences(token);
  const [editing, setEditing] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (preferences === undefined) return null;

  if (submitted && !editing) {
    return (
      <section className="card row spread">
        <p>
          <strong>✓ Submitted.</strong> <span className="muted small">Nobody else can see your answers.</span>
        </p>
        <button className="button" onClick={() => setEditing(true)}>
          Change
        </button>
      </section>
    );
  }

  return (
    <section className="stack">
      <h2>Your preferences</h2>
      <p className="muted small">
        {preferences ? 'Filled in from last time. Change anything, then submit.' : 'Private to you. Nobody sees your answers.'}
      </p>
      <PreferencesForm
        initial={preferences}
        submitLabel={submitted ? 'Update' : 'Submit'}
        onSubmit={async (p) => {
          await onSubmit(p);
          setPreferences(p);
          setEditing(false);
        }}
      />
    </section>
  );
}

/** Host fallback so one person who never submits can't stall the group. */
function ShowResultsNow({ view, onStart }: { view: SessionView; onStart: () => void }) {
  const submitted = view.members.filter((m) => m.submitted).length;
  if (submitted === 0) return null;
  const waitingOn = view.members.filter((m) => !m.submitted).map((m) => m.displayName);

  return (
    <section className="stack tight center">
      <p className="muted small">
        {waitingOn.length > 0
          ? `Still waiting on ${waitingOn.join(', ')}. Their must-haves won't count if you go now.`
          : 'Everyone here has submitted.'}
      </p>
      <button className="button link" onClick={onStart}>
        Show results now
      </button>
    </section>
  );
}

/** Gently tells everyone else when the host has closed the session and hasn't come back. */
function HostLeftNotice({ view, isHost }: { view: SessionView; isHost: boolean }) {
  const host = view.members.find((m) => m.id === view.hostId);
  const hostGone = !isHost && view.status !== 'ended' && host !== undefined && !host.online;
  // A few seconds' grace so a quick reload doesn't look like leaving.
  const show = useDelayedFlag(hostGone, 5000);
  if (!show || !host) return null;
  return (
    <p className="notice small" role="status">
      {host.displayName} (the host) has left the session for now. You can keep going; they can rejoin anytime.
    </p>
  );
}

function SessionEnded({ token }: { token: string }) {
  const { start, busy, error } = useStartSession(token);
  return (
    <section className="notice stack">
      <p>This session has ended. The results stay here for you to look at.</p>
      <button className="button primary" onClick={start} disabled={busy}>
        {busy ? 'Starting…' : 'Start a new session'}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Members({ view, myId }: { view: SessionView; myId: string }) {
  return (
    <section className="stack tight">
      <h2 className="small muted">Who&apos;s here</h2>
      <ul className="members">
        {view.members.map((m) => (
          <li key={m.id} className={m.online ? undefined : 'offline'} title={m.online ? undefined : 'Not here right now'}>
            {m.displayName}
            {m.id === myId && ' (you)'}
            {m.id === view.hostId && <span className="badge">host</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
