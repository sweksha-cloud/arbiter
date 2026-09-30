# To do

Ideas that are planned but **not built yet**. One file per item. When an item is done, delete its file (or move the useful parts into `.claude/docs/`) and note it in `TRADEOFFS.md` / `BUGS.md` as needed.

| Item | Why it matters | Blocked on |
| --- | --- | --- |
| [Fairness over time](fairness-over-time.md) | The most original feature: turns "restaurant picker" into "provably fair group decisions" | Postgres storage, login, session history |
| [E2E browser tests in CI](e2e-tests-in-ci.md) | The browser scripts caught 4 bugs the unit tests missed; running them on every push is a strong resume line | Your OK to add `@playwright/test` (dev dependency) |

The rest of the roadmap (monitoring, failure testing, security pass, installable web app, accessibility, session replay) is in [`../PROJECT_ASSESSMENT.md`](../PROJECT_ASSESSMENT.md).
