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

export class PostgresSessionHistory implements SessionHistory {
  constructor(private readonly db: Db) {}

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

  async recordReaction(sessionId: string, memberId: string, placeId: string, reaction: Reaction | null, version: number) {
    await this.db
      .insert(reactions)
      .values({ sessionId, userId: memberId, placeId, reaction, roomVersion: version })
      .onConflictDoUpdate({
        target: [reactions.sessionId, reactions.userId, reactions.placeId],
        set: { reaction, roomVersion: version, updatedAt: sql`now()` },
        // A slower, older write arriving late must not undo a newer one.
        setWhere: sql`${reactions.roomVersion} < excluded.room_version`
      });
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
          likes: sql<number>`count(*) filter (where ${reactions.reaction} = 'like')::int`,
          dislikes: sql<number>`count(*) filter (where ${reactions.reaction} = 'dislike')::int`
        })
        .from(sessionPlaces)
        .leftJoin(
          reactions,
          and(eq(reactions.sessionId, sessionPlaces.sessionId), eq(reactions.placeId, sessionPlaces.placeId))
        )
        .where(eq(sessionPlaces.sessionId, sessionId))
        .groupBy(sessionPlaces.placeId, sessionPlaces.rank)
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
