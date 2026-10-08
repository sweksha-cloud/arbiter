import type { Guest, Reaction } from '@arbiter/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { reactions, sessionMembers, sessionPlaces, sessions, users } from '../db/schema.js';
import {
  mapsUrlFor,
  SessionCodeTakenError,
  type PlacesSource,
  type SessionHistory,
  type SessionRecord
} from './session-history.js';

/**
 * The reaction write, prepared once: every vote makes one, and building it
 * with Drizzle each time was over a fifth of the server's CPU under load
 * (TRADEOFFS.md 31). Values are placeholders; the conflict update reads the
 * new row (`excluded`), and an older write arriving late never wins.
 */
function prepareRecordReaction(db: Db) {
  return db
    .insert(reactions)
    .values({
      sessionId: sql.placeholder('sessionId'),
      userId: sql.placeholder('memberId'),
      placeId: sql.placeholder('placeId'),
      reaction: sql.placeholder('reaction'),
      roomVersion: sql.placeholder('version')
    })
    .onConflictDoUpdate({
      target: [reactions.sessionId, reactions.userId, reactions.placeId],
      set: { reaction: sql`excluded.reaction`, roomVersion: sql`excluded.room_version`, updatedAt: sql`now()` },
      setWhere: sql`${reactions.roomVersion} < excluded.room_version`
    })
    .prepare('record_reaction');
}

export class PostgresSessionHistory implements SessionHistory {
  private readonly recordReactionStatement: ReturnType<typeof prepareRecordReaction>;

  constructor(private readonly db: Db) {
    this.recordReactionStatement = prepareRecordReaction(db);
  }

  async create(sessionId: string, host: Guest, placesSource: PlacesSource) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(sessions).values({ id: sessionId, hostId: host.id, placesSource });
        await tx.insert(sessionMembers).values({ sessionId, userId: host.id });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SessionCodeTakenError(sessionId);
      throw error;
    }
  }

  async addMember(sessionId: string, member: Guest) {
    await this.db.insert(sessionMembers).values({ sessionId, userId: member.id }).onConflictDoNothing();
  }

  async recordSuggestions(sessionId: string, placeIds: readonly string[]) {
    if (placeIds.length === 0) return;
    await this.db.transaction(async (tx) => {
      // Lock the session so two calls can't both see "no suggestions yet".
      await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).for('update');
      const [existing] = await tx
        .select({ placeId: sessionPlaces.placeId })
        .from(sessionPlaces)
        .where(eq(sessionPlaces.sessionId, sessionId))
        .limit(1);
      if (existing) return;
      await tx.insert(sessionPlaces).values(placeIds.map((placeId, rank) => ({ sessionId, placeId, rank })));
    });
  }

  async addSuggestion(sessionId: string, placeId: string) {
    await this.db.transaction(async (tx) => {
      // Lock the session so two additions can't take the same rank.
      await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).for('update');
      const [last] = await tx
        .select({ rank: sql<number>`max(${sessionPlaces.rank})` })
        .from(sessionPlaces)
        .where(eq(sessionPlaces.sessionId, sessionId));
      await tx
        .insert(sessionPlaces)
        .values({ sessionId, placeId, rank: (last?.rank ?? -1) + 1 })
        .onConflictDoNothing();
    });
  }

  async recordReaction(sessionId: string, memberId: string, placeId: string, reaction: Reaction | null, version: number) {
    await this.recordReactionStatement.execute({ sessionId, memberId, placeId, reaction, version });
  }

  async moveMember(fromId: string, toId: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`update sessions set host_id = ${toId} where host_id = ${fromId}`);
      // Members before reactions: a reaction must belong to a member.
      await tx.execute(sql`
        insert into session_members (session_id, user_id, joined_at)
        select session_id, ${toId}, joined_at from session_members where user_id = ${fromId}
        on conflict do nothing`);
      await tx.execute(sql`
        insert into reactions (session_id, user_id, place_id, reaction, room_version, updated_at)
        select session_id, ${toId}, place_id, reaction, room_version, updated_at from reactions where user_id = ${fromId}
        on conflict do nothing`);
      await tx.execute(sql`delete from reactions where user_id = ${fromId}`);
      await tx.execute(sql`delete from session_members where user_id = ${fromId}`);
    });
  }

  async recordMatch(sessionId: string, placeId: string) {
    const updated = await this.db
      .update(sessionPlaces)
      .set({ matchedAt: sql`coalesce(${sessionPlaces.matchedAt}, now())` })
      .where(and(eq(sessionPlaces.sessionId, sessionId), eq(sessionPlaces.placeId, placeId)))
      .returning({ placeId: sessionPlaces.placeId });
    if (updated.length === 0) throw new Error(`${placeId} was not suggested in session ${sessionId}`);
  }

  async end(sessionId: string) {
    await this.db
      .update(sessions)
      .set({ status: 'ended', endedAt: sql`now()` })
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'open')));
  }

  async listForMember(userId: string, limit: number): Promise<SessionRecord[]> {
    const rows = await this.db
      .select({ id: sessions.id })
      .from(sessionMembers)
      .innerJoin(sessions, eq(sessions.id, sessionMembers.sessionId))
      .where(eq(sessionMembers.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(limit);
    // One query per session: fine for a page of 20; a single join would be the next step.
    const records = await Promise.all(rows.map((r) => this.get(r.id)));
    return records.filter((r): r is SessionRecord => r !== undefined);
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (!session) return undefined;

    const [members, places] = await Promise.all([
      this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(sessionMembers)
        .innerJoin(users, eq(users.id, sessionMembers.userId))
        .where(eq(sessionMembers.sessionId, sessionId))
        .orderBy(asc(sessionMembers.joinedAt)),
      this.db
        .select({
          placeId: sessionPlaces.placeId,
          rank: sessionPlaces.rank,
          matched: sql<boolean>`${sessionPlaces.matchedAt} is not null`,
          likes: sql<number>`count(*) filter (where ${reactions.reaction} = 'like')::int`,
          dislikes: sql<number>`count(*) filter (where ${reactions.reaction} = 'dislike')::int`
        })
        .from(sessionPlaces)
        .leftJoin(
          reactions,
          and(eq(reactions.sessionId, sessionPlaces.sessionId), eq(reactions.placeId, sessionPlaces.placeId))
        )
        .where(eq(sessionPlaces.sessionId, sessionId))
        .groupBy(sessionPlaces.placeId, sessionPlaces.rank, sessionPlaces.matchedAt)
        .orderBy(asc(sessionPlaces.rank))
    ]);

    const placesSource = session.placesSource as PlacesSource;
    return {
      sessionId: session.id,
      hostId: session.hostId,
      placesSource,
      status: session.status as SessionRecord['status'],
      createdAt: session.createdAt,
      endedAt: session.endedAt,
      members,
      places: places.map((p) => ({ ...p, mapsUrl: mapsUrlFor(p.placeId, placesSource) }))
    };
  }
}
