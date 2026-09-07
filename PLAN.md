# v3.0 Astra subagent routing

## Goal
Modernize the personal subagent configuration for the available Astra/5.6 models; remove automatic Spark routing, repair stale role contracts, validate and publish v3.0 only after clean checks/review.

## Constraints
- Preserve pre-existing package updates and local model-thinking preferences; no credentials or runtime artifacts in Git.
- Parent owns settings edits, integration and publication. Independent child checks are read-only; a mechanic smoke may change only an isolated temporary fixture.
- No invented context sizes, unavailable fallback aliases, priority tiers, or silent CLI fallback.
- User explicitly approved updating the active `pi-model-routing` skill; lint it before release.

## Steps
- [x] Inspect actual models, installed Pi/subagents docs, configuration and discovered agent paths.
- [x] Update central routing, role prompts, legacy shadow, tests and documentation.
- [x] Run deterministic checks and native async role-validation/review workflows.
- [x] Resolve findings and accept the reviewed flat-team release candidate.

Publication is parent-owned; the annotated `v3.0` tag and GitHub release record the delivered commit rather than claiming delivery from a candidate checklist.

## Decisions
- Parent/lead/planner/oracle/reviewer: Astra high; bugtester: Sol high; worker/mechanic/delegate/researcher/default: Terra medium; scout/web-searcher: Luna low.
- Registry snapshot: Spark 128,000 context; Astra/Sol/Terra/Luna 272,000. This is routing policy, not a quality benchmark.
- Fresh role handoffs by default, preserving oracle's fork preference. No automatic fallbacks.
- Create the previously non-executable planner role; remove the phantom context-builder override (use scout), and configure advisor through canonical oracle.
- Legacy `~/.agents/teamleiter.md` moved reversibly to `teamleiter.md.pre-v3.bak` outside Markdown discovery; canonical version is tracked under `agent/agents/`.
- Owner approved flat native teams after nested runner failure: only root parent launches evidence children, then passes completed reports to read-only Astra teamleiter. Teamleiter has no shell/subagent tools. Runtime defaults: concurrency 4, cumulative launches/run 12, active async runs/session 2, depth 1. No forced fixed-size team.

## Verification
- Initial `subagent models/list/doctor`: Astra registered; old teamleiter shadow reproduced; pi-subagents 0.66.0 matches npm latest.
- Fresh native discovery after edits resolves all updated roles and canonical user teamleiter.
- `npm --prefix agent test`: 65/65 passed, including flat-team evidence rules and exact custom-role toolsets. Typecheck passed. Skill lint: 82 skills, 0 errors, 25 pre-existing advisory warnings; edited routing skill has no findings. Both production npm audits: 0 vulnerabilities.
- Fresh-process native `loadConfig()` verified all five final values (async true, concurrency 4, spawns 12, active async 2, depth 1); native discovery verified canonical user teamleiter and Astra advisor alias with no diagnostics. Existing sessions still need restart for startup-cached defaults.
- Native workflow `fc1ee3b7-a6dc-4219-8887-2d13b88db041`: bugtester passed with native discovery, mechanic repaired isolated clamp fixture (3 red -> 5 green tests), web tools worked, independent Astra review found no concrete code/config defects.
- Initial teamleiter child `0dc91859-f5ff-4c51-8e99-65854dfbb16b` failed with empty output; nested workflow `8371faef-d823-46be-be5a-3fd16f5c2e0c` proves missing `runs.all` keys. Prompt/example corrected and native `action:validate` passed. Same-protocol retry `c27de1dd-1f94-48b9-8383-990ffc8ceeef` fixed keys, but nested workflow `9ec98705-1888-4057-82ba-89af90f5433a` failed: runner PID 34936 disappeared before result. No claim that upstream nesting is fixed; owner selected the flat configuration.
- Web report invented an access date; prompt now requires evidence-backed dates/version claims. Retained correction `7d57058d-8429-4c09-a1f9-fbf93fa7ebdd` passed: official page fetched, unsupported date withdrawn, inference distinguished from exact quotes.
- Flat workflow `a291362b-724f-498f-8583-7b0d7d6c3b55` completed all three children: Luna scout evidence, independent Astra review (`Merge verdict: OK`), and Astra teamleiter source-checked synthesis (`PASS`). Teamleiter corrected the scout's mistaken freshness interpretation using the actual manifests and builtin alias source; no configuration fix was needed.
- Parent verified persisted complete states, exact effective models/thinking, fresh contexts and observed process-terminal evidence for bugtester, mechanic, corrected web-searcher, scout, reviewer and teamleiter. Artifacts remain private runtime state.

## Blockers
No open blocker in the owner-approved flat configuration. Failed nesting is explicitly excluded, not claimed fixed. No CLI/foreground fallback or runtime package-source patch was used. The initial dirty diff was captured outside Git; only intended configuration/docs/tests and the pre-existing audited package state belong in the release.
