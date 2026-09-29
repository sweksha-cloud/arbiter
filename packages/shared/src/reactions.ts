import { z } from 'zod';

export const ReactionSchema = z.enum(['like', 'dislike']);
export type Reaction = z.infer<typeof ReactionSchema>;

/** memberId -> placeId -> reaction. One reaction per member per place. */
export type ReactionsByMember = Readonly<Record<string, Readonly<Record<string, Reaction>>>>;

export interface ReactionTally {
  likes: number;
  dislikes: number;
}

/** Sets, changes, or (with `null`) clears a member's reaction. Returns a new object. */
export function setReaction(
  reactions: ReactionsByMember,
  memberId: string,
  placeId: string,
  reaction: Reaction | null
): ReactionsByMember {
  const { [placeId]: _previous, ...others } = reactions[memberId] ?? {};
  const memberReactions = reaction === null ? others : { ...others, [placeId]: reaction };
  return { ...reactions, [memberId]: memberReactions };
}

/** Totals per place. Contains only counts, never who reacted. */
export function tallyReactions(
  reactions: ReactionsByMember,
  placeIds: readonly string[]
): Record<string, ReactionTally> {
  const tally: Record<string, ReactionTally> = {};
  for (const id of placeIds) tally[id] = { likes: 0, dislikes: 0 };

  for (const memberReactions of Object.values(reactions)) {
    for (const [placeId, reaction] of Object.entries(memberReactions)) {
      const entry = tally[placeId];
      if (!entry) continue;
      if (reaction === 'like') entry.likes += 1;
      else entry.dislikes += 1;
    }
  }
  return tally;
}
