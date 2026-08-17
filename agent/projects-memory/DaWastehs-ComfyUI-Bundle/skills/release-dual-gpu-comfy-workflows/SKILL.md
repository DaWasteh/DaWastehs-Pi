---
name: "release-dual-gpu-comfy-workflows"
created: "2026-08-10"
description: "Migrate, validate, live-test, deploy, and release collection-wide GPU, duration, adaptive-media, MiniMax/LTX/Wan workflow changes. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 9
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when changing collection-wide GPU placement, RODENT layouts, seconds-based media duration, adaptive media loaders, MiniMax H3/Music 3, LTX/Wan templates, or the port-8188 Windows-ROCm deployment in this repository.

## Procedure
1. Keep canonical changes in the repository; deploy to L:\ComfyUI\ComfyUI only after focused tests pass and a timestamped live backup exists.
2. Use tools/migrate_workflows_v092.py as the collection migration entry point. Compose newer versioned upgrades (currently tools/upgrade_v094.py) through it so v0.9.3 baselines deterministically reconstruct the checked workflows.
3. Keep one canonical workflow per task, exactly one root DaWMultiGPUDeviceControl, 28 curated GPU splits, all other profiles on gpu:0, and deterministic RODENT metadata.
4. For release-critical new nodes, prefer an already-managed custom-node pack when feasible. The adaptive Load Image/Video nodes live in ComfyUI-DaWasteh-MultiGPU-Control so the installed v0.9.3 updater deploys them on its first v0.9.4 run; a newly named static pack would require a second updater run.
5. Keep adaptive media crop-free: preserve source aspect ratio, round to model multiples, reject extreme unsupported ratios rather than crop/pad/distort, retain manual profile selection, and make ambiguous graph detection explicit.
6. For Wan Animate 2, keep cache cpu/int8; adaptive image width/height drive both subgraphs; visible seconds times the loaded pose-video FPS snaps to a minimum-5 4n+1 length; enable context windows only on the active subgraph and retain the second subgraph bypassed as an expert alternative.
7. Refresh generated notes in place when topology changes, but preserve authored note IDs/text unless that authored guidance is now false. Update both primary and secondary Wan extension notes when duration behavior changes.
8. Run migration check, focused adaptive/duration/GPU tests, full unittest discovery, validator against the pre-release baseline, PowerShell parsing, JavaScript syntax parsing, and git diff --check.
9. For live workflow proof, stop both servers, back up changed live files, deploy the exact repo pack/workflow, start R9700 on 8188, load the frontend graph in a real browser, serialize with graphToPrompt, submit a cheapest 5-frame/35%-quality prompt, verify execution_success and nonempty video dimensions/FPS, inspect WanTEModel warnings, then stop the server and remove smoke outputs while retaining deployed canonical files.
10. Run fresh-context correctness and release reviewers, apply evidence-backed findings, and repeat focused review when fixes change topology/docs.
11. Create a detailed release commit and annotated tag, validate post-commit with --baseline-ref set to the previous release (v0.9.3 for v0.9.4), push main and tag separately, and verify remote dereferenced hashes.

## Pitfalls
- HIP/PyTorch order is gpu:0 R9700 32 GB and gpu:1 RX 9070 XT 16 GB; Vulkan order differs.
- Do not recreate the legacy Dual GPU workflow folder or restore the two deleted redundant MiniMax H3 FL2VA variants.
- Static updater pack lists are evaluated before self-update; adding a brand-new required pack can deploy a broken workflow on the first upgrade run.
- A seconds-looking field can control segmentation rather than total duration. Keep duration mode and output FPS explicit.
- WanTEModel warnings are ComfyUI weakref-lifetime diagnostics, not measurements of accumulating RAM/VRAM. Do not add clear-VRAM nodes as a speculative repair; measure repeated-run growth and isolate reference holders.
- Do not refresh all customized historical notes wholesale. Refresh only generated notes whose targets changed and authored notes whose guidance became false.
- After a release commit, HEAD alone no longer proves the migration delta; use the previous tag as --baseline-ref.

## Verification
1. python tools/migrate_workflows_v092.py --check reports changed=0 and removed=0.
2. python -m unittest discover -s tests passes with only documented skips (v0.9.4: 197 tests, 20 skips).
3. python tools/validate_workflows.py --against-head reports 227 files, 280 graphs, 10,032 nodes, 4,558 notes, 6,934 links, 210 timers, errors 0.
4. After v0.9.4 commit, python tools/validate_workflows.py --against-head --baseline-ref v0.9.3 reports errors 0.
5. PowerShell parser, node --check for adaptive_media.js, and git diff --check succeed.
6. Browser graphToPrompt resolves both adaptive nodes to Wan automatically; a standard SDXL sibling-loader graph resolves SDXL/FLUX.
7. Windows-ROCm smoke produces nonempty 160x288, 5-frame, source-FPS video at the cheapest profile and logs no post-GC WanTEModel memory-leak warning in a clean run.
8. git status is clean; origin/main and dereferenced remote v0.9.4 equal the release commit.
