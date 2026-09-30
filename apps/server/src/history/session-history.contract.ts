import { randomUUID } from 'node:crypto';

import type { Guest } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import { SessionCodeTakenError, type SessionHistory } from './session-history.js';

export interface HistoryTestContext {
  history: SessionHistory;
  /** A guest that exists wherever this history keeps its users. */
  newGuest(name: string): Promise<Guest>;
}

// Unique per run, so tests sharing one database never collide.
const newCode = () => randomUUID().slice(0, 8).toUpperCase();

/** Behavior every SessionHistory must have. Run against each implementation. */
export function describeSessionHistory(name: string, makeContext: () => HistoryTestContext) {
  describe(`${name} (SessionHistory contract)`, () => {
    async function sessionWithTwo(source: 'sample' | 'google' = 'google') {
      const ctx = makeContext();
      const host = await ctx.newGuest('Host');
      const friend = await ctx.newGuest('Friend');
      const code = newCode();
      await ctx.history.create(code, host, source);
      await ctx.history.addMember(code, friend);
      return { ...ctx, host, friend, code };
    }

    it('records a new session as open, with the host as its first member', async () => {
      const ctx = makeContext();
      const host = await ctx.newGuest('Host');
      const code = newCode();
      await ctx.history.create(code, host, 'google');

      const record = await ctx.history.get(code);
      expect(record).toMatchObject({ sessionId: code, hostId: host.id, status: 'open', endedAt: null, places: [] });
      expect(record!.members).toEqual([host]);
      expect(record!.createdAt).toBeInstanceOf(Date);
    });

    it('never gives out the same code twice, even after the session ended', async () => {
      const { history, host, code } = await sessionWithTwo();
      await history.end(code);
      await expect(history.create(code, host, 'google')).rejects.toBeInstanceOf(SessionCodeTakenError);
    });

    it('returns nothing for a code that was never used', async () => {
      expect(await makeContext().history.get(newCode())).toBeUndefined();
    });

    it('lists members in the order they joined, once each', async () => {
      const { history, host, friend, code } = await sessionWithTwo();
      await history.addMember(code, friend);
      await history.addMember(code, host);
      expect((await history.get(code))!.members).toEqual([host, friend]);
    });

    it('keeps suggested places in ranked order with Maps links', async () => {
      const { history, code } = await sessionWithTwo();
      await history.recordSuggestions(code, ['p2', 'p1', 'p3']);
      const { places } = (await history.get(code))!;
      expect(places.map((p) => [p.placeId, p.rank])).toEqual([
        ['p2', 0],
        ['p1', 1],
        ['p3', 2]
      ]);
      expect(places[0]!.mapsUrl).toContain('query_place_id=p2');
    });

    it('gives sample places no Maps link, since their IDs are made up', async () => {
      const { history, code } = await sessionWithTwo('sample');
      await history.recordSuggestions(code, ['sample-1']);
      expect((await history.get(code))!.places[0]!.mapsUrl).toBeNull();
    });

    it('keeps the first set of suggestions if recorded twice', async () => {
      const { history, code } = await sessionWithTwo();
      await history.recordSuggestions(code, ['a', 'b']);
      await history.recordSuggestions(code, ['c']);
      expect((await history.get(code))!.places.map((p) => p.placeId)).toEqual(['a', 'b']);
    });

    it('totals reactions per place, and a changed or cleared reaction counts once', async () => {
      const { history, host, friend, code } = await sessionWithTwo();
      await history.recordSuggestions(code, ['a', 'b']);
      await history.recordReaction(code, host.id, 'a', 'like', 1);
      await history.recordReaction(code, friend.id, 'a', 'like', 2);
      await history.recordReaction(code, friend.id, 'a', 'dislike', 3);
      await history.recordReaction(code, host.id, 'b', 'dislike', 4);
      await history.recordReaction(code, host.id, 'b', null, 5);

      const { places } = (await history.get(code))!;
      expect(places.map(({ placeId, likes, dislikes }) => ({ placeId, likes, dislikes }))).toEqual([
        { placeId: 'a', likes: 1, dislikes: 1 },
        { placeId: 'b', likes: 0, dislikes: 0 }
      ]);
    });

    it('ignores a reaction that arrives after a newer one', async () => {
      const { history, host, code } = await sessionWithTwo();
      await history.recordSuggestions(code, ['a']);
      await history.recordReaction(code, host.id, 'a', 'dislike', 7);
      await history.recordReaction(code, host.id, 'a', 'like', 6); // Older write landing late.
      expect((await history.get(code))!.places[0]).toMatchObject({ likes: 0, dislikes: 1 });
    });

    it('refuses reactions from non-members or to places that were not suggested', async () => {
      const { history, newGuest, host, code } = await sessionWithTwo();
      await history.recordSuggestions(code, ['a']);
      const stranger = await newGuest('Stranger');
      await expect(history.recordReaction(code, stranger.id, 'a', 'like', 1)).rejects.toThrow();
      await expect(history.recordReaction(code, host.id, 'not-suggested', 'like', 1)).rejects.toThrow();
    });

    it('marks a session ended once, keeping the first end time', async () => {
      const { history, code } = await sessionWithTwo();
      await history.end(code);
      const first = (await history.get(code))!;
      expect(first.status).toBe('ended');
      expect(first.endedAt).toBeInstanceOf(Date);

      await history.end(code);
      expect((await history.get(code))!.endedAt).toEqual(first.endedAt);
    });

    it("lists a member's sessions, newest first, and nobody else's", async () => {
      const ctx = makeContext();
      const me = await ctx.newGuest('Me');
      const other = await ctx.newGuest('Other');
      const [first, second, notMine] = [newCode(), newCode(), newCode()];
      await ctx.history.create(first, me, 'google');
      await new Promise((r) => setTimeout(r, 5));
      await ctx.history.create(second, other, 'google');
      await ctx.history.addMember(second, me);
      await ctx.history.create(notMine, other, 'google');

      const mine = await ctx.history.listForMember(me.id, 10);
      expect(mine.map((r) => r.sessionId)).toEqual([second, first]);
      expect(mine[0]!.members).toEqual([other, me]);
      expect(await ctx.history.listForMember(me.id, 1)).toHaveLength(1);
    });
  });
}
