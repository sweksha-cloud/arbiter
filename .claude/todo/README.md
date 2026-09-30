# To do

Ideas that are planned but **not built yet**. One file per item. When an item is done, delete its file (or move the useful parts into `.claude/docs/`) and note it in `TRADEOFFS.md` / `BUGS.md` as needed.

| Item | Why it matters | Blocked on |
| --- | --- | --- |
| [Nutrition preferences](nutrition.md) | Optional calories, protein and allergies in preferences; data from chain nutrition datasets, no ML | Owner's answers to its open questions; Postgres storage |
| [Fairness over time](fairness-over-time.md) | The most original feature: turns "restaurant picker" into "provably fair group decisions" | Postgres storage, login, session history |

[`basic.md`](basic.md) lists broader directions for making Arbiter more than a basic project.

The rest of the roadmap (monitoring, failure testing, security pass, installable web app, accessibility, session replay) is in [`../PROJECT_ASSESSMENT.md`](../PROJECT_ASSESSMENT.md).
