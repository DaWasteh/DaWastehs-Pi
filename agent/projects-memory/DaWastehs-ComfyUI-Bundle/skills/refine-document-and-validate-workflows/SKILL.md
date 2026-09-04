---
name: "refine-document-and-validate-workflows"
created: "2026-07-26"
description: "Alle Workflows dieses Repos kollisionsfrei anordnen, nodespezifische Parameter-Notes erzeugen und Release-Invarianten prüfen. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding workflows or refreshing layout/parameter documentation in this repository, especially before a release that must preserve PixaromaNotes, links, and one root timer per workflow.

## Procedure
1. Ensure the matching local ComfyUI server is running and query `/object_info` read-only; never queue work while the user has an active job.
2. Run `python tools/refine_workflows.py --workflows workflows` for new/unmarked workflows. Use `--refresh-notes` only to update generated text without moving nodes.
3. For generated LoRA workflows, run `python tools/generate_lora_workflows.py` followed by the refinement tool; compare hashes after a second generate/refine cycle to prove deterministic output.
4. Run `python -m unittest tests/test_workflow_refinement.py -v`, then `python tools/validate_workflows.py --workflows workflows --against-head`, both refinement `--check` modes, and `git diff --check`.
5. Before staging, update the hard-coded collection totals in `tools/validate_workflows.py` and the matching README statistics whenever workflow count changes.
6. Stage only `.gitignore`, `README.md`, `workflows/`, `tools/`, and `tests/`; keep `.pi-subagents`, caches, and smoke artifacts out of Git.

## Pitfalls
- Do not naively zip `widgets_values` with object_info. Prefer visible `node.inputs[].widget` order when it fully explains persisted values; otherwise expand dynamic combos and `control_after_generate`.
- Never alter existing `PixaromaNote` dictionaries, existing link entries, `last_link_id`, or schema version. Treat PixaromaNotes as anchored layout obstacles.
- Do not persist dynamic combo option counts in note text; model/input lists change locally and break generator determinism.
- ComfyUI Core TrainLora on Krea 2 RAW BF16 is unsafe on this 32 GB VRAM / 48 GB RAM system even with offloading; omit the trainer.
- Boogu Image Base requires `offloading=true` to avoid OOM. FLUX.1 FP8 uses `training_dtype=none`, `quantized_backward=true`, and `bypass_mode=true`; keep its experimental warning.
- The `--against-head` validator must compare to the current Git baseline dynamically; do not hard-code the previous release's HEAD node/link totals.

## Verification
1. Validator reports the expected file, graph, node, generated-note, link, and timer totals with zero errors.
2. Every target node has exactly one generated MarkdownNote and every mapped widget name appears in its note.
3. Existing links and PixaromaNote dictionaries compare equal to HEAD; no node rectangles overlap.
4. All retained LoRA trainers complete a minimal train-and-save smoke test on the target AMD system, and saved Safetensors contain non-empty keys.
5. Git is clean after commit, `main` and the annotated version tag point to the same commit on origin.
