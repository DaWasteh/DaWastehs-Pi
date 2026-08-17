---
name: "validate-pandalife-voxengine"
created: "2026-07-13"
description: "Validate coordinated PandaLife game and VOXEngine engine changes without testing stale mirrored data. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use after changing PandaLife gameplay/assets/tests or VOXEngine code used by PandaLifeSG in L:/LAB.

## Procedure
1. Check both repositories independently with `git -C L:/LAB/PandaLife status --short --branch` and `git -C L:/LAB/VOXEngine status --short --branch`; do not mix their diffs or commits.
2. Treat `L:/LAB/PandaLife/data` as canonical game data. Never validate gameplay by launching the engine immediately after CMake SyncAssets without applying the PandaLife overlay.
3. Run Python syntax and JSON checks, then `L:/LAB/PandaLife/.venv/Scripts/python.exe L:/LAB/PandaLife/scripts/test_assets.py`.
4. Run `vox_tests.exe` from `L:/LAB/VOXEngine`; confirm its printed player source is the explicit Engine mirror. Then run `L:/LAB/PandaLife/.venv/Scripts/python.exe L:/LAB/PandaLife/scripts/test_player_l2.py` and confirm it prints the canonical `PandaLife/data/scripts/player_fps.lua` source.
5. Run `L:/LAB/PandaLife/.venv/Scripts/python.exe L:/LAB/PandaLife/scripts/test_smoke.py`; this builds first, overlays canonical data second, then asserts the full game scene and launches.
6. For menu/game-start changes, run `scripts/click_test.py` and require `onClick_new_game=True`, `reached_playing=True`, and wave 1. For a stale-overlay rendering regression, additionally capture/read a post-click screenshot and verify the main-menu panel is gone.
7. Run `git diff --check` in each modified repo, review final diffs separately, and make separate local commits per repo; do not push without explicit approval.
## Pitfalls
- CMake SyncAssets wipes build/data and restores VOXEngine/data, so overlay must happen after every build.
- Direct engine launch can silently use the engine demo scene and false-pass gameplay smoke tests.
- A direct VOXEngine `vox_tests` run intentionally tests the Engine mirror. Only `PandaLife/scripts/test_player_l2.py` proves canonical Player-L2 coverage; verify the printed resolved path.
- UI visibility can be correct on the CPU while stale GPU quads remain if renderer dirty flags are mishandled. A wave-start marker alone does not prove the menu disappeared; use the RenderStorage dirty-mask tests and a post-click visual capture for this regression class.
- GLM subagents may disconnect or hit acceptance/turn-budget limits after useful work. Inspect status/artifacts and send a short `Weiter` resume message before replacing the run.
- Do not allow concurrent writers in the same repo; use read-only reviewers around one writer.
## Verification
1. Canonical asset test reports all seven GLBs OK.
2. VOXEngine-cwd doctest reports the current suite green and prints `VOXEngine/data/scripts/player_fps.lua` (currently 38/38, 324 assertions).
3. `PandaLife/scripts/test_player_l2.py` reports the same suite green against canonical `PandaLife/data/scripts/player_fps.lua` (currently 38/38, 329 assertions).
4. Runtime smoke reports Build + Overlay + Game-Szene-Load passed.
5. When applicable, click test reports `onClick_new_game=True`, `reached_playing=True`, and wave 1; a post-click screenshot contains HUD/gameplay but no main-menu panel.
6. `git diff --check` passes and only intended files appear in each repository's final status.
