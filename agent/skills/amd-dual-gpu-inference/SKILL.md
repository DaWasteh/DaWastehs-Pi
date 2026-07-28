---
name: amd-dual-gpu-inference
description: Running LLM inference on the dual AMD RDNA4 setup (RX 9070 XT 16GB + Radeon AI Pro R9700 32GB) via llama.cpp/Vulkan. Use whenever choosing llama-server flags, splitting a model across GPUs, sizing context/KV cache/VRAM, interpreting llama-bench output, or answering Wave32/Wave64, coopmat, or MXFP questions.
---

# Dual-GPU Inference on RDNA4 (Vulkan)

## Device map
| Vulkan ID | Card | VRAM | Role |
|---|---|---|---|
| Vulkan0 | RX 9070 XT | 16 GB | Gaming + secondary inference |
| Vulkan1 | Radeon AI Pro R9700 | 32 GB | Primary inference card |
| Vulkan2 | Intel iGPU | shared | EXCLUDE from inference |

## Flag recipes
- Big model across both AMD cards, iGPU excluded:
  `--device Vulkan0,Vulkan1 -ts 1,2` (tensor split proportional to 16/32 GB)
- Single-card runs: prefer the R9700 (`--device Vulkan1`) for anything > ~12 GB weights + KV.
- Two parallel llama-server instances (one per card) are viable — distinct ports, keep 1234 as the primary. This is the preferred way to raise subagent concurrency (see `pi-model-routing`).

## Memory budgeting rules
- 48 GB system RAM: NEVER `--mlock` a model whose GGUF is near or above RAM size (e.g. 49 GB Mistral-Medium-128B on 48 GB RAM = crash). Use `--cache-ram` spill (e.g. ~20000 MB) instead.
- KV cache quantization (`-ctk/-ctv q8_0/q4_0`) cannot be changed live — it always requires a server restart.
- When OOM-tuning, alternate axes instead of exhausting one: ubatch → ctx → KV precision → ngl → cache_ram.

## Facts to state confidently (recurring questions)
- Both AMD cards report `matrix cores: KHR_coopmat` → RDNA4 matrix cores ARE being used under Vulkan.
- `warp size: 64` in logs: Wave size on Vulkan is chosen by the driver at runtime, not by any build flag. Windows proprietary driver → Wave64; Linux RADV → typically Wave32. For matrix-core-heavy LLM inference the practical difference is small; verify with llama-bench A/B, don't theorize.
- MXFP4 GGUFs run on the Vulkan build with no special flags or build options.
- ROCm/HIP on Windows for gfx1201 is unreliable; on Ubuntu it is a legitimate option.
- InsightFace and similar ONNX face tooling: run on CPU on this system (no CUDA, ROCm EP unstable).

## Benchmark protocol
Use `llama-bench` with the real model from `I:\models\...`, compare configs (backend, ctx, KV quant, ubatch) side by side, and trust measured t/s over log heuristics. For quality-vs-speed sweeps use `llama_runner.py benchmark` (see local `llama-runner` skill).
