import { describe, expect, it } from 'vitest';

import { setTag, tallyTags, type TagsByMember } from './nutrition-tags.js';

describe('nutrition tags', () => {
  it('counts each member once per tag, and only for the places asked about', () => {
    let tags: TagsByMember = {};
    tags = setTag(tags, 'ana', 'p1', 'high_protein', true);
    tags = setTag(tags, 'ana', 'p1', 'high_protein', true); // Marking twice changes nothing.
    tags = setTag(tags, 'bo', 'p1', 'high_protein', true);
    tags = setTag(tags, 'bo', 'p1', 'vegan', true);
    tags = setTag(tags, 'bo', 'gone', 'vegan', true);

    const tally = tallyTags(tags, ['p1', 'p2']);
    expect(tally.p1).toMatchObject({ high_protein: 2, vegan: 1, low_carb: 0 });
    expect(tally.p2).toMatchObject({ high_protein: 0, vegan: 0 });
    expect(tally).not.toHaveProperty('gone');
  });

  it('removes a mark, and tidies away empty entries', () => {
    let tags: TagsByMember = setTag({}, 'ana', 'p1', 'low_carb', true);
    tags = setTag(tags, 'ana', 'p1', 'low_carb', false);
    expect(tags).toEqual({ ana: {} });
    expect(tallyTags(tags, ['p1']).p1!.low_carb).toBe(0);
  });

  it('never changes the object it was given', () => {
    const before: TagsByMember = { ana: { p1: ['vegan'] } };
    setTag(before, 'ana', 'p1', 'vegetarian', true);
    expect(before).toEqual({ ana: { p1: ['vegan'] } });
  });
});
