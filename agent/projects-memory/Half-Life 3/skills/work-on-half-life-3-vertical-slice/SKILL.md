---
name: "work-on-half-life-3-vertical-slice"
created: "2026-07-09"
description: "Develop and verify the Half-Life 3 Borealis Signal browser vertical slice, including its expanded mountain level, combat audio, rendering, physics, and smoke gates. Do not use for unrelated project work or to broaden a smaller task."
version: 5
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use for the Borealis Signal rendering, weapon/audio, mountain-level, physics, or matching smoke-test path. Select only the section corresponding to the requested change.

## Rendering pipeline
Quality is controlled by `Renderer.setVideoProfile(quality)`.
- `PostFX.ts`: `RenderPass → GTAOPass → UnrealBloomPass → Vignette ShaderPass → FXAA ShaderPass → OutputPass`. `OutputPass` stays last.
- `PostFX.render()` returns `false` when disabled so low quality falls back to direct rendering.
- EnvMap is baked once with `PMREMGenerator` + `RoomEnvironment`; low quality clears it.
- `DecalSystem` caps at 32 recycled decals; keep the cap.

## Weapon and Gravity Gun rules
- `WeaponKey = 'pistol' | 'smg' | 'gravityTool'`; Gravity Gun is slot 3. Digit1/2/3 select, Q cycles.
- Left mouse grabs/holds, right mouse throws; `throwLocked` requires release+re-press.
- HUD shows infinity ammo for gravity tool; `weaponChanged` accepts `gravityTool`.

## Audio rules
- Every one-shot Web Audio chain must disconnect all source/oscillator and gain nodes on `onended`.
- Combine fire emits `weapon.smg.fire` only when the 0.75s attack cooldown actually produces a shot.
- `DeathAnnouncer` edge-triggers the death message once per death; never emit death messages per frame.
- Regression gate: `npm run test:audio`.

## Expanded mountain-level architecture
- Baseline floor is 38×52 = 1,976 m². The current map totals 70,706 m²: 1,976 m² lab + 1,130 m² interior floors + 260×260 = 67,600 m² exterior terrain.
- Progression: preserved reactor lab → equipment storage → generator cavern → frozen overflow → mountain exterior → ridge checkpoint.
- `LevelDefinition.bounds` owns X/Z player clamps. Do not restore hard-coded old bounds.
- Geometry `role: 'ground'` participates in Rapier grounding but not lateral Player AABB collision; `role: 'solid'` participates in both.
- `InteriorBuilder.expandCorridors` is the source of floor/wall/ceiling geometry for corridor segments.
- `TerrainMath.terrainHeight` is the single deterministic height source. `Terrain.ts` feeds the same vertices and explicit `Uint32Array` indices to the visible mesh and Rapier trimesh.
- Exterior entities use `terrainGroundY`; dominant ruin walls have both Player and Rapier collision.
- Keep exterior decoration instanced and shadow budgets bounded; do not replace the terrain with thousands of box colliders.
- The tunnel mouth at z=-116 must blend to baseHeight. Exit trigger Y must contain `terrainHeight + 1.72`.

## Pitfalls
- Live settings apply only in-game; before `bootstrap()` the active renderer/audio may be undefined.
- Run `tools/extract_hl2_textures.py` from repo root. Never commit generated `public/assets/legacy_hl2/*`, `public/assets/pbr/`, or `public/assets/rtx/`.
- Headless verification uses system Chrome (`channel: 'chrome'`).
- Keep the Rapier/renderer loop single-RAF and clamp accumulated deltas.
- Do not validate a changed build against a stale preview server. Start a preview on a separate free port and pass `SMOKE_URL`.
- Never kill all `node.exe` processes to restart Vite; stop only the process owning the chosen preview port.
- The exterior smoke must not fire the SMG from spawn or it empties before the exterior ambush; begin firing at the surface.
- The simple enemy AI has no navmesh; keep exterior encounters in the central valley.

## Verification
1. Audio-only changes: run `npm run test:audio`.
2. Level/physics changes: run `npm run test:level` plus a fresh-preview `mountain_smoke.mjs` on a dedicated `SMOKE_URL`.
3. Rendering/build changes: run `npm run build`; add `npm run analyze` only when bundle/performance scope changed.
4. Use `check_404.mjs` when routes/assets changed. Require the mountain smoke to reach only the checkpoints affected by the change and report no console/page errors.
5. Perform the full manual controls, puzzle, interior, terrain/collision, and free-roam smoke only for cross-cutting gameplay/release work.
