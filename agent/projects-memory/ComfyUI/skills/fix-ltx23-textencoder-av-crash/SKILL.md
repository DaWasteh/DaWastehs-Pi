---
name: fix-ltx23-textencoder-av-crash
description: "Fix LTX-2.3/LTXAV ComfyUI workflows crashing in preprocess_text_embeds (\\\"got 4 and 3\\\") because a raw Gemma text encoder or missing AV latent/audio pipeline is wired. Use for LTX-2.3 workflow repair on H:/ComfyUI. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# ComfyUI LTX-2.3 Text Encoder + AV Latent Repair

## Root cause
Core `CLIPLoader(type=ltxv)` plus a generic Gemma 3 12B file can auto-detect raw `gemma3_te` output (4D, no projection, no `unprocessed_ltxav_embeds`) and crash LTXAV `preprocess_text_embeds` with `got 4 and 3`.

## Text encoder fix
- Copy/read `ltx-2.3_text_projection_bf16.safetensors` from `models/checkpoints` because `LTXAVTextEncoderLoader` hardcodes its projection input there.
- Replace the CLIPLoader node with `LTXAVTextEncoderLoader` from `comfy_extras/nodes_lt_audio.py`.
- Widgets: Gemma file from `text_encoders`, projection file from `checkpoints`, preset `default`. Keep CLIP output links to CLIPTextEncode nodes.

## AV latent/audio pipeline
Insert and wire:
- `LTXVEmptyLatentAudio` (requires `audio_vae` input).
- `LTXVConcatAVLatent` before sampler latent input.
- `LTXVSeparateAVLatent` after sampler output.
- `LTXVAudioVAELoader` + `LTXVAudioVAEDecode`; route decoded audio into `CreateVideo.audio`.

Preferred Audio VAE is standalone `LTX23_audio_vae_bf16.safetensors` copied from `models/vae/LTX` into `models/checkpoints/LTX`. The full 22B checkpoint also works but reads far more data.

## Editing rules
- Look nodes up by TYPE, not id; distilled workflows have shifting ids.
- Keep MODEL/LoRA/sampler/CFG/scheduler untouched unless the user asked for those changes.
- Update `last_node_id`/`last_link_id`, avoid duplicate link ids, and tell the user to reload the workflow file from disk.

## Pitfalls
- ComfyUI keeps the open workflow in memory; file edits do nothing until reopen.
- Projection and Audio VAE loader both read from `checkpoints`, not `text_encoders`/`vae`.
- Video-only latent is not enough for LTX-2.3; official blueprints use AV concat/separate.
- Do not replicate the full 46-node official workflow when only text encoder + AV latent repair is needed.

## Verification
- CLIPLoader is gone; `LTXAVTextEncoderLoader` is present with Gemma + projection widgets.
- AV nodes and Audio VAE decode chain are wired with no dangling links.
- Sampler latent input is fed by `LTXVConcatAVLatent`; decode gets video latent from `LTXVSeparateAVLatent`.
- Queueing no longer raises `got 4 and 3` in `preprocess_text_embeds`.
