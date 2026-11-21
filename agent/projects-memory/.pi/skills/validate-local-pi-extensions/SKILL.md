---
name: "validate-local-pi-extensions"
created: "2026-08-01"
description: "Validate local Pi extensions against the installed Pi release on Pandaking. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-11-21"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Load manually after a Pi upgrade or when `agent/extensions/*.ts` may depend on changed extension events, tool schemas, CLI update behavior, or Windows process handling. Explicit task requirements and repository evidence override this checklist.

## Procedure
1. Confirm the global Pi version from the installed package and `pi --version`; read `CHANGELOG.md` and `docs/extensions.md` for breaking changes since the last aligned release.
2. Align the editor-only dependencies in `agent/package.json`/`agent/package-lock.json` with the installed Pi release and modern `typebox`, then run `npm --prefix agent run typecheck`.
3. Run `npm --prefix agent test` and `npm --prefix agent run skill:lint`; cover event registration, `BeforeAgentStartEvent` narrowing, Google-compatible `StringEnum` schemas, cancellation, Windows tree-aware timeout routing, lock/recovery ordering, header width/image reuse, token accounting, `post-edit-validation`, and clean-install package-patch fixtures.
4. Load every custom extension independently with `pi --no-extensions -e <path> --list-models <nonmatching-filter>` and run `npm --prefix agent run test:installed` against both the local SDK and the global Pi install to verify zero extension load errors or host-peer warnings.
5. Run both `npm --prefix agent audit` and `npm --prefix agent/npm audit --omit=dev`; fix non-breaking runtime findings and document any remaining upstream-pinned advisories honestly.
6. Verify post-update package checks for host peers, `pi-intercom`, `pi-subagents`, `pix-pretty`/`pix-optimizer`, `pi-hermes-memory`, and `pi-heimdall` (universal `~/.config/heimdall/config.json` on >=0.3.32). On Windows, silently validate the alarm MP3 with PowerShell `PresentationCore`/`MediaPlayer` at volume 0 when audio code changed.
7. For `pi-subagents` compatibility and host peers, verify the tracked `agent/npm/patches/postinstall.cjs` hook is idempotent and recognizes the installed package layout without false failures.
8. Run `git diff --check` and inspect staged diffs for secrets or volatile runtime artifacts before release.

## Pitfalls
- `agent/node_modules` can stay pinned to an older Pi release while global Pi is newer; typecheck against stale declarations is not proof of compatibility.
- Since Pi 1.2, `BeforeAgentStartEvent` is a union on `messageType` (`"user"` vs `"custom"`); `"custom"` runs triggered by `pi.sendMessage(..., { triggerTurn: true })` have no `prompt`.
- Since Pi 1.5/1.6, `pi.exec()` puts spawn errors (e.g. `spawn python ENOENT`) into `stderr` instead of leaving `stderr` empty, returns `128 + signal` when terminated by a signal, and supports `maxBuffer`/`truncated`.
- Since Pi 1.6, TUI `render()` returns `readonly string[]` and `Container` caches arrays; copy before mutating.
- `agent_end` ends only a low-level run; completion alarms belong on `agent_settled` and must ignore `event.aborted`.
- Use `StringEnum` from `@earendil-works/pi-ai` for Google-compatible enum schemas and narrow `params` safely in TypeScript.
- During Windows `pi-intercom` package updates, re-apply the broker-CWD check inside `finally` before releasing the respawn lock.
- Do not run a mutating package update merely as a compatibility test; use stubbed CLIs, check mode, and isolated fixtures.

## Verification
1. `pi --version` and `agent/package.json` match the target Pi release.
2. `npm --prefix agent run typecheck`, `npm --prefix agent test`, `npm --prefix agent run skill:lint` (0 errors), and `npm --prefix agent run test:installed` pass.
3. Every custom extension loads independently without jiti/startup errors.
4. `agent` and `agent/npm` audit results are clean or explicitly documented.
5. `node agent/npm/patches/postinstall.cjs` succeeds and is idempotent against the installed packages.
6. `git diff --check` and final Git status contain only intended tracked files and no secrets or volatile runtime artifacts.
