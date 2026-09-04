---
name: "consolidate-comfyui-workflows-rdna4"
created: "2026-07-25"
description: "Consolidate and validate ComfyUI workflow folders for the L:/ComfyUI Windows RDNA4 setup. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when importing, reorganizing, renaming, deduplicating, or AMD-adapting workflows under `ComfyUI/user/default/workflows`, especially into `DaWasteh`.

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
