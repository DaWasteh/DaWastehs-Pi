---
name: "qwen3-tts-voice-lora-live-avatar"
created: "2026-08-01"
description: "Echte Qwen3-TTS-PEFT-Voice-LoRAs auf Windows-RDNA4 trainieren, laden und mit LivePortrait/Spout/OBS integrieren. Manual-only; do not use for unrelated work."
version: 4
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding, updating, debugging, or releasing Qwen3-TTS voice-LoRA training/inference or combined LivePortrait+Spout+OBS workflows in this repository.

## Procedure
1. Use the bundled custom node pack under custom_nodes/ComfyUI-DaWasteh-Qwen3TTS-LoRA; install with tools/install_qwen3_tts_lora_node.py against L:/ComfyUI/ComfyUI only when the :8188 queue is empty.
2. Keep qwen3-tts-comfyui or ComfyUI-Qwen-TTS installed as the qwen_tts runtime. Use Qwen3-TTS 12Hz Base 0.6B for the first smoke test, the 12Hz tokenizer, BF16 through the Windows-ROCm cuda/HIP alias, and SDPA.
3. Prepare audio/transcript pairs as <stem>.<audio-ext> + <stem>.txt or <stem>_Text.txt. Read UTF-8 BOM-tolerantly, normalize audio to 24 kHz mono, and start with learning rate 2e-6, batch 1, accumulation 4, rank 16, alpha 32, and one epoch.
4. Declare numeric-looking ComfyUI COMBO choices such as lora_rank as strings in INPUT_TYPES and generated workflow JSON, then validate and convert them to integers inside the node before passing them to PEFT.
5. Store adapters under models/qwen-tts/loras/<voice>/checkpoint-epoch-N with adapter_model.safetensors, adapter_config.json, speaker_embedding.safetensors, and qwen3_tts_speaker.json. Publish through a staging directory and rollback-safe rename.
6. Include adapter file signatures in both ComfyUI IS_CHANGED and the in-process model-cache key. Clear the cache before/after training so retraining the same path cannot reuse stale weights.
7. Generate the training, low-latency voice, and LiveAvatar-04 workflows using tools/generate_voice_lora_workflows.py. The generator must directly refine its output and use the fixed portable default my_voice/checkpoint-epoch-1.
8. In the combined LivePortrait workflow use PlaySoundKJ mode on_change and fixed TTS inputs so webcam Auto Queue reuses cached audio rather than speaking every frame. OBS captures browser/application audio; Spout carries RGBA video only.
9. Install the three generated workflows byte-identically under L:/ComfyUI/ComfyUI/user/default/workflows/DaWasteh in their matching category folders.
## Pitfalls
- ACE-Step voice LoRAs target singing/music, not speaking-avatar TTS.
- The official Qwen3-TTS path and flybirdxx FB_Qwen3TTSTrain are full SFT, not PEFT LoRA.
- Numeric Python values inside a ComfyUI COMBO can be rendered/queued as strings by current frontends and then fail prompt validation (`'16' not in [8, 16, 32, 64]`). Use string choices/defaults and normalize after validation.
- Do not accept arbitrary unmatched transcript files. Prefer exact <stem>.txt, then the explicit <stem>_Text.txt alias, case-insensitively.
- PEFT 0.19.1 rejects the shared torchao 0.9.0 even for ordinary Linear layers; disable only PEFT's torchao LoRA dispatcher and keep the standard dispatcher instead of upgrading shared torchao blindly.
- Tail gradient-accumulation groups must divide by their actual size; a one-sample dataset with requested accumulation 4 must divide by 1.
- Do not serialize or load pickle/torch.load voice adapters. Use Safetensors plus JSON only.
- ComfyUI voice output is low-latency request-based complete-clip TTS, not continuous microphone voice conversion. State this clearly.
- Do not derive serialized workflow defaults from the live adapter dropdown; that makes generator output machine-dependent.
- Do not install LivePortrait/Jovi requirements wholesale in the shared ROCm venv.
## Verification
1. Run 1-sample/1-epoch 0.6B training on the R9700 and confirm 462 nonempty LoRA tensors plus a nonempty speaker embedding with no staging/backup leftovers.
2. Run adapter inference and verify finite nonempty 24 kHz mono audio. Touch or republish adapter files and rerun the same prompt; the inference node must not appear in execution_cached.
3. Run the combined LiveAvatar-04 API smoke and verify a nonempty 1024x1024 RGBA image with alpha range 0..255 plus finite Voice-LoRA audio.
4. Run python -m unittest discover -s tests -v, validate_workflows.py --against-head, refine_workflows.py --check, integrate_pixaroma_prompts.py --check, and git diff --check.
5. Run the voice workflow generator twice and compare bytes. Compare installed node-pack files and installed workflow files byte-for-byte with repository sources.
6. Before release, obtain independent review of cache invalidation, accumulation, atomic publication, bounded dependencies, runtime validation, generator determinism, and installer behavior.
