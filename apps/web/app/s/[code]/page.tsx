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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

import { normalizeSessionCode } from '../../../components/JoinCodeForm';
import { ConnectionBanner } from '../../../components/ConnectionBanner';
import { MeetingCard, searchedNearText, type MeetingActions } from '../../../components/MeetingCard';
import { MoreOptions } from '../../../components/MoreOptions';
import { NameForm } from '../../../components/NameForm';
import { PreferencesForm } from '../../../components/PreferencesForm';
import { SessionNotFound } from '../../../components/SessionNotFound';
import { SuggestionCard } from '../../../components/SuggestionCard';
import { Icon } from '../../../components/Icon';
import { FinalRoundInvite, Matches, MatchToast, SwipeDeck, YourLikes } from '../../../components/SwipeDeck';
import { forgetActiveSession, rememberActiveSession } from '../../../lib/active-session';
import { SERVER_URL } from '../../../lib/config';
import { describeWishNotMet } from '../../../lib/format';
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

/** Opens once this connection has joined the session; a new, closed one replaces it on every disconnect. */
interface JoinedGate {
  promise: Promise<void>;
  open: () => void;
  isOpen: boolean;
}

function closedGate(): JoinedGate {
  let open!: () => void;
  const gate: JoinedGate = { promise: new Promise<void>((resolve) => (open = resolve)), open: () => {}, isOpen: false };
  gate.open = () => {
    gate.isOpen = true;
    open();
  };
  return gate;
}

/** How long an action waits for a reconnecting phone before saying so. */
const READY_WAIT_MS = 15_000;

function LiveSession({ code, identity }: { code: string; identity: Identity }) {
  const socketRef = useRef<ArbiterSocket | null>(null);
  const joinedRef = useRef<JoinedGate>(closedGate());
  const [view, setView] = useState<SessionView>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [notFound, setNotFound] = useState(false);
  // "Show results now" failures, kept here so the message survives the button moving
  // between the lobby and the searching screen (BUG-031).
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    const socket: ArbiterSocket = io(SERVER_URL, {
      auth: { token: identity.token },
      // Give up on a connection attempt that gets no answer after 5 s and try
      // again, rather than the default 20 s (BUG-015).
      timeout: 5_000,
      reconnectionDelayMax: 3_000
    });
    socketRef.current = socket;
    joinedRef.current = closedGate();

    // Joining on every connect also covers reconnects after a dropped connection.
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('session:join', { sessionId: code }, (ack) => {
        if (ack.ok) {
          joinedRef.current.open();
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
      if (joinedRef.current.isOpen) joinedRef.current = closedGate();
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

  /**
   * The socket, once this phone has joined (or, after a restart or dropped
   * connection, rejoined) the session. Anything sent earlier would reach the
   * server before the rejoin and be refused, so actions wait here (BUG-026).
   */
  async function joinedSocket(): Promise<ArbiterSocket> {
    const s = socket();
    if (!s) throw new Error('Not connected yet. Try again in a moment.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Not connected yet. Try again in a moment.')), READY_WAIT_MS);
    });
    try {
      await Promise.race([joinedRef.current.promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
    return s;
  }
  /** For buttons that show errors at the top of the page. */
  const send = (action: (s: ArbiterSocket) => void) =>
    void joinedSocket().then(action, (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong'));
  const failOn = (ack: Ack) => {
    if (!ack.ok) throw new Error(ack.error);
  };
  const joinFinalRound = async () => failOn(await (await joinedSocket()).emitWithAck('session:final-round'));

  async function submitPreferences(preferences: Preferences) {
    const ack = await (await joinedSocket()).emitWithAck('session:submit', { preferences });
    if (ack.ok) return;
    // The answers were saved; only starting results failed (daily limit, Google
    // down). The form closes on submit, so say it on the page itself (BUG-032).
    if (ack.code === 'quota' || ack.code === 'unavailable') {
      setError(ack.error);
      return;
    }
    throw new Error(ack.error);
  }

  const meetingActions: MeetingActions = {
    setMode: async (mode) => failOn(await (await joinedSocket()).emitWithAck('session:meeting-mode', { mode })),
    setArea: async (area) => failOn(await (await joinedSocket()).emitWithAck('session:area', { area })),
    setOrigin: async (origin) => failOn(await (await joinedSocket()).emitWithAck('session:origin', { origin }))
  };

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
  const resultsIn = view.status === 'voting' || view.status === 'ended';
  const showResultsNow = (
    <ShowResultsNow
      view={view}
      onStart={async () => failOn(await (await joinedSocket()).emitWithAck('session:start'))}
      error={startError}
      setError={setStartError}
    />
  );

  return (
    <>
      <ConnectionBanner connected={connected} />
      {/* Session info sits on top while people join; once results are in it
          moves to the bottom for everyone, out of the way of swiping. */}
      {/* Lobby on desktop: preferences on the left, the session in a sidebar (TRADEOFFS.md 26). */}
      <div className={view.status === 'lobby' ? 'stack lobby-layout' : 'stack'}>
      {!resultsIn && (isHost ? <HostBar sessionId={view.sessionId} /> : <SessionCode sessionId={view.sessionId} />)}
      <HostLeftNotice view={view} isHost={isHost} />
      {view.demo && (
        <p className="demo-notice small" role="note">
          <Icon name="info" size={16} />
          <span>
            <strong>Demo session.</strong> Alex and Sam are simulated friends who swipe on their own. The places are
            samples.
          </span>
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {view.status === 'lobby' && (
        <>
          <SubmissionStatus view={view} myId={identity.guest.id} />
          <MeetingCard view={view} myId={identity.guest.id} token={identity.token} actions={meetingActions} />
          <div className="lobby-prefs">
            {view.meeting.mode === 'between' && !view.meeting.myOrigin ? (
              <p className="notice">
                First, share where you&apos;re coming from. Then you can fill in your preferences.
              </p>
            ) : (
              <MyPreferences token={identity.token} submitted={me?.submitted ?? false} onSubmit={submitPreferences} />
            )}
            {/* Under your answers (the right column on desktop), as a real button (owner, 2026-10-07). */}
            {isHost && showResultsNow}
          </div>
        </>
      )}

      {view.status === 'scanning' && <p className="card">Everyone&apos;s in. Finding places…</p>}

      {/* While searching, only a failed try's message shows (BUG-031). */}
      {isHost && view.status === 'scanning' && showResultsNow}
      </div>

      {(view.status === 'voting' || view.status === 'ended') && (
        <section className="stack results-layout">
          {/* The deck (or list) comes first: it's what everyone is here for. */}

          <FinalRoundInvite view={view} onFinalRound={joinFinalRound} />
          <SwipeOrList
            canSwipe={view.status === 'voting' && view.suggestions.length > 0}
            swipe={
              <SwipeDeck
                view={view}
                onSwipe={async (placeId, reaction) =>
                  failOn(await (await joinedSocket()).emitWithAck('session:react', { placeId, reaction }))
                }
                onMore={async () => failOn(await (await joinedSocket()).emitWithAck('session:more-places'))}
                onFinalRound={joinFinalRound}
                onFinalVote={async (placeId, reaction) =>
                  failOn(await (await joinedSocket()).emitWithAck('session:final-vote', { placeId, reaction }))
                }
              />
            }
            list={
              <>
            {view.suggestions.length === 0 ? (
              <div className="card stack">
                <h2>Nothing fits everyone</h2>
                <p className="muted">The search found no places nearby.</p>
              </div>
            ) : (
              view.suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.place.id}
                  suggestion={suggestion}
                  missed={view.missesForYou[suggestion.place.id]}
                  noLongerFits={view.noLongerFits.includes(suggestion.place.id)}
                  fitsAll={view.fitsAll.includes(suggestion.place.id)}
                  myKinds={view.myKinds}
                  myRuledOut={view.myRuledOut}
                  source={view.placesSource}
                  canReact={view.status === 'voting'}
                  onReact={(reaction: Reaction | null) =>
                    send((s) => s.emit('session:react', { placeId: suggestion.place.id, reaction }, handleAck))
                  }
                  onTag={(tag, on) => send((s) => s.emit('session:tag', { placeId: suggestion.place.id, tag, on }, handleAck))}
                />
              ))
            )}

            {view.status === 'voting' && (
              <MoreOptions
                options={view.moreOptions}
                distanceFromYou={view.suggestions[0]?.distanceFromYou ?? false}
                view={view}
                onLike={async (placeId) =>
                  failOn(await (await joinedSocket()).emitWithAck('session:react', { placeId, reaction: 'like' }))
                }
              />
            )}

            {view.suggestions.length > 0 && (
              <p className="muted small">
                Tap what you know a place has (like high-protein or vegan options). It&apos;s what people in this group say,
                not nutrition advice, and it&apos;s only kept for this session.
              </p>
            )}
              </>
            }
          />

          {/* Below the deck on phones (nothing above the card moves while people swipe); the side panel on desktop. */}
          {view.status === 'voting' && view.suggestions.length > 0 && (
            <>
              <Matches view={view} />
              <MatchToast view={view} />
              {view.members.length > 1 && <YourLikes view={view} />}
            </>
          )}

          {/* Things to act on stay in view; settings-like things fold away (TRADEOFFS.md 23). */}
          <ReorganizedNote sessionId={view.sessionId} reorganized={view.reorganized} />

          {view.status === 'ended' && <SessionEnded token={identity.token} />}

          {me && !me.submitted && (
            <p className="notice small">
              {me.joinedAfterResults
                ? 'Results are already in. Add your preferences and the list will re-sort to include them.'
                : 'Results were shown before you submitted. Add your preferences and the list will re-sort to include them.'}
            </p>
          )}
          {/* Editing your answers is a core feature: always in view, never folded away. */}
          {view.status === 'voting' && me && (
            <MyPreferences token={identity.token} submitted={me.submitted} afterResults onSubmit={submitPreferences} />
          )}

          {view.wishesNotMet.length > 0 && (
            <ul className="notice small wishes" aria-label="Why some of what you wanted isn't here">
              {view.wishesNotMet.map((wish) => (
                <li key={wish.cuisine}>{describeWishNotMet(wish)}</li>
              ))}
            </ul>
          )}

          {view.closestMatches && (
            <p className="notice small" role="note">
              Nothing nearby fits all your preferences, so here are the closest matches.
            </p>
          )}

          {view.allergyReminder && (
            <p className="notice small" role="note">
              Someone in your group has a food allergy. Check with the restaurant before ordering.
            </p>
          )}

          <details className="card session-details">
            <summary>
              <span>Session details</span>
              <span className="muted small">
                {view.members.length} {view.members.length === 1 ? 'person' : 'people'}
                {view.members.length > 1 && ` · ${doneSwiping(view)} done swiping`}
              </span>
            </summary>
            <div className="stack">
              <Members view={view} myId={identity.guest.id} />
              <p className="small">
                <strong>What happens next:</strong>{' '}
                {view.members.length === 1
                  ? 'your likes are kept, and you can go through them again until one is left.'
                  : "when everyone likes the same place it's a match, shown to everyone with directions. No match? Start a final round with the places most of you liked."}
              </p>
              {view.placesSource === 'sample' && !view.demo && (
                <p className="notice small">Sample places for testing. These aren&apos;t real restaurants yet.</p>
              )}
              <p className="muted small">
                {searchedNearText(view)} · Looked at {view.scannedCount} places · {view.eliminatedCount} didn&apos;t work
                for someone in the group
              </p>
              {isHost ? <HostBar sessionId={view.sessionId} atBottom /> : <SessionCode sessionId={view.sessionId} />}
              {isHost && view.status === 'voting' && (
                <button className="button" onClick={() => send((s) => s.emit('session:end', handleAck))}>
                  End session
                </button>
              )}
            </div>
          </details>

          {view.placesSource === 'google' && <p className="muted small center">Place data © Google Maps</p>}
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
    <section className="card stack submission-status" aria-live="polite">
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

/**
 * The host's session code and invite link, pinned to the top of the screen
 * through the whole session, so inviting someone is always one tap away.
 * Only the host sees it.
 */
function HostBar({ sessionId, atBottom = false }: { sessionId: string; atBottom?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/s/${sessionId}`;
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <header className={`host-bar ${atBottom ? 'bottom' : ''}`} aria-label="Invite people to this session">
      <div className="row spread nowrap">
        <div className="stack tight">
          <span className="small muted">Your session</span>
          <h1 className="code">{sessionId}</h1>
        </div>
        <div className="row nowrap">
          <button className="button" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {canShare && (
            <button
              className="button"
              onClick={() => navigator.share({ title: 'Arbiter', text: 'Help pick where we eat', url }).catch(() => {})}
            >
              Share
            </button>
          )}
        </div>
      </div>
      <input className="invite-url small" value={url} readOnly onFocus={(e) => e.target.select()} aria-label="Invite link" />
    </header>
  );
}

/** Everyone, host included, submits preferences here, for this session. */
function MyPreferences({
  token,
  submitted,
  afterResults = false,
  onSubmit
}: {
  token: string;
  submitted: boolean;
  /** Editing after results re-sorts the list for everyone (TRADEOFFS.md 2i). */
  afterResults?: boolean;
  onSubmit: (preferences: Preferences) => Promise<void>;
}) {
  // Last time's answers, to prefill the form. They don't count until submitted here.
  const { preferences, setPreferences, error } = usePreferences(token);
  const [editing, setEditing] = useState(false);

  if (error) return <p className="error">{error}</p>;
  if (preferences === undefined) return null;

  if (submitted && !editing) {
    // After results: one compact line, the explanation in a tooltip (TRADEOFFS.md 23f).
    if (afterResults) {
      return (
        <section className="card row spread nowrap answers-in">
          <p className="small">
            <strong>✓ Your answers are in.</strong>{' '}
            <span className="muted">Changing them re-sorts everyone&apos;s list.</span>
          </p>
          <button className="pill-button" onClick={() => setEditing(true)} aria-label="Change my preferences">
            Change
          </button>
        </section>
      );
    }
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
      <h2 className="prefs-title">Your preferences</h2>
      <p className="muted prefs-lead">
        {preferences ? 'Filled in from last time. Change anything, then submit.' : 'Fill these in for this session.'}
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

/** Host fallback so one person who never submits (or shares a starting point) can't stall the group. */
function ShowResultsNow({
  view,
  onStart,
  error,
  setError
}: {
  view: SessionView;
  onStart: () => Promise<void>;
  error: string | undefined;
  setError: (error: string | undefined) => void;
}) {
  const submitted = view.members.filter((m) => m.submitted).length;
  if (submitted === 0) return null;
  // Only the host sees this, so the host is "you".
  const waitingOn = view.members.filter((m) => !m.submitted).map((m) => (m.id === view.hostId ? 'you' : m.displayName));
  const notShared =
    view.meeting.mode === 'between'
      ? view.members.filter((m) => !view.meeting.sharedIds.includes(m.id)).map((m) => m.displayName)
      : [];

  async function start() {
    setError(undefined);
    try {
      await onStart();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  // While searching, only a message from the last try (if any) shows.
  if (view.status !== 'lobby') return error ? <p className="error center">{error}</p> : null;

  return (
    <section className="stack tight center show-results-now">
      <p className="muted small">
        {waitingOn.length === 1 && waitingOn[0] === 'you'
          ? "Everyone else has submitted. Your must-haves won't count if you go now."
          : waitingOn.length > 0
            ? `Still waiting on ${waitingOn.join(', ')}. Their must-haves won't count if you go now.`
            : 'Everyone here has submitted.'}
        {notShared.length > 0 &&
          ` ${notShared.join(', ')} ${notShared.length === 1 ? "hasn't" : "haven't"} shared where they're coming from, so the meeting spot won't count them.`}
      </p>
      {/* A real button, the main one once everyone's in (owner, 2026-10-07). */}
      <button className={`button ${waitingOn.length === 0 ? 'primary' : ''}`} onClick={start}>
        Show results now
      </button>
      {error && <p className="error">{error}</p>}
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
  // After results: how far along each person is (counts only).
  const resultsIn = view.status === 'voting' || view.status === 'ended';
  const total = view.suggestions.length + view.moreOptions.length;
  return (
    <section className="stack tight">
      <h2 className="small muted">Who&apos;s here</h2>
      <ul className="members">
        {view.members.map((m) => (
          <li key={m.id} className={m.online ? undefined : 'offline'} title={m.online ? undefined : 'Not here right now'}>
            {m.displayName}
            {m.id === myId && ' (you)'}
            {m.id === view.hostId && <span className="badge">host</span>}
            {resultsIn && (
              <span className="muted small">
                {' '}
                · {(m.swiped ?? 0) >= total ? 'done' : `${m.swiped ?? 0} of ${total}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Someone changed their preferences…" after an edit re-sorted the list. Never
 * says who. Closing it hides this edit's note (remembered for the tab), and a
 * later edit shows a new one.
 */
function ReorganizedNote({ sessionId, reorganized }: { sessionId: string; reorganized: SessionView['reorganized'] }) {
  const key = `arbiter.reorganized-seen.${sessionId}`;
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    try {
      setSeen(Number(sessionStorage.getItem(key) ?? 0));
    } catch {
      // Storage blocked: the note just shows until closed.
    }
  }, [key]);
  if (!reorganized || reorganized.count <= seen) return null;
  const close = () => {
    setSeen(reorganized.count);
    try {
      sessionStorage.setItem(key, String(reorganized.count));
    } catch {
      // Storage blocked: closed for now only.
    }
  };
  return (
    <div className="notice small row spread nowrap" role="status">
      <p>
        {reorganized.byYou
          ? reorganized.reason === 'joined'
            ? 'Your preferences are in, so the options have been reorganized.'
            : 'Your changes are in, so the options have been reorganized.'
          : reorganized.reason === 'joined'
            ? 'Someone new added their preferences, so the options have been reorganized.'
            : reorganized.reason === 'added'
              ? 'Someone added their preferences, so the options have been reorganized.'
              : 'Someone changed their preferences, so the options have been reorganized.'}
      </p>
      <button className="button link" onClick={close} aria-label="Close this note">
        OK
      </button>
    </div>
  );
}

/**
 * Swiping is the default way to vote (TRADEOFFS.md 22); the list shows every
 * place side by side, and is all there is once the session has ended.
 */
function SwipeOrList({ canSwipe, swipe, list }: { canSwipe: boolean; swipe: ReactNode; list: ReactNode }) {
  const [asList, setAsList] = useState(false);
  if (!canSwipe) return <div className="results-main stack">{list}</div>;
  return (
    <div className={`results-main stack ${asList ? '' : 'swiping'}`}>
      <div className="segmented view-switch" role="group" aria-label="How to see the places">
        <button type="button" aria-pressed={!asList} onClick={() => setAsList(false)}>
          Swipe
        </button>
        <button type="button" aria-pressed={asList} onClick={() => setAsList(true)}>
          List
        </button>
      </div>
      {asList ? list : swipe}
    </div>
  );
}

/** The session code, for people who joined (the host gets the invite bar instead). */
function SessionCode({ sessionId }: { sessionId: string }) {
  return (
    <header className="stack tight">
      <p className="muted small">Session</p>
      <h1 className="code">{sessionId}</h1>
    </header>
  );
}

/** How many members have swiped on every place. */
function doneSwiping(view: SessionView): number {
  const total = view.suggestions.length + view.moreOptions.length;
  return view.members.filter((m) => (m.swiped ?? 0) >= total).length;
}

