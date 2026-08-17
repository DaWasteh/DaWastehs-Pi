---
name: "release-live-avatar-workflows"
created: "2026-08-02"
description: "Implement, validate, and deploy generated Live Avatar workflows from the DaWasteh source repository. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 4
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when adding or changing Live Avatar templates, DaWasteh LiveAvatar nodes, DirectML supervisors/benchmarks, Workflow-13 view generation, Workflow-14 Hunyuan3D mesh generation, or runtime deployment under L:/ComfyUI.

## Procedure
1. Treat L:/GitHub/DaWasteh ComfyUI Nodes as the only source of truth; do not edit runtime custom-node/workflow copies first.
2. Edit workflow JSON programmatically. When nested subgraph inputs override inner widgets, update and test the effective parent-instance widgets as well as the child defaults.
3. Regenerate committed workflow JSON from assets/live-avatar-v080 templates and compare generated/committed bytes.
4. Update assets/live-avatar-v072/object-info.json whenever a custom node's inputs, outputs, or OUTPUT_NODE status change.
5. Run every tests/test_*.py file from the repository working directory, Python compilation, PowerShell parser checks, the full validator with --against-head, and focused release validation with --skip-collection-totals.
6. For Workflow 12, keep the shipped config disabled, bind typed identity/model/sender placeholders, use a token file, probe token/Origin denial, verify listener/process identity, and require multiple changing frames from the per-run Spout sender before READY.
7. For Workflow 14, use only installed ComfyUI-Core Hunyuan3D shape nodes on AMD. Keep CUDA-oriented nvdiffrast/paint wrappers out, label output untextured/unrigged, and resolve the newest allowlisted Workflow-13 views rather than a hardcoded counter.
8. Back up installed node/workflow directories, mirror the source custom node excluding caches, copy all Live Avatar JSONs, then compare both directory trees byte-for-byte.
9. Confirm L:/ComfyUI/ComfyUI git status still contains only pre-existing tracked changes. If ComfyUI was running during node sync, require a restart before live object-info validation.

## Pitfalls
- Do not count fixed-rate Spout presentations or duplicate pixels as AI frames.
- Workflow 12-I is preflight-only; it never creates a sender by itself.
- LivePortrait is face/head-only. OpenPose or better cropping cannot add hand/torso deformation to Workflow 12-II.
- Workflow 08 edits a flattened UV texture at low denoise; it does not create geometry, and prompt/seed influence is intentionally weak.
- Changing an inner Qwen prompt has no effect when the nested subgraph prompt port is connected to a parent-instance widget.
- Do not hardcode `_00001_` for generated semantic assets; resolve the newest allowlisted nonempty output safely.
- Workflow-14/Hunyuan3D must receive tightly isolated foreground views. Dark-background Workflow-13 PNGs produced empty meshes or background planes; run RMBG first and inspect the rendered GLB, not just SaveGLB success. Even RMBG multiview can fragment, while a single-view RMBG fallback may yield usable static geometry.
- A successful SaveGLB node may return an empty `3d` list when VoxelToMesh is empty. Check that a nontrivial GLB exists and render it in Blender before accepting the run.
- Do not run repository tests from L:/ComfyUI; several tests depend on the source-repository working directory.
- The full validator uses --against-head because historical baseline workflows contain grandfathered issues.
- Windows PowerShell 5.1 may not expose Get-FileHash; use .NET SHA-256. typeperf CSV may be cp1252 rather than UTF-16.
- Never enable external face-swap candidates without licensed runtimes/models and a fail-closed consent record.
## Verification
1. All tests/test_*.py files pass from the repository working directory.
2. tools/validate_workflows.py --workflows workflows --against-head reports errors=0.
3. The v0.8 generator reproduces all five Workflow-12–14 release files byte-for-byte.
4. Focused validation reports five files, fourteen graphs, and zero errors.
5. Workflow-12 PowerShell files parse, and the supervisor integration test passes.
6. The disabled example is rejected before process launch.
7. Source/runtime node and all sixteen Live Avatar workflow files are byte-identical.
8. After restarting ComfyUI, live object_info contains DaWastehLatestLiveAvatarOutput and the new face-crop inputs.
9. A 24-AI-FPS claim is published only after separate 600-second 720p/1080p measurements with unique FPS >=24 and p95 <=41.67 ms.
