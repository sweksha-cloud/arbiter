# To do: Fairness over time

**Status:** idea, not started.
**Blocked on:** login, and the owner's answers below. Session history is now saved in Postgres (members, ranked place IDs, reactions), which is what fairness reads. Whose must-haves were binding isn't recorded yet; that needs the privacy decision first.

## The idea

Today Arbiter is fair *within* one session: everyone's must-haves are respected automatically. But across many outings, the same person might always be the one whose favorite places lose, or whose budget always ends up setting the limit for the group.

Fairness over time tracks two things across a group's history:

1. **Whose must-haves limited the options:** which person's constraint actually removed places (the "binding" constraint).
2. **Whose favorite places won:** whose liked cuisines matched the places the group ended up liking most.

It then **lightly favors people who have compromised more often**, for example by giving their liked cuisines a small ranking boost next time.

**Why it matters:** it changes the pitch from "restaurant picker" (common) to "provably fair group decisions" (original). It also puts the product's first principle, "fairness is the product", into code with numbers behind it.

## The privacy tension (decide this first)

The current design deliberately never reveals *who* removed a place (see `TRADEOFFS.md` #3). Fairness over time needs to *compute* that, which is fine on the server. The rule must be that it is **never shown to anyone else**.

Options for what to show:
- **(a) Nothing shown; boost only.** People never see scores; the ranking quietly adjusts. It's the most private, but the fairness is invisible and harder to demo.
- **(b) Only your own balance.** "You've compromised in 4 of your last 6 outings; your picks get a small boost." Other people's balances are never shown.
- **(c) A group-level balance without names.** "This group's decisions are well balanced" or "uneven lately".

Recommendation: (b) plus (c). Needs the owner's decision.

## Rough design

**Record per finished session** (our own data, so storing it is allowed; no Google content beyond place IDs):
- For each member: whether their must-haves were binding. That means removing their constraints would have changed which places survived.
- For each member: a "satisfaction" signal, such as whether any of the top-liked places matched their liked cuisines, or their own reactions to the winner.

**Compute a balance per person within a group**, for example a running count of "compromises" minus "wins", with older sessions counting less.

**Use it in ranking:** add a small, capped weight to the soft-preference score in `rankSuggestions` for members with a high compromise balance. Hard constraints are never relaxed; fairness only nudges the order of places that already fit everyone.

**Must be explainable:** a single function takes a group's history and returns each person's boost. It's pure, so it's easy to unit-test and to walk through in an interview.

## Tests to write

- Someone who compromised in the last 3 sessions gets their liked place ranked higher when it's otherwise tied.
- The boost is capped: it can never outweigh a place the whole group prefers.
- A hard constraint is never relaxed by fairness.
- Nobody's balance appears in anyone else's view (the same "never leaks" check as today's privacy test).

## Open questions for the owner

1. What to show (a / b / c above)?
2. Is fairness per *group* (the same friends) or per *person* across all groups? Per group needs a "group" concept, which the data model hasn't decided (`.claude/docs/DESIGN.md` section 8, tradeoff (a)).
3. How strong should the boost be? Recommendation: small enough that it only breaks near-ties.
