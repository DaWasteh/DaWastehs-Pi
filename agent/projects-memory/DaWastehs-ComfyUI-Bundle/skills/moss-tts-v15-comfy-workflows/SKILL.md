---
name: "moss-tts-v15-comfy-workflows"
created: "2026-07-27"
description: "MOSS-TTS Local v1.5 Workflows in diesem Repo bauen, dokumentieren und sicher validieren. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding, changing, or validating MOSS-TTS Local Transformer v1.5 ComfyUI workflows in this repository.

## Procedure
1. Use node pack https://github.com/Saganaki22/Moss_TTS-ComfyUI; do not use richservo for v1.5 because its documented catalog targets older 24 kHz models.
2. Use MossTTSContinueSpeech for prefix audio + exact prefix transcript + continuation text, and MossTTSVoiceClone for text + one audio reference without a transcript.
3. Set the loader to MOSS-TTS Local Transformer v1.5, dtype=auto, attention=sdpa, and keep one root PixaromaRunTimer.
4. Download model.safetensors to models/mosstts/moss-tts-local-transformer-v1.5/ and codec index plus all three shards to models/mosstts/moss-audio-tokenizer-v2/; actual total is about 17.6 GB.
5. Add a PixaromaNote with all direct links, exact destinations, disk sizes, and the distinction from the separate 8B Delay checkpoint.
6. Install workflows byte-identically into user/default/workflows/DaWasteh/Voice Design, restart the R9700 server only with an empty queue, and confirm all five MossTTS node types in live object_info.
7. Run refinement against live object_info, update README and validator totals, then run unit tests, validate_workflows.py --against-head, refinement --check, and git diff --check.
8. Queue short live Voice Clone and Continuation tests only when the queue is empty; verify output sample rate, stereo channels, duration, peak, RMS, finiteness, and final empty queue.
## Pitfalls
- The required custom node may not be installed locally; object_info then omits every MossTTS node. Static schema validation is not a substitute for a live run.
- Saganaki22/Moss_TTS-ComfyUI v0.1.2 needs the local native.py Comfy-cast wrapper for MossQwen3RMSNorm on this static-offload R9700 profile; the patch is lost on reinstall. Do not use a direct self.weight.to(input) workaround because it bypasses Comfy memory management.
- Do not trust ComfyUI `/system_stats` vram_free alone after a large job; it can report zero while external torch.cuda.mem_get_info shows free VRAM. Ensure the queue is empty, request model unload, and verify externally before guarding or interrupting.
- For Continuation, duration_tokens describes the total conditioned duration. Setting it equal to the existing prefix duration can yield only a tiny tail; use 0 unless a deliberate total prefix-plus-continuation target is known.
- Do not include the separate OpenMOSS-Team/MOSS-TTS-v1.5 8B Delay shards in Local v1.5 workflow downloads.
- Do not provide a LoRA workflow until a Local v1.5-compatible ComfyUI LoRA loader/trainer exists and passes a safe R9700 smoke test.
- The generic string-effect heuristic must treat prefix_text as text before matching the word prefix as a filename prefix.
## Verification
1. ComfyUI validator reports zero errors and expected collection totals; refinement check reports no changes.
2. Each workflow has one timer, one generated note per functional node, consistent links/IDs, no overlap, and installed copy bytes equal the repository source.
3. Direct Hugging Face links and downloaded Safetensors/index files match required Local model and codec filenames; total disk payload is about 17.6 GB.
4. Live object_info exposes MossTTSModelLoader, MossTTSGenerate, MossTTSVoiceClone, MossTTSContinueSpeech, and MossTTSWhisperTranscribe.
5. Custom-node tests include RMSNorm conversion, Comfy cast-path, and static GPU cross-device coverage and all pass.
6. Voice Clone and Continuation each complete on the R9700 and produce non-empty finite 48 kHz stereo audio with a final empty queue.
