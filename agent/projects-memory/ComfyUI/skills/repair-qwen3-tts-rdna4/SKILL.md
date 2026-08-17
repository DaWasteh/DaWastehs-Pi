---
name: "repair-qwen3-tts-rdna4"
created: "2026-07-25"
description: "Diagnose and repair Qwen3-TTS workflows in the L:/ComfyUI Windows RDNA4 environment. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when Qwen3-TTS AILab or FB workflows fail to load/generate, report pad_token_id errors, cannot find models, or break after a ComfyUI dependency update.

## Procedure
1. Check `ComfyUI/user/comfyui_8188*.log` and `comfyui_8189*.log` for the exact Qwen stack and node prefix (`AILab_` versus `FB_`).
2. Verify `.venv` package versions and run `pip check`; current validated compatibility is `transformers==4.57.6` with `huggingface-hub==0.36.2`, while keeping the existing AMD ROCm torch wheels untouched.
3. Keep the exact pin in `L:/ComfyUI/qwen3-tts-constraints.txt` and ensure `update-comfyui-rdna4.ps1` installs it after core and Manager requirements.
4. Store all Qwen models in `ComfyUI/models/qwen-tts`; required 1.7B workflow models are CustomVoice, VoiceDesign, and Base. The AILab loader is locally patched to search this layout.
5. For AMD workflows use device `auto` and attention `sdpa`; do not install CUDA-only FlashAttention or SageAttention.
6. Validate workflow JSON programmatically: node types, links/backreferences, last IDs, widget indexes, saved-voice filenames, and model assets.
7. Test CustomVoice, VoiceDesign, and Base/VoiceClone separately. VoiceClone must exercise `create_voice_clone_prompt` because its speaker encoder can fail independently on ROCm.
8. Test at least one short generation on each GPU by setting `HIP_VISIBLE_DEVICES`/`CUDA_VISIBLE_DEVICES` before launching Python.
9. After winget installs SoX, restart the shell/ComfyUI so the refreshed PATH reaches the Python `sox` wrapper.

## Pitfalls
- Do not patch `pad_token_id` in model code as the primary fix; Transformers 5.x also causes RoPE/generation-quality incompatibilities. Pin the known-good 4.x version.
- Do not run generic pip upgrades that replace AMD ROCm torch/torchaudio with PyPI CUDA or CPU wheels.
- AILab and flybird bundle the same `qwen_tts` namespace; inspect the traceback path rather than assuming which node pack failed.
- AILab normally expects `models/TTS/Qwen3-TTS`; the local loader patch intentionally reuses `models/qwen-tts` to avoid multi-gigabyte duplicates.
- SoX absence is not the cause of 12 Hz CustomVoice/VoiceDesign/Base failures, although installing the binary removes the warning and supports 25 Hz helper paths.
- hipBLASLt `HIPBLAS_STATUS_NOT_SUPPORTED` warnings can recover through classic hipBLAS; treat them as nonfatal when generation completes with valid audio.

## Verification
1. `.venv/Scripts/python.exe -m pip check` reports no broken requirements.
2. Offline custom-node initialization registers all expected AILab and FB Qwen node types.
3. All ten local Qwen workflows pass structural validation and FB nodes use `sdpa` with portable device selection.
4. CustomVoice, VoiceDesign, and VoiceClone each produce non-silent 24 kHz WAV output on the R9700.
5. A short CustomVoice test produces non-silent WAV output on the RX 9070 XT.
6. `SoX v14.4.2` and Python `sox 1.5.0` are discoverable after a fresh shell starts.
