---
name: "consolidate-comfyui-workflows-rdna4"
created: "2026-07-25"
description: "Consolidate and validate ComfyUI workflow folders for the L:/ComfyUI Windows RDNA4 setup. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when importing, reorganizing, renaming, deduplicating, or AMD-adapting workflows under `ComfyUI/user/default/workflows`, especially into `DaWasteh - Neu`.

## Procedure
1. Back up the current target folder before changing it and leave source workflow folders untouched.
2. Inventory workflow purposes, exact/functional duplicates, node types, model widgets, media defaults, and CUDA/NVIDIA-only patterns.
3. Query the running ComfyUI `/object_info` when available; otherwise create a current offline snapshot and validate node types/dropdown values against it.
4. Curate unique capabilities into the existing English top-level structure; add task-oriented folders rather than importing tutorial trees wholesale.
5. Replace NVIDIA-only families (Nunchaku, nvfp4, CUDAExecutionProvider, hardcoded SeedVR2 cuda:0) with installed native FP8/BF16/GGUF alternatives or exclude them with a documented reason.
6. Parse and serialize workflow JSON programmatically. Update model/input widgets, preserve node IDs, and repair only demonstrably stale references.
7. Validate root graphs and every `definitions.subgraphs` graph recursively, including node/link IDs, slots, bidirectional backreferences, model/input files, auth-token leakage, and QwenTTS auto+sdpa settings.
8. Run a fresh read-only reviewer after changes and resolve every blocker before declaring completion. Keep a README index and machine-readable final audit outside the workflow JSON tree.

## Pitfalls
- Subgraph links are dicts, unlike top-level LiteGraph array links.
- Subgraph interface links use virtual endpoint IDs `origin_id=-10` and `target_id=-20`; never remove them as dangling. Cross-check all `inputs[].linkIds` and `outputs[].linkIds`.
- Do not put migration/audit JSON files inside a ComfyUI workflow folder because the UI may treat every JSON as a workflow.
- Naive repeated substring replacement can create doubled model paths such as `SDXL\\SDXL\\...`; make replacements idempotent and validate exact dropdown values.
- Validate nested widget dictionaries and nested subgraphs; main-graph-only checks miss models, media defaults, auth URLs, and malformed stages.
- Downloaded tutorial notes can mention CUDA without runtime use; scan node types and actual widgets separately from Note/Markdown text.

## Verification
1. Every workflow JSON parses and there are no case-insensitive filename collisions.
2. All root and nested subgraph links have valid endpoints/slots and matching node backreferences.
3. Every subgraph interface `linkId` resolves to a preserved -10/-20 boundary link.
4. All used node types resolve through current object_info, allowing only known frontend and local subgraph types.
5. All active model and media references exist and are valid dropdown values where applicable.
6. No Nunchaku, nvfp4, CUDAExecutionProvider, hardcoded CUDA-only widget, embedded Rh-Comfy-Auth/JWT, or QwenTTS non-auto/non-sdpa setting remains.
7. An independent fresh reviewer reports PASS with no blockers.
