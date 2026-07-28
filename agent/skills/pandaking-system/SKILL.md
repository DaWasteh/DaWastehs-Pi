---
name: pandaking-system
description: Core system context for Basti's workstation "Pandaking". ALWAYS consult this before running shell commands, writing scripts, choosing file paths, or making hardware/VRAM assumptions. Covers hardware specs, dual-boot layout, directory conventions, and OS-specific rules for Windows 11 and Ubuntu 26.04.
---

# Pandaking System Context

## Identity
- Windows hostname: `Pandaking`, user `Sebas` (home `C:\Users\Sebas`). Ubuntu hostname: `KillMicroslop`, user `dawasteh` (home `/home/dawasteh`, German locale — Desktop is `Schreibtisch`).
- Primary OS: Windows 11. Secondary OS: Ubuntu 26.04 on its own solo-boot SSD (used for ROCm/Linux-only AI workloads).
- Language: respond in German or English matching the user; keep code, comments and commit messages in English.

## Hardware (do not guess — these are fixed facts)
- CPU: Intel Core Ultra 9 285K (24 threads; use `--parallel 20` for builds)
- GPU 0: AMD Radeon RX 9070 XT — 16 GB VRAM, RDNA4, gfx1201
- GPU 1: AMD Radeon AI Pro R9700 — 32 GB VRAM, RDNA4, gfx1201
- iGPU: Intel (shows up as a third Vulkan device — usually exclude it)
- RAM: 48 GB DDR5
- Board: MSI MEG Z890 UNIFY-X, Secure Boot DISABLED
- Storage: nine drives, multiple NVMe SSDs. Never assume a single ESP or single OS disk (see the `dualboot-separated-drives` skill before touching bootloaders).

**There is no NVIDIA hardware. Never propose CUDA-only solutions.** GPU paths are Vulkan (preferred on Windows) or ROCm/HIP (fragile on Windows for gfx1201, usable on Ubuntu).

## Directory conventions (Windows)
- `C:\LAB\ai-local\llama.cpp` — main llama.cpp source build (Vulkan)
- `C:\LAB\ai-local\1bllama.cpp` — separate build for 1-bit "Bonsai" models
- `H:\LAB\ai-local\...` — secondary lab area (e.g. `ocr_b17400_llama.cpp` experimental builds)
- `I:\models` — GGUF model store, organized in named subfolders per family (Mistral, Gemma, Qwen, 1Bit-Bonsai, Frankenmerger, ...). Do NOT flatten into one folder.
- `C:\LAB\llama-mcp-server\` — local filesystem MCP server project
- `C:\Users\Sebas\.pi\` — Pi Coding Agent config root on Windows (`agent\settings.json`, `agent\agents\`, `agent\prompts\`, `agent\extensions\`); on Ubuntu it is `/home/dawasteh/.pi/agent`, with the published GitHub clone at `/home/dawasteh/.pi/DaWastehs-Pi`.

## Toolchain versions
- Visual Studio 2026 (v18.x, toolset v180). CMake generator string is `"Visual Studio 18 2026"` and requires CMake >= 4.2. Never emit `"Visual Studio 17 2022"`.
- CMake via winget (`winget upgrade Kitware.CMake`), Ninja available as fallback generator.
- Node.js >= 22, Python 3.12, Git with Git Bash.
- Default shell: PowerShell. Follow the `powershell-windows-scripting` skill for script style.

## Standing rules
1. Prefer local/free compute (llama.cpp, mostly ~35B GGUFs, models rotate often) for cheap tasks; the cloud API model only for hard reasoning — see `pi-model-routing`.
2. Before destructive disk/boot operations, verify device↔UUID mappings with `blkid`/`lsblk` output; never act on remembered mappings.
3. Local llama-server default port: 1234. Check the port is free before starting a new instance.
4. When file paths matter, ask which drive (`C:` vs `H:` LAB trees exist in parallel) instead of assuming.
