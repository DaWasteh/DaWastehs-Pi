---
name: "consolidate-ace-autosongwriters"
created: "2026-08-14"
description: "Maintain, validate, deploy, and release the two ACE-Step 1.5 XL SFT AutoSongwriter genre-selector workflows. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when changing the Gemma 4 or Qwen 3.5 ACE-Step AutoSongwriter workflow, its genre profiles/custom mode, the DaWasteh AutoSongwriter custom node, collection membership, or post-v0.9.3 release validation.

## Procedure
1. Keep exactly two canonical files under workflows/Music Generation: the Gemma4_e4B and Qwen3_5_4B AutoSongwriter-Genre-Selector workflows.
2. Maintain profile logic in custom_nodes/ComfyUI-DaWasteh-AutoSongwriter/profiles.py. Preserve POP/GLOW/DRIVE/CLUB/NIGHT/RUSH BPM, key, direction, and filename prefixes; CUSTOM uses user text/BPM/key and CUSTOM_Track.
3. Route selector outputs reciprocally to StringConcatenate musical direction, TextEncodeAceStepAudio1.5 BPM/key/language, and SaveAudioMP3 filename_prefix. Keep the language embedded in the LLM direction block as well as linked to ACE-Step.
4. Regenerate deterministically with tools/consolidate_ace_autosongwriters_v093.py. Source paths must win while old sources exist; committed targets must pass their SHA-256 integrity marker after consolidation.
5. Update updater-owned node packs, collection membership/totals, Pixaroma unmanaged-path expectations, duration counts, README, and docs when graph count or membership changes.
6. Run the full unittest suite, both migration checks, workflow validator against the correct baseline tag, PowerShell parsing, git diff --check, and fresh-context review.
7. After a clean release commit, deploy through tools/update-comfyui-rdna4.ps1 so files come from committed blobs. Confirm byte parity and absence of all 14 legacy source paths.
8. For live acceptance, start Port 8188 with start-MultiGPU.ps1, confirm DaWAutoSongwriterGenreSelector appears in /object_info, then queue one short Gemma preset run and one Qwen CUSTOM run. Require execution_success and nonempty audio outputs before tagging/pushing.

## Pitfalls
- Do not let desired_targets prefer an existing target while a valid v0.9.2 source still exists; that can preserve stale data and then delete the canonical source.
- Do not treat CUSTOM as only a free-text prompt: BPM, key, lyrics language, and output prefix must remain concrete backend inputs.
- ComfyUI TextGenerate dynamic API inputs serialize as sampling_mode.temperature, sampling_mode.top_k, sampling_mode.top_p, sampling_mode.min_p, sampling_mode.repetition_penalty, and related prefixed names.
- The updater deployment manifest records one commit. Amend before deployment, or rerun the updater after an amend so source_commit remains truthful.
- Server startup logs can include unrelated optional Triton import errors. Judge the AutoSongwriter smoke from prompt history execution_success, registered selector schema, and nonempty output files.

## Verification
1. python -m unittest discover -s tests reports all tests passing with only documented skips.
2. python tools/migrate_workflows_v092.py --check and python tools/consolidate_ace_autosongwriters_v093.py --check report zero changes/removals.
3. python tools/validate_workflows.py --against-head --baseline-ref v0.9.2 reports 227 files, 280 graphs, 10,028 nodes, 4,556 notes, 6,927 links, 210 timers, and zero errors.
4. PowerShell parses tools/update-comfyui-rdna4.ps1 and git diff --check is clean.
5. Live Gemma preset and Qwen CUSTOM prompts both finish successfully and save nonempty profile-named MP3 files.
6. origin/main and dereferenced v0.9.3 (or the current release tag) equal the release commit; git status is clean.
