---
name: "improve-realistic-live-avatar-workflows"
created: "2026-08-01"
description: "Improve realistic adult Live Avatar references, VRM motion, timer-free workflows, persistent Spout, and recorded OBS acceptance in this repo. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding realistic adult character references or models, tuning Workflow 07/10, improving hands or VRM0 spring motion, fixing OBS Spout delivery, or performing visible Live Avatar acceptance.

## Procedure
1. Keep capability tiers explicit: Workflow 06 is real-time browser VRM; Workflow 07/11 is a slower Buffered AI Mirror; Workflow 10 generates 2D references only and does not rig a VRM.
2. Keep every `workflows/Live Avatar/*.json` and template timer-free; authorize only reviewed node replacements against HEAD with exact hashes.
3. For VRM tracking, construct VRM before pruning joints, capture model rest quaternions, compose deltas relative to rest, clamp/slew-limit hands plus body/legs, reject degenerate palms, and decay occluded targets toward rest.
4. Use authored VRM0 spring chains only; cap physics delta at 50 ms and reset springs on swaps, calibration, and long pauses.
5. When separate Hunyuan head geometry has poor texture fidelity, retain the validated body rig and use `tools/blender/add_face_decal_vrm.py` with a local alpha-feathered authorized face RGBA. Bind it to the humanoid Head bone and preserve Blink/Blink_L/Blink_R/A/I/U/E/O morphs. Keep the resulting blend, VRM, texture, and portrait out of Git.
6. Use `DaWastehPersistentSpout` for latest-frame OBS retention. Count generated AI frames separately from repeated presentations and validate with an independent receiver.
7. Use isolated temporary OBS scenes/profiles for acceptance, restore all production configuration afterward, and never start a stream during tests.
8. Sync workflows and custom-node runtime to `L:/ComfyUI/ComfyUI`, restart only the required server with an empty queue, and stop all temporary Chrome/ComfyUI/Blender/test processes before release.
## Pitfalls
- A realistic 2D reference does not improve a low-poly VRM's body geometry, hands, rig, or hair physics; a face decal improves frontal identity only and must be described as hybrid, not volumetric reconstruction.
- The tested native Hunyuan multiview conditioner can fragment human geometry; do not promote its output without neutral multi-axis renders.
- Workflow 06 never creates a Spout sender; capture its browser window. Workflow 07/11 uses Persistent Spout and repeated transport is not new AI FPS.
- Wrong camera indices can capture virtual screens or UI; identify the physical camera before blaming generation.
- Do not use Chrome's unsupported `--use-fake-ui-for-media-stream` flag on this system. Grant `videoCapture` through CDP for automated fake-camera tests.
- Running refinement with `--refresh-notes` can alter HEAD-pinned notes; update exact authorized node hashes only after reviewing regenerated deltas.
- Do not commit local VRM, blend, portrait, face texture, recording, or benchmark artifacts. Commit only reproducible tools, templates, docs, tests, and generated frontend assets.
## Verification
1. Run `L:/ComfyUI/.venv/Scripts/python.exe -m unittest discover -s tests -v`; expected v0.8.5 baseline is 134+ tests with only the documented optional source skip.
2. Run `npm ci`, frontend tests, and the production build. Confirm 29 tracking tests pass and only the known MediaPipe non-module/bundle-size/npm-audit warnings remain.
3. Run both LiveAvatar workflow generators, `refine_workflows.py --check` with the pinned object-info fixture, `validate_workflows.py --workflows workflows --against-head`, and `git diff --check`.
4. Confirm validator totals are 233 files, 279 graphs, 8126 nodes, 3366 notes, 5667 links, and 216 timers; all Live Avatar workflows remain timer-free.
5. For v5, confirm the local VRM is below the 32 MiB route limit, the model list exposes it, Blink/vowel morphs exist, and frontal browser output visibly uses the authorized source face.
6. Confirm browser metrics distinguish tracking/render rates and achieve at least 24 render FPS; retain exact screenshot/JSON evidence outside Git.
7. Verify repo↔runtime synchronization and ensure ports 8188, 8189, and the temporary CDP port are no longer listening before commit.
8. Run final `git status`, inspect generated Vite hash replacement, ensure local binaries/media are untracked/absent, then commit, tag, and push.
