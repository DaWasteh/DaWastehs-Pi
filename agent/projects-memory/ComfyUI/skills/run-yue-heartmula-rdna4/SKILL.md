---
name: "run-yue-heartmula-rdna4"
created: "2026-07-28"
description: "Install, patch, validate, and test YuE or HeartMuLa on L:/ComfyUI with the R9700 Windows-ROCm server. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when updating, repairing, benchmarking, or retesting YuE or HeartMuLa workflows on the L:/ComfyUI Windows RDNA4 setup.

## Procedure
1. Keep the shared pins `transformers==4.57.6` and `huggingface-hub==0.36.2`; never replace the custom ROCm PyTorch build with generic Torch/CUDA wheels.
2. YuE models live under `ComfyUI/models/yue`: local Stage 1/2 folders plus `ckpt_00360000.pth`, `decoder_131000.pth`, and `decoder_151000.pth`. The semantic XCodec weight lives under `ComfyUI/custom_nodes/ComfyUI_YuE/inference/xcodec_mini_infer/semantic_ckpts/hf_1_325000/pytorch_model.bin`.
3. For YuE on native Windows ROCm use SDPA, BF16 through the node's `fp16` option, `use_mmgp=False`, Stage-2 batch 1 initially, and no `torch.compile`. Keep soundfile PCM-WAV intermediate I/O because current torchaudio routes through TorchCodec.
4. Run YuE/HeartCodec with classic hipBLAS in `start-R9700.ps1`: `TORCH_BLAS_PREFER_HIPBLASLT=0`, `TORCH_BLAS_PREFER_CUBLASLT=0`, and `DISABLE_ADDMM_CUDA_LT=1`. Their varied Linear/Conv1d shapes otherwise trigger many hipBLASLt `HIPBLAS_STATUS_NOT_SUPPORTED` retries.
5. Keep Hugging Face Stage-1 generation interruptible with a `StoppingCriteria` that calls `comfy.model_management.throw_exception_if_processing_interrupted()`. Preserve the genre/lyrics/ICL prefix when long-form generation slides the 16,384-token context window, dropping oldest generated audio from the middle instead.
6. For Stage-2 durations below six seconds, do not call `stage2_generate` with an empty zero-batch prompt; initialize an empty output and process the whole prompt as the ending chunk.
7. HeartMuLa uses `ComfyUI/custom_nodes/ComfyUI-HeartMuLa` with torchtune 0.4.0, torchao 0.9.0, and vector-quantize-pytorch. Use Happy-New-Year 3B plus HeartCodec 20260123, `torch_compile=False`, modular model/codec offloading, and dynamic decoder duration `tokens.shape[-1] / 12.5`.
8. Validate installed node types through `http://127.0.0.1:8188/object_info`, verify workflow links/model paths programmatically, queue a short API prompt through `/prompt`, and inspect `/history/{prompt_id}` plus `ComfyUI/user/comfyui_8188.log`.
9. After live tests restart `start-R9700.ps1` so no large custom-node model remains retained unintentionally. Confirm port 8188, R9700 device selection, empty queue, and the intended BLAS environment on both matching `main.py --port 8188` processes.

## Pitfalls
- Do not install FlashAttention, Triton, MMGP, exllamav2, or CUDA-specific quantization to make YuE work on native Windows ROCm. Their missing-module warnings belong to unrelated optional nodes.
- TorchCodec 0.15 installs but does not load with this custom PyTorch 2.12 ROCm nightly/full-shared FFmpeg setup; retain the soundfile WAV patches.
- YuE lyric headers must begin a line in brackets. The upstream `\[(\w+)\]` parser recognizes `[Chorus]` but silently ignores rich labels such as `[Verse 1]`, `[Spoken Intro / Heavy Breathing]`, or `[Instrumental / Synth Solo]`; retain the local line-anchored parser accepting any non-empty bracket label.
- `run_n_segment` only caps how many parsed lyric sections can be used; it does not manufacture sections. At 100 interleaved IDs/second, `target_duration_seconds=540` and `max_new_tokens=3000` require 18 parsed/enabled sections. Seventeen sections allow 510 seconds, or require `max_new_tokens>=3178`; sixteen allow 480 seconds, or require `>=3376`. Prefer adding sections over stretching much beyond 3000 tokens per section.
- Old YuE guidance saying `run_n_segment=2` is obsolete for the local duration-planning patch: a 5-second one-section smoke test now uses `run_n_segment=1` and 500 planned codec IDs. Stage 2 must include the sub-six-second fix.
- Forced duration and enough sections do not guarantee long-range quality. Preserve the ICL prefix across context sliding; generated audio still loses oldest continuation context, and long runs lack resume checkpoints.
- When locating the server with psutil, exclude the inspector process and match `args[1] == 'main.py'` plus the separate `--port 8188` argument; joined-string matching sees its own command source.
- Do not create YuE or HeartMuLa ComfyUI LoRA workflows until real model-specific trainer/adapter-loader nodes exist. Current official/community training paths are CUDA/Linux or external SimpleTuner workflows.
## Verification
1. PowerShell parser accepts `start-R9700.ps1`; matching server processes expose BLAS values `0`, `0`, and `1` for hipBLASLt, CUBLASLt alias, and addmm-Lt disable.
2. `py_compile` passes for `yue_node.py`, `inference/infer.py`, and `inference/xcodec_mini_infer/vocoder.py`; the short-duration Stage-2 unit probe calls generation once with a non-empty `(1, 250)` prompt.
3. Test rich lyric headers against the live server before model loading. The HeartMuLa example previously detected only four simple headers; the local parser now detects all 17. At 540 seconds/3000 tokens the live validation must report 17 sections, a 510-second maximum, and the exact `max_new_tokens>=3178` alternative.
4. A validated YuE ICL smoke test produced `ComfyUI/output/audio/YuE_ICL_5s_FinalSmoke__00001.mp3`: 5.00 seconds, 44.1-kHz mono, non-silent, completed in about 145 seconds.
5. The current `ComfyUI/user/comfyui_8188.log` contains zero `HIPBLAS_STATUS_NOT_SUPPORTED`, `gemm_and_bias`, `bgemm_internal_cublaslt`, tensor-copy, traceback, or error lines for the final smoke run.
6. HeartMuLa live verification remains non-silent 48-kHz stereo; established prior test was 8.08 seconds in 42.4 seconds.
7. No Git commit or push is made unless the user explicitly requests it.
