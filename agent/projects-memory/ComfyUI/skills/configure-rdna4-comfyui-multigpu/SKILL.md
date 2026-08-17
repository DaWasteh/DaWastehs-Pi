---
name: configure-rdna4-comfyui-multigpu
description: "Enable and validate native RDNA4 multi-GPU ComfyUI on H:/ComfyUI. Use for launcher edits, R9700/9070 mapping, P2P/CPU-staging behavior, solo R9700 crash-avoidance, or DisTorch/MultiGPU workflow routing. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# ComfyUI RDNA4 Multi-GPU Launcher Rules

## Environment
- Project: `H:/ComfyUI` on Windows RDNA4.
- Devices expected by the launcher probe: `cuda:0` = Radeon AI Pro R9700 (~31.86 GB), `cuda:1` = RX 9070 XT (~15.92 GB).
- Also consult `comfyui-amd-workflows` for workflow JSON editing and AMD/no-CUDA rules.

## Launcher invariants
- Set `HIP_VISIBLE_DEVICES` and `CUDA_VISIBLE_DEVICES` before any Python/Torch import; use `0,1` for R9700 primary + 9070 secondary.
- Keep BLAS workarounds before import: `TORCH_BLAS_PREFER_HIPBLASLT=0`, `TORCH_BLAS_PREFER_CUBLASLT=0`, `DISABLE_ADDMM_CUDA_LT=1`.
- Keep CPU helper thread env vars at `[Environment]::ProcessorCount` to document the 24-thread setup.
- Safe multi-GPU profile: `--cuda-device 0,1 --default-device 0 --enable-dynamic-vram --async-offload 1 --reserve-vram 4 --disable-pinned-memory`, with a separate sqlite database URL.
- Keep `MGPU_DISABLE_P2P=1`; Windows ROCm/WDDM uses CPU staging unless an explicit diagnostic run sets `MGPU_FORCE_P2P_QUERY=1`.

## Solo R9700 crash-avoidance profile
After any comfy_aimdo access violation, restart the whole Python process — the first crash poisons the process; later LTXAVTEModel/ModelVBAR crashes in the same process are fallout, not independent bugs. The safe solo profile (`start-r9700.ps1`) uses `HIP_VISIBLE_DEVICES=0`, `CUDA_VISIBLE_DEVICES=0`, `--disable-dynamic-vram`, `--disable-async-offload`, `--disable-pinned-memory`, and `--reserve-vram 4`. On AMD, async offload defaults to ON — safe profiles must pass the explicit disable flags (omitting `--enable-dynamic-vram` is not enough). Do not re-enable comfy-aimdo DynamicVRAM for Wan 14B on Windows RDNA4 until upstream fixes the VBAR/VRAMBuffer access violation; startup logs must not contain "DynamicVRAM support detected and enabled" or "Using async weight offloading".

## Workflow routing
- DisTorch donor testing: replace loaders with `CheckpointLoaderSimpleDisTorch2MultiGPU`, `UNETLoaderDisTorch2MultiGPU`, or `UnetLoaderGGUFDisTorch2MultiGPU`; use `compute_device=cuda:0`, `donor_device=cuda:1`, `virtual_vram_gb=4.0`, `eject_models=true`.
- Core acceleration: add MultiGPU CFG Split after model/LoRA nodes and before KSampler; use Select Model/CLIP/VAE Device nodes for manual component routing.
- Keep the ROCm safety patch in `ComfyUI/comfy/samplers.py` that synchronizes output device after multi-GPU copies.

## Pitfalls
- `CUDA_VISIBLE_DEVICES` alone is insufficient on ROCm; set HIP too.
- Do not re-enable direct P2P or pinned memory while debugging stability.
- PowerShell + Bash quoting can corrupt `$vars`; write probes to temp `.py` files when needed.
- MultiGPU is not llama.cpp-style VRAM pooling; selectors/splits and DisTorch each solve different problems.
- In comfy_aimdo crash stacks, ComfyUI-MultiGPU/TiledDiffusion frames are often wrappers only; the decisive frames are `comfy_aimdo.model_vbar.ModelVBAR` and `comfy_aimdo.vram_buffer.VRAMBuffer`.

## Verification
```powershell
cd H:/ComfyUI/ComfyUI
../.venv/Scripts/python.exe -m py_compile custom_nodes/ComfyUI-MultiGPU/p2p_registry.py custom_nodes/ComfyUI-MultiGPU/__init__.py comfy/samplers.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$errs=@();$tokens=@();[System.Management.Automation.Language.Parser]::ParseFile("H:\ComfyUI\start-rdna4-multigpu.ps1",[ref]$tokens,[ref]$errs)|Out-Null;if($errs.Count){$errs|Format-List *;exit 1}else{Write-Host "PowerShell parse OK"}'
```

With user consent, `start-rdna4-multigpu.ps1 -QuickTestMode` exits 0 and logs CPU staging/P2P disabled plus the expected device map.
