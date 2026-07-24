---
name: build-llama-forks
description: "Build llama.cpp and local forks through the Auto Tuner *_llama_build.txt scripts. Use for mainline/tq/Bonsai/diffusion builds, b9174 UI layout changes, OpenSSL/cpp-httplib failures, and DiffusionGemma Vulkan/HIP decisions."
version: 3
created: "2026-07-17"
updated: "2026-07-17"
---

# Auto Tuner — llama.cpp Fork Build Rules

## Scope
Use the checked-in `*_llama_build.txt` scripts as the source of truth. They encode repo path, generator, targets, and known fork-specific patches.

## Build workflow
- Run the matching build script for the fork instead of hand-writing CMake flags.
- For upstream llama.cpp after b9174, expect layout changes in `tools/server/webui`; preserve cached `node_modules` only when the script explicitly allows it.
- OpenSSL/cpp-httplib `const X509_NAME*` failures are solved by disabling SSL/HTTP extras or by the local patch already documented in the build scripts.
- DiffusionGemma PR #24427 ships `llama-diffusion-gemma-cli`, `llama-diffusion-gemma-server`, and `llama-diffusion-cli`; Auto Tuner default runner is the persistent server.

## DiffusionGemma Vulkan crash triage
The classic `alloc_tensor_range ... Vulkan0 buffer of size 1073741824` has three causes:
1. Broadcast `head_count_kv=[2]` must be expanded to block count or KV is ~30× under-estimated.
2. Vulkan device 0 may be the smaller 9070 XT; forward `--main-gpu` / `--tensor-split` deliberately.
3. Vulkan has a ~1 GiB single-allocation ceiling; build/use a HIP/ROCm variant for that path.

## Pitfalls
- Do not invoke `cargo`/`cmake` ad hoc from memory when a script exists; script drift is the bug source.
- Do not pass unsupported server flags to `llama-diffusion-gemma-server`; capability must be verified against the exact PR binary.
- PR #24427's dedicated server can parse common flags without applying all of them to runtime params. At head `dd0cf044...`, its model/context setup does not copy cache K/V types, expert-only `n_cpu_moe` tensor overrides, `no_kv_offload`, or `main_gpu`/`tensor_split`. AutoTuner must therefore plan this runner as F16 KV, layer-based `-ngl`, VRAM-resident KV, and rely on verified device visibility for hard pinning rather than assuming parsed flags took effect.
- Vulkan's ~1 GiB contiguous-allocation ceiling is separate from total free VRAM. DiffusionGemma Auto context 4096 (~0.47 GiB F16 KV) is safer; use HIP for an explicit 8192 context when its real F16 budget fits.
- MXFP/quant support is model/backend-specific; benchmark rather than guessing.
## Verification
- Build log ends with the expected binaries under the fork's configured output dir.
- `llama-bench` or the AutoTuner benchmark command runs against a real model.
- For DiffusionGemma, inspect the exact binary/source contract instead of equating “accepted by the parser” with “applied to model/context params”. Verify `/health`, one completed prompt, actual KV type/context, GPU placement, and observed VRAM before integrating.
- On Vulkan, verify the selected Auto context avoids a ~1 GiB single allocation; for larger explicit contexts, repeat with the HIP build and compare observed VRAM to the F16 estimate.