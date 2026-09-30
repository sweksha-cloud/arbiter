# To do: Decide how preferences are stored (columns or JSON)

**Status:** building with **columns** for now. The final choice is still open; revisit before preferences change much.
**Decide by:** before adding nutrition preferences, or any other batch of new preference questions.

## The question

Everything lives in Postgres either way. The only difference is how the `preferences` table holds each person's answers:

- **Columns (current):** one column per question: `vegetarian`, `no_fast_food`, `max_price_level`, `max_distance_meters`, `liked_cuisines`, `disliked_cuisines`.
- **JSON:** one `jsonb` column holding all of a person's answers, e.g. `{"vegetarian": true, "maxPriceLevel": 2}`.

## Pros and cons

| | Columns | JSON (`jsonb`) |
| --- | --- | --- |
| Adding a question | A migration each time | Code change only |
| Renaming or removing one | A migration, plus moving existing data | Code change, plus handling old saved answers when reading (store a version number per row) |
| Nested or list-shaped answers (allergy lists, "calories under 700") | Awkward; extra columns or tables | Natural fit |
| Catching bad data | Postgres rejects bad values itself | Only the app checks, via the shared Zod schema (it already validates every save) |
| Querying across users ("how many are vegetarian?") | Easy and fast | Possible (`preferences->>'vegetarian'`), slightly clunkier; can be indexed |
| Still SQL, still Postgres | Yes | Yes |

The app only ever reads one person's preferences at a time (to prefill their form or run a session), so the querying advantage of columns matters little. The flexibility of JSON matters more the more the questions change.

## What would tip it

- **Nutrition preferences come back** (high protein, low calorie, allergies, gluten-free…): lean JSON, since that list would keep changing.
- **Preferences stay roughly as they are:** keep columns.

Switching later is one migration: add the `jsonb` column, copy each row across, drop the old columns.

## Nutrition: what's known so far

- Google's Places API has **no nutrition data**: no calories, protein, ingredients, gluten-free, dairy-free or allergy fields. It only has `servesVegetarianFood`, what a place serves (breakfast, dessert, coffee, beer…), and place types like `vegan_restaurant` / `vegetarian_restaurant` (fully vegan or vegetarian places only).
- Chain-restaurant nutrition databases exist but mostly cover big chains and usually cost money.
- The spec lists nutrition labels as future work, likely ML-based. The owner decided: **no ML for now.**
- If added, allergies must work like vegetarian: a must-have where unknown counts as "no".
