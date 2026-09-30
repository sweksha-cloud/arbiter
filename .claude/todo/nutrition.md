# To do: Nutrition preferences

**Status:** decided in outline, not built. **No ML for now** (owner's decision).
**Blocked on:** the open questions below, then Postgres storage.

## What the owner decided

- Nutrition is **optional**. In their preferences, people can fill in any of:
  - a **calorie** count,
  - a **protein** count,
  - **allergies**.
- No ML or LLMs for now.
- "No fast food" is now a nice-to-have, so chains (where nutrition data exists) aren't removed up front.

## Where the data can come from

Google's Places API has **no nutrition data** (no calories, protein, ingredients or allergens). Its closest fields are `servesVegetarianFood`, what a place serves (breakfast, dessert, coffee…), and types like `vegan_restaurant`.

| Source | What it has | Cost | Coverage |
| --- | --- | --- | --- |
| **MenuStat** (NYC Health Department) | Calories, protein, fat, carbs, sodium, sugar, fiber per menu item | Free download (Excel / CSV on Harvard Dataverse) | ~100 largest US chains only. Check how recent the latest year is |
| **Nutritionix**, **FatSecret** APIs | Calories and macros for chain menu items, more current | Paid tiers; free limits need checking | Big chains |
| **Your own users** | Answers after an outing ("good high-protein options?"), stored by Google place ID | Free | Any restaurant, grows with use |
| **USDA FoodData Central** | Generic and packaged foods | Free (1,000 requests/hour) | Not restaurant menus; not useful here |

Local independent restaurants have no structured nutrition data anywhere. Getting it would mean reading their menus, which is the ML work ruled out for now.

**Recommended:** MenuStat loaded into our own database, plus user answers later (fits the Ratings phase).

**Google's terms:** chain nutrition data is ours to store. Matching a Google place's name to a chain must happen live during each session and the match must not be saved, so we never build a dataset from Google content (see `TRADEOFFS.md` 4d).

## How it would work (proposal)

- For each suggested place that matches a chain, check whether its menu has an item that fits: e.g. calories at or under the person's number, protein at or over theirs.
- **Soft, not hard:** a match raises the place's rank; no data changes nothing. Most places will have no data, so a must-have would remove almost everything.

## Open questions for the owner

1. **What the numbers mean.** Proposed: calories = "at most this many per meal"; protein = "at least this many grams per meal". Right?
2. **Allergies.** No free source has reliable allergen data for restaurants (MenuStat has none). Options:
   - (a) Store them but don't use them for picking places yet, and show the group a private reminder like "Someone has a food allergy; check with the restaurant." It never names who.
   - (b) Treat an allergy as a must-have, which removes nearly every place, because allergen data is almost always unknown.
   - (c) Leave allergies out until there's a data source.
   Recommendation: (a). Suggesting a place as "allergy-safe" without data would be dangerous.
3. **Allergy input:** a fixed list (the 9 major US allergens: milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame) or free text? A fixed list is easier to match against data later.
4. ~~**Storage.**~~ Decided: preferences are one versioned `jsonb` object (`TRADEOFFS.md` 16c), so adding `maxCalories`, `minProteinGrams` and `allergies` is a Zod schema change plus a version bump, with no migration.
