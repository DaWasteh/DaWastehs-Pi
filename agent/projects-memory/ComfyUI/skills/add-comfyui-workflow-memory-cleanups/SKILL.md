---
name: "add-comfyui-workflow-memory-cleanups"
created: "2026-07-31"
description: "Safely add KJNodes VRAM cleanup barriers to RAM/VRAM-heavy ComfyUI UI workflows. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when personal workflows under ComfyUI/user/default/workflows/DaWasteh need automatic model/VRAM cleanup at safe model-phase or terminal boundaries without disabling Smart Memory.

## Procedure
1. Run `_add_memory_cleanup_nodes.py` without `--apply` and inspect the dry-run candidate and placement report.
2. Create and verify a full ZIP backup of the personal workflow tree before any edit. Keep Pixaroma, WhatDreamsCost, and training workflows outside the mutation scope.
3. Use pre-decode cleanup only for a single final sampler directly feeding a single decoder through an exclusively consumed latent edge.
4. Use terminal cleanup only when `placement_barrier_gaps()` proves every active heavy sampler/encoder/decoder is an ancestor of the cleanup source. Reject independent Preview/ShowText branches that do not dominate the heavy graph.
5. For reviewed two-branch LTX/WAN workflows, use one dual-input VRAM_Debug barrier: ANY plus IMAGE inputs force both heavy branches to finish before unload; pass both values onward.
6. Apply with `_add_memory_cleanup_nodes.py --apply`. The tool inserts `VRAM_Debug` with `widgets_values=[true,true,true]`, marks nodes with `dawasteh_memory_cleanup`, splits links programmatically, writes atomically, backs up actionable files, and emits an audit.
7. Validate all 193 root graphs and every definitions.subgraphs graph: unique IDs, endpoints/slots, bidirectional backreferences, last IDs, marker schema, terminal liveness, and idempotency with zero remaining actions.
8. Run a fresh read-only reviewer. If it finds an unsafe marker, back up that file, use `remove_marked_cleanup()` to restore the split edge, add liveness enforcement, rerun all validation, and obtain a clean review.

## Pitfalls
- Never insert cleanup blindly before every VAE in LTX/WAN multi-stage or parallel workflows; it can unload models needed by another pending branch.
- A unique Save/Preview/Text sink is not automatically a terminal barrier. Prove dominance over all active heavy compute nodes.
- KJNodes VRAM_Debug is not an OUTPUT_NODE; it must lie on a path to an output/save node. Dual barriers must route both pass-through outputs onward.
- Do not add cleanup to LoRA/training workflows because optimizer/trainer state can be invalidated.
- YuE and HeartMuLa may retain custom-node model references outside ComfyUI model management; terminal GC/empty-cache helps but cannot guarantee complete RAM release.
- Task Manager may still show ROCm driver/runtime allocations after all tracked models are unloaded.

## Verification
1. Dry-run reports zero actionable files after application.
2. All personal workflow JSON files parse; root and subgraph link validators return zero errors.
3. Every managed node has the installed KJNodes input/output order and all three cleanup widgets enabled.
4. Every terminal marker has zero `placement_barrier_gaps`; pre-decode markers meet the single-sampler/single-decoder rule.
5. Backups pass ZIP integrity checks and audit counts match changed files and inserted nodes.
6. Independent reviewer reports PASS with no blockers.
