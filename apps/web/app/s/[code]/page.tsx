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
  const { preferences, setPreferences, error: preferencesError } = usePreferences(identity?.token);

  return (
    <main className="page stack">
      <p>
        <Link href="/">← Home</Link>
      </p>
      {identity === null && <NameForm intro="You've been invited to pick a place to eat." />}
      {preferencesError && <p className="error">{preferencesError}</p>}
      {identity && preferences === null && (
        <>
          <h1>Before you join</h1>
          <p className="muted">Set your preferences once. They&apos;re private and apply to every session.</p>
          <PreferencesForm
            token={identity.token}
            initial={null}
            submitLabel="Save and join"
            onSaved={setPreferences}
          />
        </>
      )}
      {identity && preferences && <LiveSession code={code} identity={identity} />}
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

      {error && <p className="error">{error}</p>}

      {view.status === 'lobby' && (
        <Lobby view={view} isHost={isHost} hostName={host?.displayName} onStart={() => socket()?.emit('session:start', handleAck)} />
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

      <Members view={view} myId={identity.guest.id} />
    </>
  );
}

function Lobby({
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
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: 'Arbiter', text: 'Help pick where we eat', url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <section className="card stack">
      <p>Invite friends with this code or link. Everyone sets their must-haves once, then the host finds places.</p>
      <button className="button" onClick={share}>
        {copied ? 'Link copied' : 'Share invite link'}
      </button>
      {isHost ? (
        <button className="button primary" onClick={onStart}>
          Find places ({view.members.length} {view.members.length === 1 ? 'person' : 'people'})
        </button>
      ) : (
        <p className="muted">Waiting for {hostName ?? 'the host'} to find places…</p>
      )}
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
          </li>
        ))}
      </ul>
    </section>
  );
}
