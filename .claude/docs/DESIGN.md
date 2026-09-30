# Arbiter: Design Decisions

Product decisions for v1. Each entry says whether it is **Decided** (by the owner), **Proposed** (drafted by the AI agent where the owner said "up to Claude", awaiting approval), **Deferred** (owner chose to decide later), or **Open** (needs an answer before the code that depends on it).

Source of the owner's answers: `.claude/PROJECT_OVERVIEW.md`, "What's still open".

---

## 1. Decision rules

**Decided**
- The app does not pick a winner. After elimination it suggests a short list (around the top 3), and people react to each suggestion.
- Each suggestion has a like and a dislike option and a bar showing likes against dislikes. People can dislike, not only like.
- Voting has no time limit.
- Anyone can create a session and share an invite link.

Options that were considered: app picks a winner; group votes on everything left; app shortlists and group picks. The owner chose a shortlist with like/dislike reactions and no forced final pick.

**Proposed** (easy to change later)
- Each person has at most one reaction per place (like, dislike, or none) and can change or clear it at any time.
- No separate veto. A dislike is the way to push back; with no forced winner, a veto adds nothing.
- Ties don't need breaking, because nothing is declared the winner.
- If fewer places survive elimination than the short-list size, show all survivors.
- The person who created the session can end it. Anyone with the link can join while it is open.

**Open**
- What happens when no place survives elimination? Options: (a) show "nothing fits everyone" and let the host rescan with a larger radius; (b) relax the softest hard constraint (distance) automatically and say so; (c) just show the empty state. Recommendation: (a).
- Is the short list exactly 3, or should it depend on how many places survive?

## 2. Groups and identity

**Decided**
- People can use Arbiter as guests without logging in.
- Guests can choose to log in so their preferences are saved.
- Anyone can create a session and send an invite link.

- **Session history for logged-in users:** people who log in can go back to their past sessions and see who took part, the reactions, and a Google Maps link for each suggested place (built from the stored place ID; names aren't stored or looked up again). Guests can't; history is part of what logging in gives you.
- **Sessions only, no long-lived groups.**

**Built (temporary)**
- A guest is a name plus a random token the server issues. The browser keeps it in `localStorage` and sends it in the `Authorization` header and the Socket.IO handshake. Guests live in server memory until the data model is approved.

**Open**
- Login method for "log in to save" (magic email link, Google sign-in, or passkeys). Not needed until guest flow works.

## 3. Preferences

**Decided**
- Budget is a hard constraint and the lowest maximum wins: if one person's max is 20 and another's is 100, the group's max is 20.

**Proposed**
| Field | Kind | How the group combines it |
| --- | --- | --- |
| Vegetarian | Hard | If anyone needs it, every place must serve vegetarian food |
| Rather not do fast food | Soft (owner's decision) | Lowers a known fast-food place's rank once for each member who sets it. Never removes it: a fast-food place can still win if it suits everyone better |
| Max budget | Hard | Lowest maximum in the group (decided) |
| Max distance | Hard | Shortest maximum in the group. Choices: Don't care, 0.5, 1, 2, 5, 10 or 20 mi, or a custom distance from 0.1 to 31 mi |
| Liked cuisines | Soft | Raises a place's rank for each member who likes one of its cuisines |
| Disliked cuisines | Soft | Lowers a place's rank for each member who dislikes one of its cuisines |

- Distance is straight-line distance from the scan center, not drive time. Drive time would need a second paid Google API call per session.
- The scan searches exactly as far as the group's shortest maximum, so far limits can find far places and close limits spend the scan's results on nearby ones. If everyone picks "Don't care", it uses the default radius (section 4). 31 mi is the cap because 50 km is the largest radius Google's Nearby Search accepts.
- Per-session overrides: not in v1. Preferences are edited in one place and apply to every session.

**Open**
- Budget unit. Google Places gives a price *level* (free, $, $$, $$$, $$$$), not a dollar amount; some places also have a price *range* in dollars. The code currently uses price level 0–4. Keep price level, or ask people for dollars and map them?

## 4. Place scanning

**Deferred** by the owner ("will decide this later"): scan center, default radius, which place types count, and how missing data is handled.

What the code does meanwhile, so nothing is silently assumed:
- Every place field that Google may omit (price level, vegetarian, fast-food, rating, open now) is optional in the type.
- Elimination takes a required `MissingDataPolicy` that says, per field, whether a place with no data is kept or eliminated. There is no default; the caller must choose.
- The actual Google client is not written yet. The server talks to a `PlacesProvider` interface, with a fixture provider for local development and tests.

## 5. Privacy

**Decided**
- Members can't see each other's preferences at all.

**Proposed**
- Elimination results never say which member's constraint removed a place (the domain code only returns what survived and how many were removed).
- Reactions are shown only as totals on the bar, never by name.

## 6. Ratings

**Deferred** ("much much later").

## 7. Screens and flows

**Proposed** (the owner said "up to Claude")

1. **Home**: "Start a session" and "Join with a code".
2. **Your preferences** (optional page): edit saved preferences outside a session.
3. **New session**: one tap. Uses the host's location for now (method depends on section 4).
4. **Session lobby**: a status bar ("1 of 2 submitted") with who has submitted (never what they chose), the invite link with Copy/Share, and a "Your preferences" form that everyone, host included, submits for this session. Last session's answers are prefilled but don't count until submitted. Results appear automatically once everyone has submitted.
5. **Suggestions**: the short list. Each card shows name, distance, price level, rating, the like/dislike bar, a Directions button (opens Google Maps), and Google Maps attribution.
6. **Nothing fits**: empty state when no place survives (behavior depends on the open question in section 1).
7. **Terms of Use** and **Privacy Policy**: public pages, required by Google.
8. **Log in to save**: optional, reachable from preferences.

Main flow (**Decided** by the owner: start a session first, everyone submits preferences inside it with a "1/2 submitted" status bar, and results appear once everyone has submitted): host enters a name → Start a session → session with invite link immediately → friends open link, enter a name → everyone submits preferences → results appear automatically → everyone reacts.

**Proposed** details:
- Auto-results need at least 2 people, so a host alone doesn't get results before friends arrive.
- The host can "Show results now" if someone never submits; that person's must-haves don't count.
- People can change their answers until results appear; then they're locked.
- Someone who joins after results appear can react but their preferences don't count.

## 8. Data model

**Proposed, not migrated yet.** No tables are created until the tradeoffs below are answered.

- `users`: id, display name, is_guest, created_at. A guest is a real row with a server-issued token, so logging in later just attaches a login to the same row.
- `preferences`: one row per user.
- `sessions`: id, invite code, host user, scan center, status (open/ended), created_at, ended_at.
- `session_members`: session, user, joined_at.
- `session_places`: session, Google place ID. Only IDs are stored; Google's terms allow keeping place IDs indefinitely but names, prices, hours and ratings only for the session.
- `reactions`: session, user, place ID, like/dislike, updated_at.

Scan results (names, prices, etc.) live only in the in-memory room state for the life of the session.

History requirement (section 2) means past sessions must outlive the live room: members, the suggested place IDs, and reaction totals all go in Postgres, and an old link opened by a logged-in member shows that session's results instead of "not found".

**Google's terms (decided):** only place IDs (forever) and coordinates (30 days) may be stored. Names, prices and ratings may not be kept after the session. History stores *which* places were suggested and how people reacted, and shows each place as a Google Maps link built from its ID. No fresh lookups.

Tradeoffs for the owner:
- **(a) Groups or sessions only.** Decided: sessions only.
- **(b) Preferences as columns or as one JSON column.** Columns for now (owner's decision). The final choice is still open: see `.claude/todo/preferences-columns-or-json.md`.
- **(c) Reactions in Postgres or only in room state.** Now decided by the history requirement: Postgres.
- **(d) Scan center coordinates.** Google allows keeping coordinates up to 30 days. Store them on the session and clear them with a cleanup job, or keep them only in memory. Recommendation: store and clear after 30 days.

## 9. Real-time events

**Deferred** ("much much later"). A minimal provisional set exists so the local demo works; it will be revisited when this section is designed properly:

- Client → server: `session:join`, `session:start` (host only), `session:react` (like, dislike, or clear), `session:end` (host only). Each gets an `{ ok }` or `{ ok: false, error }` reply.
- Server → client: `session:state`, the full view for that person (totals, their own reactions, member names), sent after every change.
- Reconnect: the client rejoins on every connect and receives the current state, including its own reactions.
- Out-of-order updates: every state has a `version`; clients keep the highest.
