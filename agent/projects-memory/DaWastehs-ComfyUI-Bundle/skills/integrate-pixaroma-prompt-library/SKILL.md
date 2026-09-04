---
name: "integrate-pixaroma-prompt-library"
created: "2026-07-28"
description: "PixaromaPrompt und PixaromaPauseText manifestgesteuert in die Workflows dieses Repos integrieren und sicher releasen. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding, refreshing, or auditing Pixaroma Prompt/Pause Text integrations or the personal prompt library in this repository.

## Procedure
1. Use `tools/pixaroma_prompt_manifest.json` as the complete 186-workflow decision matrix; regenerate it from Git HEAD with `python tools/integrate_pixaroma_prompts.py --write-manifest`, never from already-mutated workflow widgets.
2. Keep system formulas, negative prompts, lyrics, TTS speech text, and transcripts unchanged. Connect `PixaromaPrompt` only to the human-editable idea/style/instruction field; Formula+Idea nodes use only `string_b`.
3. Apply with `python tools/integrate_pixaroma_prompts.py --apply --audit tools/pixaroma_prompt_audit.json`, then require `--check` to report zero pending changes.
4. Place `PixaromaPauseText` only after a TextGenerate-derived text chain and before an expensive CLIP-conditioned image/video/audio consumer. Preserve the old downstream link ID and create one reciprocal source-to-gate STRING link.
5. Install the personal library only through `python tools/install_pixaroma_prompt_library.py` while the ComfyUI queue is empty. Existing libraries require explicit `--replace` and are backed up first.
6. Run `python -m unittest discover -s tests -v`, the integrator check, `python tools/validate_workflows.py --workflows workflows --against-head`, both refinement check modes, and `git diff --check` before release.

## Pitfalls
- Do not accept marker presence as proof of a valid integration; exact Prompt/Pause schemas, state, reciprocal links, widget clearing, and HEAD hashes must match.
- Do not broadly exempt marked nodes from overlap or HEAD-delta validation. The validator must normalize only manifest-authorized changes and reject everything else.
- Preserve each workflow's original JSON style; one-line workflows must remain one-line to avoid massive formatting churn.
- A Pause node with `input.link=null` silently feeds empty text downstream even if its output link looks correct.
- Prompt tag expansion and Pause/Continue/Keep are frontend/browser features; pure headless API execution cannot prove them.

## Verification
1. Audit reports 186 files, 101 modified files, 98 prompt files, 111 Prompt targets, 9 Pause gates, and zero pending changes.
2. Validator reports 186 files, 222 graphs, 6,203 nodes, 2,709 generated notes, 4,059 links, 186 timers, and zero errors.
3. All 25 tests pass, including corruption tests for Prompt/Pause mode/type/link mutations and exact HEAD hash checks.
4. All marked nodes are collision-free; every Pause has TextGenerate ancestry and a reciprocal source-to-gate-to-target link chain.
5. Local `Pixaroma.Prompt.Library` contains 63 tags in 30 categories after installer verification, with an empty ComfyUI queue.
