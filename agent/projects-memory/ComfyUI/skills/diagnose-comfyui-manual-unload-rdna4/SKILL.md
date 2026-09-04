---
name: "diagnose-comfyui-manual-unload-rdna4"
created: "2026-07-31"
description: "Diagnose Alt+shortcut/manual unload leaving RAM or VRAM allocated in Windows RDNA4 ComfyUI. Do not use for unrelated work."
version: 4
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when ComfyUI's Unload Models and Execution Cache command appears to leave models or several GB in RAM/VRAM, or subsequent workflow runs become slower.

## Procedure
1. Confirm the configured keybinding in ComfyUI/user/default/comfy.settings.json and identify whether it invokes Comfy.Memory.UnloadModelsAndExecutionCache.
2. Verify the frontend implementation in comfyui_frontend_package: the command should POST /free with both unload_models=true and free_memory=true.
3. Check that the queue is idle through GET /queue, then capture GET /system_stats and GET /internal/logs/raw.
4. Measure per-process dedicated GPU memory with the Windows GPU Process Memory PDH counter and private/working-set RAM with Get-Process.
5. Reproduce the command with POST /free, wait briefly, then measure again. In logs, a successful execution-cache reset creates a new cache and logs its cache mode.
6. Compare the running server's system_stats torch VRAM values against torch.cuda.mem_get_info() from a fresh short-lived process on the same visible GPU. A running process stuck at zero free while the fresh process sees free VRAM indicates a ROCm/PyTorch runtime accounting failure rather than a bad frontend shortcut.
7. For the known ComfyUI 0.29 RAM-pressure-cache issue, add --cache-classic to both RDNA4 launchers, parse-check the PowerShell scripts, restart ComfyUI, and rerun the same before/after measurements.
8. For a workflow-local memory-pressure workaround, insert KJNodes VRAM Debug as a pass-through between the last sampler latent and VAE Decode. Connect LATENT to any_input and any_output to the VAE samples input; enable unload_all_models, empty_cache, and gc_collect.
9. Optionally add a second pass-through cleanup after VAE Decode and before Save/Preview to unload the VAE. This helps critical workflow transitions but cannot release ROCm runtime/context allocations.
10. If a global aggressive policy is acceptable, enable --disable-smart-memory. It unloads tracked models aggressively during model transitions and after each prompt, but can slow multi-stage workflows through repeated reloads.
## Pitfalls
- Do not blame --reserve-vram for allocated memory; it is headroom used by ComfyUI's load decisions, not a fixed allocation.
- Task Manager or the PDH Dedicated Usage counter includes ROCm runtime allocations outside PyTorch's caching allocator; compare it with torch reserved bytes instead of treating all dedicated usage as a loaded model.
- The launcher change has no effect on an already-running server; a full ComfyUI process restart is required.
- Do not restart or terminate the user's active ComfyUI server without permission.
- If --cache-classic still leaves several GB and the running process's mem_get_info remains stuck at zero, only a process restart may fully recover it; investigate the current PyTorch/ROCm nightly rather than piling on cache flags.
- Unload/VRAM-cleanup nodes call the same ComfyUI unload and torch cache APIs as the manual command. They can prevent transition-time OOMs but cannot make Task Manager return to zero or release driver/runtime high-water allocations.
- Do not place an unload node before a model's final consumer. For ACE-Step, the safe first boundary is after KSampler and before VAEDecodeAudio; an optional second boundary is after VAEDecodeAudio.
- Prefer workflow-local cleanup over --disable-smart-memory for multi-stage workflows that reuse models, because the global flag can force expensive reloads.
## Verification
1. Both start-R9700.ps1 and start-9070XT.ps1 pass the PowerShell parser.
2. Startup logs say the classic cache is in use rather than 'Using RAM pressure cache'.
3. After an idle POST /free, tracked PyTorch reserved VRAM falls to its small baseline and subsequent workflow runs no longer enter unnecessary offload/low-VRAM paths.
4. The second execution of the same workflow is not slower than the first for memory-management reasons.
