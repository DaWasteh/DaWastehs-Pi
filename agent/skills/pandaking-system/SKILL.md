---
name: "pandaking-system"
description: "Hardware, OS, directory, and toolchain facts for Basti's Pandaking workstation. Use when commands, paths, builds, GPU/VRAM, or OS behavior depend on this machine; do not treat remembered drive paths as task authorization."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for machine-specific commands, scripts, path selection, build settings, GPU/VRAM assumptions, or Windows/Ubuntu behavior. Explicit current user paths and live system evidence override remembered locations. Ask when parallel lab trees make the target ambiguous.

## Procedure
1. Match the user's language; keep code, code comments, and commit messages in English unless the repository says otherwise.
2. Use the fixed hardware facts: Core Ultra 9 285K (24 threads; build parallelism normally 20), RX 9070 XT 16 GB, Radeon AI Pro R9700 32 GB, Intel iGPU, 48 GB RAM, MSI MEG Z890 UNIFY-X, Secure Boot disabled. Never propose CUDA-only paths.
3. Distinguish OS identities: Windows `Pandaking`/`C:\Users\Sebas`; Ubuntu `KillMicroslop`/`/home/dawasteh`. Windows prefers Vulkan; Ubuntu can use ROCm/HIP.
4. Resolve the task's actual drive before using remembered lab paths. Common roots include `C:\LAB\ai-local`, `H:\LAB\ai-local`, `I:\models`, and `C:\Users\Sebas\.pi`, but they are context, not defaults that override the request.
5. Use VS 2026 (`"Visual Studio 18 2026"`, toolset v180), CMake >=4.2, Node >=22, and modern Python. Apply `powershell-windows-scripting` only for Windows scripting work.
6. Check port 1234 before starting another llama-server. Keep model families in separate `I:\models\<family>` folders.
7. Before boot/ESP operations, manually load `dualboot-separated-drives` and re-observe device mappings.

## Pitfalls
- There is no NVIDIA GPU.
- Nine drives and parallel lab trees make remembered drive/device assumptions unsafe.
- A machine fact does not authorize package installation, cleanup, restart, or destructive action.
- macOS is a shipping target for some projects but is not locally testable here.

## Verification
1. For path-sensitive work, confirm the target path/drive exists or ask the user.
2. For hardware-sensitive work, use current command/log evidence when it can drift (device order, free VRAM, port/process state).
3. Do not run a broad hardware inventory when the task does not depend on it.
