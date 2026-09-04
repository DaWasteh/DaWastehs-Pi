# v2.8 AutoTuner Gateway and Hardening Plan

## Goal
Ship `v2.8`: switch local models through AutoTuner's control API from Pi's native `/model`, fix the review findings in the existing extensions, slim the skill catalogue where the audit proved waste, and make Ponytail the global engineering guideline, all regression-free.

## Constraints
- Preserve the pre-existing package bumps in `agent/npm/package.json` and `agent/npm/package-lock.json`.
- AutoTuner's API contract (v5.3.9, additive) is owned by the parallel AutoTuner session; only consume documented endpoints and the `control_api.json` sidecar.
- The Governor must never prompt the user; it only reduces and routes.
- No merge of skill bodies without editorial review; mechanical slimming only.
- No commit, tag, or push until typecheck, the full test suite, skill lint, and audits are green.

## Steps
- [x] Coordinate the control-API contract, sidecar credentials, and test window with the AutoTuner session.
- [x] Build `extensions/autotuner.ts` (provider + pre-switch + `/autotuner`) with six isolated tests.
- [x] Review all six existing extensions; fix Governor routing, local detection, config validation, reload delta, and validator timeout/availability/JSONC/TypeScript-focus/parallelism/footer issues.
- [x] Audit 85 skills; apply mechanical slimming (descriptions, governance paragraph, stale paths, unreachable project keys, five retirements).
- [x] Make Ponytail `full` the default in `pix.json` and document the research fit.
- [>] Run typecheck, 57 tests, skill lint, audits; update docs; commit, tag `v2.8`, push.

## Decisions
- The AutoTuner proxy on port 1233 carries chat traffic; llama-server stays on 1234. Pi-level reasoning mirrors AutoTuner's scanner verdict; no reasoning_effort is sent.
- Explicit environment credentials override a persisted "disabled" flag; only `AUTOTUNER_CONTROL_API_ENABLED` can veto them.
- Restored sessions are not pre-warmed; the first request switches, with the status line visible.
- Validator: killed = failure; code≠0 with no output = unavailable; foreign TypeScript diagnostics are shown but labelled, capped at eight.
- Governor: substring name matches removed, two-character tokens cannot route alone, generic verbs are stop words; headless local sessions keep Pi's full prompt.
- Retired skills move to the ignored `agent/skill-governor/retired/` folder instead of being deleted outright.

## Verification
- `npm --prefix agent run typecheck`, `npm --prefix agent test` (57 tests), `npm --prefix agent run skill:lint`.
- `npm --prefix agent audit --omit=dev`, `npm --prefix agent/npm audit --omit=dev`.
- Six extension loads in isolation; AutoTuner fake-gateway tests cover discovery, offline/online refresh, pre-switch, command paths, and credential precedence.
- Live AutoTuner test pending: the External control API is still disabled in the GUI (sidecar reports `enabled: false`).

## Blockers
- Live end-to-end switch cannot run until the user enables the External control API in AutoTuner; the fake gateway mirrors the documented contract.
