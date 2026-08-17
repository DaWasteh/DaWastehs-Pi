---
name: "validate-pandalifesg"
created: "2026-07-09"
description: "Validate and smoke-test native VOXEngine-based PandaLifeSG across scene, Lua, controls, assets, and integration. Manual-only: invoke for explicit cross-cutting/runtime validation; do not use for a narrow local edit."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and current engine/game state override this skill. It is manual-only because it builds and launches a native runtime. Run only the requested validation stages; do not broaden a narrow edit into full runtime/release work.

## When to Use
Use after touching `../VOXEngine/data/main.json`, `../VOXEngine/data/scripts/*.lua`, VOXEngine C++ UI/input/runtime files, asset generators, launchers, or controls/menu behavior. The old single-file HTML app has been removed.

## Procedure
1. Build the engine from the PandaLife repo root with `rtk cmd //c "L:\\LAB\\PandaLife\\scripts\\build-engine.bat"` on Windows, or the shell build script on Linux.
2. For Lua/runtime-sensitive edits, start `L:\\LAB\\VOXEngine\\build\\VoxelEngine2026.exe` with CWD `L:\\LAB\\VOXEngine\\build`, let it run briefly, then terminate it; check stdout for Lua errors, asset load errors, crashes, and `setMouseLocked`/UI log messages.
3. For asset changes, confirm generated `.glb` files are in `../VOXEngine/data/objects/` and referenced from `../VOXEngine/data/main.json`.
4. Inspect `git -C ../VOXEngine status --short` and `git diff` carefully because VOXEngine is a sibling repo with its own pre-existing local changes.

## Pitfalls
- Do not run `npm test` for current PandaLife validation; current `package.json` has no test script and the old HTML smoke workflow is stale.
- `../VOXEngine/build/vox_tests.exe` currently contains tests for the old physics player controller and may fail unrelated to current FPS/fly-controller work unless the tests are updated.
- The game process does not self-exit during smoke; use a timeout/subprocess wrapper and terminate it after a few seconds.
- Pointer lock and mouse/UI behavior still need a real interactive window to fully confirm; a short process smoke only proves startup and Lua syntax/runtime initialization.

## Verification
1. Engine build completes and links `VoxelEngine2026.exe`.
2. Short runtime smoke starts the Vulkan window, loads scene/assets/scripts, reaches the main loop, and shows no Lua errors or crash before manual termination.
3. For controls/menu changes, manually verify: main menu visible at default and resized/maximized window sizes; buttons click; ESC pauses/resumes; mouse Y non-inverted in gameplay; Options can toggle Mouse Y if desired.
