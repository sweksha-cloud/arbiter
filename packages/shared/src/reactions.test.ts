import { describe, expect, it } from 'vitest';

import { setReaction, tallyReactions, type ReactionsByMember } from './reactions.js';

describe('reactions', () => {
  it('tallies likes and dislikes per place, including places with none', () => {
    let reactions: ReactionsByMember = {};
    reactions = setReaction(reactions, 'ana', 'p1', 'like');
    reactions = setReaction(reactions, 'ben', 'p1', 'dislike');
    reactions = setReaction(reactions, 'cy', 'p1', 'like');

    expect(tallyReactions(reactions, ['p1', 'p2'])).toEqual({
      p1: { likes: 2, dislikes: 1 },
      p2: { likes: 0, dislikes: 0 }
    });
  });

  it('lets a member change or clear their reaction without double counting', () => {
    let reactions: ReactionsByMember = setReaction({}, 'ana', 'p1', 'like');
    reactions = setReaction(reactions, 'ana', 'p1', 'dislike');
    expect(tallyReactions(reactions, ['p1']).p1).toEqual({ likes: 0, dislikes: 1 });

    reactions = setReaction(reactions, 'ana', 'p1', null);
    expect(tallyReactions(reactions, ['p1']).p1).toEqual({ likes: 0, dislikes: 0 });
  });

  it('does not mutate the previous state', () => {
    const before: ReactionsByMember = setReaction({}, 'ana', 'p1', 'like');
    setReaction(before, 'ana', 'p1', 'dislike');
    expect(before).toEqual({ ana: { p1: 'like' } });
  });

  it('ignores reactions to places outside the list', () => {
    const reactions = setReaction({}, 'ana', 'gone', 'like');
    expect(tallyReactions(reactions, ['p1'])).toEqual({ p1: { likes: 0, dislikes: 0 } });
  });
});
