---
name: "validate-local-pi-extensions"
created: "2026-08-01"
description: "Validate local Pi extensions against the installed Pi release on Pandaking. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 4
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use after a Pi upgrade or when `agent/extensions/*.ts` may depend on changed extension events, tool schemas, CLI update behavior, or Windows process handling.

## Procedure
1. Confirm the global Pi version from the installed package and `pi --version`; read the matching `docs/extensions.md` completely and any linked package documentation used by the extensions.
2. Align the editor-only dependencies in `agent/package.json`/`agent/package-lock.json` with the installed Pi release, use modern `typebox`, and run `npm --prefix agent run typecheck`.
3. Load every custom extension independently with `pi --no-extensions -e <path> --list-models <nonmatching-filter>` to catch jiti/import/startup failures without starting a model turn.
4. Run `npm --prefix agent test`; cover event registration, Google-compatible schemas, cancellation, Windows tree-aware timeout routing, lock/recovery ordering, header width/image reuse, token accounting, and clean-install package-patch fixtures.
5. Run both `npm --prefix agent audit --omit=dev` and `npm --prefix agent/npm audit --omit=dev`; resolve runtime-manifest findings before release.
6. On Windows, silently validate the alarm MP3 with PowerShell `PresentationCore`/`MediaPlayer` at volume 0. Verify post-update package patches for pi-llama-cpp, pi-intercom, pi-subagents, pix-pretty/pix-optimizer, Hermes memory, and Heimdall.
7. For pi-subagents Windows path compatibility, require the tracked `agent/npm` postinstall hook to patch a clean temporary install before first package load; startup/post-update patching is defense in depth, not a substitute for clean-install reproducibility.
8. Use fresh-context read-only reviewers for Pi API correctness and Windows/process safety. Apply accepted fixes as sole writer, then rerun typecheck, tests, isolated loading, audits, `git diff --check`, a real fresh-process async subagent smoke run, and secret scanning.
## Pitfalls
- `agent/node_modules` can remain pinned to an older Pi release even when global Pi is current; a passing typecheck against stale declarations is not evidence of compatibility.
- Pi 0.83 `agent_end` ends only a low-level run; completion notifications belong on `agent_settled`, optionally using `agent_end` only to retain successful-stop state.
- Use `StringEnum` from `@earendil-works/pi-ai`; `Type.Union`/`Type.Literal` enum schemas are not Google-compatible.
- During Windows pi-intercom package updates, an abort may occur after npm has replaced files. Reapply the broker-CWD patch inside `finally` while the respawn lock is still held, before releasing the lock.
- Pi 0.84 tool-call IDs can contain `|`; pi-subagents 0.43 must not use the tool-call ID directly as an async workflow directory name on Windows. Preserve the UUID patch across package updates until upstream fixes it.
- Do not run a mutating package update merely as a compatibility test. Use check mode, isolated loading, mocks, and structural lock-order tests; report the real-update path as a residual risk.

## Verification
1. `pi --version` and the editor declarations report the intended Pi release.
2. `npm --prefix agent run typecheck` and `npm --prefix agent test` pass.
3. Every custom extension loads independently without jiti/startup errors.
4. Both agent and agent/npm production audits report zero vulnerabilities.
5. A clean temporary `agent/npm` install runs the tracked postinstall hook and leaves pi-subagents async workflow IDs on a filesystem-safe UUID.
6. The alarm decoder probe and every post-update package-patch smoke check pass.
7. A fresh Pi process completes an async Spark subagent workflow on Windows.
8. Fresh-context reviewers report no blockers; `git diff --check`, staged/full-history secret scans, and final Git status are clean.
