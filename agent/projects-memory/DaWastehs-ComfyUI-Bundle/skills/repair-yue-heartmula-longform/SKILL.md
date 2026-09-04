---
name: "repair-yue-heartmula-longform"
created: "2026-07-28"
description: "YuE-Langform und HeartMuLa-Decoder in diesem Repo auf Windows-ROCm zuverlässig reparieren und validieren. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when the YuE workflow generates only one ~30-second segment, mmgp_profile turns red after manual selection, or HeartMuLa fails with a one-frame tensor mismatch such as 6431 vs 6430.

## Procedure
1. In `ComfyUI_YuE/yue_node.py`, treat `prompt_start_time` and `prompt_end_time` only as reference-audio crop controls; song length must use a dedicated `target_duration_seconds` input.
2. Plan YuE at 100 interleaved codec IDs per second (50 per track). Compute the required number of lyric sections from `ceil(target_seconds * 100 / max_new_tokens)` and distribute an exact even token count across those sections.
3. Pass each planned section count as both `min_new_tokens` and `max_new_tokens`; otherwise YuE can emit EOA early and an 18-section workflow may still produce only about two minutes.
4. Keep `run_n_segment` as the maximum usable lyrics-section count, provide 20 marked sections for the full 600-second range at 3000 tokens per section, and reject impossible duration/section combinations in `VALIDATE_INPUTS` before loading models.
5. Define `mmgp_profile` combo options as strings, persist the workflow value as a string such as `"2"`, normalize to int inside `loader_main`, and add `VALIDATE_INPUTS` so legacy integer workflows pass pre-execution ComfyUI validation.
6. For YuE reference audio, use the separate `YuE-s1-7B-anneal-en-icl` checkpoint and a connected optional ComfyUI `AUDIO` input with `use_audio_prompt=True`; keep the ordinary no-reference workflow on the CoT checkpoint with prompt switches disabled.
7. For HeartMuLa, keep `codec.decode_tokens(..., duration=29.76)` as the fixed codec chunk window. The OSS 3B pipeline has no reference-audio conditioning. Extend the UI to 600 seconds only with a prompt-dependent preflight against the 8192-position backbone context.
8. Copy the repo workflows into the matching live user-workflow directory only after validation, then restart ComfyUI to reload custom-node Python. Preserve distributable custom-node diffs under `tools/patches/`.
## Pitfalls
- Changing YuE `prompt_end_time` to 600 does not request a 600-second song; it only changes the selected reference-audio range.
- `run_n_segment` and a large `max_new_tokens` do not enforce duration by themselves. With `min_new_tokens=100`, sections can emit EOA early; this produced only 1:57 from the former 18-section preset.
- A loader-side `int(mmgp_profile)` alone cannot fix combo validation; ComfyUI may reject the value before calling the loader, so workflow migration plus custom validation are required.
- YuE audio prompting requires an ICL Stage-1 checkpoint. Do not advertise the CoT checkpoint as a reference-voice model.
- Single-track YuE ICL may use isolated vocals, a mix, or an instrumental, but it is style/audio conditioning rather than guaranteed identity-perfect voice cloning.
- Dynamic HeartMuLa decode duration can round latent and mask lengths differently. Keep 29.76 fixed.
- HeartMuLa `duration_seconds` is an upper limit and may end early on audio EOS. At 12.5 frames/s, 600 seconds also leaves little of the 8192-position context for long lyrics.
- Long-form YuE generation can take several hours on the R9700; validate the exact duration logic with a 10-second end-to-end smoke first.
## Verification
1. Query live `/object_info`: YuE exposes `target_duration_seconds` 5–600 plus optional `reference_audio`, and HeartMuLa exposes `duration_seconds` up to 600.
2. Unit-test the YuE planner: 117/480/540/600 seconds allocate exactly 11700/48000/54000/60000 codec IDs and require 4/16/18/20 sections at a 3000-token cap.
3. Use Comfy prompt validation to prove impossible duration/section combinations fail before execution and legacy integer `mmgp_profile` still validates.
4. Run separate 10-second end-to-end YuE CoT and YuE ICL-reference smokes; inspect saved audio and require exactly 10.00 seconds, finite samples, and 44.1 kHz output.
5. Run a HeartMuLa request above the former boundary (for example 301 seconds), confirm successful generation/decoding, and document that the produced audio may end earlier at EOS.
6. Verify downloaded ICL Safetensors shards against the index and open each shard header safely.
7. Confirm repo/live workflow hashes match, custom-node patches reverse-apply cleanly to the live modified repositories, and run JSON parsing, unit tests, regression validator, refinement checks, and `git diff --check`.
