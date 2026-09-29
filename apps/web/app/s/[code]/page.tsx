'use client';

import {
  newerView,
  type Ack,
  type ClientToServerEvents,
  type Reaction,
  type ServerToClientEvents,
  type SessionView
} from '@arbiter/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { NameForm } from '../../../components/NameForm';
import { PreferencesForm } from '../../../components/PreferencesForm';
import { SuggestionCard } from '../../../components/SuggestionCard';
import { SERVER_URL } from '../../../lib/config';
import { clearIdentity, useIdentity, type Identity } from '../../../lib/identity';
import { usePreferences } from '../../../lib/use-preferences';

type ArbiterSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export default function SessionPage() {
  const { code } = useParams<{ code: string }>();
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

  useEffect(() => {
    const socket: ArbiterSocket = io(SERVER_URL, { auth: { token: identity.token } });
    socketRef.current = socket;

    // Joining on every connect also covers reconnects after a dropped connection.
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('session:join', { sessionId: code }, (ack) => {
        if (!ack.ok) setError(ack.error);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') clearIdentity();
      else setError("Can't reach the Arbiter server. Retrying…");
    });
    socket.on('session:state', (next) => {
      setView((current) => newerView(current, next));
      setError(undefined);
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

  if (!view) {
    return error ? <p className="error">{error}</p> : <p className="muted">Joining session {code}…</p>;
  }

  const isHost = view.hostId === identity.guest.id;
  const host = view.members.find((m) => m.id === view.hostId);

  return (
    <>
      <header className="stack tight">
        <p className="muted small">Session</p>
        <h1 className="code">{view.sessionId}</h1>
        {!connected && <p className="warning small">Reconnecting…</p>}
      </header>

      <Members view={view} myId={identity.guest.id} />

      {error && <p className="error">{error}</p>}

      {view.status === 'lobby' && (
        <>
          <InviteCard sessionId={view.sessionId} />
          <MyPreferences
            token={identity.token}
            ready={view.members.find((m) => m.id === identity.guest.id)?.ready ?? false}
            onSaved={() => socket()?.emit('session:ready', handleAck)}
          />
          <StartControls
            view={view}
            isHost={isHost}
            hostName={host?.displayName}
            onStart={() => socket()?.emit('session:start', handleAck)}
          />
        </>
      )}

      {view.status === 'scanning' && <p className="card">Finding places near you…</p>}

      {(view.status === 'voting' || view.status === 'ended') && (
        <section className="stack">
          {view.placesSource === 'sample' && (
            <p className="notice small">Sample places for testing. These aren&apos;t real restaurants yet.</p>
          )}
          <p className="muted small">
            Looked at {view.scannedCount} places · {view.eliminatedCount} didn&apos;t work for someone in the group
          </p>

          {view.status === 'ended' && <p className="notice">This session has ended.</p>}

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
              />
            ))
          )}

          {view.placesSource === 'google' && <p className="muted small center">Place data © Google Maps</p>}

          {isHost && view.status === 'voting' && (
            <button className="button" onClick={() => socket()?.emit('session:end', handleAck)}>
              End session
            </button>
          )}
        </section>
      )}
    </>
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
      <div className="row">
        <input className="invite-url" value={url} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
      </div>
      <div className="row">
        <button className="button primary grow" onClick={copy}>
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

/** Everyone, host included, sets preferences here while the group gathers. */
function MyPreferences({ token, ready, onSaved }: { token: string; ready: boolean; onSaved: () => void }) {
  const { preferences, setPreferences, error } = usePreferences(token);
  const [editing, setEditing] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (preferences === undefined) return null;

  if (ready && !editing) {
    return (
      <section className="card row spread">
        <p>
          <strong>✓ You&apos;re ready.</strong> <span className="muted small">Nobody else can see your answers.</span>
        </p>
        <button className="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </section>
    );
  }

  return (
    <section className="stack">
      <h2>Your preferences</h2>
      <p className="muted small">
        {preferences ? 'Here’s what you picked last time. Change anything, then tap below.' : 'Private to you. Saved for next time.'}
      </p>
      <PreferencesForm
        token={token}
        initial={preferences}
        submitLabel={ready ? 'Save changes' : "I'm ready"}
        onSaved={(saved) => {
          setPreferences(saved);
          setEditing(false);
          onSaved();
        }}
      />
    </section>
  );
}

function StartControls({
  view,
  isHost,
  hostName,
  onStart
}: {
  view: SessionView;
  isHost: boolean;
  hostName: string | undefined;
  onStart: () => void;
}) {
  const readyCount = view.members.filter((m) => m.ready).length;
  const total = view.members.length;
  const allReady = readyCount === total;

  if (!isHost) {
    return <p className="muted center">Waiting for {hostName ?? 'the host'} to find places…</p>;
  }
  return (
    <section className="card stack">
      <p className="muted small">
        {readyCount} of {total} ready
        {!allReady && '. Anyone not ready yet won’t have their must-haves counted.'}
      </p>
      <button className={`button ${allReady ? 'primary' : ''}`} onClick={onStart}>
        {allReady ? 'Find places' : 'Find places anyway'}
      </button>
    </section>
  );
}

function Members({ view, myId }: { view: SessionView; myId: string }) {
  return (
    <section className="stack tight">
      <h2 className="small muted">Who&apos;s here</h2>
      <ul className="members">
        {view.members.map((m) => (
          <li key={m.id}>
            {m.displayName}
            {m.id === myId && ' (you)'}
            {m.id === view.hostId && <span className="badge">host</span>}
            {view.status === 'lobby' && (
              <span className={`badge ${m.ready ? 'ready' : 'waiting'}`}>{m.ready ? '✓ ready' : 'choosing…'}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
