# v2.9 AutoTuner Reconnect, Unload on Quit, and pi-llama-cpp 0.10 Plan

## Goal
Ship `v2.9`: make the AutoTuner gateway connection survive AutoTuner restarts and Pi updates, unload a Pi-loaded model when Pi quits, and stop the post-update patch from warning about pi-llama-cpp 0.10's renamed constant, all regression-free.

## Findings (2026-09-05)
- The Pi 0.85.0 update did not change the extension API; typecheck and all v2.8 tests were green before any change.
- The real cause of the lost connection: AutoTuner rewrites `control_api.json` as `enabled: false` without a token whenever its gateway stops (app closed, API stopped, a second instance exiting). v2.8 treated that file as authoritative and hid every model even though `autotuner_settings.json` still said `control_api_enabled: true` with a valid token. Port 1233 was not listening at the time of the analysis.
- `pi-llama-cpp` 0.10.0 renamed `DEFAULT_LLAMA_SERVER_URL` to `LLAMA_SERVER_URL`; the package still honours the legacy global `llamaServerUrl` setting, so the warning was cosmetic.

## Steps
- [x] Credentials: a token-less sidecar falls back to the settings scan; only a persisted `control_api_enabled: false` or `AUTOTUNER_CONTROL_API_ENABLED=0` vetoes.
- [x] Late discovery: re-read credentials when `/model` opens while unconfigured and on every session start; re-register the provider with the real token after the refresh.
- [x] Unload on quit: `session_shutdown` with reason `quit` posts `/api/v1/stop` (10 s cap) when this Pi process loaded the model (judged by `active_since`), never on `/new`, `/resume`, `/fork`, `/reload`; `AUTOTUNER_UNLOAD_ON_EXIT=0` opts out; the flag survives `/reload` via `globalThis`.
- [x] pi-autoupdate: `patchLlamaServerUrlSource` accepts both constant names and keeps the one found; a missing constant is informational.
- [x] Governor frontmatter for the two new project-memory skills (BlenderAssets, Borealis-Signal-Godot) so skill lint stays green.
- [x] Tests: discovery precedence updated, late discovery, quit/unload matrix, patch helper, env parsing (61 tests).
- [ ] Live check against a running AutoTuner ≥ 5.4.1 with the External control API enabled: `/autotuner health`, `/model` listing, one switch, quit unloads.

## Decisions
- Reachability, not the sidecar's `enabled` flag, decides whether the gateway is usable; "nicht erreichbar" is the honest message while the settings say enabled.
- Only a real quit frees the GPU; every session-replacement shutdown keeps the model because the next session still uses it.
- A model that was active before Pi asked for it is not Pi's to unload.

## Verification
- `npm --prefix agent run typecheck`, `npm --prefix agent test` (61 tests), `npm --prefix agent run skill:lint`.
- Live: AutoTuner's control API was not running during this session (sidecar `enabled: false`, port 1233 closed); the fake gateway mirrors docs/control-api.md.
