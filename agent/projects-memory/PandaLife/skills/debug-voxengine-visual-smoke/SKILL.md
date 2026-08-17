---
name: "debug-voxengine-visual-smoke"
created: "2026-07-09"
description: "Build and smoke-test PandaLife VOXEngine visual, camera, scene-sync, and Lua runtime issues. Manual-only: invoke for explicit native visual/runtime diagnosis; do not use for a narrow data-only edit."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and current engine/game state override this skill. It is manual-only because it builds and launches the native runtime. Run only the visual/camera/sync checks relevant to the reported defect.

## When to Use
Use when PandaLife native VOXEngine renders the wrong view, the FPS camera clips into geometry/player mesh, scene data seems stale, or smoke tests need verification.

## Procedure
1. Inspect the screenshot and compare `../VOXEngine/data/main.json` with `../VOXEngine/build/data/main.json`; runtime reads `build/data/main.json`, and `scripts/build-engine.bat` syncs source data into build.
2. For FPS camera artifacts, check whether the camera target/player mesh is being rendered around the camera. Use entity `"render": false` on `PandaHero` so its mesh is collision-only.
3. Keep `FPSCam` after `PandaHero` in the entity list so the camera updates after the player and avoids one-frame jitter.
4. Run `cmd //c "L:\\LAB\\PandaLife\\scripts\\build-engine.bat"` after source data or C++ changes.
5. Run `.venv/Scripts/python.exe scripts/test_smoke.py` with `VOX_SMOKE_TIMEOUT=30` when loading GateRoom/assets, then verify `Swapchain handle:` and `[Gameplay] Lua-API gebunden` appear with no `FATALER ENGINE FEHLER`.

## Pitfalls
- Do not edit only `../VOXEngine/build/data/main.json` unless it is a temporary runtime test; rebuild will overwrite it from `../VOXEngine/data/main.json`.
- If a light has `"shadows": null`, older SceneLoader code may throw a JSON type error unless it checks `is_string()` or the field is removed.
- Default smoke timeout can be too short while heavy assets/BVH load; use 30 seconds for visual/scene debugging.
- Lua UI scripts must initialize from the real `onUpdate` hook; `onUpdate_wrapped` is never called by ScriptController.
- Dynamic UI creation is exposed through the `Globals` table (`Globals.createPanel`, `Globals.createButton`), not bare global functions. Ensure `data/main.json` includes `ui.fonts` with `fontA` so button text renders.
- InputEventType numeric values are `Pressed=0`, `Released=1`, `Axis=2`; menu toggles should check `type == 0` for press events.
## Verification
1. Build exits successfully and links `VoxelEngine2026.exe`.
2. Smoke test prints `OK — Build + Lauf + Log-Scan bestanden.`
3. `../VOXEngine/build/data/main.json` contains the intended scene order and `PandaHero` has `"render": false`.
