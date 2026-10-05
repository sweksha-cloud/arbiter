/**
 * Load test: many friend groups using Arbiter at once. Each simulated person
 * becomes a guest, the host sets up a session, everyone joins over Socket.IO
 * and submits, results appear, then everyone keeps voting at random.
 *
 * Measures, per vote:
 * - ack: how long until the server confirms it;
 * - seen by everyone: how long until every member of the group has received
 *   the updated session (what people actually experience).
 *
 * Point it at a server started with RATE_LIMITS=off and sample places, never
 * at production (it would use up Google searches and fill the database):
 *   pnpm --filter @arbiter/server load-test --url http://localhost:4500 --groups 50
 */
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

import type { Ack, ClientToServerEvents, ServerToClientEvents, SessionView } from '@arbiter/shared';
import { io, type Socket } from 'socket.io-client';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4500' },
    groups: { type: 'string', default: '10' },
    size: { type: 'string', default: '4' },
    seconds: { type: 'string', default: '60' },
    /** Each person votes about this often (randomised ±50%). */
    'vote-every-ms': { type: 'string', default: '2000' },
    verbose: { type: 'boolean', default: false }
  }
});
const URL = values.url!;
const GROUPS = Number(values.groups);
const SIZE = Number(values.size);
const SECONDS = Number(values.seconds);
const VOTE_EVERY_MS = Number(values['vote-every-ms']);

interface Member {
  token: string;
  socket: Client;
  /** When each session version first arrived at this person. */
  seen: Map<number, number>;
  view?: SessionView;
}

interface Vote {
  group: number;
  sentAt: number;
  ackMs?: number;
  /** The version this vote produced (the first new one the voter saw after sending). */
  version?: number;
  failed?: string;
}

const votes: Vote[] = [];
const setupMs: number[] = [];
const errors: string[] = [];

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

function connect(token: string): Promise<Member> {
  return new Promise((resolve, reject) => {
    const socket: Client = io(URL, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const member: Member = { token, socket, seen: new Map() };
    socket.on('session:state', (view) => {
      if (!member.seen.has(view.version)) member.seen.set(view.version, performance.now());
      if (!member.view || view.version > member.view.version) member.view = view;
    });
    socket.once('connect', () => resolve(member));
    socket.once('connect_error', reject);
  });
}

const emit = <E extends keyof ClientToServerEvents>(socket: Client, event: E, ...args: unknown[]) =>
  new Promise<Ack>((resolve) => (socket.emit as (...a: unknown[]) => void)(event, ...args, resolve));

function waitFor(member: Member, predicate: (view: SessionView) => boolean, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (member.view && predicate(member.view)) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for the session'));
      setTimeout(check, 20);
    };
    check();
  });
}

/** One group from first guest to results. Returns its members, ready to vote. */
async function setUpGroup(index: number): Promise<Member[]> {
  const started = performance.now();
  // With --verbose, the first group reports how long each step took.
  const step = (label: string) => {
    if (values.verbose && index === 0) console.log(`  group 0: ${label} at ${(performance.now() - started).toFixed(0)} ms`);
  };
  const guests = await Promise.all(
    Array.from({ length: SIZE }, (_, i) => post<{ token: string }>('/api/guests', { displayName: `Load ${index}-${i}` }))
  );
  step('guests created');
  const { sessionId } = await post<{ sessionId: string }>(
    '/api/sessions',
    { meeting: { mode: 'area', area: { center: { lat: 37.3352, lng: -121.8811 }, label: 'San Jose' } } },
    guests[0]!.token
  );
  step('session created');
  const members = await Promise.all(guests.map((g) => connect(g.token)));
  step('sockets connected');
  for (const member of members) {
    const ack = await emit(member.socket, 'session:join', { sessionId });
    if (!ack.ok) throw new Error(`join: ${ack.error}`);
  }
  step('everyone joined');
  await Promise.all(
    members.map(async (member) => {
      const ack = await emit(member.socket, 'session:submit', { preferences: { hard: {}, soft: {} } });
      if (!ack.ok) throw new Error(`submit: ${ack.error}`);
    })
  );
  step('everyone submitted');
  await Promise.all(members.map((m) => waitFor(m, (v) => v.status === 'voting' && v.suggestions.length > 0)));
  step('results on every phone');
  setupMs.push(performance.now() - started);
  return members;
}

async function vote(group: number, member: Member, until: number) {
  while (performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, VOTE_EVERY_MS * (0.5 + Math.random())));
    if (performance.now() >= until) break;
    const suggestions = member.view?.suggestions ?? [];
    const pick = suggestions[Math.floor(Math.random() * suggestions.length)];
    if (!pick) continue;
    const reaction = pick.myReaction === 'like' ? 'dislike' : 'like';
    const before = member.view!.version;
    const record: Vote = { group, sentAt: performance.now() };
    votes.push(record);
    const ack = await emit(member.socket, 'session:react', { placeId: pick.place.id, reaction });
    record.ackMs = performance.now() - record.sentAt;
    if (!ack.ok) {
      record.failed = ack.error;
      continue;
    }
    // The server broadcasts before it acknowledges, so the new version is here or arriving.
    await waitFor(member, (v) => v.version > before, 10_000).catch(() => undefined);
    record.version = [...member.seen.keys()].filter((v) => v > before).sort((a, b) => a - b)[0];
  }
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
const summary = (label: string, samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const ms = (n: number) => `${n.toFixed(0)} ms`;
  console.log(
    `${label.padEnd(26)} n=${String(sorted.length).padEnd(6)} p50 ${ms(percentile(sorted, 50))}  p95 ${ms(percentile(sorted, 95))}  p99 ${ms(percentile(sorted, 99))}  max ${ms(sorted.at(-1) ?? NaN)}`
  );
};

async function main() {
  console.log(`${GROUPS} groups × ${SIZE} people = ${GROUPS * SIZE} connections, voting every ~${VOTE_EVERY_MS} ms for ${SECONDS} s, against ${URL}`);
  // Groups arrive over a few seconds, not all in the same millisecond.
  const groups = await Promise.all(
    Array.from({ length: GROUPS }, (_, i) =>
      new Promise<void>((resolve) => setTimeout(resolve, (i * 3000) / GROUPS)).then(() =>
        setUpGroup(i).catch((error: unknown) => {
          errors.push(`setup ${i}: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        })
      )
    )
  );
  const ready = groups.filter((g): g is Member[] => g !== undefined);
  console.log(`${ready.length} of ${GROUPS} groups reached results`);

  const started = performance.now();
  const until = started + SECONDS * 1000;
  await Promise.all(ready.flatMap((members, g) => members.map((m) => vote(g, m, until))));
  const elapsed = (performance.now() - started) / 1000;
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Let the last updates land.

  const everyone: number[] = [];
  for (const record of votes) {
    if (record.failed || record.version === undefined) continue;
    const arrivals = ready[record.group]!.map((m) =>
      Math.min(...[...m.seen.entries()].filter(([v]) => v >= record.version!).map(([, t]) => t))
    );
    const last = Math.max(...arrivals);
    if (Number.isFinite(last)) everyone.push(last - record.sentAt);
  }
  const failed = votes.filter((v) => v.failed);

  console.log('');
  summary('Group setup (join→results)', setupMs);
  summary('Vote acknowledged', votes.filter((v) => v.ackMs !== undefined && !v.failed).map((v) => v.ackMs!));
  summary('Vote seen by whole group', everyone);
  console.log(`Votes: ${votes.length} in ${elapsed.toFixed(0)} s (${(votes.length / elapsed).toFixed(1)}/s), failed ${failed.length}`);
  if (failed.length) console.log(`  e.g. ${failed[0]!.failed}`);
  if (errors.length) console.log(`Setup errors: ${errors.length}, e.g. ${errors[0]}`);

  for (const members of ready) for (const m of members) m.socket.disconnect();
}

await main();
