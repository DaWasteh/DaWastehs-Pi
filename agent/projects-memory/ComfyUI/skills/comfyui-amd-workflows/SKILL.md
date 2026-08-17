---
name: comfyui-amd-workflows
description: "Building and repairing ComfyUI workflow JSONs on AMD GPUs (RDNA4 locally, RDNA2 for Kevin's RX 6800). Use for any ComfyUI error, workflow graph edit, face-preservation/FaceID pipeline, ACE-Step audio generation, IPAdapter/InsightFace issue, or comfyui-rocm installation/repair. No CUDA exists on these machines. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# ComfyUI on AMD — Workflow & Repair Rules

## Environment
- Local: Windows 11, RX 9070 XT / R9700 (RDNA4). Kevin (remote support): RX 6800 (RDNA2, gfx103x), Ryzen 7 5800X, 32 GB RAM, path `C:\Users\kevin\Downloads\comfyui-rocm-...`.
- **Never propose CUDA nodes/args.** InsightFace and ONNX face models run on **CPU** (stable) — never ROCm EP.

## Editing workflow JSONs
Always edit programmatically (Python: parse nodes/links, print graph, modify, re-serialize) — never hand-edit link IDs. Verify after every edit: every input link resolves, every output link's target exists, `last_node_id`/`last_link_id` updated.

Recurring pitfalls:
- **Widget value ORDER matters** (e.g. IPAdapter: `[weight, start_at, end_at, weight_type]`) — a string on a float slot fails silently or with "Value not in list".
- **weight_type / preset names are version-specific.** Read the installed node pack's valid lists from the error message; e.g. `'standard'` may not exist, `'linear'` does; preset `'FACEID PLUS V2'` may not exist, `'PLUS FACE (portraits)'` does.
- **KeyError: 'clipvision'** and similar = missing required input wiring on IPAdapter nodes (ipadapter/insightface/clip_vision inputs unconnected), not a model problem.
- Never mix SD1.5 and SDXL components in one pass (architecture mismatch).
- LoadImage widgets must reference files actually present in ComfyUI's `input/` folder.

## Face-preservation recipe (proven 3-pass pipeline)
1. **Scene pass**: img2img, denoise ~0.70, CFG ~6.5, dpmpp_2m_sde/karras — pose/scene without identity.
2. **FaceID pass**: same-architecture checkpoint + IPAdapterFaceID (InsightFace on CPU), denoise ~0.35, CFG ~5.0, FaceID weight 0.9–1.0.
3. **FaceDetailer polish**: SAME FaceID model wired in (identity survives the polish), denoise ~0.35, `face_yolov8m` bbox + skin seg, guide_size 768 for SDXL.
SDXL settings: CFG 5–6.5 (not 8–9), karras scheduler. Add a Preview node after each pass.

## ACE-Step audio (local)
ACE-Step 1.5 XL runs on RDNA4 with no CUDA deps; reference audio/timbre via the native `ReferenceTimbreAudio` node (requires ComfyUI >= 0.12.0). Prefer native nodes over custom-node workarounds.

## comfyui-rocm on RDNA2 (Kevin)
- Official ROCm Windows wheels support RDNA3/RDNA4 only → RDNA2 needs the patientx/comfyui-rocm fork.
- torch + ROCm SDK nightly wheels must match as a SET: fetch all relevant index pages (torch, torchvision, torchaudio, rocm meta/core/devel/gfx103x libs), intersect available Windows cp312 tags, install the newest COMPLETE set. Single-package pinning always ends in version mismatch.
- Corrupt installs (interrupted extraction → `ModuleNotFoundError: torchgen`, broken RECORD): resumable curl downloads + `pip install --ignore-installed --no-deps`, never `--force-reinstall` into resolver backtracking.
- Harden install.bat: debug mode on, tool checks (git/curl/tar), visible GPU detection, errorlevel checks, pause on failure.

## Verification
1. For workflow edits, parse the changed JSON and validate only its node types, widgets, reciprocal links, IDs, and referenced local assets.
2. Query current `/object_info` when node/schema compatibility changed; do not run a live generation for a note/layout-only edit.
3. Run one short queue smoke only for executable graph/model changes and confirm the queue returns idle.
4. Dependency/ROCm installation repair requires its own explicit approval and environment verification; it is not part of ordinary workflow validation.
