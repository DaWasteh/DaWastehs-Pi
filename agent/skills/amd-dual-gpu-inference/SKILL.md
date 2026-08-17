---
name: "amd-dual-gpu-inference"
description: "Choose llama.cpp/Vulkan devices, tensor splits, KV/context budgets, and benchmarks for Pandaking's RX 9070 XT 16 GB plus R9700 32 GB. Do not use for game rendering, CUDA systems, generic ML installs, or unrelated GPU advice."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for llama-server/llama-bench device flags, model placement, VRAM/KV sizing, coopmat, Wave32/64, MXFP, or dual-server planning on this workstation. Explicit task constraints and observed server output override these recipes.

## Procedure
1. Confirm the current device map before acting: Vulkan0 RX 9070 XT 16 GB, Vulkan1 R9700 32 GB, Vulkan2 Intel iGPU (normally excluded).
2. For a model intentionally split across both AMD cards, start from `--device Vulkan0,Vulkan1 -ts 1,2`. Prefer `--device Vulkan1` for a single-card run needing more than roughly 12 GB for weights plus KV.
3. Budget measured weight, KV, graph, and runtime allocations together. Never use `--mlock` when the GGUF approaches/exceeds the 48 GB system RAM.
4. For OOM work, change one bounded axis at a time: ubatch, context, KV precision, GPU layers, then host cache/spill. KV type changes require a restart.
5. Treat two independent servers on distinct ports/cards as a concurrency option, not as an automatic default. Port 1234 remains primary.
6. Benchmark the real model and compare observed throughput/VRAM rather than inferring performance from one log field.

## Pitfalls
- Vulkan device order is not the same as every HIP/PyTorch device order.
- `warp size: 64` is driver-selected on Windows; it is not fixed by a build flag.
- `KHR_coopmat` means matrix-cooperative support is exposed, not that every kernel is optimal.
- MXFP is a model quantization format, not a reason to switch backend.
- Windows ROCm/HIP for gfx1201 remains fragile; do not replace a working Vulkan path without a task-specific reason.
- InsightFace/ONNX face tooling should default to CPU/DirectML here, not CUDA.

## Verification
1. Run one focused `llama-bench` or server smoke using the target GGUF/config.
2. Confirm only intended devices are selected and record actual context, KV type, throughput, and observed VRAM.
3. Broaden to a configuration sweep only when tuning is the task; stop when the acceptance target is met.
