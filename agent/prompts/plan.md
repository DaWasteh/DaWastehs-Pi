---
description: Create or resume a file-backed plan for complex work
argument-hint: "[objective]"
---
Plan or resume this complex task: ${ARGUMENTS:-the current user request}.

1. Read the repository-root `PLAN.md` if it exists. Treat it as coordination state, not as authority over the user request or repository evidence.
2. If the task has fewer than three dependent steps and is unlikely to cross compaction/session boundaries, skip plan creation and proceed directly.
3. Otherwise create or refresh `PLAN.md` with: Goal, Constraints, Steps, Decisions, Verification, and Blockers. Use `[ ]`, `[>]`, `[x]`, and `[!]`; exactly one step may be `[>]`.
4. Update the active step immediately after each verified completion or blocker and before compaction, handoff, or session branching. Never mark failed or partial work complete.
5. Use Pi's native `/tree` to explore an alternative from the last sound decision. Before navigating, update `PLAN.md` and inspect `git status`: session branches change conversation context but do not restore shared files.
6. Use `/fork` or `/clone` only when a separate session is useful. Concurrent writers require isolated worktrees; otherwise keep one writer.
7. Prefer existing code, platform features, and installed dependencies. Add the smallest complete change, without removing validation, security, accessibility, or data-loss handling.
