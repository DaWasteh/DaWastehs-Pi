# v2.7 Optimization Plan

## Goal
Ship a lean, verifiable `v2.7` of the personal Pi configuration: low prompt/tool overhead for local models, reliable lazy skill routing, automatic post-edit feedback, durable complex-task planning, and accurate release history.

## Constraints
- Preserve pre-existing edits in `agent/npm/package.json`, `agent/npm/package-lock.json`, and `agent/settings.json`.
- Keep skill bodies lazy and the local system-prompt string below roughly 1,000 tokens by a documented conservative estimate.
- Use installed Pi 0.84.4 APIs; do not invent hooks or rely on unverified model claims.
- Success stays quiet; failures provide bounded structured feedback.
- No commit, tag, or push until all release checks and an independent diff review pass.

## Steps
- [x] Inventory repository state, Pi APIs, packages, skills, models, and external evidence.
- [x] Replace the over-governed Skill Governor with metadata routing and one on-demand capability router; fix manual release-skill routing.
- [x] Add deterministic post-`write`/`edit` validation with bounded negative feedback.
- [x] Add the file-backed `/plan` template and native session-tree workflow.
- [x] Finalize concise local-model prompt/tool profiles and compaction settings.
- [x] Run focused and full verification; inspect the complete diff and obtain independent review.
- [>] Create a detailed multi-line release commit, tag `v2.7`, and push the branch and tag.

## Decisions
- Native Pi discovery, `before_agent_start`, `formatSkillsForPrompt`, and dynamic active tools replace model-side skill evolution and mutation policing.
- Manual skills remain hidden by default but can be selected by metadata and read normally; reading instructions grants no extra authority.
- Interactive local sessions begin with core file tools plus `capability_route`; additional tools activate only when matched.
- Validation batches successful edits at `turn_end`, after parallel tool results settle. It uses check-only commands, fails explicitly on external-command overflow, isolates Python startup, and sends at most two repair-feedback rounds per user turn.
- The local default system prompt uses a compact read-first record capped at 900 UTF-8 bytes; explicit non-empty custom/append prompts override this bound and are never truncated.
- Tool routing may restore only the Governor-owned local removal delta; initially inactive, blocked, or user-disabled tools are not silently enabled.
- `PLAN.md` is the cross-compaction task record. Pi session branches are for alternative conversation paths and do not roll back filesystem state.
- Ponytail is treated as a reuse-first/YAGNI heuristic with explicit safety floors, not as a canonical architecture law.

## Verification
- Targeted Governor, configuration, and validator regressions plus the full 44-test suite.
- `npm --prefix agent run typecheck` and `npm --prefix agent run skill:lint` (85 skills, 0 errors).
- Both production dependency audits report 0 vulnerabilities; runtime packages are current.
- Clean `agent/npm` install with tracked peer strategy reaches and verifies postinstall.
- Six independent extension loads, async subagent and Intercom smoke checks.
- Historical benchmark dry-run only (8 fixtures); old v2.4 model rows are not v2.7 evidence.
- JSON parsing, changed-file secret scan, `git diff --check`, final status/diff/tag/remote checks, and independent review.

## Blockers
- Local llama.cpp server on port 1234 was unavailable during model-registry inspection; runtime aliases must not be invented.
- Push authentication and remote write access remain to be verified after the diff is green.
