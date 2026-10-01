import { z } from 'zod';

/**
 * What people in a session can mark a suggested place as having (option D in
 * .claude/todo/nutrition.md). Local restaurants have no nutrition data
 * anywhere, so this is what the group knows. Wording is always "people say it
 * has … options", never advice: fatsecret's and good sense's rule alike.
 */
export const NutritionTagSchema = z.enum(['high_protein', 'low_calorie', 'low_carb', 'vegetarian', 'vegan']);
export type NutritionTag = z.infer<typeof NutritionTagSchema>;

/** Display order and short labels, shown under "Options the group says it has". */
export const NUTRITION_TAGS: readonly { tag: NutritionTag; label: string }[] = [
  { tag: 'high_protein', label: 'High protein' },
  { tag: 'low_calorie', label: 'Low calorie' },
  { tag: 'low_carb', label: 'Low carb' },
  { tag: 'vegetarian', label: 'Vegetarian' },
  { tag: 'vegan', label: 'Vegan' }
];

/** memberId -> placeId -> the tags that member marked. */
export type TagsByMember = Readonly<Record<string, Readonly<Record<string, readonly NutritionTag[]>>>>;

/** Adds or removes one member's mark. Returns a new object; marking twice changes nothing. */
export function setTag(
  tags: TagsByMember,
  memberId: string,
  placeId: string,
  tag: NutritionTag,
  on: boolean
): TagsByMember {
  const memberTags = tags[memberId] ?? {};
  const current = memberTags[placeId] ?? [];
  const next = on ? (current.includes(tag) ? current : [...current, tag]) : current.filter((t) => t !== tag);
  const { [placeId]: _previous, ...otherPlaces } = memberTags;
  const updatedPlaces = next.length === 0 ? otherPlaces : { ...otherPlaces, [placeId]: next };
  return { ...tags, [memberId]: updatedPlaces };
}

/** placeId -> tag -> how many members marked it. Counts only, never who. */
export function tallyTags(tags: TagsByMember, placeIds: readonly string[]): Record<string, Record<NutritionTag, number>> {
  const empty = () => Object.fromEntries(NUTRITION_TAGS.map(({ tag }) => [tag, 0])) as Record<NutritionTag, number>;
  const tally: Record<string, Record<NutritionTag, number>> = {};
  for (const id of placeIds) tally[id] = empty();
  for (const memberTags of Object.values(tags)) {
    for (const [placeId, marked] of Object.entries(memberTags)) {
      const counts = tally[placeId];
      if (!counts) continue;
      for (const tag of marked) counts[tag] += 1;
    }
  }
  return tally;
}
